import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2DomainEvent,
  type Project,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WorkReport from "./WorkReport.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" };
const createdAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

const applyProject = (input: {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}) =>
  Effect.gen(function* () {
    const store = yield* ProjectStore.ProjectStoreV2;
    if (Option.isSome(yield* store.get(input.projectId))) return;
    yield* store.apply({
      sequence: 1,
      eventId: EventId.make(`event:${input.projectId}:created`),
      aggregateKind: "project",
      aggregateId: input.projectId,
      occurredAt: DateTime.formatIso(createdAt),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: input.projectId,
        title: input.title,
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(createdAt),
        updatedAt: DateTime.formatIso(createdAt),
      },
    });
  });

const applyEvents = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    for (const event of events) yield* store.apply(event);
  });

const threadCreated = (input: {
  readonly threadId: string;
  readonly projectId: ProjectId;
  readonly title?: string;
  readonly settledAt?: string | null;
  readonly subagentOf?: string;
  readonly pullRequestUrls?: ReadonlyArray<string>;
}): OrchestrationV2DomainEvent => {
  const threadId = ThreadId.make(input.threadId);
  const settledAt = input.settledAt ?? null;
  return {
    id: EventId.make(`event:${input.threadId}:created`),
    type: "thread.created",
    threadId,
    providerInstanceId,
    occurredAt: createdAt,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: input.projectId,
      title: input.title ?? input.threadId,
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: (input.pullRequestUrls ?? []).map((url, index) => ({
        host: "github.com",
        repository: "acme/client-app",
        number: index + 1,
        url,
        source: index === 0 ? "created" : "stack-dismissed",
        linkedAt: "2026-01-01T00:00:00.000Z",
        snapshot: null,
        stack: null,
      })),
      activeProviderThreadId: null,
      lineage:
        input.subagentOf === undefined
          ? { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId }
          : {
              parentThreadId: ThreadId.make(input.subagentOf),
              relationshipToParent: "subagent",
              rootThreadId: ThreadId.make(input.subagentOf),
            },
      forkedFrom: null,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      settledOverride: settledAt === null ? null : "settled",
      settledAt: settledAt === null ? null : DateTime.makeUnsafe(settledAt),
      lastVisitedAt: null,
      deletedAt: null,
    },
  };
};

/** The v2 services WorkReport calls, backed by the real projection and project stores. */
const layerServices = Layer.unwrap(
  Effect.gen(function* () {
    const projectStore = yield* ProjectStore.ProjectStoreV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const toProject = (row: ProjectStore.ProjectRow): Project => ({
      id: row.projectId,
      title: row.title,
      workspaceRoot: row.workspaceRoot,
      repositoryIdentity: null,
      faviconPath: row.faviconPath,
      defaultModelSelection: row.defaultModelSelection,
      defaultThreadEnvMode: row.defaultThreadEnvMode,
      autoPull: row.autoPull,
      projectIcon: row.projectIcon,
      scripts: row.scripts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
    const provideStores = <A, E>(
      effect: Effect.Effect<A, E, ProjectStore.ProjectStoreV2 | ProjectionStore.ProjectionStoreV2>,
    ) =>
      effect.pipe(
        Effect.provideService(ProjectStore.ProjectStoreV2, projectStore),
        Effect.provideService(ProjectionStore.ProjectionStoreV2, projectionStore),
        Effect.orDie,
      );
    return Layer.mergeAll(
      Layer.mock(ProjectService.ProjectService)({
        bootstrap: (input) =>
          provideStores(
            Effect.gen(function* () {
              const existing = yield* projectStore.findActiveByWorkspaceRoot(input.workspaceRoot);
              if (Option.isSome(existing)) {
                return { project: toProject(existing.value), created: false };
              }
              yield* applyProject(input);
              const created = yield* projectStore.get(input.projectId);
              return { project: toProject(Option.getOrThrow(created)), created: true };
            }),
          ),
        getById: (projectId) =>
          provideStores(projectStore.get(projectId).pipe(Effect.map(Option.map(toProject)))),
        listShells: (options) => provideStores(projectStore.listShells(options)),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: (threadId) => provideStores(projectionStore.getThreadShell(threadId)),
        getThreadRecords: (threadId, fields, filter) =>
          provideStores(projectionStore.getThreadRecords(threadId, fields, filter)),
      }),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: (input) =>
          provideStores(
            Effect.gen(function* () {
              const threadId = input.threadId!;
              yield* applyEvents([
                threadCreated({
                  threadId,
                  projectId: input.projectId,
                  title: input.title,
                }),
              ]);
              const projection = yield* projectionStore.getThreadProjection(threadId);
              return { threadId, projection, resumed: false };
            }),
          ),
      }),
    );
  }),
);

const testLayer = () =>
  WorkReport.layer.pipe(
    Layer.provideMerge(layerServices),
    Layer.provideMerge(Layer.mergeAll(ProjectionStore.layer, ProjectStore.layer)),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
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

const clientProject = {
  projectId: ProjectId.make("client"),
  title: "Client app",
  workspaceRoot: "/work/client-app",
};

it.effect("start creates the reports folder, project, and instructions, then reuses the run", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projections = yield* ProjectionStore.ProjectionStoreV2;

    const first = yield* startReport;
    expect(first.started).toBe(true);
    expect(yield* fileSystem.exists(path.join(first.folder, "AGENTS.md"))).toBe(true);
    const thread = yield* projections.getThreadShell(first.threadId);
    expect(thread?.projectId).toBe(first.projectId);

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
    yield* applyProject(clientProject);
    yield* applyEvents([
      threadCreated({
        threadId: "in-window",
        projectId: clientProject.projectId,
        settledAt: hoursBefore(run.windowEnd, day),
        pullRequestUrls: [
          "https://github.com/acme/client-app/pull/1",
          "https://github.com/acme/client-app/pull/2",
        ],
      }),
      threadCreated({
        threadId: "too-old",
        projectId: clientProject.projectId,
        settledAt: hoursBefore(run.windowEnd, 8 * day),
      }),
      threadCreated({
        threadId: "after-window",
        projectId: clientProject.projectId,
        settledAt: hoursBefore(run.windowEnd, -1),
      }),
      threadCreated({ threadId: "active", projectId: clientProject.projectId }),
      threadCreated({
        threadId: "subagent",
        projectId: clientProject.projectId,
        settledAt: hoursBefore(run.windowEnd, day),
        subagentOf: "in-window",
      }),
      threadCreated({
        threadId: "earlier-report",
        projectId: run.projectId,
        settledAt: hoursBefore(run.windowEnd, day),
      }),
    ]);

    const result = yield* workReport.listSettledThreads(run.threadId);
    expect(result.threads.map((thread) => thread.threadId)).toEqual(["in-window"]);
    expect(result.threads[0]).toMatchObject({
      projectTitle: "Client app",
      workspaceRoot: "/work/client-app",
      pullRequests: ["https://github.com/acme/client-app/pull/1"],
    });

    const error = yield* Effect.flip(workReport.listSettledThreads(ThreadId.make("in-window")));
    expect(error.message).toContain("not the running work report");
  }).pipe(Effect.scoped, Effect.provide(testLayer())),
);

it.effect("digests turns with the final answer, changed files, and failures, in pages", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const run = yield* startReport;
    const threadId = ThreadId.make("worked");
    yield* applyProject(clientProject);
    yield* applyEvents([
      threadCreated({
        threadId,
        projectId: clientProject.projectId,
        settledAt: hoursBefore(run.windowEnd, 1),
      }),
    ]);
    const long = "x".repeat(5_000);
    const event = (id: string, at: DateTime.Utc) => ({
      id: EventId.make(`event:${id}`),
      threadId,
      occurredAt: at,
    });
    const message = (input: {
      readonly id: string;
      readonly runId: RunId;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly at: DateTime.Utc;
    }): OrchestrationV2DomainEvent => ({
      ...event(input.id, input.at),
      type: "message.updated",
      payload: {
        createdBy: input.role === "user" ? "user" : "agent",
        creationSource: "web",
        id: MessageId.make(input.id),
        threadId,
        runId: input.runId,
        nodeId: null,
        role: input.role,
        text: input.text,
        attachments: [],
        streaming: false,
        createdAt: input.at,
        updatedAt: input.at,
      },
    });
    const command = (input: {
      readonly id: string;
      readonly runId: RunId;
      readonly ordinal: number;
      readonly command: string;
      readonly exitCode: number;
      readonly at: DateTime.Utc;
    }): OrchestrationV2DomainEvent => ({
      ...event(input.id, input.at),
      type: "turn-item.updated",
      payload: {
        id: TurnItemId.make(input.id),
        threadId,
        runId: input.runId,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: input.ordinal,
        status: input.exitCode === 0 ? "completed" : "failed",
        title: null,
        startedAt: input.at,
        completedAt: input.at,
        updatedAt: input.at,
        type: "command_execution",
        input: input.command,
        output: "y".repeat(10_000),
        exitCode: input.exitCode,
      },
    });

    for (let index = 0; index < 7; index++) {
      const at = DateTime.makeUnsafe(`2026-02-01T00:0${index}:00.000Z`);
      const answeredAt = DateTime.makeUnsafe(`2026-02-01T00:0${index}:30.000Z`);
      const runId = RunId.make(`run-${index}`);
      const checkpointId = index === 0 ? CheckpointId.make("checkpoint-0") : null;
      yield* applyEvents([
        message({
          id: `user-${index}`,
          runId,
          role: "user",
          text: index === 0 ? "Fix the login bug" : long,
          at,
        }),
        {
          ...event(`run-${index}`, at),
          type: "run.created",
          payload: {
            id: runId,
            threadId,
            ordinal: index + 1,
            providerInstanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make(`user-${index}`),
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed",
            requestedAt: at,
            startedAt: at,
            completedAt: answeredAt,
            checkpointId,
            contextHandoffId: null,
          },
        },
        message({ id: `progress-${index}`, runId, role: "assistant", text: "Looking.", at }),
        message({
          id: `answer-${index}`,
          runId,
          role: "assistant",
          text: index === 0 ? "Fixed the token check." : long,
          at: answeredAt,
        }),
      ]);
    }
    const turnZero = DateTime.makeUnsafe("2026-02-01T00:00:10.000Z");
    yield* applyEvents([
      command({
        id: "failed",
        runId: RunId.make("run-0"),
        ordinal: 1,
        command: "pnpm test",
        exitCode: 1,
        at: turnZero,
      }),
      command({
        id: "passed",
        runId: RunId.make("run-0"),
        ordinal: 2,
        command: "pnpm lint",
        exitCode: 0,
        at: turnZero,
      }),
      {
        ...event("checkpoint-0", turnZero),
        type: "checkpoint.captured",
        payload: {
          id: CheckpointId.make("checkpoint-0"),
          threadId,
          scopeId: CheckpointScopeId.make("scope-0"),
          runId: RunId.make("run-0"),
          nodeId: NodeId.make("node-0"),
          parentCheckpointId: null,
          ordinalWithinScope: 1,
          appRunOrdinal: 1,
          ref: CheckpointRef.make("refs/t3/checkpoint-0"),
          status: "ready",
          files: [{ path: "src/login.ts", kind: "modified", additions: 3, deletions: 1 }],
          capturedAt: turnZero,
        },
      },
    ]);

    const first = yield* workReport.getThreadDigest({
      reportThreadId: run.threadId,
      threadId,
      cursor: 0,
    });
    expect(first.totalTurns).toBe(7);
    expect(first.turns[0]).toEqual({
      index: 0,
      requestedAt: "2026-02-01T00:00:00.000Z",
      user: "Fix the login bug",
      assistant: "Fixed the token check.",
      filesChanged: ["modified src/login.ts (+3 -1)"],
      problems: ["Command failed (exit 1): pnpm test"],
    });
    expect(first.nextCursor).not.toBeNull();
    expect(first.turns.length).toBe(first.nextCursor);

    const rest = yield* workReport.getThreadDigest({
      reportThreadId: run.threadId,
      threadId,
      cursor: first.nextCursor!,
    });
    expect(rest.nextCursor).toBeNull();
    expect(first.turns.length + rest.turns.length).toBe(7);
  }).pipe(Effect.scoped, Effect.provide(testLayer())),
);

it.effect("digests a thread imported from v1, whose messages have no runs", () =>
  Effect.gen(function* () {
    const workReport = yield* WorkReport.WorkReport;
    const run = yield* startReport;
    const threadId = ThreadId.make("imported");
    yield* applyProject(clientProject);
    const message = (id: string, role: "user" | "assistant", text: string, iso: string) => {
      const at = DateTime.makeUnsafe(iso);
      return {
        id: EventId.make(`event:${id}`),
        threadId,
        occurredAt: at,
        type: "message.updated",
        payload: {
          createdBy: role === "user" ? "user" : "agent",
          creationSource: "web",
          id: MessageId.make(id),
          threadId,
          runId: null,
          nodeId: null,
          role,
          text,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      } satisfies OrchestrationV2DomainEvent;
    };
    yield* applyEvents([
      threadCreated({
        threadId,
        projectId: clientProject.projectId,
        settledAt: hoursBefore(run.windowEnd, 1),
      }),
      message("ask-1", "user", "Rename the field", "2026-02-01T00:00:00.000Z"),
      message("note-1", "assistant", "Looking.", "2026-02-01T00:00:10.000Z"),
      message("answer-1", "assistant", "Renamed it.", "2026-02-01T00:00:20.000Z"),
      message("ask-2", "user", "Ship it", "2026-02-01T00:01:00.000Z"),
    ]);

    const digest = yield* workReport.getThreadDigest({
      reportThreadId: run.threadId,
      threadId,
      cursor: 0,
    });
    expect(digest.turns.map(({ user, assistant }) => ({ user, assistant }))).toEqual([
      { user: "Rename the field", assistant: "Renamed it." },
      { user: "Ship it", assistant: null },
    ]);
    const listed = yield* workReport.listSettledThreads(run.threadId);
    expect(listed.threads.find((thread) => thread.threadId === threadId)?.turnCount).toBe(2);
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
