import { notesProject } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Server health (PR #28): on a remote environment, Thread details shows the
// server's latency, CPU, load, and memory.

walkthrough.use({
  scenario: {
    project: notesProject,
    remote: { label: "Build Box" },
    agent: {
      exec: { title: "Run the tests on Build Box" },
      turns: [
        {
          steps: [
            { run: { command: "npm test", ms: 1_500 } },
            { say: { text: "The tests pass on Build Box." } },
          ],
        },
      ],
    },
  },
});

walkthrough("Server health", async ({ page, title, say, pause }) => {
  await title("Server health");

  await say("This thread runs on Build Box, a remote environment.");
  await send(page, "Run the tests");
  await expect(page.getByText("The tests pass on Build Box.")).toBeVisible({ timeout: 30_000 });

  await say("Thread details shows a summary of the server's health.");
  const health = page.getByRole("region", { name: "Server health" }).getByRole("button");
  await expect(health).toHaveText(/ms/, { timeout: 15_000 });
  await health.hover();
  await pause();

  await say("Open it to see latency, CPU, load, and memory.");
  await health.click();
  await page.mouse.move(640, 400);
  await pause(4_000);
});
