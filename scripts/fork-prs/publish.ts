// @effect-diagnostics globalConsole:off
import { deleteRemoteBranch, gh, pushBranch, type Git } from "./exec.ts";
import type { Ledger } from "./ledger.ts";
import { describeAction, type Action, type Remote } from "./plan.ts";

// GitHub refuses to retarget a PR that is in a stack, so unstack comes first.
const ORDER: Array<Action["kind"]> = [
  "push",
  "create",
  "unstack",
  "retarget",
  "edit",
  "label",
  "close",
  "stack",
  "deleteBranch",
];

const LABELS = [
  { name: "stale", color: "d93f0b", description: "fork-prs could not rebuild this PR from mine" },
  { name: "needs-evidence", color: "fbca04", description: "The UI diff changed; add new captures" },
];

const STATUS_TITLE = "PR sync status";

// Runs the planned actions in a safe order. Returns one line per failed action.
export const publish = (repo: Git, ledger: Ledger, remote: Remote, actions: Array<Action>) => {
  const cwd = repo.cwd;
  const failures: Array<string> = [];
  const numberOf = (ref: number | string) =>
    typeof ref === "number" ? ref : ledger.prs.find((pr) => pr.slug === ref)?.number;

  if (actions.some((action) => action.kind === "label")) {
    for (const label of LABELS) {
      gh(cwd, [
        "label",
        "create",
        label.name,
        "--force",
        "--color",
        label.color,
        "--description",
        label.description,
      ]);
    }
  }

  const sorted = [...actions].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  for (const action of sorted) {
    // GitHub closes a PR whose base branch goes away, so delete nothing after a failure.
    if (action.kind === "deleteBranch" && failures.length > 0) {
      failures.push(`skipped: ${describeAction(action)}`);
      continue;
    }
    console.log(`  ${describeAction(action)}`);
    try {
      run(action);
    } catch (error) {
      failures.push(`${describeAction(action)}: ${String(error).slice(0, 600)}`);
    }
  }
  return failures;

  function run(action: Action) {
    switch (action.kind) {
      case "push":
        pushBranch(repo, action.branch, action.sha, remote.branches.get(action.branch) ?? null);
        return;
      case "create": {
        const url = gh(
          cwd,
          [
            "pr",
            "create",
            "--head",
            `pr/${action.slug}`,
            "--base",
            action.base,
            "--title",
            action.title,
            "--body-file",
            "-",
          ],
          action.body,
        );
        const pr = ledger.prs.find((candidate) => candidate.slug === action.slug);
        if (pr) pr.number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
        return;
      }
      case "retarget":
        gh(cwd, ["pr", "edit", String(action.number), "--base", action.base]);
        return;
      case "edit":
        gh(
          cwd,
          ["pr", "edit", String(action.number), "--title", action.title, "--body-file", "-"],
          action.body,
        );
        return;
      case "label": {
        const number = numberOf(action.number);
        if (!number) throw new Error(`no PR number for ${action.number}`);
        gh(cwd, [
          "pr",
          "edit",
          String(number),
          action.add ? "--add-label" : "--remove-label",
          action.label,
        ]);
        return;
      }
      case "close":
        gh(cwd, ["pr", "close", String(action.number), "--comment", action.comment]);
        return;
      case "unstack":
        gh(cwd, ["stack", "unstack", String(action.stack)]);
        ledger.stacks = ledger.stacks.filter((stack) => stack.number !== action.stack);
        return;
      case "stack": {
        const numbers = action.slugs.map((slug) => numberOf(slug));
        if (numbers.some((number) => !number)) throw new Error("a PR in the stack has no number");
        // PR numbers only: a branch argument would make gh stack push it past pushBranch.
        gh(cwd, [
          "stack",
          "link",
          "--remote",
          "origin",
          "--base",
          action.base,
          ...numbers.map(String),
        ]);
        // gh stack link prints nothing, but the REST pull carries the stack.
        const number = Number(
          gh(cwd, ["api", `repos/{owner}/{repo}/pulls/${numbers[0]}`, "--jq", ".stack.number"]),
        );
        if (!number) throw new Error(`linked, but PR #${numbers[0]} shows no stack`);
        ledger.stacks.push({ number, slugs: action.slugs });
        return;
      }
      case "deleteBranch": {
        const sha = remote.branches.get(action.branch);
        if (sha) deleteRemoteBranch(repo, action.branch, sha);
        return;
      }
    }
  }
};

// The ledger lives as prs.json on the orphan branch fork-prs, one commit per run.
export const saveLedger = (repo: Git, ledger: Ledger, remote: Remote, message: string) => {
  const blob = repo.git(["hash-object", "-w", "--stdin"], `${JSON.stringify(ledger, null, 2)}\n`);
  const tree = repo.git(["mktree"], `100644 blob ${blob}\tprs.json\n`);
  const parent = remote.branches.get("fork-prs") ?? null;
  const commit = repo.git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);
  pushBranch(repo, "fork-prs", commit, parent);
};

// Returns null when the repository has issues turned off.
export const writeStatusIssue = (repo: Git, body: string) => {
  const cwd = repo.cwd;
  if (gh(cwd, ["api", "repos/{owner}/{repo}", "--jq", ".has_issues"]) !== "true") return null;
  const issues = JSON.parse(
    gh(cwd, [
      "issue",
      "list",
      "--state",
      "open",
      "--search",
      `"${STATUS_TITLE}" in:title`,
      "--json",
      "number,title",
    ]),
  ) as Array<{ number: number; title: string }>;
  const found = issues.find((issue) => issue.title === STATUS_TITLE);
  if (found) {
    gh(cwd, ["issue", "edit", String(found.number), "--body-file", "-"], body);
    return found.number;
  }
  const url = gh(cwd, ["issue", "create", "--title", STATUS_TITLE, "--body-file", "-"], body);
  const number = Number(/\/issues\/(\d+)/.exec(url)?.[1]);
  gh(cwd, ["issue", "pin", String(number)]);
  return number;
};
