import {
  GIT_ACTION_ACTIVITY_KIND,
  type GitActionActivityPayload,
  type GitRunStackedActionResult,
} from "@t3tools/contracts";

/**
 * The thread activity recorded for a stacked git action, or null when the
 * action changed nothing worth showing in the thread (an up-to-date push, say).
 */
export function gitActionActivity(result: GitRunStackedActionResult): {
  readonly kind: typeof GIT_ACTION_ACTIVITY_KIND;
  readonly summary: string;
  readonly payload: GitActionActivityPayload;
} | null {
  const { toast, ...payload } = result;
  if (
    payload.commit.status !== "created" &&
    payload.push.status !== "pushed" &&
    payload.pr.status === "skipped_not_requested"
  ) {
    return null;
  }
  return { kind: GIT_ACTION_ACTIVITY_KIND, summary: toast.title, payload };
}
