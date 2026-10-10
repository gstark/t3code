/**
 * Turns the stderr of a failed Git command into a fixed, user-facing explanation.
 *
 * Git errors never carry stderr itself, because it can contain credentials, remote
 * URLs, and arbitrary server output. Matching known failures to fixed strings tells
 * the user what went wrong without copying any of that text. Returns undefined when
 * the failure is not recognized, so callers keep their generic detail.
 */
const GIT_FAILURE_DETAILS: ReadonlyArray<{
  readonly patterns: ReadonlyArray<string>;
  readonly detail: string;
}> = [
  {
    patterns: ["stale info"],
    detail: "Push rejected: the remote branch changed since the last fetch. Fetch, then try again.",
  },
  {
    patterns: ["non-fast-forward", "[rejected]", "fetch first", "updates were rejected"],
    detail:
      "Push rejected: the remote branch has commits that this branch does not have. Pull, then push again.",
  },
  {
    patterns: ["[remote rejected]", "pre-receive hook declined", "protected branch"],
    detail: "The remote rejected the push. A server hook or branch protection rule declined it.",
  },
  {
    patterns: [
      "authentication failed",
      "could not read username",
      "could not read password",
      "permission denied (publickey)",
      "invalid username or password",
      "terminal prompts disabled",
    ],
    detail: "Git could not sign in to the remote. Check your credentials or SSH key.",
  },
  {
    patterns: ["repository not found", "does not appear to be a git repository"],
    detail: "The remote repository was not found, or you do not have access to it.",
  },
  {
    patterns: [
      "could not resolve host",
      "connection timed out",
      "connection refused",
      "network is unreachable",
      "failed to connect to",
    ],
    detail: "Git could not reach the remote. Check your network connection.",
  },
  {
    patterns: ["would be overwritten by"],
    detail: "Local changes would be overwritten. Commit or stash them, then try again.",
  },
  {
    patterns: ["divergent branches", "not possible to fast-forward"],
    detail: "This branch and its remote have diverged. Merge or rebase, then try again.",
  },
  {
    patterns: ["conflict ("],
    detail: "The merge stopped with conflicts. Resolve them, then try again.",
  },
  {
    patterns: ["couldn't find remote ref"],
    detail: "The remote branch does not exist.",
  },
  {
    patterns: ["index.lock"],
    detail: "Another Git process is using this repository. Wait for it to finish, then try again.",
  },
];

export function describeGitFailure(stderr: string): string | undefined {
  const normalized = stderr.toLowerCase();
  return GIT_FAILURE_DETAILS.find(({ patterns }) =>
    patterns.some((pattern) => normalized.includes(pattern)),
  )?.detail;
}
