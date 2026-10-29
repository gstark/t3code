import * as NodeTimersPromises from "node:timers/promises";

import type { Locator, Page } from "@playwright/test";

export async function showCursor(page: Page, pace: number) {
  const cursor = new Cursor(page, pace);

  cursors.set(page, cursor);

  await page.exposeFunction("__walkthroughCursorAt", () => cursor.at);

  await page.addInitScript(drawCursor);

  patchLocators(Object.getPrototypeOf(page.locator("html")) as Locator);
  const move = page.mouse.move.bind(page.mouse);

  page.mouse.move = async (x, y, options) => {
    await cursor.glideTo({ x, y });

    await move(x, y, options);
  };
}

// Playwright has no hook around actions, so wrap them on the Locator class.
// Pages without a cursor (an off-camera context) pass straight through.
function patchLocators(locator: Locator) {
  if (locatorsPatched) {
    return;
  }

  locatorsPatched = true;
  const methods = locator as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

  for (const name of pointedAt) {
    const action = methods[name];

    methods[name] = async function (this: Locator, ...args: unknown[]) {
      const cursor = cursors.get(this.page());

      await cursor?.pointAt(this);

      const result = await action.apply(this, args);

      if (clicks.has(name)) {
        await cursor?.linger();
      }

      return result;
    };
  }
}

// Runs in the page before its own scripts; serialized, so it must stand alone.
function drawCursor() {
  if (window.top !== window) {
    return;
  }

  const at = { x: 640, y: 360 };
  let gliding = 0;

  function start() {
    const host = document.createElement("walkthrough-cursor");

    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    // Closed, so Playwright's selectors never match anything inside it.
    const root = host.attachShadow({ mode: "closed" });

    root.innerHTML = `
      <style>
        .pointer {
          position: absolute; left: 0; top: 0; width: 34px; height: 48px;
          margin: -3px 0 0 -3px; transform-origin: 3px 3px;
          filter: drop-shadow(0 3px 4px rgb(0 0 0 / 0.45));
          transition: scale 120ms ease-out;
        }
        .pointer.pressed { scale: 0.82; }
        .ring {
          position: absolute; width: 92px; height: 92px; margin: -46px 0 0 -46px;
          border-radius: 50%; box-sizing: border-box;
          border: 6px solid rgb(255 183 3);
          background: rgb(255 183 3 / 0.22);
          box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35), inset 0 0 0 2px rgb(0 0 0 / 0.35);
          animation: ring 750ms ease-out forwards;
        }
        @keyframes ring {
          0% { transform: scale(0.15); opacity: 1; }
          40% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.45); opacity: 0; }
        }
      </style>
      <svg class="pointer" viewBox="0 0 17 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.5 1.5v18.2l4.6-4.4 3.1 7.1 3.3-1.4-3.1-7h6.5z"
          fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round" />
      </svg>`;
    const pointer = root.querySelector<SVGElement>(".pointer");

    if (!pointer) {
      return;
    }

    const place = (x: number, y: number) => {
      at.x = x;
      at.y = y;
      pointer.style.translate = `${x}px ${y}px`;
    };

    place(at.x, at.y);
    document.documentElement.append(host);
    void window.__walkthroughCursorAt?.().then((point) => {
      if (!gliding) {
        place(point.x, point.y);
      }
    });

    // A gentle arc with ease-in-out reads as a hand, not a robot.
    window.__walkthroughCursor = {
      glide(x, y, ms) {
        const from = { ...at };
        const bend = Math.hypot(x - from.x, y - from.y) * 0.12;
        const length = Math.hypot(x - from.x, y - from.y) || 1;
        const control = {
          x: (from.x + x) / 2 + ((y - from.y) / length) * bend,
          y: (from.y + y) / 2 - ((x - from.x) / length) * bend,
        };
        const began = performance.now();
        const run = ++gliding;
        const step = (now: number) => {
          if (run !== gliding) {
            return;
          }

          const t = Math.min(1, (now - began) / ms);
          const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
          const u = 1 - e;

          place(
            u * u * from.x + 2 * u * e * control.x + e * e * x,
            u * u * from.y + 2 * u * e * control.y + e * e * y,
          );

          if (t < 1) {
            requestAnimationFrame(step);
          }
        };

        requestAnimationFrame(step);
      },
    };

    // The real mouse: Playwright moves it as it acts.
    const options = { capture: true, passive: true };

    window.addEventListener(
      "mousemove",
      (event) => {
        gliding++;
        place(event.clientX, event.clientY);
      },
      options,
    );
    window.addEventListener(
      "pointerdown",
      (event) => {
        gliding++;
        place(event.clientX, event.clientY);
        pointer.classList.add("pressed");
        const ring = document.createElement("div");

        ring.className = "ring";
        ring.style.left = `${event.clientX}px`;
        ring.style.top = `${event.clientY}px`;
        ring.addEventListener("animationend", () => ring.remove());
        pointer.before(ring);
      },
      options,
    );
    window.addEventListener("pointerup", () => pointer.classList.remove("pressed"), options);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

declare global {
  interface Window {
    __walkthroughCursor?: { glide: (x: number, y: number, ms: number) => void };
    __walkthroughCursorAt?: () => Promise<Point>;
  }
}

// The Locator methods that move the mouse, or that a person would move the
// mouse for (pointing at a field before typing). Clicks get a moment after
// them so the ring is seen before the next glide.
const pointedAt = [
  "click",
  "dblclick",
  "hover",
  "check",
  "uncheck",
  "setChecked",
  "fill",
  "clear",
  "pressSequentially",
  "selectOption",
] as const;

const clicks = new Set<string>(["click", "dblclick", "check", "uncheck", "setChecked"]);

const cursors = new WeakMap<Page, Cursor>();

let locatorsPatched = false;

class Cursor {
  // Where the pointer is drawn. It starts mid-screen, where a person's hand
  // would rest, and each new document draws it here again.
  at: Point = { x: 640, y: 360 };

  readonly #page: Page;
  readonly #pace: number;

  constructor(page: Page, pace: number) {
    this.#page = page;
    this.#pace = pace;
  }

  async pointAt(locator: Locator) {
    let box: Awaited<ReturnType<Locator["boundingBox"]>>;

    try {
      // Scroll first, as a person would, so the glide ends where the click lands.
      await locator.scrollIntoViewIfNeeded({ timeout: 3_000 });

      box = await locator.boundingBox({ timeout: 1_000 });
    } catch {
      // Not there yet, or ambiguous: the action itself waits or fails with the real reason.
      return;
    }

    if (!box || box.width === 0) {
      return;
    }

    await this.glideTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  async glideTo(target: Point) {
    const from = this.at;

    this.at = target;

    if (this.#pace === 0) {
      return;
    }

    const distance = Math.hypot(target.x - from.x, target.y - from.y);

    if (distance < 4) {
      return;
    }

    const ms = Math.round(Math.min(800, 250 + distance * 0.5));

    await this.#page
      .evaluate(
        ([x, y, ms]) => window.__walkthroughCursor?.glide(x, y, ms),
        [target.x, target.y, ms],
      )
      .catch(() => {});
    // A beat on arrival, before the press.
    await NodeTimersPromises.setTimeout(ms + 100);
  }

  async linger() {
    if (this.#pace > 0) {
      await NodeTimersPromises.setTimeout(300);
    }
  }
}

// Headless Chromium records no mouse pointer, so each page draws one that glides
// to the next target and rings on each click. The glide is only drawn: the real
// mouse still jumps when Playwright acts, so nothing on the way is hovered.

type Point = { x: number; y: number };
