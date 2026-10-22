import { onTestFinished } from "vitest";

export { holdFrames };
export type { HeldFrames };

/** Animation frames held by `holdFrames`. */
interface HeldFrames {
  /** Lets `ms` pass and runs the frames asked for so far, once. Frames they ask for wait for the next step. */
  step(ms?: number): void;
  /**
   * Steps `ms` at a time until `done` returns true; throws after 2000 steps.
   *
   * @claim "Steps `ms` at a time until" registry/ouro/lib/ouro/testing/frames.test.ts verify:testExists(registry/ouro/lib/ouro/testing/frames.test.ts::steps until a condition holds, and gives up when it never does)
   * @claim "Steps `ms` at a time until" registry/ouro/lib/ouro/testing/frames.ts verify:fileLine(registry/ouro/lib/ouro/testing/frames.ts, /if\s\(count\s===\s2000\)/)
   */
  until(done: () => boolean, ms?: number): void;
  /**
   * Gives frames and the clock back to the browser, and asks it for the frames still
   * waiting; a later `cancelAnimationFrame` with a held frame's id still cancels it.
   * Calling it again does nothing.
   */
  release(): void;
}

// Held frames count down from -1, so they never share a handle with a frame the browser
// was asked for: cancelling one of those still reaches the browser. One count for every
// hold, so a frame one hold handed to the browser is not mistaken for a later hold's.
let last = 0;
/**
 * Frames handed to the browser on release and not yet run: the id each was given while held, and the browser's.
 *
 * @claim "Frames handed to the browser on" registry/ouro/lib/ouro/testing/frames.test.ts verify:testExists(registry/ouro/lib/ouro/testing/frames.test.ts::passes a cancel for a frame it never held on to the browser while released frames wait)
 * @claim "Frames handed to the browser on" registry/ouro/lib/ouro/testing/frames.test.ts verify:testExists(registry/ouro/lib/ouro/testing/frames.test.ts::still cancels, by the id it gave, a frame it handed to the browser on release)
 */
const moved = new Map<number, number>();
/** The browser's own `cancelAnimationFrame`, while `cancelMoved` stands in for it. */
let browserCancel: typeof window.cancelAnimationFrame | undefined;
const cancelMoved = (handle: number) => {
  const id = moved.get(handle) ?? handle;
  moved.delete(handle);
  browserCancel!.call(window, id);
  settle();
};
/**
 * Gives cancelling back to the browser once no moved frame is left. A hold in between keeps its own cancel; its release settles again.
 *
 * @claim "Gives cancelling back to the browser" registry/ouro/lib/ouro/testing/frames.test.ts verify:testExists(registry/ouro/lib/ouro/testing/frames.test.ts::gives frames and the clock back, and the waiting frames to the browser)
 */
function settle() {
  if (moved.size > 0 || !browserCancel || window.cancelAnimationFrame !== cancelMoved) return;
  window.cancelAnimationFrame = browserCancel;
  browserCancel = undefined;
}

/**
 * Holds `requestAnimationFrame` and `performance.now()` still, so a test decides when a
 * frame runs and what time it is. A spring or any other frame-driven motion then stands
 * exactly where the test left it, however slow the machine: assert on it mid-flight,
 * catch it with a pointer, then `until` it has come to rest.
 *
 * While frames are held, nothing that waits for a real frame resolves, `expect.poll`
 * included when it waits on motion: step instead. The frames are released when the test
 * finishes, pass or fail, so a forgotten `release()` cannot hang the tests after it.
 * Release sooner when the rest of the test, or an `afterEach`, waits on real frames.
 *
 * @example
 * const frames = holdFrames();
 * await release(finger);
 * frames.step(16);
 * expect(row.hasAttribute("data-ouro-settling")).toBe(true);
 * frames.until(() => !row.hasAttribute("data-ouro-settling"));
 * frames.release();
 */
function holdFrames(): HeldFrames {
  const real = { request: window.requestAnimationFrame, cancel: window.cancelAnimationFrame, now: performance.now };
  const waiting = new Map<number, FrameRequestCallback>();
  let time = performance.now();
  let held = true;
  window.requestAnimationFrame = (callback) => {
    waiting.set(--last, callback);
    return last;
  };
  window.cancelAnimationFrame = (handle) => {
    if (!waiting.delete(handle)) real.cancel.call(window, handle);
  };
  performance.now = () => time;
  const step = (ms = 16) => {
    if (!held) throw new Error("holdFrames: these frames were released");
    time += ms;
    const due = [...waiting];
    for (const [handle, callback] of due) {
      // A frame an earlier one cancelled does not run.
      if (waiting.delete(handle)) callback(time);
    }
  };
  const release = () => {
    if (!held) return;
    held = false;
    window.requestAnimationFrame = real.request;
    window.cancelAnimationFrame = real.cancel;
    performance.now = real.now;
    // The frames still waiting go to the browser, which knows them by its own ids. Code that
    // asked for one still holds the id it was given, so until the last of them has run,
    // cancelling by that id cancels the browser's frame.
    for (const [handle, callback] of waiting) {
      const run: FrameRequestCallback = (now) => {
        moved.delete(handle);
        settle();
        callback(now);
      };
      moved.set(handle, real.request.call(window, run));
    }
    waiting.clear();
    if (moved.size > 0 && window.cancelAnimationFrame !== cancelMoved) {
      browserCancel = window.cancelAnimationFrame;
      window.cancelAnimationFrame = cancelMoved;
    }
    settle();
  };
  // A test that fails, or forgets, before its `release()` still gives the frames back.
  // Held outside a test (in a `beforeAll`), there is no test to wait for.
  try {
    onTestFinished(release);
  } catch {
    // Not in a test: the caller releases.
  }
  return {
    step,
    until(done, ms = 16) {
      for (let count = 0; !done(); count++) {
        if (count === 2000) throw new Error(`holdFrames: still not done after ${count} steps of ${ms}ms`);
        step(ms);
      }
    },
    release,
  };
}
