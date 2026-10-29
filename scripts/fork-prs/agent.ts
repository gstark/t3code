import type { Decision } from "./ledger.ts";
import { run } from "./exec.ts";

const READ_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git show:*)",
  "Bash(git log:*)",
  "Bash(git diff:*)",
];
const EDIT_TOOLS = [...READ_TOOLS, "Edit", "Write", "Bash(git status:*)", "Bash(git add:*)"];

const CONTEXT = `You work for fork-prs, a tool that keeps one pull request on gstark/t3code for each feature of Gavin's fork of T3 Code. The branch "mine" is the fork. It merges upstream releases and holds every fork feature. Each PR branch holds one feature on top of the upstream release tag, or on top of the PR it depends on. mine is the source of truth: a PR must contain exactly its feature's change as it is on mine. Never commit, push, rebase, reset, check out, or abort anything. Never change the branch mine. You cannot change mine and you cannot run checks, installs, or tests, so never ask for permission to do them. When a fix is needed, write the question as a request to Gavin: name the file and say what Gavin must change on mine.`;

const ask = <T>(cwd: string, prompt: string, schema: object, tools: ReadonlyArray<string>): T => {
  const result = run(
    "claude",
    [
      "-p",
      `${CONTEXT}\n\n${prompt}`,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ...tools,
      "--disallowedTools",
      "Bash(git push:*)",
    ],
    { cwd, env: { UNSLOP_OFF: "1" } },
  );
  const parsed = JSON.parse(result.stdout || "{}") as { is_error?: boolean; structured_output?: T };
  if (!result.ok || parsed.is_error || !parsed.structured_output) {
    throw new Error(`claude -p failed:\n${result.output.slice(-4000)}`);
  }
  return parsed.structured_output;
};

const string = { type: "string" };
const object = (properties: Record<string, object>, required: Array<string>) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const classifyCommits = (
  cwd: string,
  input: { prs: Array<object>; commits: Array<object> },
) =>
  ask<{ decisions: Array<Decision> }>(
    cwd,
    `Assign each new commit on mine to exactly one place.

- "existing": the commit changes or fixes the feature of an existing PR. Set slug to that PR.
- "new": the commit starts a feature that no PR covers. Set slug to a short kebab-case name and title to a conventional-commit title in plain language, such as "feat(web): show durations for tool calls". Commits that belong to the same new feature must use the same slug.
- "forkOnly": the commit only makes sense for the fork and must never go upstream. Examples: G$ branding and icons, fork release and Homebrew tooling, the fork justfile, mine release hosts, and the fork-prs tool itself. Use this only when you are confident.
- "pending": you cannot decide. Set question to one short question for Gavin. Use this when it could be a feature or fork-only, or when it could be a new PR or part of an existing one and both are plausible.

A commit is mixed when its changes serve two unrelated purposes, for example a web feature plus fork tooling, or a server fix plus a UI timer. Read the full file list of every commit. A mixed commit is always "pending", even when one part is clearly fork-only. The question must name each part and its files.

Read a commit with "git show <sha>" when the subject and files are not enough. Some existing PRs were built before their commits got recorded; their originalSubjects list the commits they held, so match by meaning. Give a one-sentence reason for each decision.

Existing PRs:
${JSON.stringify(input.prs, null, 2)}

New commits, oldest first:
${JSON.stringify(input.commits, null, 2)}`,
    object(
      {
        decisions: {
          type: "array",
          items: object(
            {
              sha: string,
              kind: { type: "string", enum: ["existing", "new", "forkOnly", "pending"] },
              slug: string,
              title: string,
              reason: string,
              question: string,
            },
            ["sha", "kind", "reason"],
          ),
        },
      },
      ["decisions"],
    ),
    READ_TOOLS,
  );

export const resolveConflicts = (
  cwd: string,
  input: { slug: string; title: string; operation: string; commit: string; files: Array<string> },
) =>
  ask<{ resolved: boolean; summary: string; question?: string }>(
    cwd,
    `A "${input.operation}" stopped with conflicts while building PR "${input.slug}" (${input.title}). The commit being applied is ${input.commit}.

Conflicted files: ${input.files.join(", ")}

Resolve each conflicted file so that it holds the current base plus only this PR's change. Use the file on mine as the reference answer ("git show mine:<path>"), but leave out changes that belong to other fork features. Remove every conflict marker, then run "git add" on each file.

If you cannot resolve a file with confidence, set resolved to false and ask one short question for Gavin. Otherwise set resolved to true and summarize each resolution in one sentence.`,
    object({ resolved: { type: "boolean" }, summary: string, question: string }, [
      "resolved",
      "summary",
    ]),
    EDIT_TOOLS,
  );

export const findParent = (
  cwd: string,
  input: { slug: string; title: string; failure: string; candidates: Array<object> },
) =>
  ask<{ parent: string | null; reason: string; question?: string }>(
    cwd,
    `PR "${input.slug}" (${input.title}) failed when built alone on the upstream release tag.

Failure:
${input.failure}

Decide if the failure comes from code that another PR adds, such as a symbol, file, or schema from one of the candidates below. If so, set parent to that PR's slug and give the reason, for example "uses GitActionCompleted from git-timeline-cards". If no candidate explains the failure, set parent to null and ask one short question for Gavin about how to fix it on mine.

Candidates:
${JSON.stringify(input.candidates, null, 2)}`,
    object({ parent: { type: ["string", "null"] }, reason: string, question: string }, [
      "parent",
      "reason",
    ]),
    READ_TOOLS,
  );

export const explainDrift = (
  cwd: string,
  input: { slug: string; title: string; diff: string; owners: Array<object> },
) =>
  ask<{ explained: boolean; question?: string }>(
    cwd,
    `PR "${input.slug}" (${input.title}) is built. The diff below goes from the PR branch to mine, for the files the PR changes. Each hunk must come from one of these sources: another PR, a fork-only commit, or formatting. The owners list shows which fork commits touch each file.

If every hunk has such a source, set explained to true. If a hunk looks like part of this PR's own feature that the PR is missing or has wrong, set explained to false and ask one short question for Gavin that names the file and the hunk.

Owners:
${JSON.stringify(input.owners, null, 2)}

Diff from the PR to mine:
${input.diff}`,
    object({ explained: { type: "boolean" }, question: string }, ["explained"]),
    READ_TOOLS,
  );

export const classifyPorts = (
  cwd: string,
  input: { tag: string; prs: Array<object>; files: Array<object> },
) =>
  ask<{ files: Array<{ file: string; owners: Array<string> }> }>(
    cwd,
    `mine merged the upstream release ${input.tag}. The files below differ between ${input.tag} and mine, but no fork commit touches them, so every change in them came from a merge resolution. Usually upstream moved or split a file, and the merge carried a fork feature into the new file.

For each file, list the owners of its changes: the slug of each PR whose feature the changes carry, "forkOnly" for fork-only work such as branding and release tooling, or "upstream" for upstream code that the merge took in. A file can have several owners. Each diff is cut short; run "git diff ${input.tag} mine -- <file>" for the full diff.

PRs:
${JSON.stringify(input.prs, null, 2)}

Files:
${JSON.stringify(input.files, null, 2)}`,
    object(
      {
        files: {
          type: "array",
          items: object({ file: string, owners: { type: "array", items: string } }, [
            "file",
            "owners",
          ]),
        },
      },
      ["files"],
    ),
    READ_TOOLS,
  );

export const applyPort = (
  cwd: string,
  input: { slug: string; title: string; tag: string; files: Array<string> },
) =>
  ask<{ applied: boolean; summary: string; question?: string }>(
    cwd,
    `PR "${input.slug}" (${input.title}) is being built on ${input.tag}. The files below carry part of its feature on mine only through merge resolutions, and they also carry the work of other PRs or the fork.

Files: ${input.files.join(", ")}

Edit each file so it holds what it has now plus only this PR's part of the change from "git diff HEAD mine -- <file>". Leave out the parts that belong to other features. Then run "git add" on each file.

If you cannot separate this PR's part with confidence, set applied to false and ask one short question for Gavin. Otherwise set applied to true and summarize each file in one sentence.`,
    object({ applied: { type: "boolean" }, summary: string, question: string }, [
      "applied",
      "summary",
    ]),
    EDIT_TOOLS,
  );

export const writePrText = (
  cwd: string,
  input: { slug: string; title: string; body: string; parent: string | null; diff: string },
) =>
  ask<{ title: string; body: string }>(
    cwd,
    `Write the title and body for PR "${input.slug}". Start from the current text and change only what the diff makes wrong or incomplete.

- Title: a conventional-commit title in plain language, such as "fix(web): new threads no longer spike CPU".
- Body: the problem in one or two sentences, then how the change fixes it. Use short sentences in the active voice. No headings for short bodies.${input.parent ? `\n- Add one line that says the PR is stacked on pr/${input.parent} and why.` : ""}
- End the body with "---" and then "Kept in sync from mine by fork-prs."

Current title: ${input.title}
Current body:
${input.body || "(none)"}

Diff of the PR:
${input.diff}`,
    object({ title: string, body: string }, ["title", "body"]),
    READ_TOOLS,
  );
