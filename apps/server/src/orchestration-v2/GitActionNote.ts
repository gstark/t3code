import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2RunAttempt,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type GitActionItem = Extract<OrchestrationV2TurnItem, { readonly type: "git_action" }>;

const MAX_NOTE_ENTRIES = 10;

/**
 * Git actions the agent has not heard about: those recorded after the latest
 * prompt a provider completed. The set is derived, not cleared, so a failed or
 * cancelled turn carries the note to the next one.
 */
export function pendingGitActions(input: {
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "startedAt">>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "status">
  >;
}): ReadonlyArray<GitActionItem> {
  const completedAttemptIds = new Set(
    input.providerTurns
      .filter((turn) => turn.status === "completed")
      .map((turn) => turn.runAttemptId),
  );
  const cutoff = input.attempts.reduce(
    (latest, attempt) =>
      completedAttemptIds.has(attempt.id) && attempt.startedAt !== null
        ? Math.max(latest, DateTime.toEpochMillis(attempt.startedAt))
        : latest,
    Number.NEGATIVE_INFINITY,
  );
  return input.turnItems.filter(
    (item): item is GitActionItem =>
      item.type === "git_action" &&
      item.runId === null &&
      item.startedAt !== null &&
      DateTime.toEpochMillis(item.startedAt) > cutoff,
  );
}

function gitActionParts({ gitAction }: GitActionItem): ReadonlyArray<string> {
  const lines: Array<string> = [];
  if (gitAction.branch.status === "created" && gitAction.branch.name) {
    lines.push(`created branch ${gitAction.branch.name}`);
  }
  if (gitAction.commit.status === "created") {
    const sha = gitAction.commit.commitSha?.slice(0, 7);
    const subject = gitAction.commit.subject ? ` "${gitAction.commit.subject}"` : "";
    lines.push(`committed${sha ? ` ${sha}` : ""}${subject}`);
  }
  if (gitAction.push.status === "pushed") {
    const target = gitAction.push.upstreamBranch ?? gitAction.push.branch;
    lines.push(`pushed${target ? ` to ${target}` : ""}`);
  }
  if (gitAction.pr.status === "created" || gitAction.pr.status === "opened_existing") {
    const number = gitAction.pr.number === undefined ? "" : ` #${gitAction.pr.number}`;
    const verb = gitAction.pr.status === "created" ? "opened" : "found existing";
    lines.push(`${verb} pull request${number}${gitAction.pr.url ? ` ${gitAction.pr.url}` : ""}`);
  }
  if (gitAction.land) {
    lines.push(
      `landed ${gitAction.land.branch} into ${gitAction.land.baseBranch} and removed the worktree ${gitAction.land.removedWorktreePath}; the thread now works in ${gitAction.land.mainCheckoutPath}`,
    );
  }
  return lines;
}

/** One git action in words, such as `committed abc1234 "fix: x", pushed to origin/x`. */
export function describeGitAction(item: GitActionItem): string {
  return gitActionParts(item).join(", ") || item.summary;
}

/** Agent-facing text for git actions the user ran since the agent's last turn. */
export function gitActionNote(items: ReadonlyArray<GitActionItem>): string {
  const entries = items.map((item) => `- ${describeGitAction(item)}`);
  if (entries.length === 0) return "";
  const omitted = entries.length - MAX_NOTE_ENTRIES;
  return [
    "Note: since your last turn, the user ran these git actions from the T3 Code git controls:",
    ...entries.slice(-MAX_NOTE_ENTRIES),
    ...(omitted > 0 ? [`- and ${omitted} earlier`] : []),
  ].join("\n");
}
