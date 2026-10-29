export type Pr = {
  slug: string;
  number: number | null;
  title: string;
  body: string;
  // Commits on mine that make up this PR, in mine order.
  commits: Array<string>;
  parent: string | null;
  parentReason: string | null;
  status: "open" | "retired";
  // The last good build. All four stay null until a build passes.
  baseTag: string | null;
  builtOn: string | null;
  head: string | null;
  applied: Array<string>;
  // Why the last build failed, phrased as a question for Gavin.
  stale: string | null;
};

// A file that differs from the release tag only through merge resolutions on mine.
// owners holds PR slugs, or "forkOnly" or "upstream".
export type Port = { file: string; owners: Array<string> };

export type Ledger = {
  version: 1;
  prs: Array<Pr>;
  forkOnly: Array<{ sha: string; reason: string }>;
  pending: Array<{ sha: string; question: string }>;
  stacks: Array<{ number: number; slugs: Array<string> }>;
  ports: { tag: string; files: Array<Port> } | null;
};

export type Decision = {
  sha: string;
  kind: "existing" | "new" | "forkOnly" | "pending";
  slug?: string;
  title?: string;
  reason: string;
  question?: string;
};

const WRITABLE_BRANCHES = [
  /^pr\/[a-z0-9][a-z0-9-]*$/,
  /^upstream-base\/v\d+\.\d+\.\d+$/,
  /^fork-prs$/,
];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// mine is the build Gavin runs. Every branch write in this tool goes through here.
export const assertWritableBranch = (branch: string) => {
  if (!WRITABLE_BRANCHES.some((pattern) => pattern.test(branch))) {
    throw new Error(
      `fork-prs: refusing to write "${branch}". Only pr/*, upstream-base/vX.Y.Z, and fork-prs are writable.`,
    );
  }
  return branch;
};

export const emptyLedger = (): Ledger => ({
  version: 1,
  prs: [],
  forkOnly: [],
  pending: [],
  stacks: [],
  ports: null,
});

export const newPr = (slug: string, title: string): Pr => ({
  slug,
  number: null,
  title,
  body: "",
  commits: [],
  parent: null,
  parentReason: null,
  status: "open",
  baseTag: null,
  builtOn: null,
  head: null,
  applied: [],
  stale: null,
});

// Commits that left mine, such as a split HEAD commit, drop out of every list.
export const pruneLedger = (ledger: Ledger, forkCommits: ReadonlyArray<string>): Ledger => {
  const live = new Set(forkCommits);
  const next = structuredClone(ledger);
  for (const pr of next.prs) pr.commits = pr.commits.filter((sha) => live.has(sha));
  next.forkOnly = next.forkOnly.filter((entry) => live.has(entry.sha));
  next.pending = next.pending.filter((entry) => live.has(entry.sha));
  return next;
};

// A build can extend the last good head only if that head holds no commit the PR lost.
export const canReuse = (pr: Pr) =>
  pr.head !== null && pr.builtOn !== null && pr.applied.every((sha) => pr.commits.includes(sha));

// The PR and its live ancestors, nearest first.
export const ancestry = (ledger: Ledger, pr: Pr) => {
  const chain: Array<Pr> = [];
  for (let at: Pr | null = pr; at && !chain.includes(at); at = liveParent(ledger, at))
    chain.push(at);
  return chain;
};

export const unassignedCommits = (ledger: Ledger, forkCommits: ReadonlyArray<string>) => {
  const known = new Set([
    ...ledger.prs.flatMap((pr) => pr.commits),
    ...ledger.forkOnly.map((entry) => entry.sha),
    ...ledger.pending.map((entry) => entry.sha),
  ]);
  return forkCommits.filter((sha) => !known.has(sha));
};

export const applyDecisions = (
  ledger: Ledger,
  requested: ReadonlyArray<string>,
  decisions: ReadonlyArray<Decision>,
  forkCommits: ReadonlyArray<string>,
): Ledger => {
  const next = structuredClone(ledger);
  const order = new Map(forkCommits.map((sha, index) => [sha, index]));
  const bySha = new Map(decisions.map((decision) => [decision.sha, decision]));
  const park = (sha: string, question: string) => next.pending.push({ sha, question });

  for (const sha of requested) {
    const decision = bySha.get(sha);
    if (!decision) {
      park(sha, "The classifier returned no decision for this commit. Which PR owns it?");
      continue;
    }
    if (decision.kind === "pending") {
      park(sha, decision.question ?? decision.reason);
      continue;
    }
    if (decision.kind === "forkOnly") {
      next.forkOnly.push({ sha, reason: decision.reason });
      continue;
    }
    const slug = decision.slug ?? "";
    let pr = next.prs.find((candidate) => candidate.slug === slug);
    if (decision.kind === "existing" && !pr) {
      park(sha, `The classifier chose the unknown PR "${slug}". Which PR owns this commit?`);
      continue;
    }
    if (!pr) {
      if (!SLUG.test(slug)) {
        park(
          sha,
          `The classifier proposed the invalid slug "${slug}". What should the PR be called?`,
        );
        continue;
      }
      pr = newPr(slug, decision.title ?? slug);
      next.prs.push(pr);
    }
    if (pr.status === "retired") pr.status = "open";
    pr.commits.push(sha);
    pr.commits.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }
  return next;
};

// Walks past retired PRs so a child lands on the nearest live ancestor.
export const liveParent = (ledger: Ledger, pr: Pr): Pr | null => {
  let slug = pr.parent;
  const seen = new Set<string>();
  while (slug && !seen.has(slug)) {
    seen.add(slug);
    const parent = ledger.prs.find((candidate) => candidate.slug === slug);
    if (!parent) return null;
    if (parent.status === "open") return parent;
    slug = parent.parent;
  }
  return null;
};

// GitHub stacks are linear, so a PR with two children stacks with the first one only.
export const stackChains = (ledger: Ledger) => {
  const open = ledger.prs.filter((pr) => pr.status === "open" && pr.head);
  const childOf = (slug: string) =>
    open.find((pr) => liveParent(ledger, pr)?.slug === slug && !pr.stale);
  return open
    .filter((pr) => !liveParent(ledger, pr))
    .map((root) => {
      const chain = [root.slug];
      for (let child = childOf(root.slug); child; child = childOf(child.slug)) {
        chain.push(child.slug);
      }
      return chain;
    })
    .filter((chain) => chain.length > 1);
};
