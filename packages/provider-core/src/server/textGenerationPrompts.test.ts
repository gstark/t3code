import { describe, expect, it } from "vite-plus/test";

import { buildCommitMessagePrompt } from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("buildCommitMessagePrompt", () => {
  it("adds the thread conversation only when there is one", () => {
    const base = { branch: "main", stagedSummary: "M a.ts", stagedPatch: "diff" };
    const withContext = buildCommitMessagePrompt({
      ...base,
      threadContext: "USER:\nFix the login loop",
    });
    expect(withContext.prompt).toContain("Conversation that produced this change.");
    expect(withContext.prompt).toContain("Fix the login loop");
    expect(buildCommitMessagePrompt(base).prompt).not.toContain("Conversation that produced");
  });
});

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});
