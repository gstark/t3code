import { notesProject, wordCountFooter } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Collapse history (PRs #21 and #29): fold the thread so far into one row
// with a one-line summary. The agent still sees all of it.

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      execMs: 1500,
      exec: {
        title: "Word count in the footer",
        summary: "Added a word count to the note footer and checked the README.",
      },
      turns: [
        {
          match: "word count",
          steps: [
            { think: { text: "Find where the footer is built.", ms: 800 } },
            { run: { command: "grep -rn footer src", ms: 600 } },
            { edit: { path: "src/footer.js", content: wordCountFooter } },
            { run: { command: "npm test", ms: 1200 } },
            { say: { text: "The footer now shows the word count after the date." } },
          ],
        },
        {
          match: "readme",
          steps: [
            { run: { command: "cat README.md", ms: 500 } },
            { say: { text: "The README does not mention the footer, so it needs no change." } },
          ],
        },
        {
          match: "change",
          steps: [
            {
              say: {
                text: "I added a word count after the date in `src/footer.js`, and the tests pass. The README needed no change.",
              },
            },
          ],
        },
      ],
    },
  },
});

walkthrough("Collapse history", async ({ page, title, say, pause }) => {
  await title("Collapse history");

  await say("A thread with some history.");
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("shows the word count after the date")).toBeVisible({
    timeout: 60_000,
  });
  await send(page, "Does the README need a change?");
  await expect(page.getByText("needs no change")).toBeVisible({ timeout: 30_000 });
  await pause();

  await say("Collapse history from the thread actions menu.");
  await page.getByRole("button", { name: /^Thread actions for/ }).click();
  await page.getByText("Collapse history", { exact: true }).click();

  await say("Everything so far folds into one row, with a one-line summary.");
  const summary = page.getByText("Added a word count to the note footer and checked the README.");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await pause(2_000);

  await say("Click the row to look inside.");
  await summary.click();
  await expect(page.getByText("needs no change")).toBeVisible();
  await pause(2_000);
  await summary.click();

  await say("The agent still sees all of it.");
  await send(page, "What did you change?");
  await expect(page.getByText("The README needed no change.")).toBeVisible({ timeout: 30_000 });
  await pause(2_500);
});
