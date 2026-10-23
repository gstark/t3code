import { notesProject } from "./support/demo-repo.ts";
import { send, turnOnContextIndicator } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Context use you can read (PR #16): the active composer shows a
// four-segment bar and a count. It turns amber at 75% and red above 90%.
// The indicator is off by default, so the walkthrough turns it on first.

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      exec: { title: "Notes app review" },
      turns: [
        {
          context: 100_000,
          steps: [
            { run: { command: "cat src/*.js", ms: 600 } },
            { say: { text: "I read the source. The notes app has two modules." } },
          ],
        },
        {
          context: 100_000,
          steps: [
            { run: { command: "cat test/*.js", ms: 600 } },
            { say: { text: "I read the tests. Only the footer has a test." } },
          ],
        },
        {
          context: 40_000,
          steps: [
            { run: { command: "git log --stat", ms: 600 } },
            { say: { text: "I read the history. The repository has two commits." } },
          ],
        },
      ],
    },
  },
});

const prompts = ["Read the source", "Read the tests", "Read the git history"];

walkthrough("Context use", async ({ page, title, say, pause }) => {
  await title("Context use you can read");
  const meter = page.getByRole("button", { name: /^Context window/ });

  await say("Turn on the context window indicator in Settings.");
  await turnOnContextIndicator(page, pause);

  for (const [index, prompt] of prompts.entries()) {
    await send(page, prompt);
    await expect(page.getByRole("button", { name: /^Worked for/ })).toHaveCount(index + 1, {
      timeout: 30_000,
    });
    await page.getByRole("textbox").first().click();
    if (index === 0) {
      await say("The composer shows how full the context is, as a bar and a count.");
    } else if (index === 1) {
      await say("At 75%, the bar turns amber.");
    } else {
      await say("Above 90%, it turns red.");
    }
    await expect(meter).toBeVisible();
    await pause(2_000);
  }

  await say("Hover it for the details.");
  await meter.hover();
  await expect(page.getByText("Context Window", { exact: true })).toBeVisible();
  await pause(2_500);
});
