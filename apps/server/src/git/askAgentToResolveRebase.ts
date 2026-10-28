import { CommandId, type GitRebaseConflict, MessageId, type ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

/** The prompt that hands a stopped rebase to the thread's agent. */
export function rebaseConflictPrompt(conflict: GitRebaseConflict): string {
  return [
    `The user's git action stopped because rebasing ${conflict.branch} onto ${conflict.onto} hit conflicts in:`,
    ...conflict.files.map((file) => `- ${file}`),
    "",
    `The rebase is still in progress in ${conflict.cwd}. Resolve it there:`,
    "1. Fix each conflicted file, keeping the intent of both sides.",
    "2. Stage the fixed files with `git add`.",
    "3. Run `GIT_EDITOR=true git rebase --continue`, and repeat until the rebase finishes.",
    "",
    "Do not push, and do not abort the rebase unless it cannot be resolved. When it finishes, tell the user so they can run the git action again.",
  ].join("\n");
}

/**
 * Asks the thread's agent to finish a rebase that stopped on conflicts. The
 * turn queues behind any active run. Returns whether the agent was asked.
 */
export const askAgentToResolveRebase = (input: {
  readonly threadId: ThreadId;
  readonly conflict: GitRebaseConflict;
}): Effect.Effect<boolean, never, Orchestrator.OrchestratorV2 | Crypto.Crypto> =>
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const id = yield* (yield* Crypto.Crypto).randomUUIDv4();
    const text = rebaseConflictPrompt(input.conflict);
    yield* engine.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:git-rebase-conflict:${id}`),
      threadId: input.threadId,
      messageId: MessageId.make(`git-rebase-conflict:${id}`),
      text,
      notification: {
        source: { kind: "system" },
        outcome: "failed",
        summary: `Rebase onto ${input.conflict.onto} hit conflicts; asked the agent to resolve them`,
        detail: text,
      },
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "server",
    });
    return true;
  }).pipe(
    Effect.withSpan("askAgentToResolveRebase"),
    Effect.catch((error) =>
      Effect.logWarning("failed to ask the agent to resolve a rebase", {
        threadId: input.threadId,
        error: error.message,
      }).pipe(Effect.as(false)),
    ),
  );
