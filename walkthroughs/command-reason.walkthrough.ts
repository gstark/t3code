import { notesProject } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Commands labeled with their reason (PR #8): an ACP agent says why it runs
// each command, and the work log uses that as the label. Codex sends no
// reason, so its label lists every program in the chain.

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      execFor: [
        { match: "source lines", values: { title: "Count the source lines" } },
        { match: "footer tests", values: { title: "Run the footer tests" } },
      ],
      turns: [
        {
          steps: [
            { run: { command: "cat src/*.js | wc -l; git log --oneline | head -1", ms: 600 } },
            { say: { text: "The source has two modules." } },
          ],
        },
      ],
    },
    acpAgent: {
      turns: [
        {
          steps: [
            {
              run: {
                command: "npm test 2>&1 | tail -5",
                reason: "Check that the footer tests pass",
                ms: 1_500,
              },
            },
            { say: { text: "The footer test passes." } },
          ],
        },
      ],
    },
  },
});

walkthrough("Commands labeled with their reason", async ({ page, title, say, pause }) => {
  await title("Commands labeled with their reason");

  await say("Codex sends no reason, so the label lists each program in the chain.");
  await send(page, "Count the source lines");
  await expect(page.getByText("two modules")).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /^Worked for/ })
    .first()
    .click();
  await page.mouse.move(640, 400);
  await pause(2_500);

  await say("An ACP agent says why it runs a command.");
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page.getByRole("button", { name: "gpt-6-astra" }).click();
  await page
    .getByRole("toolbar", { name: "Providers" })
    .getByRole("button", { name: "ACP Agent" })
    .click();
  await page.getByRole("option", { name: /^Default ACP Agent/ }).click();
  await send(page, "Run the footer tests");
  await expect(page.getByText("The footer test passes.")).toBeVisible({ timeout: 30_000 });

  await say("The work log uses that reason as the label.");
  await page
    .getByRole("button", { name: /^Worked for/ })
    .first()
    .click();
  await expect(page.getByText("Check that the footer tests pass")).toBeVisible();
  await page.mouse.move(640, 400);
  await pause(3_000);
});
