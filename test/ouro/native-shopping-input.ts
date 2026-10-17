import type {} from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

export interface ShoppingGesture {
  /** Fractions of the actual row bounding box, then native event time in ms. */
  points: readonly (readonly [number, number, number])[];
  cancel?: boolean;
  /** Deliver compositor-paced moves without explicit timestamps, for native scrolling. */
  sequential?: boolean;
}
export interface ShoppingInput {
  selector: string;
  gestures: readonly ShoppingGesture[];
}
interface NativeTouchEvent {
  type: string;
  observedAt: number;
  settling: boolean;
  open: string | null;
  timeStamp: number;
  pointerType: string | null;
  isTrusted: boolean;
  detail: number | null;
  defaultPrevented: boolean;
  targetInRow: boolean;
  clientX: number | null;
  clientY: number | null;
}
export interface ShoppingInputObservation {
  terminal: "touchend" | "touchcancel";
  events: NativeTouchEvent[];
  settlingBefore: boolean;
  settlingAfter: boolean;
  openBefore: string | null;
  openAfter: string | null;
}
declare global {
  interface Window {
    __sjTask21NativeTouch?: {
      events: NativeTouchEvent[];
      types: string[];
      listener: (event: Event) => void;
    };
  }
}
const nativeEndTimes = new WeakMap<object, number>();

/** Test-only native input: CDP touchCancel is not exposed by the released test kit.
 * Resolve the real Playwright frame/box; never invent an iframe or dock offset.
 * Only input timestamps are controlled, just as in the released touchDrag command.
 * No DOM pointer dispatch, product timer, spring or animation state is substituted.
 * Consecutive timed gestures queue together; observation round trips must not
 * consume the spring that the next actual native press is meant to interrupt.
 */
export const nativeShoppingInput: BrowserCommand<[ShoppingInput]> = async ({ page }, input) => {
  if (page.context().browser()?.browserType().name() !== "chromium") throw new Error("Native shopping touch input requires Chromium");
  if (input.gestures.length === 0 || input.gestures.some((gesture) => gesture.points.length < 2)) {
    throw new Error("At least one gesture with two native touch points is required");
  }
  if (input.gestures.length > 1 && input.gestures.some((gesture) => gesture.sequential)) {
    throw new Error("Compositor-paced scrolling must use its own native input command");
  }
  const frame = (await Promise.all(page.frames().map(async (candidate) =>
    (await candidate.locator(input.selector).count()) ? candidate : null,
  ))).find((candidate) => candidate !== null);
  if (!frame) throw new Error(`No real frame contains ${input.selector}`);
  const session = await page.context().newCDPSession(page);
  let previousEnd = nativeEndTimes.get(page) ?? 0;
  const observations: ShoppingInputObservation[] = [];
  try {
    await frame.evaluate((selector) => {
      const events: NativeTouchEvent[] = [];
      const row = document.querySelector(selector)!;
      const swipe = (row.matches('[data-ouro="swipe-actions"]') ? row : row.querySelector('[data-ouro="swipe-actions"]'))!;
      const types = ["touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "pointermove", "pointerup", "pointercancel", "click"];
      const listener = (event: Event) => {
        const observed = {
          type: event.type, timeStamp: event.timeStamp, isTrusted: event.isTrusted,
          observedAt: performance.timeOrigin + performance.now(),
          settling: swipe.hasAttribute("data-ouro-settling"), open: swipe.getAttribute("data-open"),
          pointerType: "pointerType" in event ? String(event.pointerType) : null,
          detail: "detail" in event ? Number(event.detail) : null,
          defaultPrevented: event.defaultPrevented,
          targetInRow: row.contains(event.target as Node),
          clientX: "clientX" in event ? Number(event.clientX) : null,
          clientY: "clientY" in event ? Number(event.clientY) : null,
        };
        events.push(observed);
        queueMicrotask(() => { observed.defaultPrevented = event.defaultPrevented; });
      };
      window.__sjTask21NativeTouch = { events, types, listener };
      for (const type of types) window.addEventListener(type, listener, { capture: true, passive: true });
    }, input.selector);
    const box = await frame.locator(input.selector).boundingBox();
    if (!box) throw new Error("A visible row is required for native touch input");
    const send: Promise<unknown>[] = [];
    for (const gesture of input.gestures) {
      // Several queued native gestures must not run backwards in event time when
      // the previous path's explicit duration exceeds the host round-trip time.
      const start = Math.max(Date.now() / 1000, previousEnd + .001);
      previousEnd = start + (gesture.points[gesture.points.length - 1]![2] + 1) / 1000;
      nativeEndTimes.set(page, previousEnd);
      for (const [index, [x, y, ms]] of gesture.points.entries()) {
        const delivery = session.send("Input.dispatchTouchEvent", {
          type: index === 0 ? "touchStart" : "touchMove",
          touchPoints: [{ id: 1, x: box.x + box.width * x, y: box.y + box.height * y }],
          ...(gesture.sequential ? {} : { timestamp: start + ms / 1000 }),
        });
        if (gesture.sequential) await delivery;
        else send.push(delivery);
      }
      send.push(session.send("Input.dispatchTouchEvent", {
        type: gesture.cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
        ...(gesture.sequential ? {} : { timestamp: previousEnd }),
      }));
    }
    await Promise.all(send);
    // Protocol ACKs alone do not prove the actual frame handled every gesture.
    const handled = await frame.waitForFunction((count) =>
      window.__sjTask21NativeTouch!.events.filter((event) =>
        event.type === "touchend" || event.type === "touchcancel").length >= count, input.gestures.length);
    await handled.dispose();
    await frame.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const events = await frame.evaluate(() => window.__sjTask21NativeTouch!.events);
    const starts = events.flatMap((event, index) => event.type === "pointerdown" && event.pointerType === "touch" ? [index] : []);
    if (starts.length !== input.gestures.length) throw new Error("Native input did not deliver one touch pointerdown per gesture");
    for (const [index, gesture] of input.gestures.entries()) {
      const segment = events.slice(starts[index]!, starts[index + 1] ?? events.length);
      const down = segment[0]!;
      const terminal = gesture.cancel ? "touchcancel" : "touchend";
      const endings = segment.filter((event) => event.type === "touchend" || event.type === "touchcancel");
      if (endings.length !== 1 || endings[0]!.type !== terminal) throw new Error(`Native gesture ${index} did not deliver its expected ${terminal}`);
      const end = endings[0]!;
      observations.push({
        terminal, events: segment,
        settlingBefore: down.settling, settlingAfter: end.settling,
        openBefore: down.open, openAfter: end.open,
      });
    }
  } finally {
    try {
      await frame.evaluate(() => {
        const observer = window.__sjTask21NativeTouch;
        if (observer) for (const type of observer.types) window.removeEventListener(type, observer.listener, true);
        delete window.__sjTask21NativeTouch;
      });
    } finally {
      await session.detach();
    }
  }
  return observations;
};

/** Print is a real browser media mode, not a product CSS or clock substitution. */
export const task21PrintMedia: BrowserCommand<["screen" | "print"]> = async ({ page }, media) => {
  await page.emulateMedia({ media });
};

/** Actual top-level coordinates, including the real test iframe placement. */
export const shoppingInputBounds: BrowserCommand<[string]> = async ({ iframe, page }, selector) => {
  const box = await iframe.locator(selector).boundingBox();
  if (!box) throw new Error(`No visible native input target ${selector}`);
  return {
    ...box,
    page: await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, scrollY,
      visual: { width: visualViewport?.width, height: visualViewport?.height, scale: visualViewport?.scale },
    })),
    frame: await iframe.locator(selector).evaluate((element) => {
      const ancestors = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        ancestors.push({ tag: node.tagName, component: node.getAttribute("data-ouro"),
          touchAction: style.touchAction, overflowY: style.overflowY, position: style.position });
      }
      return { scrollY, scrollHeight: document.scrollingElement?.scrollHeight,
        clientHeight: document.scrollingElement?.clientHeight, ancestors };
    }),
  };
};

declare module "vitest/browser" {
  interface BrowserCommands {
    nativeShoppingInput(input: ShoppingInput): Promise<ShoppingInputObservation[]>;
    task21PrintMedia(media: "screen" | "print"): Promise<void>;
    shoppingInputBounds(selector: string): Promise<{ x: number; y: number; width: number; height: number }>;
  }
}
