import { liveParent, stackChains, type Ledger, type Pr } from "./ledger.ts";

export type RemotePr = {
  number: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  title: string;
  body: string;
  labels: Array<string>;
};

export type Remote = {
  prs: Array<RemotePr>;
  // Branch name to SHA, for every branch on origin.
  branches: Map<string, string>;
};

export type Action =
  | { kind: "push"; branch: string; sha: string }
  | { kind: "create"; slug: string; base: string; title: string; body: string }
  | { kind: "retarget"; number: number; base: string }
  | { kind: "edit"; number: number; title: string; body: string }
  | { kind: "close"; number: number; comment: string }
  | { kind: "label"; number: number | string; label: string; add: boolean }
  | { kind: "unstack"; stack: number }
  | { kind: "stack"; base: string; slugs: Array<string> }
  | { kind: "deleteBranch"; branch: string };

const baseBranchOf = (ledger: Ledger, pr: Pr) => {
  const parent = liveParent(ledger, pr);
  return parent ? `pr/${parent.slug}` : `upstream-base/${pr.baseTag}`;
};

export const planActions = (
  ledger: Ledger,
  remote: Remote,
  options: { tag: string; tagSha: string; needsEvidence: ReadonlySet<string> },
): Array<Action> => {
  const actions: Array<Action> = [];
  const openRemote = new Map(remote.prs.map((pr) => [pr.headRefName, pr]));
  const targetedBases = new Set<string>();
  const releaseBase = `upstream-base/${options.tag}`;

  if (remote.branches.get(releaseBase) !== options.tagSha) {
    actions.push({ kind: "push", branch: releaseBase, sha: options.tagSha });
  }

  for (const pr of ledger.prs) {
    const branch = `pr/${pr.slug}`;
    const live = openRemote.get(branch);
    if (pr.status === "retired") {
      if (live) {
        actions.push({
          kind: "close",
          number: live.number,
          comment:
            "Upstream now covers this change, so the diff against the release base is empty.",
        });
      }
      continue;
    }
    if (!pr.head) {
      // A PR that never built keeps its old content and base, but still gets its labels.
      if (!live) continue;
      targetedBases.add(live.baseRefName);
    } else {
      // A stale PR still holds its last good build, so it keeps the base that build sits on.
      const base = pr.stale && live ? live.baseRefName : baseBranchOf(ledger, pr);
      targetedBases.add(base);
      if (remote.branches.get(branch) !== pr.head) {
        actions.push({ kind: "push", branch, sha: pr.head });
      }
      if (!live) {
        actions.push({ kind: "create", slug: pr.slug, base, title: pr.title, body: pr.body });
      } else {
        if (live.baseRefName !== base)
          actions.push({ kind: "retarget", number: live.number, base });
        if (live.title !== pr.title || live.body !== pr.body) {
          actions.push({ kind: "edit", number: live.number, title: pr.title, body: pr.body });
        }
      }
    }

    const ref = live?.number ?? pr.slug;
    const labels = new Set(live?.labels ?? []);
    if (pr.stale && !labels.has("stale")) {
      actions.push({ kind: "label", number: ref, label: "stale", add: true });
    }
    if (!pr.stale && labels.has("stale")) {
      actions.push({ kind: "label", number: ref, label: "stale", add: false });
    }
    if (options.needsEvidence.has(pr.slug) && !labels.has("needs-evidence")) {
      actions.push({ kind: "label", number: ref, label: "needs-evidence", add: true });
    }
  }

  const chains = stackChains(ledger);
  const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
    a.length === b.length && a.every((slug, index) => slug === b[index]);
  for (const stack of ledger.stacks) {
    if (!chains.some((chain) => same(chain, stack.slugs))) {
      actions.push({ kind: "unstack", stack: stack.number });
    }
  }
  for (const chain of chains) {
    if (!ledger.stacks.some((stack) => same(stack.slugs, chain))) {
      const root = ledger.prs.find((pr) => pr.slug === chain[0]);
      actions.push({ kind: "stack", base: `upstream-base/${root?.baseTag}`, slugs: chain });
    }
  }

  // An old base goes only when no PR, not even a stale one, still targets it.
  for (const branch of remote.branches.keys()) {
    const isBase = branch.startsWith("base/") || branch.startsWith("upstream-base/");
    if (isBase && branch !== releaseBase && !targetedBases.has(branch)) {
      actions.push({ kind: "deleteBranch", branch });
    }
  }
  return actions;
};

export const describeAction = (action: Action) => {
  switch (action.kind) {
    case "push":
      return `push ${action.branch} -> ${action.sha.slice(0, 10)}`;
    case "create":
      return `open PR pr/${action.slug} -> ${action.base}: ${action.title}`;
    case "retarget":
      return `retarget #${action.number} -> ${action.base}`;
    case "edit":
      return `rewrite title and body of #${action.number}: ${action.title}`;
    case "close":
      return `close #${action.number} as retired`;
    case "label":
      return `${action.add ? "add" : "remove"} label ${action.label} on ${typeof action.number === "number" ? `#${action.number}` : `pr/${action.number}`}`;
    case "unstack":
      return `unstack stack #${action.stack}`;
    case "stack":
      return `link stack on ${action.base}: ${action.slugs.join(" -> ")}`;
    case "deleteBranch":
      return `delete branch ${action.branch}`;
  }
};
