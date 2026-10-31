import { describe, expect, it, vi } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type OrchestrationV2RunStatus,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Projects from "./ProjectStore.ts";
import * as Threads from "./ThreadManagementService.ts";
import * as Suggestions from "./ThreadReplySuggestionService.ts";
import { emptyProjection, threadShellFromProjection } from "./ProjectionStore.ts";

const threadId = ThreadId.make("thread:reply");
const projectId = ProjectId.make("project:reply");
const messageId = MessageId.make("message:reply");
const runId = RunId.make("run:reply");
const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
function fixture(status: OrchestrationV2RunStatus = "completed"): OrchestrationV2ThreadProjection {
  const projection = emptyProjection({
    id: EventId.make("event:reply"),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      id: threadId,
      projectId,
      createdBy: "user",
      creationSource: "web",
      title: "Reply suggestion",
      providerInstanceId: modelSelection.instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: "/repo/worktree",
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  return {
    ...projection,
    runs: [
      {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId: modelSelection.instanceId,
        modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("message:user"),
        rootNodeId: NodeId.make("node:reply"),
        activeAttemptId: null,
        status,
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    messages: [
      {
        id: MessageId.make("message:user"),
        threadId,
        runId,
        role: "user",
        createdBy: "user",
        creationSource: "web",
        nodeId: null,
        text: "Fix the bug.",
        attachments: [],
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: messageId,
        threadId,
        runId,
        role: "assistant",
        createdBy: "agent",
        creationSource: "provider",
        nodeId: NodeId.make("node:reply"),
        text: "Would you like me to do that?",
        attachments: [],
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}
function harness(projection: OrchestrationV2ThreadProjection) {
  const generateReplySuggestion = vi.fn(() => Effect.succeed({ reply: "Yes, do that." }));
  const getThreadRecords = vi.fn(() => Effect.succeed(projection));
  const layer = Suggestions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(threadShellFromProjection(projection)),
          getThreadRecords,
        }),
        Layer.mock(Projects.ProjectStoreV2)({
          get: () =>
            Effect.succeedSome({
              projectId,
              title: "Project",
              workspaceRoot: "/repo",
              defaultModelSelection: modelSelection,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: "2026-10-07T12:00:00Z",
              updatedAt: "2026-10-07T12:00:00Z",
              deletedAt: null,
            }),
        }),
        Layer.mock(TextGeneration.TextGeneration)({ generateReplySuggestion }),
        ServerSettings.layerTest({ textGenerationModelSelection: modelSelection }),
      ),
    ),
  );
  return { layer, generateReplySuggestion, getThreadRecords };
}
function withNativeReply(reply: string, suggestionRunId = runId) {
  const projection = fixture();
  const providerThreadId = ProviderThreadId.make("provider-thread:reply");
  return {
    ...projection,
    runs: projection.runs.map((run) => ({ ...run, providerThreadId })),
    providerThreads: [
      {
        id: providerThreadId,
        driver: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: modelSelection.instanceId,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle" as const,
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        nativeMetadata: { replySuggestion: { runId: suggestionRunId, reply } },
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}
describe("thread reply suggestions", () => {
  it.effect(
    "prefers native replies and never generates while the provider owns the suggestion",
    () =>
      Effect.gen(function* () {
        for (const reply of ["Go ahead.", ""]) {
          const projection = withNativeReply(reply);
          const test = harness(projection);
          const result = yield* Effect.gen(function* () {
            const service = yield* Suggestions.ThreadReplySuggestionService;
            return yield* service.suggest({ threadId, messageId });
          }).pipe(Effect.provide(test.layer));
          expect(result).toEqual({ messageId, reply });
          expect(test.generateReplySuggestion).not.toHaveBeenCalled();
          expect(threadShellFromProjection(projection).replySuggestion).toEqual({ runId, reply });
        }
      }),
  );
  it.effect("ignores native replies from earlier runs and generates a fallback", () => {
    const projection = withNativeReply("Old reply", RunId.make("run:old"));
    const test = harness(projection);
    return Effect.gen(function* () {
      const service = yield* Suggestions.ThreadReplySuggestionService;
      expect((yield* service.suggest({ threadId, messageId })).reply).toBe("Yes, do that.");
      expect(test.generateReplySuggestion).toHaveBeenCalledTimes(1);
      expect(threadShellFromProjection(projection).replySuggestion).toBeUndefined();
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("shares generation across concurrent devices and reads only the latest run", () => {
    const test = harness(fixture());
    return Effect.gen(function* () {
      const service = yield* Suggestions.ThreadReplySuggestionService;
      const results = yield* Effect.all(
        [service.suggest({ threadId, messageId }), service.suggest({ threadId, messageId })],
        { concurrency: "unbounded" },
      );
      expect(results).toEqual([
        { messageId, reply: "Yes, do that." },
        { messageId, reply: "Yes, do that." },
      ]);
      expect(test.generateReplySuggestion).toHaveBeenCalledTimes(1);
      expect(test.generateReplySuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/repo/worktree",
          modelSelection: expect.objectContaining(modelSelection),
        }),
      );
      expect(test.getThreadRecords).toHaveBeenCalledWith(
        threadId,
        ["messages", "runs", "providerThreads"],
        {
          messageRoles: ["user", "assistant"],
          messageRunIds: [runId],
          runIds: [runId],
        },
      );
    }).pipe(Effect.provide(test.layer));
  });
  it.effect("skips running, waiting, interrupted, and failed turns", () =>
    Effect.gen(function* () {
      for (const status of ["running", "waiting", "interrupted", "failed"] as const) {
        const test = harness(fixture(status));
        const result = yield* Effect.gen(function* () {
          const service = yield* Suggestions.ThreadReplySuggestionService;
          return yield* service.suggest({ threadId, messageId });
        }).pipe(Effect.provide(test.layer));
        expect(result.reply).toBe("");
        expect(test.generateReplySuggestion).not.toHaveBeenCalled();
      }
    }),
  );
  it.effect("rejects stale message IDs and unfinished assistant output", () =>
    Effect.gen(function* () {
      for (const streaming of [false, true]) {
        const projection = fixture();
        const test = harness({
          ...projection,
          messages: projection.messages.map((item) => ({ ...item, streaming })),
        });
        const result = yield* Effect.gen(function* () {
          const service = yield* Suggestions.ThreadReplySuggestionService;
          return yield* service.suggest({
            threadId,
            messageId: streaming ? messageId : MessageId.make("old-message"),
          });
        }).pipe(Effect.provide(test.layer));
        expect(result.reply).toBe("");
        expect(test.generateReplySuggestion).not.toHaveBeenCalled();
      }
    }),
  );
});
