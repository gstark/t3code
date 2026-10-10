import { GitCommandError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeGitActionError } from "./gitAction.ts";

describe("describeGitActionError", () => {
  it("shows a Git failure's detail without the internal operation or path", () => {
    const error = new GitCommandError({
      operation: "GitVcsDriver.pushCurrentBranch.pushUpstream",
      command: "git",
      cwd: "/Users/someone/repo",
      detail: "Push rejected: the remote branch has commits that this branch does not have.",
    });

    expect(describeGitActionError(error, "fallback")).toBe(
      "Push rejected: the remote branch has commits that this branch does not have.",
    );
  });

  it("falls back to other errors' messages, then to the fallback text", () => {
    expect(describeGitActionError(new Error("Network down"), "fallback")).toBe("Network down");
    expect(describeGitActionError("not an error", "fallback")).toBe("fallback");
  });
});
