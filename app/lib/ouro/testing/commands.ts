import type {} from "@vitest/browser-playwright";
import type { CDPSession } from "playwright";
import type { BrowserCommand } from "vitest/node";

export interface EmulateMediaOptions {
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark";
}

export interface DragOptions {
  /** Viewport coordinates of the pointer-down point. */
  from: [number, number];
  /** Viewport coordinates of the pointer-up point. */
  to: [number, number];
  /** Number of intermediate mouse moves. */
  steps: number;
  /** Total time the drag takes, in milliseconds. */
  durationMs: number;
  /**
   * Keep the button pressed after the last move, so a test can inspect the
   * mid-drag state. Release with `commands.pointerPress({ action: "up" })`.
   */
  hold?: boolean;
}

/** Wraps Playwright's `page.emulateMedia` for `prefers-reduced-motion` and `prefers-color-scheme`. */
export const emulateMedia: BrowserCommand<[EmulateMediaOptions]> = async (ctx, options) => {
  await ctx.page.emulateMedia(options);
};

/**
 * Drags with real mouse events through Playwright's `page.mouse`, spreading the
 * moves over `durationMs` so velocity-based gestures see a realistic speed.
 * Coordinates are relative to the top-level page (Vitest renders tests in an
 * iframe, so add the iframe offset when starting from an element's rect).
 */
export const drag: BrowserCommand<[DragOptions]> = async (ctx, { from, to, steps, durationMs, hold }) => {
  const { page } = ctx;
  const pause = steps > 0 ? durationMs / steps : 0;
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    await page.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    if (pause > 0) await page.waitForTimeout(pause);
  }
  if (!hold) await page.mouse.up();
};

export interface FlickOptions {
  /** Viewport coordinates of the pointer-down point. */
  from: [number, number];
  /** Viewport coordinates of the pointer-up point. */
  to: [number, number];
  /** Number of intermediate mouse moves. */
  steps: number;
  /** Time from press to release, as the page's event timestamps report it, in milliseconds. */
  durationMs: number;
}

/** One CDP session per page, reused across flicks. */
const cdpSessions = new WeakMap<object, CDPSession>();

/**
 * A mouse gesture with exact timing, for velocity tests (Chromium only). It
 * dispatches through CDP `Input.dispatchMouseEvent` with explicit timestamps,
 * so `event.timeStamp` in the page spans exactly `durationMs`, however busy the
 * machine is. `drag` instead spends a round trip and a wait per step, so a "40ms"
 * flick takes about 80ms unloaded and over 150ms on a loaded CI runner, which a
 * velocity check then reads as a slow drag. Use `drag` for slow drags.
 */
export const flick: BrowserCommand<[FlickOptions]> = async (ctx, { from, to, steps, durationMs }) => {
  const { page } = ctx;
  if (ctx.provider.name !== "playwright" || page.context().browser()?.browserType().name() !== "chromium") {
    throw new Error("flick: CDP input is Chromium only; use drag elsewhere");
  }
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  const start = Date.now() / 1000;
  const send = (type: "mouseMoved" | "mousePressed" | "mouseReleased", [x, y]: [number, number], atMs: number, buttons: number) =>
    session.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, timestamp: start + atMs / 1000 });
  await send("mouseMoved", from, 0, 0);
  await send("mousePressed", from, 0, 1);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const point: [number, number] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    await send("mouseMoved", point, durationMs * t, 1);
  }
  await send("mouseReleased", to, durationMs, 0);
};

export interface PointerPressOptions {
  /** CSS selector of the element to press, inside the test iframe. Not needed for `up`. */
  selector?: string;
  /** `down` moves to the element's center and presses; `up` releases. */
  action: "down" | "up";
}

/**
 * Presses or releases the real mouse over an element, so `:active` styles apply.
 * Coordinates come from Playwright, so the iframe offset is already included.
 */
export const pointerPress: BrowserCommand<[PointerPressOptions]> = async (ctx, { selector, action }) => {
  const { page } = ctx;
  if (action === "up") {
    await page.mouse.up();
    return;
  }
  if (!selector) throw new Error("pointerPress: down needs a selector");
  const box = await ctx.iframe.locator(selector).boundingBox();
  if (!box) throw new Error(`pointerPress: ${selector} is not visible`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
};

/**
 * Taps an element inside the test iframe with real touch input (Playwright's
 * `locator.tap`), so the page sees `pointerType: "touch"`. Needs a context with
 * `hasTouch`, as in the `touch` project.
 */
export const tap: BrowserCommand<[selector: string]> = async (ctx, selector) => {
  await ctx.iframe.locator(selector).tap();
};

export const commands = { emulateMedia, drag, flick, pointerPress, tap };

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia: (options: EmulateMediaOptions) => Promise<void>;
    drag: (options: DragOptions) => Promise<void>;
    flick: (options: FlickOptions) => Promise<void>;
    tap: (selector: string) => Promise<void>;
    pointerPress: (options: PointerPressOptions) => Promise<void>;
  }
}
