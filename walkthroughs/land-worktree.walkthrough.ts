import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Land a worktree (PR #4): Land merges the worktree branch into its base
// branch, then removes the worktree and the branch. It does not push.

walkthrough.use({ scenario: { project: notesProject, agent: wordCountAgent } });

walkthrough("Land a worktree", async ({ page, app, title, say, pause }) => {
  await title("Land a worktree");

  await say("Start the thread in a new worktree, on its own branch.");
  await page.getByText("Current checkout").first().click();
  await page.getByRole("menuitemradio", { name: "New worktree" }).click();

  await say("Ask the agent for a change.");
  await page.getByRole("textbox").first().pressSequentially("Add a word count to the note footer", {
    delay: 35,
  });
  await page.keyboard.press("Enter");

  await say("The agent works in the worktree. The main checkout does not change.");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });
  await pause();

  const land = page.getByRole("button", { name: "Land worktree" }).first();
  await say("For a worktree thread, Land is the default Git action.");
  await land.hover();
  await pause();

  await say("Land commits the work, merges the branch into main, and removes the worktree.");
  await land.click();
  const landed = page.getByText(/Landed t3\/word-count into main/).first();
  await expect(landed).toBeVisible({ timeout: 30_000 });
  await pause();

  await say("The landing shows in the thread. The agent reads it at the start of its next turn.");
  await landed.click();
  await pause(2_000);

  await say("Land does not push. Push is the next action, when you are ready.");
  const push = page.getByRole("button", { name: "Push" }).first();
  await push.click();
  await say("main is the default branch, so T3 Code asks first.");
  await page.getByRole("button", { name: "Push to main" }).click();
  await expect
    .poll(() => app.git("rev-parse", "origin/main") === app.git("rev-parse", "main"), {
      timeout: 30_000,
    })
    .toBe(true);
  await pause();

  await say("main has the new commit, and the worktree and its branch are gone.");
  expect(app.git("branch", "--list", "t3/*")).toBe("");
  await pause(2_500);
});
