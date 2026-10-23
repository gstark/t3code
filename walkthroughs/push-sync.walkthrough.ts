import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { chooseNewWorktree, runGitMenuItem, send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Sync before push (PR #19): before a push, the server fetches and rebases
// the branch onto the default branch when main has new commits.

walkthrough.use({ scenario: { project: notesProject, agent: wordCountAgent } });

walkthrough("Sync before push", async ({ page, app, title, say, pause }) => {
  await title("Sync before push");

  await say("The agent makes a change in a new worktree.");
  await chooseNewWorktree(page);
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });

  await say("Meanwhile, a teammate pushes a commit to main.");
  app.pushAsTeammate({
    message: "Describe the notes app in the README",
    files: {
      "README.md": "# Notes\n\nA tiny notes app for the terminal. Each note has a footer.\n",
    },
  });
  await pause();

  await say("Commit and push from the Git menu.");
  await runGitMenuItem(page, "Commit & push");

  await say("Before it pushes, T3 Code fetches and rebases the branch onto the new main.");
  await expect
    .poll(
      () => {
        app.git("fetch", "--quiet", "origin");
        return app.git("branch", "--remotes", "--list", "origin/t3/*");
      },
      { timeout: 30_000 },
    )
    .toContain("origin/t3/word-count");
  await pause();

  const log = app.git("log", "--format=%s", "origin/t3/word-count");
  expect(log.split("\n").slice(0, 2)).toEqual([
    "Show a word count in the note footer",
    "Describe the notes app in the README",
  ]);
  await say("The pushed branch has the teammate's commit under the new one. No stale branch.");
  await pause(2_500);
});
