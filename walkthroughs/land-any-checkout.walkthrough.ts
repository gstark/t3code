import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { chooseNewWorktree, send, versionControl } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Land from any checkout (PR #24): landing no longer needs the main checkout
// on the base branch. It moves main forward and leaves that checkout alone.

walkthrough.use({
  scenario: { project: { ...notesProject, branch: "experiment" }, agent: wordCountAgent },
});

walkthrough("Land from any checkout", async ({ page, app, title, say, pause }) => {
  await title("Land from any checkout");

  await say("The main checkout is on the experiment branch, not on main.");
  await versionControl(page)
    .getByRole("combobox")
    .filter({ hasText: "experiment" })
    .first()
    .hover();
  await pause();

  await say("Start a thread in a new worktree, from main.");
  await chooseNewWorktree(page, "main");

  await say("Ask the agent for a change.");
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });
  await pause();

  await say("Before, Land refused here. You had to switch the main checkout to main first.");
  const land = page.getByRole("button", { name: "Land worktree" }).first();
  await land.hover();
  await pause();

  await say("Now Land moves main forward, and the main checkout stays where it is.");
  await land.click();
  const landed = page.getByText(/Landed t3\/word-count into main/).first();
  await expect(landed).toBeVisible({ timeout: 30_000 });
  await pause();

  expect(app.git("branch", "--show-current")).toBe("experiment");
  expect(app.git("status", "--porcelain")).toBe("");
  expect(app.git("log", "-1", "--format=%s", "main")).toBe("Show a word count in the note footer");
  await say("main has the new commit. The main checkout is still on experiment, with no changes.");
  await pause(2_500);
});
