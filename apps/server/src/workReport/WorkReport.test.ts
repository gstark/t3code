import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WorkReport from "./WorkReport.ts";

const testLayer = () =>
  WorkReport.layer.pipe(
    Layer.provideMerge(
      OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationProjectionPipelineLive),
      ),
    ),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-work-report-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );

/** Starts a report in a fresh reports folder and returns its thread and window end. */
const startReport = Effect.gen(function* () {
  const workReport = yield* WorkReport.WorkReport;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(yield* fileSystem.makeTempDirectoryScoped(), "reports");
  const started = yield* workReport.start({ folder });
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
  return {
    folder,
    threadId: started.threadId,
    started: started.started,
    projectId: settings.workReport.projectId!,
    windowEnd: settings.workReport.activeRun!.windowEnd,
  };
});

const hoursBefore = (iso: string, hours: number) =>
  DateTime.formatIso(DateTime.subtract(DateTime.makeUnsafe(iso), { hours }));

const insertSettledThread = (input: {
  readonly threadId: string;
  readonly projectId: string;
  readonly settledAt: string | null;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES (${input.projectId}, 'Client app', '/work/client-app', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, created_at, updated_at,
        settled_override, settled_at
      ) VALUES (
        ${input.threadId}, ${input.projectId}, ${input.threadId},
        '{"instanceId":"codex","model":"gpt-5.4"}', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', ${input.settledAt === null ? null : "settled"},
        ${input.settledAt}
      )
    `;
  });

it.effect("start creates the reports folder, project, and instructions, then reuses the run", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;

    const first = yield* startReport;
    expect(first.started).toBe(true);
    expect(yield* fileSystem.exists(path.join(first.folder, "AGENTS.md"))).toBe(true);
    const thread = yield* snapshots.getThreadShellById(first.threadId);
    expect(thread._tag === "Some" && thread.value.projectId).toBe(first.projectId);

    const again = yield* workReport.start({});
    expect(again).toEqual({ threadId: first.threadId, started: false });
  }).pipe(Effect.scoped, Effect.provide(testLayer())),
);

it.effect("start fails until a reports folder is chosen", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const error = yield* Effect.flip(workReport.start({}));
    expect(error.message).toBe("Choose a reports folder first.");
  }).pipe(Effect.provide(testLayer())),
);

it.effect("lists only threads settled in the window, outside the reports project", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const run = yield* startReport;
    const day = 24;
    yield* insertSettledThread({
      threadId: "in-window",
      projectId: "client",
      settledAt: hoursBefore(run.windowEnd, day),
    });
    yield* insertSettledThread({
      threadId: "too-old",
      projectId: "client",
      settledAt: hoursBefore(run.windowEnd, 8 * day),
    });
    yield* insertSettledThread({
      threadId: "after-window",
      projectId: "client",
      settledAt: hoursBefore(run.windowEnd, -1),
    });
    yield* insertSettledThread({ threadId: "active", projectId: "client", settledAt: null });
    yield* insertSettledThread({
      threadId: "earlier-report",
      projectId: run.projectId,
      settledAt: hoursBefore(run.windowEnd, day),
    });

    const result = yield* workReport.listSettledThreads(run.threadId);
    expect(result.threads.map((thread) => thread.threadId)).toEqual(["in-window"]);
    expect(result.threads[0]).toMatchObject({
      projectTitle: "Client app",
      workspaceRoot: "/work/client-app",
    });

    const error = yield* Effect.flip(workReport.listSettledThreads(ThreadId.make("in-window")));
    expect(error.message).toContain("not the running work report");
  }).pipe(Effect.scoped, Effect.provide(testLayer())),
);

it.effect("digests turns with the final answer, changed files, and failures, in pages", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const sql = yield* SqlClient.SqlClient;
    const run = yield* startReport;
    yield* insertSettledThread({
      threadId: "worked",
      projectId: "client",
      settledAt: hoursBefore(run.windowEnd, 1),
    });
    const long = "x".repeat(5_000);
    for (let index = 0; index < 7; index++) {
      const at = `2026-02-01T00:0${index}:00.000Z`;
      yield* sql`
        INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
        VALUES (${`user-${index}`}, 'worked', NULL, 'user', ${index === 0 ? "Fix the login bug" : long}, 0, ${at}, ${at})
      `;
      yield* sql`
        INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, checkpoint_turn_count, checkpoint_files_json)
        VALUES ('worked', ${`turn-${index}`}, ${`user-${index}`}, 'completed', ${at}, ${index + 1},
          ${index === 0 ? '[{"path":"src/login.ts","kind":"modified","additions":3,"deletions":1}]' : "[]"})
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
        VALUES
          (${`progress-${index}`}, 'worked', ${`turn-${index}`}, 'assistant', 'Looking.', 0, ${at}, ${at}),
          (${`answer-${index}`}, 'worked', ${`turn-${index}`}, 'assistant', ${index === 0 ? "Fixed the token check." : long}, 0, ${`2026-02-01T00:0${index}:30.000Z`}, ${at})
      `;
    }
    yield* sql`
      INSERT INTO projection_thread_activities (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at)
      VALUES
        ('failed', 'worked', 'turn-0', 'tool', 'tool.completed', 'Ran command',
          '{"status":"failed","detail":"pnpm test"}', '2026-02-01T00:00:10.000Z'),
        ('passed', 'worked', 'turn-0', 'tool', 'tool.completed', 'Ran command',
          '{"status":"completed","detail":"pnpm lint"}', '2026-02-01T00:00:11.000Z')
    `;

    const first = yield* workReport.getThreadDigest({
      reportThreadId: run.threadId,
      threadId: ThreadId.make("worked"),
      cursor: 0,
    });
    expect(first.totalTurns).toBe(7);
    expect(first.turns[0]).toEqual({
      index: 0,
      requestedAt: "2026-02-01T00:00:00.000Z",
      user: "Fix the login bug",
      assistant: "Fixed the token check.",
      filesChanged: ["modified src/login.ts (+3 -1)"],
      problems: ["Ran command: pnpm test"],
    });
    expect(first.nextCursor).not.toBeNull();
    expect(first.turns.length).toBe(first.nextCursor);

    const rest = yield* workReport.getThreadDigest({
      reportThreadId: run.threadId,
      threadId: ThreadId.make("worked"),
      cursor: first.nextCursor!,
    });
    expect(rest.nextCursor).toBeNull();
    expect(first.turns.length + rest.turns.length).toBe(7);
  }).pipe(Effect.scoped, Effect.provide(testLayer())),
);

it.effect("complete moves the cursor to the window end and ends the run", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const settingsService = yield* ServerSettings.ServerSettingsService;
    const run = yield* startReport;

    expect(yield* workReport.complete(run.threadId)).toEqual({ coveredUntil: run.windowEnd });
    const settings = yield* settingsService.getSettings;
    expect(settings.workReport.coveredUntil).toBe(run.windowEnd);
    expect(settings.workReport.activeRun).toBeNull();

    const error = yield* Effect.flip(workReport.complete(run.threadId));
    expect(error.message).toContain("not the running work report");

    const next = yield* workReport.start({});
    expect(next.started).toBe(true);
    expect((yield* settingsService.getSettings).workReport.activeRun?.windowStart).toBe(
      run.windowEnd,
    );
  }).pipe(Effect.scoped, Effect.provide(testLayer())),
);
