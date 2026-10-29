import {
  CommandId,
  type GitActionActivityPayload,
  type GitRunStackedActionResult,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

/**
 * What a stacked git action leaves in its thread, or null when it changed
 * nothing worth telling the user or agent about (an up-to-date push, say).
 */
function gitActionRecord(
  result: GitRunStackedActionResult,
): { readonly summary: string; readonly gitAction: GitActionActivityPayload } | null {
  const { toast, ...gitAction } = result;
  if (
    gitAction.commit.status !== "created" &&
    gitAction.push.status !== "pushed" &&
    gitAction.pr.status === "skipped_not_requested" &&
    gitAction.land === undefined
  ) {
    return null;
  }
  return { summary: toast.title, gitAction };
}

/**
 * Records a git action in the thread it ran beside. Never fails: the action
 * already succeeded, so a lost record is only logged.
 */
export const recordGitAction = Effect.fn("recordGitAction")(
  function* (input: { readonly threadId: ThreadId; readonly result: GitRunStackedActionResult }) {
    const record = gitActionRecord(input.result);
    if (record === null) return;
    const engine = yield* Orchestrator.OrchestratorV2;
    const id = yield* (yield* Crypto.Crypto).randomUUIDv4;
    yield* engine.dispatch({
      type: "thread.git-action.record",
      commandId: CommandId.make(`server:git-action-record:${id}`),
      threadId: input.threadId,
      turnItemId: TurnItemId.make(`git-action:${id}`),
      ...record,
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause as Cause.Cause<never>)
          : Effect.logWarning("failed to record git action in thread", {
              threadId: input.threadId,
              cause,
            }),
      ),
    ),
);
