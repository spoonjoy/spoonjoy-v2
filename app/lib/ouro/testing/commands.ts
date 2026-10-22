import type {} from "@vitest/browser-playwright";
import type { CDPSession, Frame, Page } from "playwright";
import type { BrowserCommand } from "vitest/node";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

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

/**
 * Wraps Playwright's `page.emulateMedia` for motion, color, contrast and forced-color preferences.
 * A forced-colours switch restyles the page at once, and a colour with a transition (the `press`
 * utility's) then eases to its new value, so this returns once those transitions have finished:
 * a test reads where each colour lands, not a colour between the two.
 *
 * @claim "this returns once those transitions have finished" registry/ouro/lib/ouro/testing/commands.test.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.test.ts, /emulateMedia returns once forced colours have settled, past any transition the switch started/)
 */
export const emulateMedia: BrowserCommand<[EmulateMediaOptions]> = async (ctx, options) => {
  await ctx.page.emulateMedia(options);
  if (!("forcedColors" in options)) return;
  const frame = await ctx.frame();
  await within(frame.evaluate(SETTLE_TRANSITIONS), 3000, "transitions did not settle within 3s").catch(() => undefined);
};

/** Waits for the running transitions in a frame (`getAnimations` restyles first, starting them). */
const SETTLE_TRANSITIONS = `Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition && animation.playState === "running").map((animation) => animation.finished.catch(() => undefined))).then(() => undefined)`;

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
 * machine is. `drag` instead spends a round trip and a wait per step, so a quick
 * flick takes longer in the page than asked, and longer still on a loaded CI runner,
 * which a velocity check then reads as a slow drag. Use `drag` for slow drags.
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
 * @claim "Runs in every frame of the" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::on a page zoomed and panned by touch, the kit waits for the frame where the touch lands)
 * @claim "The listeners capture on `window` and" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::on a page zoomed and panned by touch, the kit waits for the frame where the touch lands)
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
/**
 * The frame at a touch's point: watched (armed for this touch) or not, "frame" when the point is on
 * a frame in another process, which the hit test stops at (`url` is the address it was given, and
 * `frameId` Chromium's id for the frame), or "unknown" when the kit can't place the point in a frame.
 */
interface FrameAt {
  watched: boolean | "unknown" | "frame";
  where: string;
  url?: string;
  frameId?: string | undefined;
  /** Chromium's id for the frame's element, when the point is on a frame in another process. */
  node?: number;
}
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
/**
 * Runs `run` once `ms` have passed on `performance.now()`, and returns a function that cancels it.
 * A Node timer counts whole milliseconds of the event loop's cached time, so it can fire before its
 * delay on a precise clock; this one sets another timer for whatever is left.
 */
function after(ms: number, run: () => void): () => void {
  const end = performance.now() + ms;
  let timer: ReturnType<typeof setTimeout>;
  const check = () => {
    const left = end - performance.now();
    if (left > 0) timer = setTimeout(check, Math.ceil(left));
    else run();
  };
  timer = setTimeout(check, Math.max(0, Math.ceil(ms)));
  return () => clearTimeout(timer);
}

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let cancel = () => {};
  const expired = new Promise<never>((_, reject) => (cancel = after(ms, () => reject(new Error(message)))));
  return Promise.race([promise, expired]).finally(() => cancel());
}

/**
 * Calls `TOUCH_WATCH` in one frame. A failed call is kept, with its reason, and so is a call
 * still unanswered after `ms`: Playwright waits for a frame's document before it evaluates
 * there, and a frame whose document never arrives never answers.
 * @claim "A failed call is kept, with" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touch into an iframe that never loads does not hang)
 */
function callWatch<T>(frame: Frame, action: TouchWatchAction, point: TouchPoint, ms: number): Promise<FrameAnswer<T>> {
  const call = `(${TOUCH_WATCH})(${JSON.stringify(action)}, ${JSON.stringify({ ...point, type: point.type.toLowerCase() })})`;
  const url = () => frame.url() || "a frame with no URL yet";
  return within(frame.evaluate<T>(call), ms, `did not answer within ${Math.round(ms)}ms`).then(
    (value) => ({ frame, url: url(), action, value }),
    (error: unknown) => ({ frame, url: url(), action, error: (error instanceof Error ? error.message : String(error)).split("\n")[0]! }),
  );
}

/**
 * Calls `TOUCH_WATCH` in each of `frames`, by default every frame of the page Playwright lists.
 *
 * @claim "Calls `TOUCH_WATCH` in each of `frames`" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::on a page zoomed and panned by touch, the kit waits for the frame where the touch lands)
 */
function watchTouch<T>(page: Page, action: TouchWatchAction, point: TouchPoint, ms: number, frames: Frame[] = page.frames()): Promise<FrameAnswer<T>>[] {
  return frames.map((frame) => callWatch<T>(frame, action, point, ms));
}

/**
 * How long a "settle" or "inspect" call may take, so tidying up never holds up a command.
 *
 * @claim "call may take, so tidying up never holds" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touch into an iframe that never loads does not hang)
 * @claim "call may take, so tidying up never holds" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_TIDY_MS\s=\s1000;/)
 */
const TOUCH_TIDY_MS = 1000;

/**
 * Whether the frame that receives a touch at (x, y) is watched for `expected`, asked of Chromium
 * directly: a watcher left from an earlier event, whose tidying has not run yet, does not count.
 * `DOM.getNodeForLocation` hit-tests the way input does, through every frame and every shadow
 * root, open or closed, and past `pointer-events: none`, so it finds the frame a touch there
 * goes to, even one Playwright does not list yet. It takes a point in the top-level document,
 * and a touch a point in the visual viewport, so where that viewport is in the page is added: the
 * top-level page's scroll, and the pan of a pinch-zoomed page. "unknown" means
 * the kit could not place the point in a frame: Chromium found nothing there, as for a point
 * outside the viewport, or the node there lacks a window.
 * @claim "`DOM.getNodeForLocation` hit-tests the way input does" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::the kit waits for the frame under a pointer-events: none overlay, where the touch lands)
 * @claim "`DOM.getNodeForLocation` hit-tests the way input does" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::the kit does not wait for a pointer-events: none iframe, which the touch passes through)
 * @claim "`DOM.getNodeForLocation` hit-tests the way input does" https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getNodeForLocation verify:urlOk(https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getNodeForLocation)
 */
async function frameAtPoint(session: CDPSession, { x, y }: { x: number; y: number }, expected: TouchPoint, trace?: TouchTrace): Promise<FrameAt> {
  // How long each of Chromium's answers took, for a slow touch's log.
  let last = Date.now();
  const took: string[] = [];
  const lap = (step: string) => {
    took.push(`${step} ${Date.now() - last}ms`);
    last = Date.now();
  };
  try {
    const { cssVisualViewport } = await session.send("Page.getLayoutMetrics");
    lap("layout");
    const { backendNodeId } = await session.send("DOM.getNodeForLocation", {
      x: Math.round(x + cssVisualViewport.pageX),
      y: Math.round(y + cssVisualViewport.pageY),
      // Hit-test as input does: an element with `pointer-events: none` is not the target.
      ignorePointerEventsNone: false,
    });
    lap("hit test");
    const { object } = await session.send("DOM.resolveNode", { backendNodeId });
    lap("node");
    try {
      const { result } = await session.send("Runtime.callFunctionOn", {
        objectId: object.objectId!,
        returnByValue: true,
        arguments: [{ value: { type: expected.type.toLowerCase(), x: expected.x, y: expected.y } }],
        // Runs in the node's frame, in the same world as TOUCH_WATCH.
        functionDeclaration: `function (want) {
          // The hit can be a ::before or ::after box, whose element is \`element\`.
          const node = this.nodeType ? this : this.element;
          // A frame in another process: the hit test stops at its element, whose document this side can't reach.
          if (node && (node.localName === "iframe" || node.localName === "frame")) {
            let inside = null;
            try {
              inside = node.contentDocument;
            } catch {}
            if (!inside) {
              const url = node.hasAttribute("srcdoc") ? "about:srcdoc" : node.src || "about:blank";
              return { watched: "frame", where: "a frame in another process, at " + url, url };
            }
          }
          const document = node ? node.ownerDocument || node : null;
          const view = document && document.defaultView;
          const state = view && view.__ouroTouch;
          let where = view ? view.location.href : "a node with no window (" + String(this) + ")";
          try {
            const source = view.frameElement && view.frameElement.getAttribute("src");
            if (source) where += ", in an iframe whose src is " + source;
          } catch {}
          // A hit the kit can't place in a frame is "unknown": the kit then waits for every frame Playwright lists.
          const armed = Boolean(state && state.document === document && state.expected && state.expected.type === want.type && state.expected.x === want.x && state.expected.y === want.y);
          return { watched: view ? armed : "unknown", where };
        }`,
      });
      lap("watcher");
      const at = result.value as FrameAt;
      if (at.watched === "frame") {
        at.frameId = (await session.send("DOM.describeNode", { backendNodeId })).node.frameId;
        at.node = backendNodeId;
      }
      lap("frame id");
      return at;
    } finally {
      await session.send("Runtime.releaseObject", { objectId: object.objectId! }).catch(() => {});
      lap("released");
    }
  } catch (error) {
    lap("failed");
    return { watched: "unknown", where: (error instanceof Error ? error.message : String(error)).split("\n")[0]! };
  } finally {
    if (trace) traceStep(trace, `asked Chromium: ${took.join(", ")}`);
  }
}

/** Waits for a frame to draw, as page code: the kit itself is type-checked without the DOM's types. */
const TWO_FRAMES = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))";

/** Cached: a frame's own session, when it runs in another process, with Chromium's id for the frame. */
const frameSessions = new WeakMap<Frame, Promise<{ session: CDPSession; id: string } | undefined>>();

/**
 * A session of `frame`'s own, with Chromium's id for it, when it runs in another process.
 * Playwright can list such a frame under an address other than its element's, or under none, as
 * for a sandboxed `srcdoc` frame, so the kit finds the frame at a touch's point by this id. A frame
 * in its parent's process has no session of its own and resolves undefined: the hit test reaches
 * its document directly. That answer is not kept, since such a frame can move to a process of its own.
 * @claim "Playwright can list such a frame" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a frame in another process is found by Chromium's id for it, whatever address Playwright lists it with) verify:testExists(scripts/touch-kit-frames.test.mjs::a touchstart on a frame in another process that Playwright lists late waits for that frame's watcher, then reaches it)
 * @claim "A frame in its parent's process" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a touchstart on a frame in another process that Playwright lists late waits for that frame's watcher, then reaches it)
 * @claim "That answer is not kept" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a frame with no session of its own when first asked is found once Playwright has one for it)
 */
function frameSession(page: Page, frame: Frame): Promise<{ session: CDPSession; id: string } | undefined> {
  let found = frameSessions.get(frame);
  if (!found) {
    found = page
      .context()
      .newCDPSession(frame)
      .then(async (session) => ({ session, id: (await session.send("Page.getFrameTree")).frameTree.frame.id }))
      .catch(() => {
        // A frame still in its parent's process can move to its own later: ask again next time.
        frameSessions.delete(frame);
        return undefined;
      });
    frameSessions.set(frame, found);
  }
  return found;
}

/** Whether `frame` is `ancestor` or a frame inside it. */
function isWithin(frame: Frame, ancestor: Frame): boolean {
  for (let at: Frame | null = frame; at; at = at.parentFrame()) if (at === ancestor) return true;
  return false;
}

/** How often the kit asks again whether a touch at a point reaches inside a frame in another process. */
const TOUCH_POLL_MS = 50;

/**
 * Whether Chromium's hit test at `point` reaches a node inside the frame in another process whose
 * element `at` found, asked through that frame's own session: the point in the frame's coordinates,
 * from where its element's content box is on the page.
 */
async function hitsInside(session: CDPSession, inside: CDPSession, at: FrameAt, point: { x: number; y: number }): Promise<boolean> {
  try {
    const { quads } = await session.send("DOM.getContentQuads", { backendNodeId: at.node! });
    const quad = quads[0];
    if (!quad) return false;
    const { cssVisualViewport } = await inside.send("Page.getLayoutMetrics");
    const { backendNodeId } = await inside.send("DOM.getNodeForLocation", {
      x: Math.round(point.x - Math.min(quad[0]!, quad[6]!) + cssVisualViewport.pageX),
      y: Math.round(point.y - Math.min(quad[1]!, quad[3]!) + cssVisualViewport.pageY),
      ignorePointerEventsNone: false,
    });
    return backendNodeId > 0;
  } catch {
    return false;
  }
}

/** A touch command that succeeds but takes longer than this logs what it waited for (`TouchTrace`). */
const TOUCH_SLOW_MS = 1000;

/**
 * What one touch command waited for, logged when it succeeds but is slow: its steps with their
 * times, when each frame's watch answered, and how late Node's event loop ran meanwhile. A refused
 * touch logs nothing; its error says why.
 * @claim "What one touch command waited for" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a touch command that takes longer than a second logs its steps, when each frame's watch answered and how late Node ran) verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_SLOW_MS\s=\s1000;/)
 * @claim "A refused touch logs nothing" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a refused touch logs no trace: its error says why)
 */
interface TouchTrace {
  start: number;
  steps: string[];
  answered: Map<Frame, number>;
  /** Vitest's Node process, which runs the kit and Playwright: how late its event loop ran callbacks. */
  loop: ReturnType<typeof monitorEventLoopDelay>;
}

const traceStep = (trace: TouchTrace, step: string) => trace.steps.push(`+${Date.now() - trace.start}ms ${step}`);

/** Logs `trace` when the command took longer than TOUCH_SLOW_MS. Only a command that succeeded logs: a refusal's error says why. */
function logIfSlow(command: string, expected: TouchPoint, trace: TouchTrace, frames: Iterable<Frame>) {
  const took = Date.now() - trace.start;
  trace.loop.disable();
  if (took <= TOUCH_SLOW_MS) return;
  const watches = [...frames].map((frame) => {
    const at = trace.answered.get(frame);
    return `${frame.url() || "a frame with no URL yet"} ${at === undefined ? "had not answered" : `answered at +${at}ms`}`;
  });
  console.warn(
    `${command}: the ${expected.type} at (${Math.round(expected.x)}, ${Math.round(expected.y)}) took ${took}ms. ` +
      `Steps: ${trace.steps.join("; ")}. Watches: ${watches.join("; ")}. ` +
      `Node's event loop ran up to ${Math.round(trace.loop.max / 1e6)}ms late.`,
  );
}

/** The frame a touch goes to: the one at the touchstart's point, or the one that handled the gesture's touchstart. */
type TouchTarget = { point: { x: number; y: number } } | { frame: Frame };

/**
 * Starts the watch for `expected` in every frame of the page, and resolves once the frame that
 * receives the touch is watched. It never waits for the other frames, so a frame elsewhere that
 * is slow, never loads, or is in another process holds nothing up. On a frame in another process,
 * where Chromium's hit test stops at the frame's element, it waits until Playwright lists that
 * frame, found by Chromium's id for it, then for that frame's own watcher, armed for this touch,
 * until Chromium's hit test at the point reaches inside the frame, asked through the frame's own
 * session, and until the frame has drawn, then the page around it, then the frame again: a touch
 * Chromium sends to such a frame while it is busy is lost, and one sent before the frame takes
 * input goes to the page around it, as does one sent after the page around it embeds the frame
 * afresh and before the frame draws again. A touchstart
 * that a frame outside it still handles throws, naming both: it never passes as handled.
 *
 * Playwright learns of a new frame, and of a frame's new document, from Chromium on its own
 * connection, which can lag the page: a test that adds an iframe, awaits its `load` and
 * touches it can get here before Playwright lists the frame (CI probe run 38385210551). So
 * for a touchstart this asks Chromium which frame is at the point, and checks again each time
 * Playwright lists a frame or a document, or a frame's watch starts, until that frame is
 * watched. It throws after 5 seconds, naming the frame. Later events of a gesture go to the
 * frame its touchstart went to, so for them it waits for that frame's watch only.
 * @claim "So for a touchstart this asks" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touchstart into a frame the kit cannot watch is refused after the time limit, and the next touch works)
 * @claim "Playwright learns of a new frame" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touch into an iframe added just before it is handled)
 * @claim "Starts the watch for `expected` in" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 * @claim "Playwright learns of a new frame" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 * @claim "It never waits for the other" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a cross-origin frame that never answers its watch holds up no touch elsewhere)
 * @claim "It never waits for the other" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touch into an iframe that never loads does not hang)
 * @claim "It never waits for the other" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a cross-origin frame that never answers its tidying up holds up no touch elsewhere)
 * @claim "until Chromium's hit test at the" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a touchstart into a frame in another process that is armed and drawn waits until Chromium's hit test there reaches inside it)
 * @claim "A touchstart that a frame outside" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a touchstart that Chromium sends to the page around a frame in another process throws, and never passes as handled)
 * @claim "On a frame in another process" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touchstart into a busy cross-origin frame is sent only once that frame's watcher is armed for it)
 * @claim "it waits until Playwright lists that" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a touchstart on a frame in another process that Playwright lists late waits for that frame's watcher, then reaches it) verify:testExists(scripts/touch-kit-frames.test.mjs::a frame in another process is found by Chromium's id for it, whatever address Playwright lists it with)
 * @claim "as does one sent after the page" scripts/touch-kit-frames.test.mjs verify:testExists(scripts/touch-kit-frames.test.mjs::a touchstart into a frame in another process waits until that frame has drawn after the page around it has)
 * @claim "and one sent before the frame" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touch into a cross-origin iframe added just before it is handled)
 * @claim "It throws after 5 seconds, naming" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touchstart into a frame the kit cannot watch is refused after the time limit, and the next touch works)
 * @claim "It throws after 5 seconds, naming" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 */
async function watchTarget(
  command: string,
  page: Page,
  session: CDPSession,
  expected: TouchPoint,
  target: TouchTarget,
  trace: TouchTrace,
): Promise<{ calls: Map<Frame, Promise<FrameAnswer<null>>>; gone?: string; inside?: Frame }> {
  const deadline = performance.now() + TOUCH_HANDLED_TIMEOUT_MS;
  const calls = new Map<Frame, Promise<FrameAnswer<null>>>();
  let changed = () => {};
  const watch = (frame: Frame) => {
    const call = callWatch<null>(frame, "expect", expected, TOUCH_HANDLED_TIMEOUT_MS);
    calls.set(frame, call);
    trace.answered.delete(frame);
    void call.then(() => {
      trace.answered.set(frame, Date.now() - trace.start);
      changed();
    });
  };
  page.on("frameattached", watch).on("framenavigated", watch).on("framedetached", watch);
  const answered = () => Promise.all([...calls.values()]);
  try {
    for (const frame of page.frames()) watch(frame);
    if ("frame" in target) {
      const answer = await (calls.get(target.frame) ?? callWatch<null>(target.frame, "expect", expected, TOUCH_HANDLED_TIMEOUT_MS));
      traceStep(trace, `the gesture's frame answered: ${answer.url}`);
      if (answer.error === undefined) return { calls };
      // A lift is sent all the same, so the finger is not left down.
      const gone = `${command}: could not watch ${answer.url}, the frame the gesture's touchstart went to: ${answer.error}.`;
      if (expected.type === "touchEnd") return { calls, gone: `${gone} The touchEnd was sent, but nothing could see it.` };
      throw new Error(`${gone} The ${expected.type} was not sent.`);
    }
    // Whether the frame at the point is armed but the hit test there does not reach inside it yet, which no change announces.
    let inside: boolean | undefined;
    for (;;) {
      // Listen before asking, so a change during the question is not missed.
      const change = new Promise<void>((resolve) => (changed = resolve));
      inside = undefined;
      const at = await within(frameAtPoint(session, target.point, expected, trace), deadline - performance.now(), "Chromium did not say which frame is there").catch(
        (error: Error): FrameAt => ({ watched: false, where: `unknown (${error.message})` }),
      );
      traceStep(trace, `the frame at the point: ${String(at.watched)}, ${at.where}`);
      if (at.watched === true) return { calls };
      if (at.watched === "frame") {
        // The frame is in another process, so only its own watcher can say it is armed: its answer to
        // this touch's watch. Until Playwright lists that frame, wait for a change: other frames, such
        // as the test's own, are already armed, and a touch Chromium sends to a frame before its
        // watcher is armed is lost, not queued.
        const children = [...calls.keys()].filter((frame) => frame.parentFrame() !== null);
        const found = await Promise.all(children.map((frame) => within(frameSession(page, frame), deadline - performance.now(), "").catch(() => undefined)));
        const index = at.frameId === undefined ? -1 : found.findIndex((frame) => frame?.id === at.frameId);
        const there = children[index];
        if (there && (await within(calls.get(there)!, 0, "").then((answer) => answer.error === undefined, () => false))) {
          // Armed is not enough: Chromium sends a touch at a point inside such a frame only once its hit
          // test there reaches the frame's own document, and after the frame has drawn; until then the
          // page around it gets the touch. Ask again shortly until it does, as far as the bound allows.
          inside = await hitsInside(session, found[index]!.session, at, target.point);
          traceStep(trace, `the hit test ${inside ? "reaches" : "does not reach"} inside the frame`);
          if (inside) {
            // When the page around the frame embeds it afresh, as when the frame's visual properties
            // change, Chromium sends the frame touches only once it has drawn again. So the frame
            // draws, then the page around it, then the frame once more.
            const draw = (frame: Frame | null) => (frame ? within(frame.evaluate(TWO_FRAMES), deadline - performance.now(), "").catch(() => {}) : undefined);
            await draw(there);
            await draw(there.parentFrame());
            await draw(there);
            traceStep(trace, "the frame drew after the page around it");
            return { calls, inside: there };
          }
        }
      }
      if (at.watched === "unknown") {
        // Chromium could not say: wait for every frame Playwright lists, as far as the bound allows.
        await within(answered(), deadline - performance.now(), "expired").catch(() => {});
        traceStep(trace, "waited for every frame's watch");
        return { calls };
      }
      const soon = inside === false ? new Promise<void>((resolve) => setTimeout(resolve, TOUCH_POLL_MS)) : change;
      const expired = await within(Promise.race([change, soon]), deadline - performance.now(), "expired").then(
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
            (inside === false
              ? `The frame there is ${at.where}: its watcher is armed, but Chromium's hit test at that point does not reach inside it yet`
              : `The frame there is ${at.where}, and it has no watcher`) +
            (at.watched === "frame" ? `. Playwright lists ${[...calls.keys()].map((frame) => frame.url() || "a frame with no URL yet").join(", ")}` : "") +
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
 * @claim "The page then handles a touchend" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::touchStep resolves once the page has handled its event, also a move during a scroll)
 * @claim "One event is never on its" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::touchStep resolves once the page has handled its event, also a move during a scroll)
 * @claim "Each wait is bounded: up to" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::touchStep resolves once the page has handled its event, also a move during a scroll)
 * @claim "One event is never on its" https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc verify:urlOk(https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc)
 * @claim "The page then handles a touchend" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 * @claim "Each wait is bounded: up to" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a missing touch event remains bounded while the page clock is frozen)
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
  const trace: TouchTrace = { start: Date.now(), steps: [], answered: new Map(), loop: monitorEventLoopDelay({ resolution: 10 }) };
  trace.loop.enable();
  try {
    const handler = await sendTraced(command, page, session, expected, target, send, none, trace);
    logIfSlow(command, expected, trace, page.frames());
    return handler;
  } finally {
    trace.loop.disable();
  }
}

async function sendTraced(
  command: string,
  page: Page,
  session: CDPSession,
  expected: TouchPoint,
  target: TouchTarget,
  send: () => Promise<unknown>,
  none: TouchSeen,
  trace: TouchTrace,
): Promise<Frame | undefined> {
  const { calls, gone, inside } = await watchTarget(command, page, session, expected, target, trace);
  traceStep(trace, "watched");
  const now = <T>(call: Promise<T>) => within(call, 0, "").catch(() => undefined);
  // Tidies every frame whose watch started; a frame whose call is still out is tidied when it answers, without waiting.
  // Once a frame has handled the event, only its tidying is waited for: a busy frame elsewhere, as a
  // cross-origin page still running its scripts, would hold the command up to TOUCH_TIDY_MS. Calls
  // into one frame run in order, so that frame is still tidied before the next command watches it,
  // and the next touchstart waits for a watcher armed for itself (frameAtPoint).
  const tidy = async (handled?: Frame) => {
    const answered = (await Promise.all([...calls.values()].map(now))).flatMap((answer) => (answer && answer.error === undefined ? [answer.frame] : []));
    for (const [frame, call] of calls) if (!answered.includes(frame)) void call.then(() => callWatch(frame, "settle", expected, TOUCH_TIDY_MS));
    const settled = watchTouch(page, "settle", expected, TOUCH_TIDY_MS, answered);
    const waited = handled ? answered.filter((frame) => frame === handled) : answered;
    await Promise.all(handled ? settled.filter((_, index) => answered[index] === handled) : settled);
    traceStep(trace, `tidied, waiting for ${waited.map((frame) => frame.url() || "a frame with no URL yet").join(", ") || "no frame"}`);
  };
  let waits: Promise<FrameAnswer<TouchSeen> | undefined>[];
  let handler: Frame | undefined;
  let watchdog = () => {};
  try {
    await send();
    traceStep(trace, "sent");
    if (gone) throw new Error(gone);
    // Each frame waits once its watch has started, and stops after the bound on its own; a frame that never answers is let go a little later.
    waits = [...calls].map(([frame, call]) =>
      call.then((answer) => (answer.error === undefined ? callWatch<TouchSeen>(frame, "wait", expected, TOUCH_HANDLED_TIMEOUT_MS + TOUCH_TIDY_MS) : undefined)),
    );
    // Page timers may be frozen by a test; keep the acknowledgement deadline on the provider.
    const deadline = new Promise<undefined>((resolve) => {
      watchdog = after(TOUCH_HANDLED_TIMEOUT_MS, () => resolve(undefined));
    });
    // The first frame to see it ends the wait in the others.
    const firstSeen = waits.map((wait) => wait.then((answer) => (answer?.value?.seen ? answer.frame : new Promise<never>(() => {}))));
    handler = await Promise.race([Promise.all(waits).then(() => undefined), deadline, ...firstSeen]);
    traceStep(trace, `handled by ${handler ? handler.url() || "a frame with no URL yet" : "no frame"}`);
  } catch (error) {
    await tidy();
    throw error;
  } finally {
    watchdog();
  }
  // Capture failure-time diagnostics, then settle frozen waits before collecting their observations.
  const states = handler ? Promise.resolve([]) : Promise.all(watchTouch<FrameState>(page, "inspect", expected, TOUCH_TIDY_MS));
  await tidy(handler);
  // A touch aimed inside a frame in another process that a frame outside it handled went astray:
  // Chromium sent it to the page around that frame. Never let it pass as handled.
  if (handler && inside && !isWithin(handler, inside)) {
    throw new Error(
      `${command}: Chromium sent the ${expected.type} at (${Math.round(expected.x)}, ${Math.round(expected.y)}) to ${handler.url() || "a frame with no URL yet"}, ` +
        `not to the frame in another process there (${inside.url() || "a frame with no URL yet"}), though that frame's watcher was armed, its hit test there reached inside it and it had drawn after the page around it. ` +
        `The frame never saw the touch; the finger is lifted before the next gesture.`,
    );
  }
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
 * @claim "Before the touch it waits until" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::on a page zoomed and panned by touch, the kit waits for the frame where the touch lands)
 * @claim "So it can take up to" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 * @claim "Before the touch it waits until" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a touchstart into a frame the kit cannot watch is refused after the time limit, and the next touch works)
 * @claim "So it can take up to" https://vitest.dev/config/testtimeout verify:urlOk(https://vitest.dev/config/testtimeout)
 * @claim "Then it waits up to 5" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a missing touch event remains bounded while the page clock is frozen)
 * @claim "Then it waits up to 5" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
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

/**
 * The top-level page's zoom (`visualViewport.scale`): 1 unless something zoomed the page.
 *
 * @claim "The top-level page's zoom (`visualViewport.scale`): 1" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::rotate names the test that had the page zoomed)
 */
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
 * @claim "In a phone context (`isMobile`), Chromium" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::rotate names the test that had the page zoomed)
 * @claim "Sets the top-level page's zoom back" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.touch.test.ts, /await\scommands\.resetPageZoom\(\);/)
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
 * @claim "The `ouro-touch` project calls this before" registry/ouro/lib/ouro/testing/touch-setup.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/touch-setup.touch.test.ts::restoreTouch turns touch emulation back on after a screenshot taller than the phone)
 * @claim "The `ouro-touch` project calls this before" registry/ouro/lib/ouro/testing/touch-setup.ts verify:fileLine(registry/ouro/lib/ouro/testing/touch-setup.ts, /beforeEach\(\(\)\s=>\scommands\.restoreTouch\(\)\)/)
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

/**
 * Where the finger `touchStep` left down is, for each page that has one, and the frame that handled its touchstart.
 *
 * @claim "Where the finger `touchStep` left down" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::touchStep resolves once the page has handled its event, also a move during a scroll)
 * @claim "Where the finger `touchStep` left down" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::lifts a finger a test left down before the next gesture starts)
 */
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
 * @claim "Each step resolves once the page" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::touchStep resolves once the page has handled its event, also a move during a scroll)
 * @claim "Each step resolves once the page" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 * @claim "Each step resolves once the page" https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc verify:urlOk(https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc)
 * @claim "A `touchStart` first waits until the" https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc verify:urlOk(https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc)
 * @claim "Once the gesture scrolls the page" https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc verify:urlOk(https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc)
 * @claim "So a step can take up" registry/ouro/lib/ouro/testing/commands.ts verify:fileLine(registry/ouro/lib/ouro/testing/commands.ts, /const\sTOUCH_HANDLED_TIMEOUT_MS\s=\s5000;/)
 * @claim "So a step can take up" registry/ouro/lib/ouro/testing/commands.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/commands.touch.test.ts::a lift into a frame that has gone is sent all the same, and throws naming the frame)
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
