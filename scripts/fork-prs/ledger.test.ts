import { assert, describe, it } from "@effect/vitest";

import {
  applyDecisions,
  assertWritableBranch,
  canReuse,
  emptyLedger,
  liveParent,
  newPr,
  pruneLedger,
  stackChains,
  unassignedCommits,
  type Ledger,
} from "./ledger.ts";

const ledgerWith = (...slugs: Array<[string, Partial<ReturnType<typeof newPr>>]>): Ledger => ({
  ...emptyLedger(),
  prs: slugs.map(([slug, fields]) => ({ ...newPr(slug, slug), ...fields })),
});

describe("assertWritableBranch", () => {
  it("allows only PR, release base, and ledger branches", () => {
    for (const branch of ["pr/server-health", "upstream-base/v0.1.3", "fork-prs"]) {
      assert.strictEqual(assertWritableBranch(branch), branch);
    }
    for (const branch of [
      "mine",
      "main",
      "refs/heads/mine",
      "pr/../mine",
      "upstream-base/main",
      "base/mine-123",
    ]) {
      assert.throws(() => assertWritableBranch(branch));
    }
  });
});

describe("applyDecisions", () => {
  const fork = ["a", "b", "c", "d", "e"];

  it("keeps PR commits in mine order and parks what it cannot place", () => {
    const start = ledgerWith(["server-health", { commits: ["c"] }]);
    const requested = unassignedCommits(start, fork);
    assert.deepStrictEqual(requested, ["a", "b", "d", "e"]);

    const next = applyDecisions(
      start,
      requested,
      [
        { sha: "a", kind: "existing", slug: "server-health", reason: "fix" },
        {
          sha: "b",
          kind: "new",
          slug: "tool-durations",
          title: "feat(web): show durations",
          reason: "new",
        },
        { sha: "d", kind: "existing", slug: "no-such-pr", reason: "typo" },
      ],
      fork,
    );

    assert.deepStrictEqual(next.prs.find((pr) => pr.slug === "server-health")?.commits, ["a", "c"]);
    assert.strictEqual(
      next.prs.find((pr) => pr.slug === "tool-durations")?.title,
      "feat(web): show durations",
    );
    assert.deepStrictEqual(
      next.pending.map((entry) => entry.sha),
      ["d", "e"],
    );
    assert.deepStrictEqual(unassignedCommits(next, fork), []);
    assert.deepStrictEqual(start.prs[0]?.commits, ["c"]);
  });

  it("rejects a new slug that cannot be a branch name", () => {
    const next = applyDecisions(
      emptyLedger(),
      ["a"],
      [{ sha: "a", kind: "new", slug: "../mine", reason: "bad" }],
      fork,
    );
    assert.strictEqual(next.prs.length, 0);
    assert.strictEqual(next.pending[0]?.sha, "a");
  });
});

describe("stacks", () => {
  it("skips retired parents and stacks one child per layer", () => {
    const ledger = ledgerWith(
      ["prefs", { head: "1" }],
      ["cards", { head: "2", parent: "prefs" }],
      ["gone", { head: "3", parent: "cards", status: "retired" }],
      ["land", { head: "4", parent: "gone" }],
      ["other-child", { head: "5", parent: "prefs" }],
      ["alone", { head: "6" }],
    );
    const land = ledger.prs.find((pr) => pr.slug === "land")!;
    assert.strictEqual(liveParent(ledger, land)?.slug, "cards");
    assert.deepStrictEqual(stackChains(ledger), [["prefs", "cards", "land"]]);
  });
});

describe("pruneLedger", () => {
  it("drops commits that left mine and stops reusing heads built from them", () => {
    const ledger: Ledger = {
      ...ledgerWith([
        "pinned",
        { commits: ["old", "keep"], applied: ["old", "keep"], head: "h", builtOn: "t" },
      ]),
      forkOnly: [{ sha: "old", reason: "tool" }],
      pending: [{ sha: "gone", question: "?" }],
    };
    const pruned = pruneLedger(ledger, ["keep", "new"]);
    const pr = pruned.prs[0]!;
    assert.deepStrictEqual(pr.commits, ["keep"]);
    assert.deepStrictEqual(pruned.forkOnly, []);
    assert.deepStrictEqual(pruned.pending, []);
    assert.isFalse(canReuse(pr));
    assert.isTrue(canReuse({ ...pr, applied: ["keep"] }));
  });
});
