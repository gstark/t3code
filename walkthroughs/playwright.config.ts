import { defineConfig } from "@playwright/test";

import { videoSize } from "./support/save-video.ts";

// Recorded walkthroughs of the fork's features, run against a fake agent and
// demo repositories. See README.md.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.walkthrough.ts",
  outputDir: "./.results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    // Headless Chrome records only the window's visible page, which is 87px
    // shorter than the window. A fixed viewport does not change that, so the
    // window is sized to give a page of exactly videoSize.
    launchOptions: { args: [`--window-size=${videoSize.width},${videoSize.height + 87}`] },
    viewport: null,
    video: { mode: "on", size: videoSize },
    colorScheme: "dark",
  },
});
