import { notesProject, wordCountFooter } from "./support/demo-repo.ts";
import { send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Click to copy inline code (PR #11), and diffs in the VS Code Dark+ style
// with `+` and `-` markers (PR #23).

walkthrough.use({
  scenario: {
    project: notesProject,
    agent: {
      exec: { title: "Word count in the footer" },
      turns: [
        {
          steps: [
            { think: { text: "Find where the footer is built.", ms: 800 } },
            { edit: { path: "src/footer.js", content: wordCountFooter } },
            {
              say: {
                text: "The footer in `src/footer.js` now shows the word count after the date. Run `npm test` to check it.",
              },
            },
          ],
        },
      ],
    },
  },
});

walkthrough("Inline code and diffs", async ({ page, title, say, pause }) => {
  await title("Inline code and diffs");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("to check it")).toBeVisible({ timeout: 60_000 });

  await say("Click a command in a message to copy it.");
  await page.getByText("npm test", { exact: true }).last().click();
  await expect(page.getByText("Copied!")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm test");
  await pause(2_000);

  await say("Diffs use the VS Code colors, with + and - markers.");
  await page.getByRole("button", { name: "Open diff" }).last().click();
  // The file header is in the diff viewer's shadow root; its chevron sits
  // left of the file name.
  const name = page.getByText("src/footer.js", { exact: true }).last();
  const box = await name.boundingBox();
  if (!box) throw new Error("The diff panel has no src/footer.js row.");
  await page.mouse.move(box.x - 42, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  await say("Changed words inside a line get a stronger color.");
  await pause(3_000);
});
