import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Justfile recipes (PRs #6 and #22): the actions menu in the thread details
// card lists the public recipes from the root justfile.

const justfile = [
  "# Run the tests",
  "test:",
  "    node --test",
  "",
  "# Check the code style",
  "lint:",
  '    echo "No style problems."',
  "",
  "# Add a note with a title",
  "new-note title:",
  '    echo "{{title}}" >> notes.txt',
  "",
  "_helper:",
  "    true",
  "",
].join("\n");

walkthrough.use({
  scenario: {
    project: {
      ...notesProject,
      commits: [...notesProject.commits, { message: "Add more recipes", files: { justfile } }],
    },
    agent: wordCountAgent,
  },
});

walkthrough("Justfile recipes", async ({ page, title, say, pause }) => {
  await title("Justfile recipes in the actions menu");

  await say("This project has a justfile. There is nothing to set up.");
  await page.getByRole("button", { name: "Project actions" }).first().click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("From justfile")).toBeVisible();

  await say("The actions menu lists its public recipes. Private recipes stay hidden.");
  await menu.getByRole("menuitem", { name: "test" }).hover();
  await pause();

  await say("A recipe runs in the terminal drawer.");
  await menu.getByRole("menuitem", { name: "test" }).click();
  await pause(3_500);
});
