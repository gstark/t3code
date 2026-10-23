import { notesProject } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// The sidebar: a new thread's row holds the slot that its thread gets, so it
// does not move when you send (PR #13), and the open thread has a rail in the
// theme's primary color (PR #25).

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      execFor: [
        { match: "word count", values: { title: "Word count in the footer" } },
        { match: "readme", values: { title: "README for the footer" } },
      ],
      turns: [
        {
          match: "word count",
          steps: [
            { run: { command: "cat src/footer.js", ms: 500 } },
            { say: { text: "The footer now shows the word count after the date." } },
          ],
        },
        {
          match: "readme",
          steps: [
            { run: { command: "cat README.md", ms: 500 } },
            { say: { text: "The README now says what the footer shows." } },
          ],
        },
      ],
    },
  },
});

walkthrough("The sidebar", async ({ page, title, say, pause }) => {
  await title("The sidebar");
  const row = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });

  await send(page, "Add a word count to the note footer");
  await expect(row("Word count in the footer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("shows the word count")).toBeVisible({ timeout: 30_000 });

  await say("Start a new thread. Its row takes the slot that the thread will get.");
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await pause();
  await say("So the row stays in place when you send.");
  await send(page, "Update the README for the footer");
  await expect(row("README for the footer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The README now says")).toBeVisible({ timeout: 30_000 });
  await pause();

  await say("The open thread has a rail in the theme's primary color.");
  await row("Word count in the footer").click();
  await pause(2_000);
  await row("README for the footer").click();
  await pause(2_000);
});
