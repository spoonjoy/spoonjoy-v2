import type {} from "@vitest/browser-playwright";
import type { CDPSession, Frame, Page } from "playwright";
import type { BrowserCommand } from "vitest/node";

export interface EmulateMediaOptions {
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark";
  forcedColors?: "active" | "none";
  contrast?: "more" | "no-preference";
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

/** Wraps Playwright's `page.emulateMedia` for motion, color, contrast and forced-color preferences. */
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

/** How long a touch command waits for the page to handle an event before it throws. */
const TOUCH_HANDLED_TIMEOUT_MS = 5000;

/**
 * Runs in every frame of the page, as source text because an app's config for this file may
 * lack DOM types. It keeps `__ouroTouch` on the frame's window while a gesture is under way:
 * passive listeners that record the touch events the frame handles, and at most one expected
 * event. The listeners capture on `window` and, from touchstart on, also sit on the touch's
 * target, because a touch's later events go to that target even after it has left the
 * document, where they no longer reach `window`.
 */
const TOUCH_WATCH = `(action, expected) => {
  const view = window;
  let state = view.__ouroTouch;
  if (action === "inspect") return { href: view.location.href, readyState: view.document.readyState, watching: Boolean(state && state.document === view.document) };
  // A frame that navigated keeps its window but loses the listeners: watch its new document afresh.
  if (state && state.document !== view.document) {
    state.remove();
    state = undefined;
  }
  if (!state) {
    if (action !== "expect") return { seen: false, active: false, moved: false, saw: [] };
    const types = ["touchstart", "touchmove", "touchend", "touchcancel"];
    const options = { capture: true, passive: true };
    state = view.__ouroTouch = { document: view.document, saw: [], handled: new WeakSet(), targets: new Set(), expected: null, seen: false, resolve: null, moved: false, active: false };
    // Where this frame's top left is in the top-level page's visual viewport, in CSS pixels, or null if a parent is cross-origin.
    const origin = () => {
      let x = 0, y = 0;
      try {
        let frame = view;
        for (; frame !== frame.parent; frame = frame.parent) {
          const box = frame.frameElement.getBoundingClientRect();
          x += box.left + frame.frameElement.clientLeft;
          y += box.top + frame.frameElement.clientTop;
        }
        // CDP names a point in the visual viewport, which a pinch-zoomed page can pan across the layout viewport.
        const visual = frame.visualViewport;
        return visual ? { x: x - visual.offsetLeft, y: y - visual.offsetTop } : { x, y };
      } catch {
        return null;
      }
    };
    state.listener = (event) => {
      if (state.handled.has(event)) return;
      state.handled.add(event);
      const at = origin();
      // Each changed touch as the point CDP names for it, also on a zoomed page.
      const points = [...event.changedTouches].map((touch) => (at ? [touch.clientX + at.x, touch.clientY + at.y] : null));
      state.saw.push(event.type + points.map((point) => (point ? "(" + Math.round(point[0]) + ", " + Math.round(point[1]) + ")" : "(?)")).join(""));
      if (event.type === "touchstart") {
        state.active = true;
        state.moved = false;
      }
      if (event.type === "touchend" || event.type === "touchcancel") state.active = false;
      if (event.type === "touchmove") state.moved = true;
      if (event.type === "touchstart" && !state.targets.has(event.target)) {
        state.targets.add(event.target);
        for (const type of types.slice(1)) event.target.addEventListener(type, state.listener, { passive: true });
      }
      const want = state.expected;
      if (!want) return;
      if ((event.type === "touchcancel" ? "touchend" : event.type) !== want.type) return;
      if (!points.some((point) => !point || (Math.abs(point[0] - want.x) <= 1 && Math.abs(point[1] - want.y) <= 1))) return;
      state.expected = null;
      state.seen = true;
      if (state.resolve) state.resolve();
    };
    state.remove = () => {
      for (const type of types) view.removeEventListener(type, state.listener, options);
      for (const target of state.targets) for (const type of types.slice(1)) target.removeEventListener(type, state.listener, { passive: true });
      delete view.__ouroTouch;
    };
    for (const type of types) view.addEventListener(type, state.listener, options);
  }
  if (action === "expect") {
    state.expected = expected;
    state.seen = false;
    state.saw = [];
    return { children: view.length };
  }
  if (action === "wait") {
    const result = () => ({ seen: state.seen, active: state.active, moved: state.moved, saw: state.saw });
    // A touchmove before the gesture's first one in this frame is not on its way: see sendTouch.
    if (state.seen || !state.expected || (state.expected.type === "touchmove" && !state.moved)) return result();
    return new Promise((resolve) => {
      const timer = setTimeout(() => state.resolve(), ${TOUCH_HANDLED_TIMEOUT_MS});
      state.resolve = () => {
        clearTimeout(timer);
        state.resolve = null;
        resolve(result());
      };
    });
  }
  // "settle": stop waiting in this frame, and stop watching once the finger is up.
  state.expected = null;
  if (state.resolve) state.resolve();
  if (expected.type === "touchend") state.remove();
  return null;
}`;

interface TouchPoint {
  type: "touchStart" | "touchMove" | "touchEnd";
  x: number;
  y: number;
}
interface TouchSeen {
  /** The frame handled the expected event. */
  seen: boolean;
  /** This document has handled the gesture's touchstart but not its end. */
  active: boolean;
  /** The frame has handled a touchmove in this gesture. */
  moved: boolean;
  /** The touch events the frame handled while it waited. */
  saw: string[];
}

type TouchWatchAction = "expect" | "wait" | "settle" | "inspect";
/** One frame's answer to a `TOUCH_WATCH` call, or why the call failed. */
interface FrameAnswer<T> {
  frame: Frame;
  url: string;
  action: TouchWatchAction;
  value?: T;
  error?: string;
}
interface FrameState {
  href: string;
  readyState: string;
  watching: boolean;
}

/** Rejects with `message` after `ms`, and stops its timer once `promise` settles. */
function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), Math.max(0, ms))));
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/**
 * Calls `TOUCH_WATCH` in one frame. A failed call is kept, with its reason, and so is a call
 * still unanswered after `ms`: Playwright waits for a frame's document before it evaluates
 * there, and a frame whose document never arrives never answers.
 */
function callWatch<T>(frame: Frame, action: TouchWatchAction, point: TouchPoint, ms: number): Promise<FrameAnswer<T>> {
  const call = `(${TOUCH_WATCH})(${JSON.stringify(action)}, ${JSON.stringify({ ...point, type: point.type.toLowerCase() })})`;
  const url = () => frame.url() || "a frame with no URL yet";
  return within(frame.evaluate<T>(call), ms, `did not answer within ${Math.round(ms)}ms`).then(
    (value) => ({ frame, url: url(), action, value }),
    (error: unknown) => ({ frame, url: url(), action, error: (error instanceof Error ? error.message : String(error)).split("\n")[0]! }),
  );
}

/** Calls `TOUCH_WATCH` in each of `frames`, by default every frame of the page Playwright lists. */
function watchTouch<T>(page: Page, action: TouchWatchAction, point: TouchPoint, ms: number, frames: Frame[] = page.frames()): Promise<FrameAnswer<T>>[] {
  return frames.map((frame) => callWatch<T>(frame, action, point, ms));
}

/** How long a "settle" or "inspect" call may take, so tidying up never holds up a command. */
const TOUCH_TIDY_MS = 1000;

/**
 * Whether the frame that receives a touch at (x, y) is watched, asked of Chromium directly.
 * `DOM.getNodeForLocation` hit-tests the way input does, through every frame and every shadow
 * root, open or closed, and past `pointer-events: none`, so it finds the frame a touch there
 * goes to, even one Playwright does not list yet. It takes a point in the top-level document,
 * and a touch a point in the visual viewport, so where that viewport is in the page is added: the
 * top-level page's scroll, and the pan of a pinch-zoomed page. "unknown" means
 * the kit could not place the point in a frame: Chromium found no node there, as for a point
 * outside the viewport, or the node there has no window.
 */
async function frameAtPoint(session: CDPSession, x: number, y: number): Promise<{ watched: boolean | "unknown"; where: string }> {
  try {
    const { cssVisualViewport } = await session.send("Page.getLayoutMetrics");
    const { backendNodeId } = await session.send("DOM.getNodeForLocation", {
      x: Math.round(x + cssVisualViewport.pageX),
      y: Math.round(y + cssVisualViewport.pageY),
      // Hit-test as input does: an element with `pointer-events: none` is not the target.
      ignorePointerEventsNone: false,
    });
    const { object } = await session.send("DOM.resolveNode", { backendNodeId });
    try {
      const { result } = await session.send("Runtime.callFunctionOn", {
        objectId: object.objectId!,
        returnByValue: true,
        // Runs in the node's frame, in the same world as TOUCH_WATCH.
        functionDeclaration: `function () {
          // The hit can be a ::before or ::after box, whose element is \`element\`.
          const node = this.nodeType ? this : this.element;
          const document = node ? node.ownerDocument || node : null;
          const view = document && document.defaultView;
          const state = view && view.__ouroTouch;
          let where = view ? view.location.href : "a node with no window (" + String(this) + ")";
          try {
            const source = view.frameElement && view.frameElement.getAttribute("src");
            if (source) where += ", in an iframe whose src is " + source;
          } catch {}
          // A hit the kit can't place in a frame is "unknown": the kit then waits for every frame Playwright lists.
          return { watched: view ? Boolean(state && state.document === document) : "unknown", where };
        }`,
      });
      return result.value as { watched: boolean | "unknown"; where: string };
    } finally {
      await session.send("Runtime.releaseObject", { objectId: object.objectId! }).catch(() => {});
    }
  } catch (error) {
    return { watched: "unknown", where: (error instanceof Error ? error.message : String(error)).split("\n")[0]! };
  }
}

/** The frame a touch goes to: the one at the touchstart's point, or the one that handled the gesture's touchstart. */
type TouchTarget = { point: { x: number; y: number } } | { frame: Frame };

/**
 * Starts the watch for `expected` in every frame of the page, and resolves once the frame that
 * receives the touch is watched. It never waits for the other frames, so a frame elsewhere that
 * is slow, never loads, or is in another process holds nothing up.
 *
 * Playwright learns of a new frame, and of a frame's new document, from Chromium on its own
 * connection, which can lag the page: a test that adds an iframe, awaits its `load` and
 * touches it can get here before Playwright lists the frame (CI probe run 38385210551). So
 * for a touchstart this asks Chromium which frame is at the point, and checks again each time
 * Playwright lists a frame or a document, or a frame's watch starts, until that frame is
 * watched. It throws after 5 seconds, naming the frame. Later events of a gesture go to the
 * frame its touchstart went to, so for them it waits for that frame's watch only.
 */
async function watchTarget(
  command: string,
  page: Page,
  session: CDPSession,
  expected: TouchPoint,
  target: TouchTarget,
): Promise<{ calls: Map<Frame, Promise<FrameAnswer<null>>>; gone?: string }> {
  const deadline = Date.now() + TOUCH_HANDLED_TIMEOUT_MS;
  const calls = new Map<Frame, Promise<FrameAnswer<null>>>();
  let changed = () => {};
  const watch = (frame: Frame) => {
    const call = callWatch<null>(frame, "expect", expected, TOUCH_HANDLED_TIMEOUT_MS);
    calls.set(frame, call);
    void call.then(() => changed());
  };
  page.on("frameattached", watch).on("framenavigated", watch).on("framedetached", watch);
  const answered = () => Promise.all([...calls.values()]);
  try {
    for (const frame of page.frames()) watch(frame);
    if ("frame" in target) {
      const answer = await (calls.get(target.frame) ?? callWatch<null>(target.frame, "expect", expected, TOUCH_HANDLED_TIMEOUT_MS));
      if (answer.error === undefined) return { calls };
      // A lift is sent all the same, so the finger is not left down.
      const gone = `${command}: could not watch ${answer.url}, the frame the gesture's touchstart went to: ${answer.error}.`;
      if (expected.type === "touchEnd") return { calls, gone: `${gone} The touchEnd was sent, but nothing could see it.` };
      throw new Error(`${gone} The ${expected.type} was not sent.`);
    }
    for (;;) {
      // Listen before asking, so a change during the question is not missed.
      const change = new Promise<void>((resolve) => (changed = resolve));
      const at = await within(frameAtPoint(session, target.point.x, target.point.y), deadline - Date.now(), "Chromium did not say which frame is there").catch(
        (error: Error) => ({ watched: false as const, where: `unknown (${error.message})` }),
      );
      if (at.watched === true) return { calls };
      if (at.watched === "unknown") {
        // Chromium could not say: wait for every frame Playwright lists, as far as the bound allows.
        await within(answered(), deadline - Date.now(), "expired").catch(() => {});
        return { calls };
      }
      const expired = await within(change, deadline - Date.now(), "expired").then(
        () => false,
        () => true,
      );
      if (expired) {
        const failed = await Promise.all(
          [...calls].map(([frame, call]) =>
            within(call, 0, "").then(
              (answer) => (answer.error === undefined ? undefined : `${answer.url}: ${answer.error}`),
              () => `${frame.url() || "a frame with no URL yet"}: has not answered`,
            ),
          ),
        ).then((notes) => notes.filter((note) => note !== undefined));
        throw new Error(
          `${command}: could not watch the frame at (${Math.round(target.point.x)}, ${Math.round(target.point.y)}) within ${TOUCH_HANDLED_TIMEOUT_MS}ms, so the ${expected.type} was not sent. ` +
            `The frame there is ${at.where}, and it has no watcher` +
            (failed.length > 0 ? `. Frames whose watch did not start: ${failed.join("; ")}.` : "."),
        );
      }
    }
  } catch (error) {
    // Leave no watcher behind in a frame whose watch did start.
    for (const frame of calls.keys()) void callWatch(frame, "settle", expected, TOUCH_TIDY_MS);
    throw error;
  } finally {
    page.off("frameattached", watch).off("framenavigated", watch).off("framedetached", watch);
  }
}

/**
 * Sends touch input and resolves once the page has handled the `expected` event, the last
 * one sent, with the frame that handled it. CDP resolves a touch event when Chromium's renderer
 * has queued it for the page.
 * For an event the page can cancel, that is after the page has handled it. Once a swipe
 * scrolls, the page can't cancel the rest of it, and CDP resolves first
 * (`MainThreadEventQueue::HandleEvent` in Chromium's main_thread_event_queue.cc runs the reply
 * right after `QueueEvent`). The page then handles a touchend up to a frame later and a
 * touchmove up to 200ms later: at the start of each frame `DispatchRafAlignedInput` dispatches
 * what is queued, except a touchmove that is alone in the queue less than 200ms after the
 * last one (`kAsyncTouchMoveInterval`).
 *
 * So this watches for the event itself in the frames of the page, matched by the point it was
 * sent to, and throws if the page does not handle it. One event is never on its way: a
 * touchmove that stays within Chromium's slop distance of the touchstart, which Chromium
 * keeps from the page. The page can still cancel such a move, so CDP has already waited for
 * it; it is told apart as a touchmove sent before the page has handled any in this gesture.
 *
 * Each wait is bounded: up to 5 seconds for the frame's watch (`watchTarget`), then up to 5
 * for the page to handle the event, so a command throws within about 10 seconds at worst.
 */
async function sendTouch(
  command: string,
  page: Page,
  session: CDPSession,
  expected: TouchPoint,
  target: TouchTarget,
  send: () => Promise<unknown>,
): Promise<Frame | undefined> {
  const none: TouchSeen = { seen: false, active: false, moved: false, saw: [] };
  const { calls, gone } = await watchTarget(command, page, session, expected, target);
  const now = <T>(call: Promise<T>) => within(call, 0, "").catch(() => undefined);
  // Tidies every frame whose watch started; a frame whose call is still out is tidied when it answers, without waiting.
  const tidy = async () => {
    const answered = (await Promise.all([...calls.values()].map(now))).flatMap((answer) => (answer && answer.error === undefined ? [answer.frame] : []));
    for (const [frame, call] of calls) if (!answered.includes(frame)) void call.then(() => callWatch(frame, "settle", expected, TOUCH_TIDY_MS));
    await Promise.all(watchTouch(page, "settle", expected, TOUCH_TIDY_MS, answered));
  };
  let waits: Promise<FrameAnswer<TouchSeen> | undefined>[];
  let handler: Frame | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await send();
    if (gone) throw new Error(gone);
    // Each frame waits once its watch has started, and stops after the bound on its own; a frame that never answers is let go a little later.
    waits = [...calls].map(([frame, call]) =>
      call.then((answer) => (answer.error === undefined ? callWatch<TouchSeen>(frame, "wait", expected, TOUCH_HANDLED_TIMEOUT_MS + TOUCH_TIDY_MS) : undefined)),
    );
    // Page timers may be frozen by a test; keep the acknowledgement deadline on the provider.
    const deadline = new Promise<undefined>((resolve) => {
      watchdog = setTimeout(() => resolve(undefined), TOUCH_HANDLED_TIMEOUT_MS);
    });
    // The first frame to see it ends the wait in the others.
    const firstSeen = waits.map((wait) => wait.then((answer) => (answer?.value?.seen ? answer.frame : new Promise<never>(() => {}))));
    handler = await Promise.race([Promise.all(waits).then(() => undefined), deadline, ...firstSeen]);
  } catch (error) {
    await tidy();
    throw error;
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
  // Capture failure-time diagnostics, then settle frozen waits before collecting their observations.
  const states = handler ? Promise.resolve([]) : Promise.all(watchTouch<FrameState>(page, "inspect", expected, TOUCH_TIDY_MS));
  await tidy();
  if (handler) return handler;
  const answers = (await Promise.all(waits)).filter((answer): answer is FrameAnswer<TouchSeen> => answer !== undefined);
  const results = answers.map((answer) => answer.value ?? none);
  const targetFrame = "frame" in target ? target.frame : undefined;
  const targetObservation = answers.find((answer) => answer.frame === targetFrame && answer.error === undefined)?.value;
  // Slop needs an active gesture in this document and no contradictory event, not a missing-data fallback.
  if (
    expected.type === "touchMove" &&
    !results.some((result) => result.moved) &&
    targetObservation?.active === true &&
    targetObservation.moved === false &&
    targetObservation.saw.length === 0
  ) return undefined;
  const inspected = await states;
  const saw = results.flatMap((result) => result.saw);
  // What was watched: every frame, and every call into one that failed, with its reason.
  const started = await Promise.all([...calls.values()].map(now));
  const failed = [...started, ...answers, ...inspected].flatMap((answer) => (answer?.error !== undefined ? [answer] : []));
  const frames = inspected.map(({ url, value }) => (value ? `${url} (${value.watching ? "watching" : "no watcher"}, ${value.readyState})` : `${url} (not reachable)`));
  throw new Error(
    `${command}: the page did not handle the ${expected.type} at (${Math.round(expected.x)}, ${Math.round(expected.y)}) within ${TOUCH_HANDLED_TIMEOUT_MS}ms. ` +
      `It handled: ${saw.length > 0 ? saw.join(" ") : "no touch events"}. Is the page visible and rendering, and is the point inside it? ` +
      (expected.type === "touchMove" && targetObservation?.active === false ? "The target document did not report an active touchstart. " : "") +
      `Watched ${answers.length} ${answers.length === 1 ? "frame" : "frames"}; at the end: ${frames.join("; ")}. ` +
      `Failed calls: ${failed.length > 0 ? failed.map((answer) => `${answer.action} in ${answer.url}: ${answer.error}`).join("; ") : "none"}.`,
  );
}

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
 * It resolves once the page has handled the whole gesture, touchend included.
 * With `durationMs`, it queues the whole timed path before waiting for protocol replies:
 * delayed acknowledgments must not turn its first small moves into a long press.
 * Use `touchStep` when the finger should actually stay down between commands.
 *
 * Before the touch it waits until the frame at `from` has the kit's watcher, up to 5 seconds,
 * and throws naming that frame if it never does. Then it waits up to 5 seconds for the page to
 * handle the touchend, and throws naming the events the page did handle. So it can take up to
 * about 10 seconds to throw, and two failing touches can outlast Vitest's default 15 second
 * test timeout in browser mode, which then reports the timeout instead of the kit's message.
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
  await releaseFinger("touchDrag", page, session);
  await sendTouch("touchDrag", page, session, { type: "touchEnd", x: to[0], y: to[1] }, { point: { x: from[0], y: from[1] } }, async () => {
    const deliveries: Promise<unknown>[] = [];
    const send = async (type: "touchStart" | "touchMove" | "touchEnd", point: [number, number], t: number) => {
      const delivery = touch(type, point, t);
      if (durationMs === undefined) await delivery;
      else deliveries.push(delivery);
    };
    await send("touchStart", from, 0);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      await send("touchMove", [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], t);
    }
    await send("touchEnd", to, 1);
    await Promise.all(deliveries);
  });
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

/** Where the finger `touchStep` left down is, for each page that has one, and the frame that handled its touchstart. */
const fingersDown = new WeakMap<object, { x: number; y: number; frame: Frame | undefined }>();

/** Lifts a finger `touchStep` left down, so the next gesture starts clean. */
async function releaseFinger(command: string, page: Page, session: CDPSession) {
  const finger = fingersDown.get(page);
  if (!finger) return;
  fingersDown.delete(page);
  const send = () => session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const end = { type: "touchEnd" as const, x: finger.x, y: finger.y };
  if (finger.frame) {
    await sendTouch(command, page, session, end, { frame: finger.frame }, send);
    return;
  }
  // A page that never handled the touchstart gets no touchend to wait for.
  await send();
  await Promise.all(watchTouch(page, "settle", end, TOUCH_TIDY_MS));
}

/**
 * One step of a one-finger gesture with real touch input (Chromium only, through CDP), for
 * gestures `touchDrag` can't make: a finger that stops and stays down mid-swipe. The same
 * finger stays down between calls until `touchEnd`. Lift it in a `finally`, so a failed
 * assertion mid-gesture doesn't leave it down; a finger left down anyway is lifted before
 * the next `touchStart` or `touchDrag`.
 *
 * Each step resolves once the page has handled its event. A `touchStart` first waits until
 * the frame at its point has the kit's watcher, up to 5 seconds, and throws naming that frame
 * if it never does; any step then waits up to 5 seconds for the page to handle the event. So a
 * step can take up to about 10 seconds to throw (see `touchDrag`). Once the gesture scrolls the page, Chromium
 * hands the page at most one touchmove every 200ms, so a `touchMove` step can take that long.
 */
export const touchStep: BrowserCommand<[TouchStepOptions]> = async (ctx, step) => {
  const session = await chromiumSession(ctx);
  if (!session) throw new Error("touchStep: CDP input is Chromium only");
  const { page } = ctx;
  if (step.type === "touchEnd") return releaseFinger("touchStep", page, session);
  if (step.type === "touchStart") await releaseFinger("touchStep", page, session);
  const { type, x, y } = step;
  const last = fingersDown.get(page);
  const finger: { x: number; y: number; frame: Frame | undefined } = { x, y, frame: type === "touchMove" ? last?.frame : undefined };
  // The finger is down once the event is sent, and not before: a touch the kit refuses to send leaves none to lift.
  const send = async () => {
    fingersDown.set(page, finger);
    await session.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x, y, id: 1 }] });
  };
  // Chromium sends the page nothing for a move to where the finger already is.
  if (type === "touchMove" && last?.x === x && last.y === y) await send();
  else {
    // A move goes to the frame that handled the touchstart; a touchstart, or a move with no finger down, to the frame at the point.
    const handler = await sendTouch("touchStep", page, session, { type, x, y }, finger.frame ? { frame: finger.frame } : { point: { x, y } }, send);
    if (type === "touchStart") finger.frame = handler;
  }
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
