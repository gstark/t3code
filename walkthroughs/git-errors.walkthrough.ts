import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { notesProject, wordCountAgent } from "./support/demo-repo.ts";
import { chooseNewWorktree, runGitMenuItem, send } from "./support/steps.ts";
import { expect, walkthrough } from "./support/walkthrough.ts";

// Git errors (PR #5): a failed Git action says why it failed, not only that
// Git exited with a non-zero status.

walkthrough.use({ scenario: { project: notesProject, agent: wordCountAgent } });

walkthrough("Git errors say why", async ({ page, app, title, say, pause }) => {
  await title("Git errors say why");

  await say("The agent makes a change in a new worktree.");
  await chooseNewWorktree(page);
  await send(page, "Add a word count to the note footer");
  await expect(page.getByText("both tests pass")).toBeVisible({ timeout: 60_000 });

  // A server hook that declines every push, as branch protection would.
  const hook = NodePath.join(app.origin, "hooks", "pre-receive");
  NodeFS.writeFileSync(hook, "#!/bin/sh\necho 'Pushes need a review.' >&2\nexit 1\n");
  NodeFS.chmodSync(hook, 0o755);

  await say("The remote has a rule that declines this push.");
  await runGitMenuItem(page, "Commit & push");
  await expect(page.getByText(/server hook or branch protection rule declined it/)).toBeVisible({
    timeout: 30_000,
  });
  await say("Before, the message was only “Git command exited with a non-zero status”.");
  await pause(2_500);
});
