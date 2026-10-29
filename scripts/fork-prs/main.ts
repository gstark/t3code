// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off
// Keeps one PR on gstark/t3code per fork feature, built from the branch mine.
// Design: ~/dev/personal/plans/t3code-fork-pr-sync.md
//
//   just prs --dry-run    build every PR locally and write the plan; push nothing
//
// Work happens in ../t3code-prs. State, the lock, and dry-run output live in
// ../t3code-prs-state. Delete that folder to start the next dry run from scratch.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { classifyCommits, classifyPorts } from "./agent.ts";
import { buildAll, clip } from "./build.ts";
import { createGit, gh, run, type Git } from "./exec.ts";
import {
  applyDecisions,
  emptyLedger,
  newPr,
  pruneLedger,
  unassignedCommits,
  type Ledger,
} from "./ledger.ts";
import { describeAction, planActions, type Remote, type RemotePr } from "./plan.ts";

const root = NodePath.resolve(import.meta.dirname, "../..");
const worktree = NodePath.resolve(root, "../t3code-prs");
const stateDir = NodePath.resolve(root, "../t3code-prs-state");
const ledgerFile = NodePath.join(stateDir, "ledger.json");
const logDir = NodePath.join(stateDir, "logs");

if (!process.argv.includes("--dry-run")) {
  console.error("fork-prs: only --dry-run exists so far. Live runs come in phase 3.");
  process.exit(2);
}

NodeFS.mkdirSync(logDir, { recursive: true });
const lockFile = NodePath.join(stateDir, "lock");
const lockHolder = NodeFS.existsSync(lockFile) ? Number(NodeFS.readFileSync(lockFile, "utf8")) : 0;
if (lockHolder && isAlive(lockHolder)) {
  console.error(`fork-prs: another run holds the lock (pid ${lockHolder}).`);
  process.exit(1);
}
NodeFS.writeFileSync(lockFile, String(process.pid));
process.on("exit", () => NodeFS.rmSync(lockFile, { force: true }));

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const repo = createGit(root);
console.log("fork-prs: fetching origin and upstream");
repo.git(["fetch", "-q", "origin", "--prune"]);
repo.git(["fetch", "-q", "upstream", "--tags", "--prune"]);

const tag = repo
  .lines(["tag", "--merged", "mine", "--sort=-v:refname"])
  .find((name) => /^v\d+\.\d+\.\d+$/.test(name));
if (!tag) throw new Error("fork-prs: mine contains no upstream release tag.");
const tagSha = repo.git(["rev-parse", `${tag}^{commit}`]);
const mineSha = repo.git(["rev-parse", "mine"]);
const forkCommits = repo.lines([
  "rev-list",
  "--reverse",
  "--no-merges",
  "mine",
  "--not",
  tag,
  "upstream/main",
]);
console.log(`fork-prs: mine ${mineSha.slice(0, 10)} on ${tag}, ${forkCommits.length} fork commits`);

if (!NodeFS.existsSync(worktree)) {
  console.log(`fork-prs: creating worktree ${worktree}`);
  repo.git(["worktree", "add", "-q", "--detach", worktree, tagSha]);
}
const git = createGit(worktree);

const installMarker = NodePath.join(stateDir, "installed-lockfile");
const ensureInstalled = () => {
  const lockfile = NodePath.join(worktree, "pnpm-lock.yaml");
  const hash = NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(lockfile)).digest("hex");
  const marker = `${hash} with playwright chromium`;
  if (NodeFS.existsSync(installMarker) && NodeFS.readFileSync(installMarker, "utf8") === marker)
    return;
  console.log("    vp i");
  const install = run("vp", ["i", "--frozen-lockfile"], { cwd: worktree });
  if (!install.ok) throw new Error(`vp i failed in ${worktree}:\n${install.output.slice(-3000)}`);
  // Browser tests need the Chromium build that this lockfile's Playwright pins.
  console.log("    playwright install chromium");
  const web = NodePath.join(worktree, "apps/web");
  const browsers = run(
    NodePath.join(web, "node_modules/.bin/playwright"),
    ["install", "chromium"],
    {
      cwd: web,
    },
  );
  if (!browsers.ok) throw new Error(`playwright install failed:\n${browsers.output.slice(-3000)}`);
  NodeFS.writeFileSync(installMarker, marker);
};

const remotePrs = JSON.parse(
  gh(root, [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number,headRefName,headRefOid,baseRefName,baseRefOid,title,body,labels",
  ]),
) as Array<Omit<RemotePr, "labels"> & { labels: Array<{ name: string }> }>;
const remote: Remote = {
  prs: remotePrs
    .filter((pr) => pr.headRefName.startsWith("pr/"))
    .map((pr) => ({ ...pr, labels: pr.labels.map((label) => label.name) })),
  branches: new Map(
    repo
      .lines(["for-each-ref", "--format=%(refname:lstrip=3) %(objectname)", "refs/remotes/origin"])
      .map((line) => line.split(" ") as [string, string]),
  ),
};

const loadLedger = (): Ledger => {
  if (NodeFS.existsSync(ledgerFile))
    return { ...emptyLedger(), ...JSON.parse(NodeFS.readFileSync(ledgerFile, "utf8")) };
  const stored = repo.tryGit(["show", "origin/fork-prs:prs.json"]);
  if (stored.ok) return { ...emptyLedger(), ...JSON.parse(stored.stdout) };
  console.log("fork-prs: no ledger yet, seeding it from the open PRs");
  return seed(repo);
};

// Old PRs were cut from fork snapshots with rewritten SHAs, so match by patch ID.
const seed = (source: Git): Ledger => {
  const ledger = emptyLedger();
  const patchIds = (args: ReadonlyArray<string>) => {
    const patches = source.git(["log", "-p", "--no-merges", "--format=commit %H", ...args]);
    return source
      .git(["patch-id", "--stable"], `${patches}\n`)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ") as [string, string]);
  };
  const forkByPatch = new Map(patchIds(["mine", "--not", tag, "upstream/main"]));
  const forkSet = new Set(forkCommits);
  const taken = new Set<string>();
  for (const live of [...remote.prs].sort((a, b) => a.number - b.number)) {
    const own = patchIds([`${live.baseRefOid}..${live.headRefOid}`]);
    const pr = newPr(live.headRefName.slice("pr/".length), live.title);
    pr.number = live.number;
    pr.body = live.body;
    if (live.baseRefName.startsWith("pr/")) {
      pr.parent = live.baseRefName.slice("pr/".length);
      pr.parentReason = "stacked before fork-prs existed";
    }
    for (const [patchId, sha] of own) {
      const match = forkSet.has(sha) ? sha : forkByPatch.get(patchId);
      if (match && !taken.has(match)) {
        taken.add(match);
        pr.commits.push(match);
      }
    }
    pr.commits.sort((a, b) => forkCommits.indexOf(a) - forkCommits.indexOf(b));
    ledger.prs.push(pr);
  }
  return ledger;
};

let ledger = pruneLedger(loadLedger(), forkCommits);
const questions: Array<string> = [];

const fresh = unassignedCommits(ledger, forkCommits);
if (fresh.length > 0) {
  console.log(`fork-prs: classifying ${fresh.length} new commits`);
  const described = (sha: string) => ({
    sha,
    subject: repo.git(["log", "-1", "--format=%s", sha]),
    body: repo.git(["log", "-1", "--format=%b", sha]).slice(0, 800),
    files: repo.lines(["show", "--stat=200", "--format=", sha]).slice(0, 40),
  });
  const prs = ledger.prs
    .filter((pr) => pr.status === "open")
    .map((pr) => {
      const live = remote.prs.find((candidate) => candidate.number === pr.number);
      return {
        slug: pr.slug,
        title: pr.title,
        body: pr.body.slice(0, 600),
        commits: pr.commits.map((sha) => repo.git(["log", "-1", "--format=%h %s", sha])),
        originalSubjects: live
          ? repo.lines([
              "log",
              "--no-merges",
              "--format=%s",
              `${live.baseRefOid}..${live.headRefOid}`,
            ])
          : [],
      };
    });
  const { decisions } = classifyCommits(worktree, { prs, commits: fresh.map(described) });
  ledger = applyDecisions(ledger, fresh, decisions, forkCommits);
  for (const decision of decisions) {
    console.log(
      `  ${decision.sha.slice(0, 10)} -> ${decision.kind}${decision.slug ? ` ${decision.slug}` : ""}: ${decision.reason}`,
    );
  }
}

if (ledger.ports?.tag !== tag) {
  const mergeOnly = repo
    .lines(["diff", "--name-only", "--no-renames", tag, "mine"])
    .filter(
      (file) =>
        repo.lines(["log", "-1", "--no-merges", "--format=%H", "mine", "--not", tag, "--", file])
          .length === 0,
    );
  console.log(`fork-prs: assigning ${mergeOnly.length} merge-only files to PRs`);
  const { files } = classifyPorts(worktree, {
    tag,
    prs: ledger.prs
      .filter((pr) => pr.status === "open")
      .map((pr) => ({
        slug: pr.slug,
        title: pr.title,
        files: [
          ...new Set(
            pr.commits.flatMap((sha) => repo.lines(["show", "--name-only", "--format=", sha])),
          ),
        ].slice(0, 40),
      })),
    files: mergeOnly.map((file) => ({
      file,
      diff: clip(repo.git(["diff", tag, "mine", "--", file]), 3000),
    })),
  });
  ledger.ports = { tag, files: files.filter((entry) => mergeOnly.includes(entry.file)) };
  for (const entry of ledger.ports.files)
    console.log(`  ${entry.file} -> ${entry.owners.join(", ")}`);
}

const changed = new Set<string>();
const needsEvidence = new Set<string>();
const releaseBase = `upstream-base/${tag}`;
git.setBranch(releaseBase, tagSha);
console.log("fork-prs: building PRs");
try {
  buildAll({
    git,
    ledger,
    tag,
    tagSha,
    forkCommits,
    questions,
    changed,
    needsEvidence,
    ensureInstalled,
    logDir,
  });
} catch (error) {
  questions.push(`The run crashed, so later PRs did not build: ${String(error).slice(0, 2000)}`);
}

for (const entry of ledger.pending) {
  questions.push(
    `Commit ${entry.sha.slice(0, 10)} ${repo.git(["log", "-1", "--format=%s", entry.sha])}: ${entry.question}`,
  );
}
const actions = planActions(ledger, remote, { tag, tagSha, needsEvidence });

const section = (title: string, items: ReadonlyArray<string>) =>
  `## ${title}\n\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "None."}\n`;
const report = [
  "# PR sync status (dry run)\n",
  `Run at ${new Date().toISOString()} on mine \`${mineSha.slice(0, 10)}\`, base ${tag}.\n`,
  section(
    "Changed PRs",
    [...changed].map((slug) => `pr/${slug}`),
  ),
  section(
    "Retired PRs",
    ledger.prs.filter((pr) => pr.status === "retired").map((pr) => `pr/${pr.slug}`),
  ),
  section(
    "Stale PRs",
    ledger.prs
      .filter((pr) => pr.stale)
      .map((pr) => `pr/${pr.slug}${pr.number ? ` (#${pr.number})` : ""}`),
  ),
  section(
    "Fork-only commits",
    ledger.forkOnly.map((entry) => `\`${entry.sha.slice(0, 10)}\` ${entry.reason}`),
  ),
  section(
    `Merge ports (${tag})`,
    (ledger.ports?.files ?? []).map((entry) => `\`${entry.file}\` ${entry.owners.join(", ")}`),
  ),
  `## Questions\n\n${questions.length ? questions.map((question, index) => `${index + 1}. ${question}`).join("\n\n") : "None."}\n`,
  section("Planned GitHub actions", actions.map(describeAction)),
].join("\n");

NodeFS.writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
NodeFS.writeFileSync(NodePath.join(stateDir, "report.md"), report);
NodeFS.writeFileSync(
  NodePath.join(stateDir, "actions.json"),
  `${JSON.stringify(actions, null, 2)}\n`,
);
console.log(`fork-prs: dry run done. Read ${NodePath.join(stateDir, "report.md")}`);
