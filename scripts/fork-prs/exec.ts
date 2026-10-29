// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import { assertWritableBranch } from "./ledger.ts";

const FORK_REPO = "gstark/t3code";

export type Run = { ok: boolean; stdout: string; stderr: string; output: string };

export const run = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; input?: string | undefined; env?: Record<string, string> },
): Run => {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? String(result.error ?? "");
  return { ok: result.status === 0, stdout, stderr, output: `${stdout}${stderr}` };
};

const must = (label: string, result: Run) => {
  if (!result.ok) throw new Error(`${label} failed:\n${result.output.trim()}`);
  return result.stdout;
};

export const createGit = (cwd: string) => {
  const tryGit = (args: ReadonlyArray<string>, input?: string) =>
    run("git", ["-c", "core.quotePath=false", ...args], {
      cwd,
      input,
      env: { GIT_EDITOR: "true" },
    });
  const git = (args: ReadonlyArray<string>, input?: string) =>
    must(`git ${args.join(" ")}`, tryGit(args, input)).trim();
  const lines = (args: ReadonlyArray<string>) => git(args).split("\n").filter(Boolean);
  return {
    cwd,
    tryGit,
    git,
    lines,
    setBranch: (branch: string, sha: string) =>
      git(["update-ref", `refs/heads/${assertWritableBranch(branch)}`, sha]),
  };
};

export type Git = ReturnType<typeof createGit>;

export const gh = (cwd: string, args: ReadonlyArray<string>, input?: string) =>
  must(`gh ${args.join(" ")}`, run("gh", args, { cwd, input, env: { GH_REPO: FORK_REPO } })).trim();

// The only push in fork-prs. The lease fails the push if the branch moved since the fetch.
export const pushBranch = (git: Git, branch: string, sha: string, expected: string | null) =>
  git.git([
    "push",
    "-q",
    `--force-with-lease=refs/heads/${assertWritableBranch(branch)}:${expected ?? ""}`,
    "origin",
    `${sha}:refs/heads/${branch}`,
  ]);

const DELETABLE_BRANCHES = [/^base\//, /^upstream-base\/v\d+\.\d+\.\d+$/];

export const deleteRemoteBranch = (git: Git, branch: string, expected: string) => {
  if (!DELETABLE_BRANCHES.some((pattern) => pattern.test(branch))) {
    throw new Error(`fork-prs: refusing to delete "${branch}". Only old base branches go.`);
  }
  return git.git([
    "push",
    "-q",
    `--force-with-lease=refs/heads/${branch}:${expected}`,
    "origin",
    `:refs/heads/${branch}`,
  ]);
};
