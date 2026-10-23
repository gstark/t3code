import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Worktrees from the command palette (PR #1): hold Shift, and each project row
// starts its thread in a new worktree.

walkthrough.use({ scenario: { project: notesProject, agent: wordCountAgent } });

walkthrough("Worktrees from the command palette", async ({ page, app, title, say, pause }) => {
  await title("Worktrees from the command palette");

  await say("Open the command palette with Cmd+K.");
  await page.keyboard.press("Meta+k");
  const palette = page.locator("[data-testid=command-palette]");
  await expect(palette).toBeVisible();
  await pause();

  await say("Choose a project for the new thread.");
  await palette.getByRole("option", { name: "New thread in..." }).click();
  await pause();

  await say("The footer shows a hint: hold Shift for a new worktree.");
  await palette.getByText("New worktree").last().hover();
  await pause();

  await say("Hold Shift, and the project row changes to its worktree action.");
  await page.keyboard.down("Shift");
  const row = palette.getByRole("option", { name: /Notes.*New worktree/ });
  await expect(row).toBeVisible();
  await row.hover();
  await pause(2_000);

  await say("Shift+click, or Shift+Enter, starts the thread in a new worktree.");
  await row.click({ modifiers: ["Shift"] });
  await page.keyboard.up("Shift");
  await expect(page.getByRole("button", { name: "New worktree" }).first()).toBeVisible();
  await pause();

  await say("Ask the agent for a change. It works in the worktree.");
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });
  expect(app.git("worktree", "list")).toContain("t3/word-count");
  expect(app.git("status", "--porcelain")).toBe("");
  await pause(2_500);
});
