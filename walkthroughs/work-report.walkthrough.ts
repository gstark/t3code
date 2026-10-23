import * as NodePath from "node:path";

import { notesProject } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Work reports (PR #14): a report thread reads the threads that settled since
// the last report and writes a report to a folder you pick. Its suggestions
// focus on where agents struggled.

const day = new Date().toISOString().slice(0, 10);

const personal = `# Personal work, ${day}

## Notes

- The note footer shows a word count after the date. A helper counts the
  words, and a test covers it.
- The README says what the footer shows.
`;

const suggestions = `# Suggestions, ${day}

## notes

### Checks

- The agent ran \`npm test\` twice before it found the footer test. Add a
  \`test\` line to AGENTS.md. (Word count in the footer, turn 1)

### Navigation pointers

- Add "The footer is built in src/footer.js" to AGENTS.md. The agent searched
  for it in both threads. (Word count in the footer, turn 1; README for the
  footer, turn 1)
`;

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
            { run: { command: "grep -rn footer src", ms: 500 } },
            { say: { text: "The footer now shows the word count after the date." } },
          ],
        },
        {
          match: "readme",
          steps: [
            { run: { command: "grep -rn footer src README.md", ms: 500 } },
            { say: { text: "The README now says what the footer shows." } },
          ],
        },
        {
          match: "work report",
          steps: [
            { think: { text: "List the settled threads, then read each digest.", ms: 1_200 } },
            { run: { command: "head -20 AGENTS.md", ms: 500 } },
            { edit: { path: "clients.md", content: "## Personal\n\n- /tmp/demo/notes\n" } },
            { edit: { path: `reports/${day}/personal.md`, content: personal } },
            { edit: { path: `reports/${day}/suggestions.md`, content: suggestions } },
            {
              say: {
                text: `I wrote the report for 2 threads:\n\n- \`reports/${day}/personal.md\`\n- \`reports/${day}/suggestions.md\`\n\nThe suggestions add two lines to AGENTS.md, because the agent searched for the footer in both threads.`,
              },
            },
          ],
        },
      ],
    },
  },
});

walkthrough("Work reports", async ({ page, app, title, say, pause }) => {
  await title("Work reports");
  const row = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });

  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("shows the word count")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await send(page, "Update the README for the footer");
  await expect(page.getByText("The README now says")).toBeVisible({ timeout: 30_000 });

  await say("Settle the threads when the work is done.");
  for (const name of ["Word count in the footer", "README for the footer"]) {
    await row(name).hover();
    await row(name).getByRole("button", { name: "Settle thread" }).click();
  }
  await pause();

  await say("The sidebar counts the settled threads since the last report.");
  const report = page.getByRole("button", { name: /^Work report: 2 settled threads/ });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await pause();
  await report.click();

  await say("Pick a folder for the reports.");
  // The field starts as ~/work-reports, which is in your real home folder.
  const folder = page.getByRole("textbox", { name: "Reports folder" });
  await folder.fill("");
  await folder.pressSequentially(NodePath.join(NodePath.dirname(app.workspace), "reports"), {
    delay: 30,
  });
  await page.getByRole("button", { name: "Start report" }).click();

  await say("A report thread reads the settled threads and writes the report.");
  await row(`Work report ${day}`).click();
  await expect(page.getByText("I wrote the report")).toBeVisible({ timeout: 60_000 });
  await pause(3_500);
});
