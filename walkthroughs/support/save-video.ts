import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import type { Browser, Page, TestInfo } from "@playwright/test";

import type { FinishedCue, Narration } from "./walkthrough.ts";

// The browser's frame. The video adds a caption band above it, so captions
// never cover the app and a player's controls never cover the captions.
export const videoSize = { width: 1280, height: 720 };

// Dark, to sit with the dark app theme. The accent line matches the theme's
// accent and separates the band from the app.
const band = {
  height: 100,
  colour: "#0e0e10",
  text: "#d4d7dd",
  title: "#f5f5f7",
  accent: "#4c8df6",
};

// Stable names: walkthroughs/videos/<name>.mp4 is always the latest run, and
// <name>.cues.json holds the caption times.
export async function saveVideo(
  page: Page,
  testInfo: TestInfo,
  narration: Narration,
  browser: Browser,
) {
  const video = page.video();
  if (!video) throw new Error("Walkthroughs need video recording turned on");

  const directory = NodeURL.fileURLToPath(new URL("../videos/", import.meta.url));
  const slug = NodePath.basename(testInfo.file, ".walkthrough.ts");
  const webm = NodePath.join(directory, `${slug}.webm`);
  const mp4 = NodePath.join(directory, `${slug}.mp4`);
  const cues = narration.finish();

  await NodeFSP.mkdir(directory, { recursive: true });
  await NodeFSP.rm(mp4, { force: true });
  await NodeFSP.writeFile(
    NodePath.join(directory, `${slug}.cues.json`),
    `${JSON.stringify(cues, null, 2)}\n`,
  );
  // The fixture has closed the page. saveAs waits for the encoder to finish.
  await video.saveAs(webm);

  const work = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "walkthrough-"));
  try {
    const images = await renderCaptions(browser, cues, work);
    // Input 0 is the recording, from the moment the app was ready. Each
    // caption image is one more input, shown only while its cue is current.
    const overlays = cues.map((cue, index) => {
      const from = index === 0 ? "[padded]" : `[v${index}]`;
      const to = index === cues.length - 1 ? "" : `[v${index + 1}]`;
      return `${from}[${index + 1}:v]overlay=0:0:enable='between(t,${cue.from.toFixed(2)},${cue.to.toFixed(2)})'${to}`;
    });
    const filter = [
      `[0:v]pad=iw:ih+${band.height}:0:${band.height}:color=${band.colour}${cues.length ? "[padded]" : ""}`,
      ...overlays,
    ].join(";");

    await NodeUtil.promisify(NodeChildProcess.execFile)("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      narration.offset.toFixed(2),
      "-i",
      webm,
      ...images.flatMap((image) => ["-i", image]),
      "-filter_complex",
      filter,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ]);
  } catch (error) {
    await NodeFSP.rm(mp4, { force: true });
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      console.warn(`ffmpeg is not installed; saved ${webm} without captions`);
      return;
    }
    throw error;
  } finally {
    await NodeFSP.rm(work, { recursive: true, force: true });
  }
  await NodeFSP.rm(webm);
}

// Draws each caption as a band-sized PNG. This ffmpeg build may have no text
// filters, so the browser draws the text and ffmpeg only lays images over.
async function renderCaptions(browser: Browser, cues: FinishedCue[], work: string) {
  const context = await browser.newContext({
    viewport: { width: videoSize.width, height: band.height },
  });
  const page = await context.newPage();
  const images: string[] = [];
  try {
    for (const [index, cue] of cues.entries()) {
      await page.setContent(captionHtml(cue));
      const image = NodePath.join(work, `caption-${index}.png`);
      await page.screenshot({ path: image });
      images.push(image);
    }
  } finally {
    await context.close();
  }
  return images;
}

function captionHtml(cue: FinishedCue) {
  const text = cue.text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  const size = cue.title ? 34 : 26;
  const weight = cue.title ? 700 : 500;
  return `<!doctype html><html><body style="margin:0;height:${band.height}px;display:flex;align-items:center;justify-content:center;background:${band.colour};color:${cue.title ? band.title : band.text};box-shadow:inset 0 -2px ${band.accent};font:${weight} ${size}px/1.25 -apple-system,'Helvetica Neue',Arial,sans-serif;text-align:center;padding:0 48px;box-sizing:border-box">${text}</body></html>`;
}
