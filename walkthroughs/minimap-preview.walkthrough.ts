import { notesProject } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Minimap previews: hover a minimap mark to see when that turn happened and
// how full the context was at its end.

const prompts = [
  "Add a word count to the note footer",
  "Count the title words too",
  "Update the README",
];

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      exec: { title: "Word count in the footer" },
      turns: [
        {
          steps: [
            { run: { command: "cat src/footer.js", ms: 500 } },
            { say: { text: "The footer now shows the word count after the date." } },
          ],
        },
        {
          steps: [
            { run: { command: "cat src/notes.js", ms: 500 } },
            { say: { text: "The count now includes the words in the title." } },
          ],
        },
        {
          steps: [
            { run: { command: "cat README.md", ms: 500 } },
            { say: { text: "The README now says what the footer shows." } },
          ],
        },
      ],
    },
  },
});

walkthrough("Minimap previews", async ({ page, title, say, pause }) => {
  await title("Minimap previews");

  await say("A thread with a few turns. The minimap at the left has a mark for each one.");
  for (const [index, prompt] of prompts.entries()) {
    await send(page, prompt);
    await expect(page.getByRole("button", { name: /^Worked for/ })).toHaveCount(index + 1, {
      timeout: 30_000,
    });
  }
  await pause();

  await say("Hover a mark to see when the turn happened and how full the context was.");
  const strip = page.getByRole("button", { name: /^Jump to message/ });
  const box = await strip.boundingBox();
  if (!box) throw new Error("The minimap is not on screen.");
  for (const y of [0.1, 0.5, 0.9]) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * y);
    await expect(page.getByText(/^Context \d+%/)).toBeVisible();
    await pause(1_800);
  }
});
