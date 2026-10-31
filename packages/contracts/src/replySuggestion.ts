import * as Schema from "effect/Schema";
import { MessageId, RunId, ThreadId } from "./baseSchemas.ts";

export const ReplySuggestionInput = Schema.Struct({ threadId: ThreadId, messageId: MessageId });
export type ReplySuggestionInput = typeof ReplySuggestionInput.Type;
export const ReplySuggestionResult = Schema.Struct({
  messageId: MessageId,
  reply: Schema.String.check(Schema.isMaxLength(160)),
});
export type ReplySuggestionResult = typeof ReplySuggestionResult.Type;

// An empty reply records that the provider owns suggestions for this run.
export const ProviderReplySuggestion = Schema.Struct({
  runId: RunId,
  reply: Schema.String.check(Schema.isMaxLength(160)),
});
