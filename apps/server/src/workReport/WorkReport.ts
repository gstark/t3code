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
  type OrchestrationV2CheckpointFileSummary,
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
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
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

const describeFiles = (files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>) =>
  files
    .slice(0, FILES_PER_TURN)
    .map((file) => `${file.kind} ${file.path} (+${file.additions} -${file.deletions})`);

const describeProblem = (row: {
  readonly type: string;
  readonly input: string | null;
  readonly exitCode: number | null;
  readonly failureMessage: string | null;
}) =>
  truncate(
    row.type === "error"
      ? `Error: ${row.failureMessage ?? "unknown"}`
      : `Command failed${row.exitCode === null ? "" : ` (exit ${row.exitCode})`}: ${row.input ?? ""}`,
    PROBLEM_DETAIL_LIMIT,
  );

const failure = (message: string) => (cause: unknown) => new WorkReportError({ message, cause });

/** One user-to-agent cycle of a digest, before paging. */
interface TurnDraft {
  readonly runId: string | null;
  readonly requestedAt: string;
  user: string | null;
  assistant: string | null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
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
    const { project } = yield* projects
      .bootstrap({
        commandId: yield* commandId("project"),
        projectId: ProjectId.make(yield* uuid),
        title: path.basename(workspaceRoot) || "Work reports",
        workspaceRoot,
      })
      .pipe(Effect.mapError(failure("Could not add the reports folder as a project.")));
    return project.id;
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
      const thread = yield* threads
        .getThreadShell(run.threadId)
        .pipe(Effect.mapError(failure("Could not read the running report thread.")));
      return thread !== null && thread.archivedAt === null && thread.deletedAt === null
        ? run.threadId
        : null;
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
        const project = yield* projects
          .getById(projectId)
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
        const resolved = resolveProjectSettings(settings, projectId, project.value).settings;
        const modelSelection: ModelSelection = resolved.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
        const since = coveredUntil === null ? "the last 7 days" : coveredUntil;
        // Record the run before launching: the report agent calls the work
        // report tools as soon as its turn starts. A launch that fails before
        // the thread exists leaves a run that `runningThreadId` ignores.
        yield* updateWorkReport({ activeRun: run });
        yield* threadLaunch
          .launch({
            commandId: yield* commandId("launch"),
            threadId: run.threadId,
            projectId,
            title: `Work report ${now.slice(0, 10)}`,
            modelSelection,
            runtimeMode: resolved.defaultRuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            workspaceStrategy: { type: "root" },
            initialMessage: {
              messageId: MessageId.make(yield* uuid),
              text: `Write the work report for threads settled from ${since} until ${now}. Follow AGENTS.md in this folder.`,
              attachments: [],
            },
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(Effect.mapError(failure("Could not start the report thread.")));
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
      // No service lists threads by settle time, and the shell snapshot reads
      // every thread's runs and items, so filter the thread rows here. A turn
      // is a run, or a user message imported from v1 without one.
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
          p.title AS "projectTitle", p.workspace_root AS "workspaceRoot",
          json_extract(t.payload_json, '$.branch') AS branch,
          json_extract(t.payload_json, '$.settledAt') AS "settledAt",
          (SELECT COUNT(*) FROM orchestration_v2_projection_runs AS run
            WHERE run.thread_id = t.thread_id AND run.status != 'rolled_back')
          + (SELECT COUNT(*) FROM orchestration_v2_projection_messages AS message
            WHERE message.thread_id = t.thread_id AND message.role = 'user'
              AND message.run_id IS NULL) AS "turnCount",
          (SELECT GROUP_CONCAT(json_extract(link.value, '$.url'), char(10))
            FROM json_each(t.payload_json, '$.pullRequests') AS link
            WHERE json_extract(link.value, '$.source') != 'stack-dismissed') AS "pullRequests"
        FROM orchestration_v2_projection_threads AS t
        JOIN projection_projects AS p ON p.project_id = t.project_id
        WHERE t.deleted_at IS NULL
          AND json_extract(t.payload_json, '$.settledAt') > ${windowStart}
          AND json_extract(t.payload_json, '$.settledAt') <= ${run.windowEnd}
          AND json_extract(t.payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'
          AND t.project_id != ${projectId}
        ORDER BY "settledAt" ASC
      `.pipe(Effect.mapError(failure("Could not list settled threads.")));
      const projectIds = [...new Set(rows.map((row) => ProjectId.make(row.projectId)))];
      const shells = yield* projects
        .listShells({ projectIds })
        .pipe(Effect.mapError(failure("Could not read projects.")));
      const repositoryByProject = new Map(
        shells.map((project) => [project.id, project.repositoryIdentity?.canonicalKey ?? null]),
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
      const thread = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.mapError(failure("Could not read the thread.")));
      if (thread === null) {
        return yield* new WorkReportError({ message: `Thread ${input.threadId} was not found.` });
      }
      // Imports a v1 thread's transcript on first read, so it comes before the SQL below.
      const records = yield* threads
        .getThreadRecords(input.threadId, ["runs", "messages", "checkpoints"], {
          messageRoles: ["user", "assistant"],
        })
        .pipe(Effect.mapError(failure("Could not read the thread history.")));
      // Extract in SQLite: command items carry their full output.
      const problems = yield* sql<{
        runId: string;
        type: string;
        input: string | null;
        exitCode: number | null;
        failureMessage: string | null;
      }>`
        SELECT run_id AS "runId", type,
          substr(json_extract(payload_json, '$.input'), 1, ${PROBLEM_DETAIL_LIMIT}) AS input,
          json_extract(payload_json, '$.exitCode') AS "exitCode",
          json_extract(payload_json, '$.failure.message') AS "failureMessage"
        FROM orchestration_v2_projection_turn_items
        WHERE thread_id = ${input.threadId} AND run_id IS NOT NULL
          AND ((type = 'command_execution' AND (status = 'failed'
                OR json_extract(payload_json, '$.exitCode') != 0
                OR json_extract(payload_json, '$.outputIndicatesFailure') = 1))
            OR (type = 'error' AND json_extract(payload_json, '$.retry') IS NULL))
        ORDER BY ordinal ASC, turn_item_id ASC
      `.pipe(Effect.mapError(failure("Could not read the thread history.")));
      const problemsByRun = new Map<string, Array<string>>();
      for (const problem of problems) {
        const list = problemsByRun.get(problem.runId) ?? [];
        if (list.length < PROBLEMS_PER_TURN) list.push(describeProblem(problem));
        problemsByRun.set(problem.runId, list);
      }

      // A turn is a run. Threads imported from v1 have messages without runs,
      // so there each user message starts a turn.
      const runsById = new Map(records.runs.map((run) => [run.id as string, run]));
      const filesByCheckpoint = new Map(
        records.checkpoints.map((checkpoint) => [checkpoint.id as string, checkpoint.files]),
      );
      const turns: Array<TurnDraft> = [];
      const turnByKey = new Map<string, TurnDraft>();
      let currentKey: string | undefined;
      for (const message of records.messages) {
        const run = message.runId === null ? undefined : runsById.get(message.runId);
        if (run?.status === "rolled_back") continue;
        const key = message.runId ?? (message.role === "user" ? message.id : currentKey);
        if (key === undefined) continue;
        let turn = turnByKey.get(key);
        if (turn === undefined) {
          turn = {
            runId: message.runId,
            requestedAt: DateTime.formatIso(run?.requestedAt ?? message.createdAt),
            user: null,
            assistant: null,
          };
          turnByKey.set(key, turn);
          turns.push(turn);
        }
        if (message.role === "user") {
          // Steering messages join their run; the first message started it.
          turn.user ??= message.text;
          currentKey = key;
        } else {
          // Messages arrive in creation order. The last is the answer; earlier ones narrate.
          turn.assistant = message.text;
        }
      }

      const cursor = Math.max(0, input.cursor);
      const page: Array<DigestTurn> = [];
      let used = 0;
      let index = cursor;
      for (; index < turns.length; index++) {
        const turn = turns[index]!;
        const checkpointId =
          turn.runId === null ? null : (runsById.get(turn.runId)?.checkpointId ?? null);
        const entry: DigestTurn = {
          index,
          requestedAt: turn.requestedAt,
          user: turn.user === null ? null : truncate(turn.user, MESSAGE_LIMIT),
          assistant: turn.assistant === null ? null : truncate(turn.assistant, MESSAGE_LIMIT),
          filesChanged: describeFiles(
            checkpointId === null ? [] : (filesByCheckpoint.get(checkpointId) ?? []),
          ),
          problems: turn.runId === null ? [] : (problemsByRun.get(turn.runId) ?? []),
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
        title: thread.title,
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
