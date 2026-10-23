import { notesProject } from "./support/demo-repo.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// A default environment per project (PR #18): pick where new threads in a
// project start. When that environment is offline, the command palette asks
// you to pick another.

walkthrough.use({
  scenario: { project: notesProject, remote: { label: "Build Box" }, agent: { turns: [] } },
});

walkthrough("A default environment per project", async ({ page, app, title, say, pause }) => {
  await title("A default environment per project");
  const palette = page.locator("[data-testid=command-palette]");

  await say("Notes has a checkout on this Mac and on Build Box.");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /^Project scope/ }).click();
  await page.getByRole("menuitemradio", { name: "Notes" }).click();
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await pause();

  await say("Pick the environment where new threads in Notes start.");
  await page.getByRole("combobox", { name: "Default environment" }).click();
  await page.getByRole("option", { name: "Build Box" }).click();
  await pause();

  await say("Build Box goes offline.");
  await page.getByRole("button", { name: "Connections" }).click();
  await app.remote?.stop();
  await expect(page.getByText(/Reconnecting/).first()).toBeVisible({ timeout: 30_000 });
  await pause();
  await page.getByRole("button", { name: "Back" }).click();

  await say("The command palette says so, and asks where to start.");
  await page.keyboard.press("Meta+k");
  await palette.getByRole("option", { name: "New thread in..." }).click();
  const notes = palette.getByRole("option", { name: /Build Box unavailable/ });
  await expect(notes).toBeVisible({ timeout: 30_000 });
  await notes.hover();
  await pause();
  await notes.click();
  await expect(palette.getByText("Build Box is unavailable. Start in:")).toBeVisible();
  await pause(2_000);
  await say("Start the thread on this Mac instead.");
  await palette.getByRole("option", { name: /^Local/ }).click();
  await expect(palette).toBeHidden();
  await pause(2_500);
});
