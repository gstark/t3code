import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { chooseNewWorktree, send, versionControl } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Worktree recipes (PRs #7 and #20): a new worktree runs `just worktree`, and
// landing runs `just worktree-complete` before the worktree goes away.

const justfile = [
  "# Run the tests",
  "test:",
  "    node --test",
  "",
  "# Prepare a new worktree",
  "worktree:",
  "    cp .env.example .env",
  '    echo "Copied .env from .env.example"',
  "",
  "# Clean up before the worktree goes away",
  "worktree-complete:",
  '    echo "Stopping the local notes database"',
  "    sleep 3",
  '    echo "Removed the local notes database"',
  "",
].join("\n");

walkthrough.use({
  scenario: {
    project: {
      ...notesProject,
      commits: [
        ...notesProject.commits,
        {
          message: "Add worktree recipes",
          files: { justfile, ".env.example": "NOTES_DB=./notes.db\n", ".gitignore": ".env\n" },
        },
      ],
    },
    agent: wordCountAgent,
  },
});

walkthrough("Worktree recipes", async ({ page, app, title, say, pause }) => {
  await title("Justfile worktree recipes");

  await say("The justfile has a worktree recipe and a worktree-complete recipe.");
  await pause();

  await say("Start a thread in a new worktree. The setup runs just worktree.");
  await chooseNewWorktree(page);
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });

  // `git worktree list --porcelain` has one block for each worktree.
  const worktree = app
    .git("worktree", "list", "--porcelain")
    .split("\n\n")
    .find((block) => block.includes("branch refs/heads/t3/word-count"))
    ?.match(/^worktree (.+)$/m)?.[1];
  expect(worktree).toBeDefined();
  expect(app.git("-C", worktree ?? "", "status", "--porcelain", "--ignored")).toContain(".env");
  await say("The worktree has its own .env, copied by the recipe.");
  await pause();

  await say("Land the worktree. just worktree-complete runs before the worktree goes away.");
  await page.getByRole("button", { name: "Land worktree" }).first().click();
  await expect(
    versionControl(page)
      .getByText(/worktree-complete|notes database/)
      .first(),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Landed t3\/word-count into main/).first()).toBeVisible({
    timeout: 30_000,
  });
  await pause(2_500);
});
