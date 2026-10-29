// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as NodeFS from "node:fs";

import { adoptDrift, applyPort, findParent, resolveConflicts, writePrText } from "./agent.ts";
import { run, type Git } from "./exec.ts";
import { ancestry, canReuse, liveParent, type Ledger, type Pr } from "./ledger.ts";

export type BuildContext = {
  git: Git;
  ledger: Ledger;
  tag: string;
  tagSha: string;
  forkCommits: ReadonlyArray<string>;
  questions: Array<string>;
  changed: Set<string>;
  needsEvidence: Set<string>;
};

type Attempt = { ok: true; head: string; applied: Array<string> } | { ok: false; failure: string };

const UI_FILE = /^apps\/(web|desktop)\/.*\.(tsx|css)$/;
// The fork does not ship mobile changes, so PRs leave the mobile app as the tag has it.
const EXCLUDED_FILE = /^apps\/mobile\//;
const MAX_DIFF = 120_000;

export const clip = (text: string, limit = MAX_DIFF) =>
  text.length > limit ? `${text.slice(0, limit)}\n[diff cut at ${limit} characters]` : text;

const inProgress = (git: Git) => {
  const exists = (name: string) => NodeFS.existsSync(git.git(["rev-parse", "--git-path", name]));
  if (exists("rebase-merge") || exists("rebase-apply")) return "rebase";
  if (exists("CHERRY_PICK_HEAD")) return "cherry-pick";
  return null;
};

const cleanTree = (git: Git) => {
  const operation = inProgress(git);
  if (operation) git.tryGit([operation, "--abort"]);
  git.git(["reset", "--hard", "-q"]);
  git.git(["clean", "-fdq"]);
};

const settle = (ctx: BuildContext, pr: Pr, first: ReturnType<Git["tryGit"]>): string | null => {
  const { git } = ctx;
  let last = first;
  for (let round = 0; round < 50; round++) {
    const operation = inProgress(git);
    if (!operation) return last.ok ? null : `git stopped:\n${last.output.slice(-2000)}`;
    const files = git.lines(["diff", "--name-only", "--diff-filter=U"]);
    if (files.length > 0) {
      const commit = git.git([
        "log",
        "-1",
        "--format=%h %s",
        operation === "rebase" ? "REBASE_HEAD" : "CHERRY_PICK_HEAD",
      ]);
      const answer = resolveConflicts(git.cwd, {
        slug: pr.slug,
        title: pr.title,
        operation,
        commit,
        files,
      });
      const left = git.lines(["diff", "--name-only", "--diff-filter=U"]);
      const markers = git
        .tryGit(["diff", "--cached", "-G", "^(<{7}|>{7})( |$)", "--name-only"])
        .stdout.trim();
      if (!answer.resolved || left.length > 0 || markers) {
        return (
          answer.question ??
          `Conflict in ${files.join(", ")} while applying ${commit}. How should it resolve?`
        );
      }
      console.log(`    resolved ${files.length} conflict(s): ${answer.summary}`);
    }
    last = git.tryGit([operation, "--continue"]);
    // A commit that the resolution made empty is already in the base.
    if (!last.ok && /nothing to commit|now empty|no changes/i.test(last.output))
      last = git.tryGit([operation, "--skip"]);
  }
  return "The conflict loop did not finish after 50 rounds.";
};

const changedFiles = (git: Git, onto: string) =>
  git.lines(["diff", "--name-only", "--no-renames", onto, "HEAD"]);

const blob = (git: Git, ref: string, file: string) =>
  git.tryGit(["rev-parse", "-q", "--verify", `${ref}:${file}`]).stdout.trim();

const touchedOnMine = (ctx: BuildContext, file: string) =>
  ctx.git.lines(["log", "--no-merges", "--format=%H", "mine", "--not", ctx.tag, "--", file]);

// Cherry-picks never carry merge resolutions, so take this PR's share of them from mine.
const port = (ctx: BuildContext, pr: Pr, onto: string): string | null => {
  const { git } = ctx;
  // On the tag the PR stands alone, even if the ledger still names a parent.
  const chain = onto === ctx.tagSha ? [pr] : ancestry(ctx.ledger, pr);
  const slugs = new Set(chain.map((at) => at.slug));
  const commits = new Set(chain.flatMap((at) => at.commits));
  const differs = (file: string) => blob(git, "HEAD", file) !== blob(git, "mine", file);
  const take = changedFiles(git, onto).filter(
    (file) => differs(file) && touchedOnMine(ctx, file).every((sha) => commits.has(sha)),
  );
  const shared: Array<string> = [];
  for (const entry of ctx.ledger.ports?.files ?? []) {
    if (!entry.owners.includes(pr.slug) || !differs(entry.file)) continue;
    (entry.owners.every((owner) => slugs.has(owner)) ? take : shared).push(entry.file);
  }
  for (const file of new Set(take)) {
    if (blob(git, "mine", file)) git.git(["checkout", "mine", "--", file]);
    else git.git(["rm", "-q", "--ignore-unmatch", "--", file]);
  }
  if (shared.length > 0) {
    const answer = applyPort(git.cwd, {
      slug: pr.slug,
      title: pr.title,
      tag: ctx.tag,
      files: shared,
    });
    if (!answer.applied) {
      return answer.question ?? `Which parts of ${shared.join(", ")} on mine belong to this PR?`;
    }
    console.log(`    ported ${shared.length} shared file(s): ${answer.summary}`);
  }
  if (!git.tryGit(["diff", "--cached", "--quiet"]).ok) {
    console.log(`    ported merge resolutions in ${new Set([...take, ...shared]).size} file(s)`);
    git.git(["commit", "-qm", `chore: port merge resolutions to ${ctx.tag}`]);
  }
  return null;
};

const driftQuestion = (ctx: BuildContext, pr: Pr, onto: string): string | null => {
  const { git } = ctx;
  const differing = changedFiles(git, onto).filter(
    (file) => blob(git, "HEAD", file) !== blob(git, "mine", file),
  );
  if (differing.length === 0) return null;
  const owner = new Map<string, string>();
  for (const other of ctx.ledger.prs)
    for (const sha of other.commits) owner.set(sha, `PR ${other.slug}`);
  for (const entry of ctx.ledger.forkOnly) owner.set(entry.sha, `fork-only: ${entry.reason}`);
  for (const entry of ctx.ledger.pending) owner.set(entry.sha, "pending classification");
  const owners = differing.map((file) => ({
    file,
    commits: git
      .lines(["log", "--no-merges", "--format=%H %s", "mine", "--not", ctx.tag, "--", file])
      .map((line) => ({
        commit: line.slice(0, 10),
        subject: line.slice(41),
        owner: owner.get(line.slice(0, 40)) ?? "unknown",
      })),
  }));
  const diff = clip(git.git(["diff", "HEAD", "mine", "--", ...differing]));
  const answer = adoptDrift(git.cwd, { slug: pr.slug, title: pr.title, diff, owners });
  if (!answer.explained) {
    return answer.question ?? "The PR differs from mine in a way no other owner explains.";
  }
  if (!git.tryGit(["diff", "--cached", "--quiet"]).ok) {
    console.log(`    took merge-resolved hunks from mine: ${answer.summary}`);
    git.git(["commit", "-qm", `chore: port merge resolutions to ${ctx.tag}`]);
  }
  return null;
};

const attempt = (ctx: BuildContext, pr: Pr, onto: string): Attempt => {
  const { git } = ctx;
  cleanTree(git);
  git.git(["checkout", "-q", "--detach", onto]);
  const reuse = canReuse(pr);
  const applied = reuse ? [...pr.applied] : [];

  if (reuse) {
    const question = settle(
      ctx,
      pr,
      git.tryGit(["rebase", "-q", "--onto", onto, pr.builtOn!, pr.head!]),
    );
    if (question) return { ok: false, failure: question };
  }
  for (const sha of pr.commits.filter((commit) => !applied.includes(commit))) {
    const question = settle(ctx, pr, git.tryGit(["cherry-pick", "--empty=drop", sha]));
    if (question) return { ok: false, failure: question };
    applied.push(sha);
  }

  const portQuestion = port(ctx, pr, onto);
  if (portQuestion) return { ok: false, failure: portQuestion };

  const excluded = changedFiles(git, onto).filter((file) => EXCLUDED_FILE.test(file));
  if (excluded.length > 0) {
    for (const file of excluded) {
      if (blob(git, onto, file)) git.git(["checkout", onto, "--", file]);
      else git.git(["rm", "-q", "--", file]);
    }
    git.git(["commit", "-qm", "chore: leave the mobile app unchanged"]);
  }

  const files = changedFiles(git, onto).filter((file) => NodeFS.existsSync(`${git.cwd}/${file}`));
  if (files.length > 0) {
    run("vp", ["fmt", "--no-error-on-unmatched-pattern", ...files], { cwd: git.cwd });
    if (git.git(["status", "--porcelain"])) {
      git.git(["commit", "-qam", "style: format with vp fmt"]);
    }
  }

  const drift = driftQuestion(ctx, pr, onto);
  if (drift) return { ok: false, failure: `drift: ${drift}` };
  return { ok: true, head: git.git(["rev-parse", "HEAD"]), applied };
};

export const buildAll = (ctx: BuildContext) => {
  const done = new Map<string, Attempt>();
  const visiting = new Set<string>();

  const commit = (pr: Pr, onto: string, result: Extract<Attempt, { ok: true }>) => {
    const { git } = ctx;
    const oldTree = pr.head ? git.git(["rev-parse", `${pr.head}^{tree}`]) : null;
    const newTree = git.git(["rev-parse", `${result.head}^{tree}`]);
    Object.assign(pr, {
      baseTag: ctx.tag,
      builtOn: onto,
      head: result.head,
      applied: result.applied,
      stale: null,
    });
    git.setBranch(`pr/${pr.slug}`, result.head);
    if (git.tryGit(["diff", "--quiet", onto, result.head]).ok) {
      pr.status = "retired";
      console.log(`  ${pr.slug}: diff is empty, retired`);
      return;
    }
    if (oldTree === newTree && pr.body) return;
    ctx.changed.add(pr.slug);
    const files = changedFiles(git, onto);
    if (files.some((file) => UI_FILE.test(file))) ctx.needsEvidence.add(pr.slug);
    const diff = clip(git.git(["diff", onto, result.head]));
    const parent = liveParent(ctx.ledger, pr)?.slug ?? null;
    Object.assign(
      pr,
      writePrText(git.cwd, { slug: pr.slug, title: pr.title, body: pr.body, parent, diff }),
    );
  };

  const build = (pr: Pr): Attempt => {
    const cached = done.get(pr.slug);
    if (cached) return cached;
    if (visiting.has(pr.slug))
      return { ok: false, failure: `Dependency cycle through ${pr.slug}.` };
    visiting.add(pr.slug);
    const result = buildOne(pr);
    visiting.delete(pr.slug);
    if (!result.ok) {
      pr.stale = result.failure;
      ctx.questions.push(`PR ${pr.slug}${pr.number ? ` (#${pr.number})` : ""}: ${result.failure}`);
      console.log(`  ${pr.slug}: STALE`);
    }
    done.set(pr.slug, result);
    return result;
  };

  const onParent = (pr: Pr, parent: Pr): Attempt => {
    const parentResult = build(parent);
    if (!parentResult.ok || parent.status !== "open" || !parent.head) {
      return parentResult.ok
        ? attemptAndCommit(pr, ctx.tagSha)
        : { ok: false, failure: `Its parent ${parent.slug} failed to build.` };
    }
    return attemptAndCommit(pr, parent.head);
  };

  const attemptAndCommit = (pr: Pr, onto: string): Attempt => {
    console.log(`  ${pr.slug}: building on ${onto.slice(0, 10)}`);
    const result = attempt(ctx, pr, onto);
    if (result.ok) commit(pr, onto, result);
    return result;
  };

  const buildOne = (pr: Pr): Attempt => {
    if (pr.commits.length === 0) {
      return { ok: false, failure: "No commit on mine belongs to this PR. Should it be retired?" };
    }
    const parent = liveParent(ctx.ledger, pr);
    const parentHead = parent ? build(parent) : null;
    const tagChanged = pr.baseTag !== ctx.tag;
    const expectedBase = parent?.head ?? ctx.tagSha;
    const upToDate =
      !tagChanged &&
      canReuse(pr) &&
      pr.builtOn === expectedBase &&
      pr.commits.every((sha) => pr.applied.includes(sha)) &&
      (parentHead === null || parentHead.ok);
    if (upToDate) {
      pr.stale = null;
      return { ok: true, head: pr.head!, applied: pr.applied };
    }

    // A new tag can free a PR from its parent, but a PR that never built keeps the one it was given.
    if (parent && (!tagChanged || pr.baseTag === null)) return onParent(pr, parent);

    console.log(`  ${pr.slug}: trying alone on ${ctx.tag}`);
    const alone = attempt(ctx, pr, ctx.tagSha);
    if (alone.ok) {
      if (pr.parent) console.log(`  ${pr.slug}: no longer needs ${pr.parent}`);
      pr.parent = null;
      pr.parentReason = null;
      commit(pr, ctx.tagSha, alone);
      return alone;
    }
    if (alone.failure.startsWith("drift:")) return alone;

    const candidates = ctx.ledger.prs
      .filter(
        (other) => other.slug !== pr.slug && other.status === "open" && !visiting.has(other.slug),
      )
      .map((other) => ({ slug: other.slug, title: other.title, files: filesOf(ctx, other) }));
    const answer = findParent(ctx.git.cwd, {
      slug: pr.slug,
      title: pr.title,
      failure: alone.failure,
      candidates,
    });
    const chosen = ctx.ledger.prs.find((other) => other.slug === answer.parent);
    if (!chosen) return { ok: false, failure: answer.question ?? alone.failure };
    console.log(`  ${pr.slug}: stacks on ${chosen.slug} (${answer.reason})`);
    pr.parent = chosen.slug;
    pr.parentReason = answer.reason;
    return onParent(pr, chosen);
  };

  for (const pr of ctx.ledger.prs) if (pr.status === "open") build(pr);
  cleanTree(ctx.git);
};

const filesOf = (ctx: BuildContext, pr: Pr) =>
  [
    ...new Set(
      pr.commits.flatMap((sha) => ctx.git.lines(["show", "--name-only", "--format=", sha])),
    ),
  ].slice(0, 40);
