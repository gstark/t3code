# Walkthroughs

Recorded walkthroughs of T3 Code features. Each walkthrough is a Playwright
script. It drives the real app against a demo repository and a scripted
stand-in for the Codex CLI. No real account, project, or chat history shows
on screen.

## Run

```sh
pnpm exec playwright test -c walkthroughs/playwright.config.ts
```

To run one walkthrough, add its file name:

```sh
pnpm exec playwright test -c walkthroughs/playwright.config.ts land-worktree
```

Each run writes `walkthroughs/videos/<name>.mp4` and `<name>.cues.json`.
The mp4 has a caption band above the app, a visible pointer, and a ring at
each click. The encoder needs `ffmpeg` on PATH. Without it, the run keeps the
webm with no captions.

## What a run does

1. It deletes and creates again the root folder, `/tmp/demo` by default.
2. It creates the demo repository from the scenario, with a bare `origin`.
3. It writes a throwaway T3 Code home with only the fake Codex turned on.
4. It starts `scripts/dev-runner.ts` with that home, on its own ports.
5. It pairs the browser and records the steps.
6. It stops the server and removes the root folder.

The run never reads or writes `~/.t3`. Git uses a fake identity, "Sam Rivera".
The machine label shows "Demo Mac".

## Settings

| Variable                  | Default     | Effect                                                       |
| ------------------------- | ----------- | ------------------------------------------------------------ |
| `WALKTHROUGH_PACE_MS`     | `1200`      | The pause after each caption. `0` also skips pointer glides. |
| `WALKTHROUGH_ROOT`        | `/tmp/demo` | The root folder. The app shows worktree paths below it.      |
| `WALKTHROUGH_KEEP`        | unset       | Keep the root folder after the run, to look at it.           |
| `WALKTHROUGH_PORT_OFFSET` | `47`        | `T3CODE_PORT_OFFSET` for the dev server.                     |

## Write a walkthrough

1. Add `<name>.walkthrough.ts` in this folder.
2. Set the scenario with `walkthrough.use({ scenario })`. A scenario is a
   project (see `support/demo-repo.ts`) and an agent script.
3. Write the steps with `title`, `say`, and `pause`, and the usual Playwright
   `page` calls.

The agent script (`support/agent-script.ts`) lists turns. Each prompt runs
the first unused turn whose `match` finds it. A turn's steps run for real in
the thread's checkout:

- `think` and `say` stream reasoning and reply text.
- `run` runs a shell command and shows its real output.
- `edit` writes a file and shows the diff.
- `plan` updates the plan.
- `wait` pauses.

The `exec` values answer T3 Code's text generation: the commit subject and
body, the thread title, and the branch name.
`execFor` overrides those values when its `match` finds the prompt, for
example to give each thread its own title.

A turn's `context` sets the tokens that it adds to the context window. The
default is 18,000.

A scenario's `acpAgent` adds a second agent, "ACP Agent", that speaks ACP
(`support/fake-acp.mjs`). It plays the same kind of script. Its `run` steps
can give a `reason`, which T3 Code shows as the work log label.

A scenario's `remote` starts a second server with its own clone of the
project, and pairs it as a remote environment before the recording starts.
`app.remote.stop()` takes it offline.

To find the steps for a new walkthrough, run
`node walkthroughs/support/explore.ts [scenario.json]` and use the pairing
URL that it prints.
