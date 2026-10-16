import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type OrchestrationV2TurnItem,
  type ServerSettingsError,
  type ThreadId,
  type TurnItemId,
} from "@t3tools/contracts";
import {
  formatThreadTitleContext,
  type ThreadTitleMessage,
} from "@t3tools/provider-core/server/threadTitleContext";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { OrchestratorV2Error } from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/**
 * The conversation a collapse hides: messages after the previous active
 * collapse and before this one. Null when the collapse is gone or settled.
 */
export function collapsedMessages(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  turnItemId: TurnItemId,
): ReadonlyArray<ThreadTitleMessage> | null {
  const marker = items.find((item) => item.id === turnItemId);
  if (marker?.type !== "history_collapse" || marker.status !== "running") return null;
  const start = items.reduce(
    (ordinal, item) =>
      item.type === "history_collapse" &&
      item.status !== "cancelled" &&
      item.ordinal < marker.ordinal
        ? Math.max(ordinal, item.ordinal)
        : ordinal,
    -1,
  );
  return items
    .filter((item) => item.ordinal > start && item.ordinal < marker.ordinal)
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .flatMap((item): ReadonlyArray<ThreadTitleMessage> =>
      item.type === "user_message"
        ? [{ role: "user", text: item.text, attachments: item.attachments }]
        : item.type === "assistant_message"
          ? [{ role: "assistant", text: item.text }]
          : [],
    );
}

export class HistoryCollapseSummaryService extends Context.Service<
  HistoryCollapseSummaryService,
  {
    readonly execute: (input: {
      readonly threadId: ThreadId;
      readonly requestId: CommandId;
      readonly turnItemId: TurnItemId;
    }) => Effect.Effect<
      void,
      | OrchestratorV2Error
      | ServerSettingsError
      | ThreadManagementService.ThreadManagementProviderInstanceDisabledError
    >;
  }
>()("t3/orchestration-v2/HistoryCollapseSummaryService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const execute: HistoryCollapseSummaryService["Service"]["execute"] = Effect.fn(
    "HistoryCollapseSummaryService.execute",
  )(function* (input) {
    // Any failure records a null summary, so the row stops saying it is summarizing.
    const summary: string | null = yield* Effect.gen(function* () {
      const projection = yield* threads.getThreadRecords(input.threadId, ["turnItems"], {
        turnItemTypes: ["user_message", "assistant_message", "history_collapse"],
      });
      const messages = collapsedMessages(projection.turnItems, input.turnItemId);
      if (messages === null) return null;
      const context = formatThreadTitleContext(messages);
      if (context.message.length === 0) return null;
      const project = yield* projects.get(projection.thread.projectId);
      if (Option.isNone(project)) return null;
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        projection.thread.projectId,
      ).settings;
      const result = yield* textGeneration.generateHistorySummary({
        cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
        transcript: context.message,
        modelSelection: settings.textGenerationModelSelection,
      });
      return result.summary.length > 0 ? result.summary : null;
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("History collapse summary failed", {
              threadId: input.threadId,
              turnItemId: input.turnItemId,
              cause,
            }).pipe(Effect.as(null)),
      ),
    );

    yield* threads
      .dispatch({
        type: "thread.history-collapse.complete",
        commandId: CommandId.make(`${input.requestId}:history-collapse-complete`),
        threadId: input.threadId,
        turnItemId: input.turnItemId,
        summary,
      })
      .pipe(Effect.asVoid);
  });

  return HistoryCollapseSummaryService.of({ execute });
});

export const layer = Layer.effect(HistoryCollapseSummaryService, make);
