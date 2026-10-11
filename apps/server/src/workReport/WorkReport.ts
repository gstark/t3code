import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkReportError,
  type ModelSelection,
  type WorkReportRun,
  type WorkReportStartResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { DEFAULT_REPORT_INSTRUCTIONS } from "./defaultReportInstructions.ts";

/** The first run, with no cursor yet, looks back this far. */
const FIRST_RUN_LOOKBACK_DAYS = 7;
/** Characters of turn content per digest page, so one call fits an agent's context. */
const DIGEST_PAGE_BUDGET = 40_000;
const MESSAGE_LIMIT = 4_000;
const PROBLEM_DETAIL_LIMIT = 400;
const PROBLEMS_PER_TURN = 20;
const FILES_PER_TURN = 50;

const SettledThread = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  projectTitle: Schema.String,
  workspaceRoot: Schema.String,
  repository: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  settledAt: Schema.String,
  turnCount: Schema.Int,
  pullRequests: Schema.Array(Schema.String),
});

export const ListSettledThreadsResult = Schema.Struct({
  windowStart: Schema.String,
  windowEnd: Schema.String,
  threads: Schema.Array(SettledThread),
});

const DigestTurn = Schema.Struct({
  index: Schema.Int,
  requestedAt: Schema.String,
  user: Schema.NullOr(Schema.String),
  assistant: Schema.NullOr(Schema.String),
  filesChanged: Schema.Array(Schema.String),
  problems: Schema.Array(Schema.String),
});
type DigestTurn = typeof DigestTurn.Type;

export const ThreadDigest = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  totalTurns: Schema.Int,
  turns: Schema.Array(DigestTurn),
  nextCursor: Schema.NullOr(Schema.Int),
});

export const CompleteWorkReportResult = Schema.Struct({
  coveredUntil: Schema.String,
});

export class WorkReport extends Context.Service<
  WorkReport,
  {
    /**
     * Starts a report thread in the reports folder project, or returns the one
     * still running. `folder` sets (or changes) the reports folder first; it
     * is created and added as a project when needed.
     */
    readonly start: (input: {
      readonly folder?: string | undefined;
    }) => Effect.Effect<WorkReportStartResult, WorkReportError>;
    /** Threads settled in the window of the running report `reportThreadId`. */
    readonly listSettledThreads: (
      reportThreadId: ThreadId,
    ) => Effect.Effect<typeof ListSettledThreadsResult.Type, WorkReportError>;
    /** A page of one settled thread's turns, starting at turn index `cursor`. */
    readonly getThreadDigest: (input: {
      readonly reportThreadId: ThreadId;
      readonly threadId: ThreadId;
      readonly cursor: number;
    }) => Effect.Effect<typeof ThreadDigest.Type, WorkReportError>;
    /** Moves the cursor to the end of the running report's window. */
    readonly complete: (
      reportThreadId: ThreadId,
    ) => Effect.Effect<typeof CompleteWorkReportResult.Type, WorkReportError>;
  }
>()("t3/workReport/WorkReport") {}

const truncate = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}… [${text.length - limit} more characters]`;

const CheckpointFiles = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      path: Schema.String,
      kind: Schema.optional(Schema.String),
      additions: Schema.optional(Schema.Number),
      deletions: Schema.optional(Schema.Number),
    }),
  ),
);
const decodeCheckpointFiles = Schema.decodeUnknownOption(CheckpointFiles);

const describeFiles = (json: string | null): ReadonlyArray<string> =>
  Option.match(json === null ? Option.none() : decodeCheckpointFiles(json), {
    onNone: () => [],
    onSome: (files) =>
      files
        .slice(0, FILES_PER_TURN)
        .map(
          (file) =>
            `${file.kind ?? "changed"} ${file.path} (+${file.additions ?? 0} -${file.deletions ?? 0})`,
        ),
  });

const failure = (message: string) => (cause: unknown) => new WorkReportError({ message, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const startLock = yield* Semaphore.make(1);

  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`server:work-report-${tag}:${id}`)));
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const getSettings = settingsService.getSettings.pipe(
    Effect.mapError(failure("Could not read server settings.")),
  );
  const updateWorkReport = (patch: {
    readonly projectId?: ProjectId | null;
    readonly coveredUntil?: string | null;
    readonly activeRun?: WorkReportRun | null;
  }) =>
    settingsService
      .updateSettings({ workReport: patch })
      .pipe(Effect.mapError(failure("Could not save the work report settings.")));

  /** Finds or adds the project rooted at `folder`, creating the folder if needed. */
  const ensureFolderProject = Effect.fn("WorkReport.ensureFolderProject")(function* (
    folder: string,
  ) {
    const workspaceRoot = yield* workspacePaths
      .normalizeWorkspaceRoot(folder, { createIfMissing: true })
      .pipe(Effect.mapError((cause) => new WorkReportError({ message: cause.message, cause })));
    const existing = yield* snapshots
      .getActiveProjectByWorkspaceRoot(workspaceRoot)
      .pipe(Effect.mapError(failure("Could not look up the reports folder project.")));
    if (Option.isSome(existing)) return existing.value.id;
    const projectId = ProjectId.make(yield* uuid);
    yield* engine
      .dispatch({
        type: "project.create",
        commandId: yield* commandId("project"),
        projectId,
        title: path.basename(workspaceRoot) || "Work reports",
        workspaceRoot,
        createWorkspaceRootIfMissing: true,
        createdAt: yield* nowIso,
      })
      .pipe(Effect.mapError(failure("Could not add the reports folder as a project.")));
    return projectId;
  });

  const writeDefaultInstructions = (workspaceRoot: string) =>
    Effect.gen(function* () {
      const file = path.join(workspaceRoot, "AGENTS.md");
      if (yield* fileSystem.exists(file)) return;
      yield* fileSystem.writeFileString(file, DEFAULT_REPORT_INSTRUCTIONS);
    }).pipe(Effect.mapError(failure("Could not write AGENTS.md in the reports folder.")));

  /** The running report thread, if it still exists and is not archived. */
  const runningThreadId = (run: WorkReportRun | null) =>
    Effect.gen(function* () {
      if (run === null) return null;
      const thread = yield* snapshots
        .getThreadShellById(run.threadId)
        .pipe(Effect.mapError(failure("Could not read the running report thread.")));
      return Option.isSome(thread) && thread.value.archivedAt === null ? run.threadId : null;
    });

  const start: WorkReport["Service"]["start"] = (input) =>
    startLock.withPermits(1)(
      Effect.gen(function* () {
        let settings = yield* getSettings;
        if (input.folder !== undefined) {
          const projectId = yield* ensureFolderProject(input.folder);
          if (projectId !== settings.workReport.projectId) {
            settings = yield* updateWorkReport({ projectId, activeRun: null });
          }
        }
        const { projectId, coveredUntil, activeRun } = settings.workReport;
        if (projectId === null) {
          return yield* new WorkReportError({ message: "Choose a reports folder first." });
        }
        const project = yield* snapshots
          .getProjectShellById(projectId)
          .pipe(Effect.mapError(failure("Could not read the reports folder project.")));
        if (Option.isNone(project)) {
          return yield* new WorkReportError({
            message: "The reports folder project no longer exists. Choose a reports folder again.",
          });
        }

        const running = yield* runningThreadId(activeRun);
        if (running !== null) return { threadId: running, started: false };

        yield* writeDefaultInstructions(project.value.workspaceRoot);

        const now = yield* nowIso;
        const run: WorkReportRun = {
          threadId: ThreadId.make(yield* uuid),
          windowStart: coveredUntil,
          windowEnd: now,
        };
        const resolved = resolveProjectSettings(settings, projectId).settings;
        const modelSelection: ModelSelection = resolved.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
        const since = coveredUntil === null ? "the last 7 days" : coveredUntil;
        yield* engine
          .dispatch({
            type: "thread.create",
            commandId: yield* commandId("thread"),
            threadId: run.threadId,
            projectId,
            title: `Work report ${now.slice(0, 10)}`,
            modelSelection,
            runtimeMode: resolved.defaultRuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: now,
          })
          .pipe(Effect.mapError(failure("Could not create the report thread.")));
        yield* updateWorkReport({ activeRun: run });
        yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: yield* commandId("turn"),
            threadId: run.threadId,
            message: {
              messageId: MessageId.make(yield* uuid),
              role: "user",
              text: `Write the work report for threads settled from ${since} until ${now}. Follow AGENTS.md in this folder.`,
              attachments: [],
            },
            runtimeMode: resolved.defaultRuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt: now,
          })
          .pipe(Effect.mapError(failure("Could not start the report turn.")));
        return { threadId: run.threadId, started: true };
      }),
    );

  /** The window of the running report, which must be `reportThreadId`. */
  const requireRun = Effect.fn("WorkReport.requireRun")(function* (reportThreadId: ThreadId) {
    const settings = yield* getSettings;
    const { projectId, activeRun } = settings.workReport;
    if (projectId === null || activeRun === null || activeRun.threadId !== reportThreadId) {
      return yield* new WorkReportError({
        message:
          "This thread is not the running work report. Start a report from the T3 Code sidebar.",
      });
    }
    const windowStart =
      activeRun.windowStart ??
      DateTime.formatIso(
        DateTime.subtract(DateTime.makeUnsafe(activeRun.windowEnd), {
          days: FIRST_RUN_LOOKBACK_DAYS,
        }),
      );
    return { projectId, run: activeRun, windowStart };
  });

  const listSettledThreads: WorkReport["Service"]["listSettledThreads"] = (reportThreadId) =>
    Effect.gen(function* () {
      const { projectId, run, windowStart } = yield* requireRun(reportThreadId);
      const rows = yield* sql<{
        threadId: string;
        title: string;
        projectId: string;
        projectTitle: string;
        workspaceRoot: string;
        branch: string | null;
        settledAt: string;
        turnCount: number;
        pullRequests: string | null;
      }>`
        SELECT t.thread_id AS "threadId", t.title, t.project_id AS "projectId",
          p.title AS "projectTitle", p.workspace_root AS "workspaceRoot", t.branch,
          t.settled_at AS "settledAt",
          (SELECT COUNT(*) FROM projection_turns AS turn
            WHERE turn.thread_id = t.thread_id AND turn.turn_id IS NOT NULL) AS "turnCount",
          (SELECT GROUP_CONCAT(link.url, char(10)) FROM projection_thread_pull_requests AS link
            WHERE link.thread_id = t.thread_id AND link.source != 'stack-dismissed') AS "pullRequests"
        FROM projection_threads AS t
        JOIN projection_projects AS p ON p.project_id = t.project_id
        WHERE t.deleted_at IS NULL
          AND t.settled_override = 'settled'
          AND t.settled_at > ${windowStart}
          AND t.settled_at <= ${run.windowEnd}
          AND t.project_id != ${projectId}
        ORDER BY t.settled_at ASC
      `.pipe(Effect.mapError(failure("Could not list settled threads.")));
      const projectIds = [...new Set(rows.map((row) => ProjectId.make(row.projectId)))];
      const projects = yield* snapshots
        .getProjectShells(projectIds)
        .pipe(Effect.mapError(failure("Could not read projects.")));
      const repositoryByProject = new Map(
        projects.map((project) => [project.id, project.repositoryIdentity?.canonicalKey ?? null]),
      );
      return {
        windowStart,
        windowEnd: run.windowEnd,
        threads: rows.map((row) => ({
          threadId: row.threadId,
          title: row.title,
          projectTitle: row.projectTitle,
          workspaceRoot: row.workspaceRoot,
          repository: repositoryByProject.get(ProjectId.make(row.projectId)) ?? null,
          branch: row.branch,
          settledAt: row.settledAt,
          turnCount: row.turnCount,
          pullRequests: row.pullRequests === null ? [] : row.pullRequests.split("\n"),
        })),
      };
    });

  const getThreadDigest: WorkReport["Service"]["getThreadDigest"] = (input) =>
    Effect.gen(function* () {
      yield* requireRun(input.reportThreadId);
      const thread = yield* snapshots
        .getThreadShellById(input.threadId)
        .pipe(Effect.mapError(failure("Could not read the thread.")));
      if (Option.isNone(thread)) {
        return yield* new WorkReportError({ message: `Thread ${input.threadId} was not found.` });
      }
      const readRows = Effect.all(
        [
          sql<{
            turnId: string;
            requestedAt: string;
            files: string | null;
            user: string | null;
          }>`
            SELECT turn.turn_id AS "turnId", turn.requested_at AS "requestedAt",
              turn.checkpoint_files_json AS files, message.text AS user
            FROM projection_turns AS turn
            LEFT JOIN projection_thread_messages AS message
              ON message.message_id = turn.pending_message_id
            WHERE turn.thread_id = ${input.threadId} AND turn.turn_id IS NOT NULL
            ORDER BY turn.requested_at ASC, turn.row_id ASC
          `,
          // The last assistant message of each turn is its answer; earlier ones narrate.
          sql<{ turnId: string; text: string }>`
            SELECT message.turn_id AS "turnId", message.text
            FROM projection_thread_messages AS message
            WHERE message.thread_id = ${input.threadId} AND message.role = 'assistant'
              AND message.created_at = (
                SELECT MAX(latest.created_at) FROM projection_thread_messages AS latest
                WHERE latest.thread_id = message.thread_id AND latest.turn_id = message.turn_id
                  AND latest.role = 'assistant'
              )
          `,
          // Extract in SQLite: activity payloads reach megabytes per thread.
          sql<{ turnId: string | null; summary: string; detail: string | null }>`
            SELECT turn_id AS "turnId", summary,
              json_extract(payload_json, '$.detail') AS detail
            FROM projection_thread_activities
            WHERE thread_id = ${input.threadId}
              AND (tone = 'error'
                OR (kind = 'tool.completed' AND json_extract(payload_json, '$.status') = 'failed'))
            ORDER BY created_at ASC
          `,
        ],
        { concurrency: 1 },
      ).pipe(Effect.mapError(failure("Could not read the thread history.")));
      const [turns, answers, problems] = yield* readRows;
      const answerByTurn = new Map(answers.map((row) => [row.turnId, row.text]));
      const problemsByTurn = new Map<string, Array<string>>();
      for (const problem of problems) {
        if (problem.turnId === null) continue;
        const list = problemsByTurn.get(problem.turnId) ?? [];
        if (list.length < PROBLEMS_PER_TURN) {
          const detail = typeof problem.detail === "string" ? `: ${problem.detail}` : "";
          list.push(truncate(`${problem.summary}${detail}`, PROBLEM_DETAIL_LIMIT));
        }
        problemsByTurn.set(problem.turnId, list);
      }

      const cursor = Math.max(0, input.cursor);
      const page: Array<DigestTurn> = [];
      let used = 0;
      let index = cursor;
      for (; index < turns.length; index++) {
        const turn = turns[index]!;
        const answer = answerByTurn.get(turn.turnId);
        const entry: DigestTurn = {
          index,
          requestedAt: turn.requestedAt,
          user: turn.user === null ? null : truncate(turn.user, MESSAGE_LIMIT),
          assistant: answer === undefined ? null : truncate(answer, MESSAGE_LIMIT),
          filesChanged: describeFiles(turn.files),
          problems: problemsByTurn.get(turn.turnId) ?? [],
        };
        const size = [
          entry.user ?? "",
          entry.assistant ?? "",
          ...entry.filesChanged,
          ...entry.problems,
        ].reduce((total, text) => total + text.length, 0);
        if (page.length > 0 && used + size > DIGEST_PAGE_BUDGET) break;
        page.push(entry);
        used += size;
      }
      return {
        threadId: input.threadId,
        title: thread.value.title,
        totalTurns: turns.length,
        turns: page,
        nextCursor: index < turns.length ? index : null,
      };
    });

  const complete: WorkReport["Service"]["complete"] = (reportThreadId) =>
    Effect.gen(function* () {
      const { run } = yield* requireRun(reportThreadId);
      yield* updateWorkReport({ coveredUntil: run.windowEnd, activeRun: null });
      return { coveredUntil: run.windowEnd };
    });

  return WorkReport.of({ start, listSettledThreads, getThreadDigest, complete });
});

export const layer = Layer.effect(WorkReport, make);
