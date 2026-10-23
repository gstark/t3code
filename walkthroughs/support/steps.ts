import type { Page } from "@playwright/test";

// Steps that many walkthroughs share.

// Switches the draft to a new worktree, from `base` if given.
export async function chooseNewWorktree(page: Page, base?: string) {
  await page.getByText("Current checkout").first().click();
  await page.getByRole("menuitemradio", { name: "New worktree" }).click();
  if (!base) return;
  await page.locator("main").getByRole("combobox").filter({ hasText: "From" }).first().click();
  await page.getByRole("option", { name: base, exact: true }).click();
}

// Types a prompt in the composer and sends it.
export async function send(page: Page, text: string) {
  await page.getByRole("textbox").first().pressSequentially(text, { delay: 35 });
  await page.keyboard.press("Enter");
}

// The Git controls in the Version Control region of the header.
export function versionControl(page: Page) {
  return page.getByRole("region", { name: "Version Control" });
}

// Runs an item from the Git action options menu, then confirms the commit
// dialog if one opens. With no `message`, T3 Code writes the commit message.
export async function runGitMenuItem(page: Page, item: string, message?: string) {
  await versionControl(page).getByRole("button", { name: "Git action options" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Commit changes" });
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if (message) await dialog.getByRole("textbox").last().fill(message);
    await dialog.getByRole("button", { name: "Commit", exact: true }).click();
  }
}

// Turns on the composer's context window indicator, which is off by default,
// and returns from Settings.
export async function turnOnContextIndicator(page: Page, pause: () => Promise<void>) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const legacy = page.getByRole("button", { name: "Legacy features" });
  await legacy.scrollIntoViewIfNeeded();
  await legacy.click();
  const indicator = page.getByRole("switch", { name: "Context window indicator (legacy)" });
  await indicator.scrollIntoViewIfNeeded();
  await indicator.click();
  await pause();
  await page.getByRole("button", { name: "Back", exact: true }).click();
}
