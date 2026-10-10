import { describe, expect, it } from "vite-plus/test";

import { describeGitFailure } from "./gitFailureDetail.ts";

describe("describeGitFailure", () => {
  it.each([
    [
      "To https://github.com/acme/app.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs",
      "Push rejected: the remote branch has commits that this branch does not have. Pull, then push again.",
    ],
    [
      " ! [rejected]        main -> main (fetch first)\nhint: Updates were rejected because the remote contains work",
      "Push rejected: the remote branch has commits that this branch does not have. Pull, then push again.",
    ],
    [
      " ! [rejected]        main -> main (stale info)",
      "Push rejected: the remote branch changed since the last fetch. Fetch, then try again.",
    ],
    [
      "remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)",
      "The remote rejected the push. A server hook or branch protection rule declined it.",
    ],
    [
      "remote: Invalid username or token.\nfatal: Authentication failed for 'https://x-access-token:ghp_secret@github.com/acme/app.git/'",
      "Git could not sign in to the remote. Check your credentials or SSH key.",
    ],
    [
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
      "Git could not sign in to the remote. Check your credentials or SSH key.",
    ],
    [
      "remote: Repository not found.\nfatal: repository 'https://github.com/acme/missing.git/' not found",
      "The remote repository was not found, or you do not have access to it.",
    ],
    [
      "fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com",
      "Git could not reach the remote. Check your network connection.",
    ],
    [
      "error: Your local changes to the following files would be overwritten by merge:\n\tsrc/a.ts",
      "Local changes would be overwritten. Commit or stash them, then try again.",
    ],
    [
      "hint: You have divergent branches and need to specify how to reconcile them.\nfatal: Need to specify how to reconcile divergent branches.",
      "This branch and its remote have diverged. Merge or rebase, then try again.",
    ],
    [
      "CONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed",
      "The merge stopped with conflicts. Resolve them, then try again.",
    ],
    [
      "fatal: Unable to create '/repo/.git/index.lock': File exists.",
      "Another Git process is using this repository. Wait for it to finish, then try again.",
    ],
  ] as const)("explains %j", (stderr: string, detail: string) => {
    expect(describeGitFailure(stderr)).toBe(detail);
  });

  it("returns undefined for unrecognized failures", () => {
    expect(describeGitFailure("fatal: something unusual happened")).toBeUndefined();
    expect(describeGitFailure("")).toBeUndefined();
  });
});
