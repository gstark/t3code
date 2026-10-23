import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { chooseNewWorktree, runGitMenuItem, send, versionControl } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// The agent finishes a rebase (PR #19): when the rebase before a push stops on
// conflicts, the thread's agent gets a message to finish it.

const merged = [
  "export function footer(note) {",
  "  const words = note.body.split(/\\s+/).filter(Boolean).length;",
  "  return `Created on ${note.createdAt.toLocaleDateString()} · ${words} words`;",
  "}",
  "",
].join("\n");

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      ...wordCountAgent,
      turns: [
        ...wordCountAgent.turns,
        {
          match: "rebase",
          steps: [
            { think: { text: "A rebase stopped on a conflict. Look at it.", ms: 1200 } },
            { run: { command: "git status --short", ms: 600 } },
            { run: { command: "git diff", ms: 800 } },
            {
              think: {
                text: "main now says 'Created on'. Keep that, and keep the word count.",
                ms: 1500,
              },
            },
            { edit: { path: "src/footer.js", content: merged } },
            {
              run: {
                command: "git add src/footer.js && GIT_EDITOR=true git rebase --continue",
                ms: 800,
              },
            },
            { run: { command: "node --test", ms: 1000 } },
            {
              say: {
                text: "The rebase is done. The footer keeps the new wording from main and adds the word count. The tests pass.",
                ms: 2000,
              },
            },
          ],
        },
      ],
    },
  },
});

walkthrough("The agent finishes a rebase", async ({ page, app, title, say, pause }) => {
  await title("The agent finishes a rebase");

  await say("The agent changes the note footer in a new worktree.");
  await chooseNewWorktree(page);
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });

  await say("Meanwhile, a teammate changes the same line on main.");
  app.pushAsTeammate({
    message: "Say 'Created on' in the footer",
    files: {
      "src/footer.js": [
        "export function footer(note) {",
        "  return `Created on ${note.createdAt.toLocaleDateString()}`;",
        "}",
        "",
      ].join("\n"),
    },
  });
  await pause();

  await say("Commit and push. The rebase onto main stops on a conflict.");
  await runGitMenuItem(page, "Commit & push");

  await say("The push stops, and the agent gets a message to finish the rebase.");
  await expect(page.getByText("The rebase is done.")).toBeVisible({ timeout: 60_000 });
  await pause();

  await say("The agent resolves the conflict and continues the rebase. Now push again.");
  await versionControl(page).getByRole("button", { name: "Push", exact: true }).click();
  await expect
    .poll(
      () => {
        app.git("fetch", "--quiet", "origin");
        return app.git("branch", "--remotes", "--list", "origin/t3/*");
      },
      { timeout: 30_000 },
    )
    .toContain("origin/t3/word-count");
  expect(app.git("show", "origin/t3/word-count:src/footer.js")).toBe(merged.trim());
  await say("The branch on origin has both changes.");
  await pause(2_500);
});
