import { notesProject } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// List markers that fit (PR #26): ordered list markers such as `10.` stay
// inside the gutter, also in the monospace chat font.

const plan = [
  "Read the footer code.",
  "Read the footer test.",
  "Add a word count helper.",
  "Test the helper with an empty body.",
  "Test the helper with extra spaces.",
  "Show the count in the footer.",
  "Update the footer test.",
  "Run the tests.",
  "Update the README.",
  "Check the README example.",
  "Run the tests again.",
  "Write the commit message.",
]
  .map((step, index) => `${index + 1}. ${step}`)
  .join("\n");

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      exec: { title: "Word count plan" },
      turns: [{ steps: [{ say: { text: `Here is the plan:\n\n${plan}` } }] }],
    },
  },
});

walkthrough("List markers", async ({ page, title, say, pause }) => {
  await title("List markers that fit");

  await send(page, "Plan the word count change");
  await expect(page.getByText("Write the commit message.")).toBeVisible({ timeout: 30_000 });

  await say("Two-digit list numbers stay inside the gutter, also in a monospace font.");
  await page.getByText("Write the commit message.").scrollIntoViewIfNeeded();
  await pause(4_000);
});
