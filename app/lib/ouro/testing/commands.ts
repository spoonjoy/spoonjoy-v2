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

export interface TouchDragOptions {
  /** Viewport coordinates where the finger touches down. */
  from: [number, number];
  /** Viewport coordinates where the finger lifts. */
  to: [number, number];
  /** Number of intermediate moves. */
  steps: number;
  /**
   * Time from touch down to lift, as the page's event timestamps report it, in milliseconds.
   * Set it when the gesture's speed matters, as for a swipe over scroll snap points: the
   * browser flings on from the speed at lift. Without it the speed is however fast the test
   * machine sends the moves, which differs from run to run.
   */
  durationMs?: number;
}

/**
 * A one-finger drag with real touch input (Chromium only, through CDP
 * `Input.dispatchTouchEvent`), so the page sees `pointerType: "touch"` pointer events
 * and touch events, as from a phone: a swipe to dismiss. Needs a context with
 * `hasTouch`, as in the `touch` project. Coordinates are relative to the top-level page.
 */
export const touchDrag: BrowserCommand<[TouchDragOptions]> = async (ctx, { from, to, steps, durationMs }) => {
  const { page } = ctx;
  if (ctx.provider.name !== "playwright" || page.context().browser()?.browserType().name() !== "chromium") {
    throw new Error("touchDrag: CDP input is Chromium only");
  }
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  const start = Date.now() / 1000;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", [x, y]: [number, number], t: number) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
      ...(durationMs === undefined ? {} : { timestamp: start + (durationMs * t) / 1000 }),
    });
  await releaseFinger(page, session);
  await touch("touchStart", from, 0);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    await touch("touchMove", [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], t);
  }
  await touch("touchEnd", to, 1);
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

/** The top-level page's zoom (`visualViewport.scale`): 1 unless something zoomed the page. */
export const pageZoom: BrowserCommand<[]> = async (ctx) =>
  // Runs in the page; written without DOM types, which an app's config for this file may lack.
  ctx.page.evaluate(() => (globalThis as { visualViewport?: { scale: number } | null }).visualViewport?.scale ?? 1);

/** One CDP session for a Chromium page, or undefined in another browser. */
async function chromiumSession(ctx: Parameters<BrowserCommand<[]>>[0]): Promise<CDPSession | undefined> {
  const { page } = ctx;
  if (ctx.provider.name !== "playwright" || page.context().browser()?.browserType().name() !== "chromium") return undefined;
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  return session;
}

/**
 * Sets the top-level page's zoom back to 1 (Chromium, through CDP; elsewhere it does nothing).
 * In a phone context (`isMobile`), Chromium can zoom the page when the viewport rotates, and
 * rotating back does not undo it; `rotate` in testing/rotate.ts calls this after each resize.
 */
export const resetPageZoom: BrowserCommand<[]> = async (ctx) => {
  await (await chromiumSession(ctx))?.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
};

/** Zooms the top-level page to `scale` (Chromium only), for testing code that checks the zoom. */
export const setPageZoom: BrowserCommand<[scale: number]> = async (ctx, scale) => {
  const session = await chromiumSession(ctx);
  if (!session) throw new Error("setPageZoom: CDP is Chromium only");
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: scale });
};

/**
 * Turns the page's touch emulation back on (Chromium, through CDP; elsewhere it does nothing).
 * Chromium drops it, for the rest of the page's life, after a screenshot that reaches beyond
 * the viewport, such as the one Vitest takes when a test fails on a tall page: the page then
 * reports a fine pointer that can hover. The `ouro-touch` project calls this before every test.
 */
export const restoreTouch: BrowserCommand<[]> = async (ctx) => {
  await (await chromiumSession(ctx))?.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
};

export type TouchStepOptions =
  | {
      /** `touchStart` puts the finger down and `touchMove` moves it. */
      type: "touchStart" | "touchMove";
      /** Where the finger is, relative to the top-level page. */
      x: number;
      y: number;
    }
  | { /** Lifts the finger. */ type: "touchEnd"; x?: number; y?: number };

/** Pages with a `touchStep` finger still down. */
const fingersDown = new WeakSet<object>();

/** Lifts a finger `touchStep` left down, so the next gesture starts clean. */
async function releaseFinger(page: object, session: CDPSession) {
  if (!fingersDown.delete(page)) return;
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * One step of a one-finger gesture with real touch input (Chromium only, through CDP), for
 * gestures `touchDrag` can't make: a finger that stops and stays down mid-swipe. The same
 * finger stays down between calls until `touchEnd`. Lift it in a `finally`, so a failed
 * assertion mid-gesture doesn't leave it down; a finger left down anyway is lifted before
 * the next `touchStart` or `touchDrag`.
 */
export const touchStep: BrowserCommand<[TouchStepOptions]> = async (ctx, step) => {
  const session = await chromiumSession(ctx);
  if (!session) throw new Error("touchStep: CDP input is Chromium only");
  const { page } = ctx;
  if (step.type === "touchEnd") return releaseFinger(page, session);
  if (step.type === "touchStart") await releaseFinger(page, session);
  await session.send("Input.dispatchTouchEvent", { type: step.type, touchPoints: [{ x: step.x, y: step.y, id: 1 }] });
  fingersDown.add(page);
};

export const commands = { emulateMedia, drag, flick, pageZoom, pointerPress, resetPageZoom, restoreTouch, setPageZoom, tap, touchDrag, touchStep };

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia: (options: EmulateMediaOptions) => Promise<void>;
    drag: (options: DragOptions) => Promise<void>;
    flick: (options: FlickOptions) => Promise<void>;
    tap: (selector: string) => Promise<void>;
    touchDrag: (options: TouchDragOptions) => Promise<void>;
    touchStep: (options: TouchStepOptions) => Promise<void>;
    pointerPress: (options: PointerPressOptions) => Promise<void>;
    pageZoom: () => Promise<number>;
    resetPageZoom: () => Promise<void>;
    restoreTouch: () => Promise<void>;
    setPageZoom: (scale: number) => Promise<void>;
  }
}
