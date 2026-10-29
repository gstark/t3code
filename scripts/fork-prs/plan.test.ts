import { assert, describe, it } from "@effect/vitest";

import { emptyLedger, newPr, type Ledger } from "./ledger.ts";
import { planActions, type RemotePr } from "./plan.ts";

const remotePr = (number: number, slug: string, base: string, head: string): RemotePr => ({
  number,
  headRefName: `pr/${slug}`,
  headRefOid: head,
  baseRefName: base,
  baseRefOid: "x",
  title: slug,
  body: "",
  labels: [],
});

describe("planActions", () => {
  it("moves built PRs to the release base, and labels a stale PR that keeps its old base", () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      prs: [
        { ...newPr("built", "built"), number: 1, head: "h1", baseTag: "v0.1.3" },
        { ...newPr("never-built", "never-built"), number: 2, stale: "conflict" },
        { ...newPr("brand-new", "feat: new"), head: "h3", baseTag: "v0.1.3" },
      ],
    };
    const remote = {
      prs: [
        remotePr(1, "built", "base/mine-aaa", "old1"),
        remotePr(2, "never-built", "base/mine-bbb", "old2"),
      ],
      branches: new Map([
        ["pr/built", "old1"],
        ["pr/never-built", "old2"],
        ["base/mine-aaa", "a"],
        ["base/mine-bbb", "b"],
      ]),
    };

    const actions = planActions(ledger, remote, {
      tag: "v0.1.3",
      tagSha: "t",
      needsEvidence: new Set(),
    });

    assert.deepStrictEqual(actions, [
      { kind: "push", branch: "upstream-base/v0.1.3", sha: "t" },
      { kind: "push", branch: "pr/built", sha: "h1" },
      { kind: "retarget", number: 1, base: "upstream-base/v0.1.3" },
      { kind: "label", number: 2, label: "stale", add: true },
      { kind: "push", branch: "pr/brand-new", sha: "h3" },
      {
        kind: "create",
        slug: "brand-new",
        base: "upstream-base/v0.1.3",
        title: "feat: new",
        body: "",
      },
      { kind: "deleteBranch", branch: "base/mine-aaa" },
    ]);
  });

  it("closes retired PRs, rebuilds a changed stack, and keeps a stale PR on its base", () => {
    const ledger: Ledger = {
      ...emptyLedger(),
      prs: [
        { ...newPr("prefs", "prefs"), number: 2, head: "h2", baseTag: "v0.1.3" },
        {
          ...newPr("menu", "menu"),
          number: 5,
          head: "h5",
          baseTag: "v0.1.3",
          parent: "prefs",
          stale: "drift",
        },
        { ...newPr("cards", "cards"), number: 3, head: "h3", baseTag: "v0.1.3", parent: "prefs" },
        {
          ...newPr("land", "land"),
          number: 4,
          status: "retired",
          head: "h4",
          baseTag: "v0.1.3",
          parent: "cards",
        },
      ],
      stacks: [{ number: 40, slugs: ["prefs", "cards", "land"] }],
    };
    const remote = {
      prs: [
        remotePr(2, "prefs", "upstream-base/v0.1.3", "h2"),
        remotePr(3, "cards", "pr/prefs", "h3"),
        remotePr(4, "land", "pr/cards", "h4"),
        { ...remotePr(5, "menu", "upstream-base/v0.1.3", "h5"), labels: ["stale"] },
      ],
      branches: new Map([
        ["upstream-base/v0.1.3", "t"],
        ["pr/prefs", "h2"],
        ["pr/cards", "h3"],
        ["pr/land", "h4"],
        ["pr/menu", "h5"],
      ]),
    };

    const actions = planActions(ledger, remote, {
      tag: "v0.1.3",
      tagSha: "t",
      needsEvidence: new Set(),
    });

    assert.deepStrictEqual(actions, [
      {
        kind: "close",
        number: 4,
        comment: "Upstream now covers this change, so the diff against the release base is empty.",
      },
      { kind: "unstack", stack: 40 },
      { kind: "stack", base: "upstream-base/v0.1.3", slugs: ["prefs", "cards"] },
    ]);
  });
});
