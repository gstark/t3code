import * as NodeTimersPromises from "node:timers/promises";

import { type Page, test } from "@playwright/test";

import appearance from "./appearance.json" with { type: "json" };
import { showCursor } from "./cursor.ts";
import { type Environment, type Scenario, startEnvironment } from "./environment.ts";
import { saveVideo } from "./save-video.ts";

export { expect } from "@playwright/test";
export type { Scenario } from "./environment.ts";

// The default pause; 0 also skips the pointer's glides, for fast checks.
function pace() {
  const ms = Number(process.env.WALKTHROUGH_PACE_MS ?? 1200);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error("WALKTHROUGH_PACE_MS must be a nonnegative number");
  }
  return ms;
}

// Each caption, with the seconds into the video at which it appears and is
// replaced. The video starts when the app is ready; `offset` is the time
// before that, which the encoder cuts.
export class Narration {
  offset = 0;
  #openedAt = performance.now();
  #startedAt = 0;
  readonly #cues: Cue[] = [];

  start() {
    this.#startedAt = performance.now();
    this.offset = (this.#startedAt - this.#openedAt) / 1000;
  }

  show(text: string, title: boolean) {
    const now = this.#seconds();
    const last = this.#cues.at(-1);
    if (last && last.to === undefined) last.to = now;
    if (text) this.#cues.push({ text, title, from: now });
  }

  finish(): FinishedCue[] {
    const now = this.#seconds();
    return this.#cues.map((cue) => ({ ...cue, to: cue.to ?? now }));
  }

  #seconds() {
    return (performance.now() - this.#startedAt) / 1000;
  }
}

// Each walkthrough file sets its scenario with `walkthrough.use({ scenario })`.
// The environment is worker-scoped so its start-up happens before the browser
// opens; Playwright starts a new worker for each scenario.
export const walkthrough = test.extend<
  {
    narration: Narration;
    say: (text: string) => Promise<void>;
    title: (text: string) => Promise<void>;
    caption: (text: string, options?: { title?: boolean }) => Promise<void>;
    pause: (ms?: number) => Promise<void>;
  },
  { scenario: Scenario | undefined; app: Environment }
>({
  scenario: [undefined, { option: true, scope: "worker" }],
  app: [
    async ({ scenario }, use) => {
      if (!scenario) throw new Error("Set a scenario with walkthrough.use({ scenario })");
      const environment = await startEnvironment(scenario);
      try {
        await use(environment);
      } finally {
        await environment.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  // The recording starts when the page opens. Pairing and the first load
  // happen before `narration.start()`, and the encoder cuts them.
  // Playwright requires a destructured first parameter even with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  narration: async ({}, use) => {
    await use(new Narration());
  },
  page: async ({ page, narration, app, browser }, use, testInfo) => {
    // The theme and appearance settings live in localStorage, so write them
    // before the app reads them on each load.
    await page.addInitScript((items) => {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
    }, appearance);
    await showCursor(page, pace());
    await pair(page, app.pairingUrl);
    if (app.remote) await pairRemote(page, app.pairingUrl, app.remote.pairingUrl);
    narration.start();
    try {
      await use(page);
    } finally {
      await page.close();
      await saveVideo(page, testInfo, narration, browser);
    }
  },
  // Captions are drawn in a band above the browser when the video is encoded,
  // so they never cover the page and are never part of it.
  caption: async ({ narration }, use) => {
    await use(async (text, { title = false } = {}) => {
      narration.show(text, title);
    });
  },
  say: async ({ caption, pause }, use) => {
    await use((text) =>
      test.step(text, async () => {
        await caption(text);
        await pause();
      }),
    );
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first parameter.
  pause: async ({}, use) => {
    const ms = pace();
    await use(async (wait = ms) => {
      await NodeTimersPromises.setTimeout(wait);
    });
  },
  title: async ({ caption, pause }, use) => {
    await use((text) =>
      test.step(text, async () => {
        await caption(text, { title: true });
        await pause(2_000);
      }),
    );
  },
});

// The pairing link signs the browser in once. The first load compiles the
// app in Vite, so it can take a while.
async function pair(page: Page, pairingUrl: string) {
  await page.goto(pairingUrl);
  await page.locator("[data-thread-item], textarea, [contenteditable=true]").first().waitFor({
    timeout: 90_000,
  });
  // Let fonts, icons, and the sidebar settle before the first frame.
  await NodeTimersPromises.setTimeout(1_500);
}

// Adds the second server in Settings > Connections. Its pairing link names
// a web port that is not running, so the host is the server port itself.
async function pairRemote(page: Page, pairingUrl: string, remotePairingUrl: string) {
  const remote = new URL(remotePairingUrl);
  const code = new URLSearchParams(remote.hash.slice(1)).get("token") ?? "";
  const serverPort = Number(remote.port) - BASE_WEB_PORT + BASE_SERVER_PORT;
  await page.goto(new URL("/settings/connections", pairingUrl).toString());
  await page.getByRole("button", { name: "Add environment" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Environment" });
  await dialog.getByRole("textbox", { name: "Host" }).fill(`http://localhost:${serverPort}`);
  await dialog.getByRole("textbox", { name: "Pairing code" }).fill(code);
  await dialog.getByRole("button", { name: "Add environment" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  await page.goto(new URL("/", pairingUrl).toString());
  await page.locator("[data-thread-item], textarea, [contenteditable=true]").first().waitFor();
  await NodeTimersPromises.setTimeout(1_500);
}

// As in scripts/dev-runner.ts; T3CODE_PORT_OFFSET moves both.
const BASE_SERVER_PORT = 13773;
const BASE_WEB_PORT = 5733;

export type FinishedCue = Required<Cue>;

type Cue = { text: string; title: boolean; from: number; to?: number };
