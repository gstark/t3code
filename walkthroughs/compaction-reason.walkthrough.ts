import { notesProject } from "./support/demo-repo.ts";
import { send, turnOnContextIndicator } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Why compaction is off (PR #17): when you cannot compact, the context
// popover gives the reason.

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      exec: { title: "Notes app review" },
      turns: [
        {
          context: 120_000,
          steps: [
            { run: { command: "cat src/*.js", ms: 600 } },
            { say: { text: "I read the source. The notes app has two modules." } },
          ],
        },
        {
          steps: [
            { think: { text: "Run the tests and read the output.", ms: 1_000 } },
            { run: { command: "npm test", ms: 9_000 } },
            { say: { text: "The test passes." } },
          ],
        },
      ],
    },
  },
});

walkthrough("Why compaction is off", async ({ page, title, say, pause }) => {
  await title("Why compaction is off");
  const meter = page.getByRole("button", { name: /^Context window/ });
  const compact = page.getByRole("button", { name: "Compact context" });

  await turnOnContextIndicator(page, pause);
  await send(page, "Read the source");
  await expect(page.getByText("two modules")).toBeVisible({ timeout: 30_000 });

  await say("While the agent works, you cannot compact. The popover says why.");
  await send(page, "Run the tests");
  await expect(page.getByText(/^Running npm/)).toBeVisible({ timeout: 30_000 });
  await meter.hover();
  await expect(compact).toBeDisabled();
  await expect(page.getByText("Wait for the agent to finish before compacting")).toBeVisible();
  await pause(3_500);

  await say("When the turn ends, the button is ready.");
  await page.mouse.move(640, 300);
  await expect(page.getByText("The test passes.")).toBeVisible({ timeout: 30_000 });
  await meter.hover();
  await expect(compact).toBeEnabled();
  await pause(2_500);
});
