import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { collapsedMessages } from "./HistoryCollapseSummaryService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for history collapse"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "history-collapse" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const threadId = ThreadId.make("thread:history-collapse");

const messageItem = (
  ordinal: number,
  role: "user" | "assistant",
  text: string,
  now: DateTime.Utc,
): OrchestrationV2TurnItem => {
  const base = {
    id: TurnItemId.make(`item:${ordinal}`),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    messageId: MessageId.make(`message:${ordinal}`),
    text,
  };
  return role === "user"
    ? {
        ...base,
        type: "user_message",
        inputIntent: "turn_start",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
      }
    : { ...base, type: "assistant_message", streaming: false };
};

const collapseItem = (
  ordinal: number,
  status: OrchestrationV2TurnItem["status"],
  now: DateTime.Utc,
): OrchestrationV2TurnItem => ({
  id: TurnItemId.make(`collapse:${ordinal}`),
  threadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status,
  title: null,
  startedAt: now,
  completedAt: null,
  updatedAt: now,
  type: "history_collapse",
  summary: null,
});

it.effect("collapses history, records its summary, and uncollapses it", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const now = yield* DateTime.now;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create"),
      threadId,
      projectId: ProjectId.make("project:history-collapse"),
      title: "History",
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const collapse = (id: string) =>
      orchestrator.dispatch({
        type: "thread.history.collapse",
        commandId: CommandId.make(id),
        threadId,
      });
    const collapseItemId = TurnItemId.make("history-collapse:collapse-1");
    const readCollapse = projections
      .getTurnItem({ threadId, itemId: collapseItemId })
      .pipe(
        Effect.map((item) =>
          item?.type === "history_collapse" ? { status: item.status, summary: item.summary } : null,
        ),
      );

    assert.equal((yield* Effect.exit(collapse("collapse-empty")))._tag, "Failure");

    for (const [ordinal, role] of [
      [0, "user"],
      [1, "assistant"],
    ] as const) {
      yield* projections.apply({
        id: EventId.make(`seed:${ordinal}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: messageItem(ordinal, role, `${role} text`, now),
      });
    }

    yield* collapse("collapse-1");
    assert.deepStrictEqual(yield* readCollapse, { status: "running", summary: null });
    // Nothing new since the collapse, so a second one has nothing to hide.
    assert.equal((yield* Effect.exit(collapse("collapse-again")))._tag, "Failure");

    yield* orchestrator.dispatch({
      type: "thread.history-collapse.complete",
      commandId: CommandId.make("complete-1"),
      threadId,
      turnItemId: collapseItemId,
      summary: "Asked for text and got it",
    });
    assert.deepStrictEqual(yield* readCollapse, {
      status: "completed",
      summary: "Asked for text and got it",
    });

    yield* orchestrator.dispatch({
      type: "thread.history.uncollapse",
      commandId: CommandId.make("uncollapse-1"),
      threadId,
      turnItemId: collapseItemId,
    });
    assert.deepStrictEqual(yield* readCollapse, {
      status: "cancelled",
      summary: "Asked for text and got it",
    });

    // The uncollapsed history can be collapsed again.
    yield* collapse("collapse-2");
    const second = yield* projections.getTurnItem({
      threadId,
      itemId: TurnItemId.make("history-collapse:collapse-2"),
    });
    assert.equal(second?.status, "running");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("summarizes only the messages since the previous active collapse", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const items = [
      messageItem(0, "user", "first ask", now),
      collapseItem(1, "completed", now),
      messageItem(2, "user", "second ask", now),
      collapseItem(3, "cancelled", now),
      messageItem(4, "assistant", "second answer", now),
      collapseItem(5, "running", now),
      messageItem(6, "user", "after", now),
    ];
    assert.deepStrictEqual(
      collapsedMessages(items, TurnItemId.make("collapse:5"))?.map((message) => message.text),
      ["second ask", "second answer"],
    );
    assert.equal(collapsedMessages(items, TurnItemId.make("collapse:1")), null);
  }),
);
