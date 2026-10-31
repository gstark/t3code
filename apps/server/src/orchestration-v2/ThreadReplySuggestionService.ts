import {
  TextGenerationError,
  type ReplySuggestionInput,
  type ReplySuggestionResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const encodeCacheKey = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isTextGenerationError = Schema.is(TextGenerationError);

export class ThreadReplySuggestionService extends Context.Service<
  ThreadReplySuggestionService,
  {
    readonly suggest: (
      input: ReplySuggestionInput,
    ) => Effect.Effect<ReplySuggestionResult, TextGenerationError>;
  }
>()("t3/orchestration-v2/ThreadReplySuggestionService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const generation = yield* TextGeneration.TextGeneration;
  // Share in-flight generation between devices, retaining only a bounded recent history.
  const replies = new Map<string, Effect.Effect<ReplySuggestionResult, TextGenerationError>>();
  const suggest = Effect.fn("ThreadReplySuggestionService.suggest")(
    function* (input: ReplySuggestionInput) {
      const empty = { messageId: input.messageId, reply: "" };
      const shell = yield* threads.getThreadShell(input.threadId);
      if (!shell?.latestRunId || shell.activeRunId) return empty;
      const projection = yield* threads.getThreadRecords(
        input.threadId,
        ["messages", "runs", "providerThreads"],
        {
          messageRoles: ["user", "assistant"],
          messageRunIds: [shell.latestRunId],
          runIds: [shell.latestRunId],
        },
      );
      const last = projection.messages.at(-1);
      if (
        !last ||
        last.id !== input.messageId ||
        last.role !== "assistant" ||
        last.streaming ||
        !last.text.trim()
      )
        return empty;
      const run = projection.runs.find((candidate) => candidate.id === last.runId);
      if (!run || run.status !== "completed") return empty;
      const native = projection.providerThreads.find((thread) => thread.id === run.providerThreadId)
        ?.nativeMetadata?.replySuggestion;
      // Empty native replies include pending suggestions and provider abstentions.
      // Neither should start a second generation request.
      if (native?.runId === run.id) return { messageId: input.messageId, reply: native.reply };
      const project = yield* projects.get(projection.thread.projectId);
      if (Option.isNone(project)) return empty;
      const settings = resolveProjectSettings(
        yield* settingsService.getSettings,
        projection.thread.projectId,
      ).settings;
      const key = encodeCacheKey([
        input.threadId,
        last.id,
        last.updatedAt,
        settings.textGenerationModelSelection,
      ]);
      let reply = replies.get(key);
      if (!reply) {
        const message = projection.messages
          .slice(-6)
          .map((item) => `${item.role.toUpperCase()}: ${item.text.slice(-4000)}`)
          .join("\n\n");
        reply = yield* Effect.cached(
          generation
            .generateReplySuggestion({
              cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
              message,
              modelSelection: settings.textGenerationModelSelection,
            })
            .pipe(Effect.map((result) => ({ messageId: input.messageId, reply: result.reply }))),
        );
        replies.set(key, reply);
        if (replies.size > 128) {
          const oldest = replies.keys().next().value;
          if (oldest !== undefined) replies.delete(oldest);
        }
      }
      return yield* reply;
    },
    Effect.mapError((cause) =>
      isTextGenerationError(cause)
        ? cause
        : new TextGenerationError({
            operation: "generateReplySuggestion",
            detail: "Failed to suggest a reply.",
            cause,
          }),
    ),
  );
  return ThreadReplySuggestionService.of({ suggest });
});

export const layer = Layer.effect(ThreadReplySuggestionService, make);
