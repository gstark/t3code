import { notesProject, wordCountAgent, wordCountFooter } from "./support/demo-repo.ts";
import { runGitMenuItem, send, versionControl } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Commit only (PR #2): "Commit" or "Commit & push" can be the default Git
// action. T3 Code saves the choice for the project.

const withTitle = wordCountFooter.replace(
  "const words = note.body",
  "const words = `${note.title} ${note.body}`",
);

walkthrough.use({
  scenario: {
    project: { ...notesProject, branch: "footer" },
    agent: {
      ...wordCountAgent,
      exec: { ...wordCountAgent.exec, subject: "Count the title words too" },
      turns: [
        ...wordCountAgent.turns,
        {
          steps: [
            { edit: { path: "src/footer.js", content: withTitle } },
            { say: { text: "The count now includes the title.", ms: 1200 } },
          ],
        },
      ],
    },
  },
});

walkthrough("Commit only", async ({ page, app, title, say, pause }) => {
  await title("Commit only, or commit and push");

  await say("The thread works in the main checkout, on the footer branch.");
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });

  const vc = versionControl(page);
  await say("By default, the Git button commits, pushes, and opens a pull request.");
  await vc.getByRole("button", { name: /Commit, push & PR/ }).hover();
  await pause();

  await say("The Git menu also has Commit and Commit & push. Choose Commit.");
  await runGitMenuItem(page, "Commit", "Show a word count in the note footer");
  await expect.poll(() => app.git("status", "--porcelain"), { timeout: 30_000 }).toBe("");
  expect(app.git("log", "-1", "--format=%s")).toBe("Show a word count in the note footer");
  await pause();

  await say("T3 Code saves the choice for the project. Nothing was pushed.");
  expect(app.git("branch", "--remotes")).not.toContain("origin/footer");
  await pause();

  await say("Ask for another change.");
  await send(page, "Count the title words too");
  await expect(page.getByText("includes the title")).toBeVisible({ timeout: 60_000 });

  const commit = vc.getByRole("button", { name: "Commit", exact: true });
  await say("The Git button is now Commit. One click commits, and nothing is pushed.");
  await commit.hover();
  await pause();
  await commit.click();
  await expect.poll(() => app.git("status", "--porcelain"), { timeout: 30_000 }).toBe("");
  expect(app.git("log", "-1", "--format=%s")).toBe("Count the title words too");
  expect(app.git("branch", "--remotes")).not.toContain("origin/footer");
  await pause(2_500);
});
