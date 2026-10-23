import { notesProject, wordCountFooter } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// The work log: each row shows how long it took (PR #27), expanded details
// have no height limit (PR #10), and with "Group tool calls" off each call is
// its own row (PR #9).

const wordCountTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { footer } from "../src/footer.js";',
  "",
  'test("footer shows the date", () => {',
  '  const note = { title: "a", body: "", createdAt: new Date(2026, 9, 1) };',
  "  assert.match(footer(note), /^Created /);",
  "});",
  "",
  'test("footer counts the words", () => {',
  '  const note = { title: "a", body: "one two three", createdAt: new Date(2026, 9, 1) };',
  "  assert.match(footer(note), /3 words$/);",
  "});",
  "",
].join("\n");

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      exec: { title: "Word count in the footer" },
      turns: [
        {
          steps: [
            { think: { text: "Find where the footer is built.", ms: 900 } },
            { run: { command: "grep -rn footer src test", ms: 700 } },
            { run: { command: "cat src/footer.js", ms: 400 } },
            { edit: { path: "src/footer.js", content: wordCountFooter } },
            { edit: { path: "test/footer.test.js", content: wordCountTest } },
            { run: { command: "npm test", ms: 1500 } },
            { run: { command: "git diff", ms: 400 } },
            {
              say: { text: "The footer now shows the word count after the date. Both tests pass." },
            },
          ],
        },
      ],
    },
  },
});

walkthrough("The work log", async ({ page, title, say, pause }) => {
  await title("The work log");

  await say("Ask the agent for a change.");
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("Both tests pass")).toBeVisible({ timeout: 60_000 });

  await say("Open the work log. Each step shows how long it took.");
  await page
    .getByRole("button", { name: /^Worked for/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Ran \d+ commands/ }).click();
  await pause(2_000);

  await say("Open a command to see its full output, with no height limit.");
  await page.getByRole("button", { name: "git diff", exact: true }).click();
  await expect(page.getByText("footer counts the words").first()).toBeVisible();
  await pause(2_500);

  await say('To see each tool call as its own row, turn off "Group tool calls".');
  await page
    .getByRole("button", { name: /settings/i })
    .first()
    .click();
  const group = page.getByRole("switch", { name: "Group tool calls" });
  await group.scrollIntoViewIfNeeded();
  await group.click();
  await pause();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await say("Now the work log lists each call on its own row.");
  await expect(page.getByRole("button", { name: "npm test", exact: true })).toBeVisible();
  await pause(2_500);
});
