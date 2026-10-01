import type { GitRunStackedActionResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { gitActionActivity } from "./gitActionActivity.ts";

function result(overrides: Partial<GitRunStackedActionResult> = {}): GitRunStackedActionResult {
  return {
    action: "commit_push",
    branch: { status: "skipped_not_requested" },
    commit: { status: "created", commitSha: "abc1234def", subject: "Fix the thing" },
    push: { status: "pushed", branch: "feature/x", upstreamBranch: "origin/feature/x" },
    pr: { status: "skipped_not_requested" },
    toast: { title: "Pushed abc1234 to origin/feature/x", cta: { kind: "none" } },
    ...overrides,
  };
}

describe("gitActionActivity", () => {
  it("records the result without its toast, summarized by the toast title", () => {
    const { toast: _toast, ...payload } = result();
    expect(gitActionActivity(result())).toEqual({
      kind: "git.action.completed",
      summary: "Pushed abc1234 to origin/feature/x",
      payload,
    });
  });

  it("records an opened existing pull request", () => {
    const activity = gitActionActivity(
      result({
        action: "create_pr",
        commit: { status: "skipped_not_requested" },
        push: { status: "skipped_up_to_date" },
        pr: { status: "opened_existing", number: 12, url: "https://example.com/pr/12" },
        toast: { title: "Opened PR #12", cta: { kind: "none" } },
      }),
    );
    expect(activity?.summary).toBe("Opened PR #12");
  });

  it("records nothing when the action changed nothing", () => {
    expect(
      gitActionActivity(
        result({
          action: "push",
          commit: { status: "skipped_not_requested" },
          push: { status: "skipped_up_to_date" },
        }),
      ),
    ).toBeNull();
  });
});
