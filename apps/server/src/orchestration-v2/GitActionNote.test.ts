import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2TurnItem,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { gitActionNote, pendingGitActions } from "./GitActionNote.ts";

const at = (time: string) => DateTime.makeUnsafe(`2026-10-13T${time}:00.000Z`);

function gitAction(id: string, time: string, subject: string): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: subject,
    startedAt: at(time),
    completedAt: at(time),
    updatedAt: at(time),
    type: "git_action",
    summary: `Committed ${subject}`,
    gitAction: {
      action: "commit_push",
      branch: { status: "skipped_not_requested" },
      commit: { status: "created", commitSha: "abc1234def", subject },
      push: { status: "pushed", upstreamBranch: "origin/feature" },
      pr: { status: "skipped_not_requested" },
    },
  };
}

const attempt = (id: string, startedAt: string) => ({
  id: RunAttemptId.make(id),
  runId: RunId.make(`run:${id}`),
  startedAt: at(startedAt),
});

it("tells the agent about git actions since the latest completed prompt", () => {
  const items = [gitAction("before", "10:00", "first"), gitAction("during", "10:10", "second")];
  // The completed turn started at 10:05, so only the action after it is news.
  const pending = pendingGitActions({
    turnItems: items,
    attempts: [attempt("done", "10:05"), attempt("current", "10:20")],
    providerTurns: [{ runAttemptId: RunAttemptId.make("done"), status: "completed" }],
  });
  assert.deepEqual(
    pending.map((item) => item.id),
    [TurnItemId.make("during")],
  );
  assert.equal(
    gitActionNote(pending),
    [
      "Note: since your last turn, the user ran these git actions from the T3 Code git controls:",
      '- committed abc1234 "second", pushed to origin/feature',
    ].join("\n"),
  );
});

it("keeps the note when the turn that carried it did not complete", () => {
  const pending = pendingGitActions({
    turnItems: [gitAction("action", "10:00", "kept")],
    attempts: [attempt("failed", "10:05")],
    providerTurns: [{ runAttemptId: RunAttemptId.make("failed"), status: "failed" }],
  });
  assert.lengthOf(pending, 1);
});

it("writes no note when nothing is pending", () => {
  assert.equal(gitActionNote([]), "");
});
