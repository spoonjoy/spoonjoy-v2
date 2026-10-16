import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Toaster } from "~/components/ouro/toast/toaster";
import { toast } from "~/lib/ouro/toast";
import { rubberband } from "~/lib/ouro/spring";
import { act } from "~/lib/ouro/testing/act";
import { holdFrames } from "~/lib/ouro/testing/frames";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await commands.touchStep({ type: "touchEnd" });
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await act(async () => toast.dismiss());
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await rotate(390, 844);
});

async function renderToaster() {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<Toaster />));
}

const toastNamed = (message: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-ouro="toast"]')].find(
    (item) => item.querySelector("[data-ouro-toast-title]")?.textContent === message,
  );

async function show(message: string, options?: Parameters<typeof toast>[1]) {
  await act(async () => {
    toast(message, options);
  });
  await expect.poll(() => toastNamed(message)).toBeDefined();
  const item = toastNamed(message)!;
  await expect.poll(() => item.getAnimations().length).toBe(0);
  return item;
}

/** How far the swipe has moved the toast, in px: its `translate`. */
function shift(item: HTMLElement): { x: number; y: number } {
  const [x = "0", y = "0"] = getComputedStyle(item).translate.replace("none", "0").split(" ");
  return { x: parseFloat(x), y: parseFloat(y) };
}

/** Waits until the toast is back at rest: no spring running, and no offset left. */
async function atRest(item: HTMLElement) {
  await expect.poll(() => !item.hasAttribute("data-ouro-settling") && item.style.translate === "").toBe(true);
}

/** A point on the toast's message, clear of its buttons. */
function grip(item: HTMLElement): [number, number] {
  const rect = item.getBoundingClientRect();
  return [rect.left + 60, rect.top + rect.height / 2];
}

/** Keeps the finger still until it has no velocity left. By the wall clock, which goes on while a test holds frames. */
async function restFinger() {
  const since = Date.now();
  await expect.poll(() => Date.now() - since).toBeGreaterThan(150);
}

/** Puts a finger down and moves it through `path`, offsets from where it came down. It stays down. */
async function dragTo(from: [number, number], path: Array<[number, number]>, start = true) {
  const [x, y] = from;
  if (start) await commands.touchStep({ type: "touchStart", x, y });
  for (const [dx, dy] of path) await commands.touchStep({ type: "touchMove", x: x + dx, y: y + dy });
}

/** Whether a tap at (x, y) lands on `target`. */
const hits = (target: Element, x: number, y: number) => target.contains(document.elementFromPoint(x, y));

it("spans the phone's width at the bottom, inside a 16px margin", async () => {
  await renderToaster();
  const rect = (await show("Saved", { duration: 0 })).getBoundingClientRect();
  expect(rect.left).toBe(16);
  expect(rect.right).toBe(innerWidth - 16);
  expect(innerHeight - rect.bottom).toBeGreaterThanOrEqual(16);
});

it.each([
  ["down", 0, 140],
  ["right", 220, 0],
  ["left", -220, 0],
] as const)("dismisses with a real touch swipe %s", async (direction, dx, dy) => {
  await renderToaster();
  const message = `Swipe ${direction}`;
  const item = await show(message, { duration: 0 });
  // The page must not take the swipe for a scroll: that cancels the pointer and the toast stays.
  expect(getComputedStyle(item).touchAction).toBe("none");
  const rect = item.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await commands.touchDrag({ from: [x, y], to: [x + dx, y + dy], steps: 10 });
  await expect.poll(() => toastNamed(message)).toBeUndefined();
});

it("dismisses with a swipe down on a page that scrolls, without scrolling it", async () => {
  const tall = document.createElement("div");
  tall.style.height = "3000px";
  document.body.append(tall);
  nodes.push(tall);
  scrollTo(0, 400);
  await renderToaster();
  const item = await show("Swipe on a long page", { duration: 0 });
  const rect = item.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  await commands.touchDrag({ from: [x, y], to: [x, y + 140], steps: 10 });
  await expect.poll(() => toastNamed("Swipe on a long page")).toBeUndefined();
  expect(scrollY).toBe(400);
  scrollTo(0, 0);
});

it("gets the click of a tap on its action right after a flick that does not dismiss it", async () => {
  const undo = vi.fn();
  await renderToaster();
  const item = await show("Recipe deleted", { duration: 0, action: { label: "Undo", onClick: undo } });
  const rect = item.getBoundingClientRect();
  const x = rect.left + 60;
  const y = rect.top + rect.height / 2;
  // A fast flick up, the one way a toast cannot leave: it comes back. Chromium would start a
  // fling when a fast swipe ends, although nothing scrolls, and the tap that stops a fling
  // gets no click.
  // What prevents the fling: the toast takes the swipe's touch moves once the drag has begun.
  let taken = 0;
  const count = (event: TouchEvent) => {
    if (event.defaultPrevented) taken++;
  };
  addEventListener("touchmove", count);
  cleanups.push(() => removeEventListener("touchmove", count));
  // Hold the moving pose across input transport; the press itself must stop its spring.
  const frames = holdFrames();
  try {
    await commands.touchDrag({ from: [x, y], to: [x, y - 120], steps: 10, durationMs: 100 });
    expect(taken).toBeGreaterThan(0);
    expect(toastNamed("Recipe deleted")).toBe(item);
    expect(item.hasAttribute("data-ouro-settling")).toBe(true);
    expect(shift(item).y).toBeLessThan(0);
    const action = [...item.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
    const target = action.getBoundingClientRect();
    const caught = shift(item);
    await commands.touchStep({ type: "touchStart", x: target.left + target.width / 2, y: target.top + target.height / 2 });
    frames.step(16);
    frames.step(16);
    expect(shift(item)).toEqual(caught);
    frames.release();
    await commands.touchStep({ type: "touchEnd" });
    await expect.poll(() => undo.mock.calls.length).toBe(1);
  } finally {
    frames.release();
    await commands.touchStep({ type: "touchEnd" });
  }
});

it("gives the dismiss and action buttons 44px touch targets", async () => {
  await renderToaster();
  const item = await show("Recipe deleted", { duration: 0, action: { label: "Undo", onClick: () => {} } });
  for (const button of item.querySelectorAll("button")) {
    const rect = button.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    expect(hits(button, cx, cy - 21) && hits(button, cx, cy + 21)).toBe(true);
    expect(hits(button, cx - 21, cy) && hits(button, cx + 21, cy)).toBe(true);
  }
  // 16px text on the action, as for every control on a coarse pointer.
  const undo = [...item.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
  expect(getComputedStyle(undo).fontSize).toBe("16px");
});

it("keeps the phone layout and touch sizes on a landscape phone", async () => {
  await rotate(844, 390);
  await renderToaster();
  const item = await show("Landscape", { duration: 0, action: { label: "Undo", onClick: () => {} } });
  const undo = [...item.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
  expect(getComputedStyle(undo).fontSize).toBe("16px");
  expect(item.getBoundingClientRect().width).toBe(360);
});

describe("the swipe follows the finger (rule 12)", () => {
  it("moves 1:1 from where it was taken, either way, once 10px have chosen sideways", async () => {
    await renderToaster();
    const item = await show("Follows", { duration: 0 });
    const from = grip(item);
    try {
      // Under 10px nothing has been chosen, and nothing moves.
      await dragTo(from, [[6, 0]]);
      expect(item.style.translate).toBe("");
      await dragTo(from, [[12, 0], [30, 0]], false);
      await expect.poll(() => shift(item)).toEqual({ x: 30, y: 0 });
      await dragTo(from, [[10, 0], [-25, 0]], false);
      await expect.poll(() => shift(item)).toEqual({ x: -25, y: 0 });
      // Travel down does not count once sideways has the toast.
      await dragTo(from, [[-25, 30]], false);
      await expect.poll(() => shift(item)).toEqual({ x: -25, y: 0 });
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    // Let go at rest 25px out, short of the 40px that dismiss: it comes back.
    await atRest(item);
    expect(toastNamed("Follows")).toBe(item);
  });

  it("chooses down for a move that is more down than sideways, and then moves only down", async () => {
    await renderToaster();
    const item = await show("Down", { duration: 0 });
    const from = grip(item);
    try {
      await dragTo(from, [[5, 6], [9, 12]]);
      await expect.poll(() => shift(item)).toEqual({ x: 0, y: 12 });
      await dragTo(from, [[60, 24]], false);
      await expect.poll(() => shift(item)).toEqual({ x: 0, y: 24 });
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await atRest(item);
    expect(toastNamed("Down")).toBe(item);
  });

  it("follows less and less upward, the one way it cannot leave, and comes back however far it was pulled", async () => {
    await renderToaster();
    const item = await show("Up", { duration: 0 });
    const from = grip(item);
    const height = item.offsetHeight;
    try {
      await dragTo(from, [[0, -12], [0, -60]]);
      await expect.poll(() => Math.abs(shift(item).y - rubberband(-60, height))).toBeLessThan(0.05);
      const first = shift(item).y;
      await dragTo(from, [[0, -120]], false);
      await expect.poll(() => Math.abs(shift(item).y - rubberband(-120, height))).toBeLessThan(0.05);
      // Twice the travel, less than twice the movement, and never as far as the finger.
      expect(shift(item).y).toBeGreaterThan(first * 2);
      expect(shift(item).y).toBeGreaterThan(-height);
    } finally {
      // Let go while still moving up fast: a flick, and still no way out.
      await commands.touchStep({ type: "touchEnd" });
    }
    await atRest(item);
    expect(toastNamed("Up")).toBe(item);
  });

  it.each([
    ["sideways", 30, 0],
    ["down", 0, 30],
  ] as const)("leaves on a quick flick %s, however short", async (_way, dx, dy) => {
    await renderToaster();
    const item = await show("Flicked", { duration: 0 });
    const [x, y] = grip(item);
    // 30px, short of the 40px a slow release needs.
    await commands.touchDrag({ from: [x, y], to: [x + dx, y + dy], steps: 4, durationMs: 60 });
    // It fades on the way it was thrown, and does not slide down as a closed toast does.
    expect(item.hasAttribute("data-ouro-swiped")).toBe(true);
    await expect.poll(() => toastNamed("Flicked")).toBeUndefined();
  });

  it("leaves when let go at rest more than 40px out, and goes on the way it was dragged", async () => {
    await renderToaster();
    const item = await show("Far", { duration: 0 });
    const from = grip(item);
    // The exit is a spring: with frames held it stands where it was let go until the test steps.
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    // A long fade, so the toast is still on the page, however slow the machine, for the finger that comes next.
    item.style.transitionDuration = "20s";
    try {
      await dragTo(from, [[-12, 0], [-30, 0], [-50, 0]]);
      await expect.poll(() => shift(item).x).toBe(-50);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    expect(item.hasAttribute("data-ouro-swiped")).toBe(true);
    frames.step(16);
    frames.step(16);
    const leaving = shift(item).x;
    expect(leaving).toBeLessThan(-50);
    // A finger on a toast that is on its way out does not stop it.
    const rect = item.getBoundingClientRect();
    let pressed = 0;
    item.addEventListener("pointerdown", () => pressed++, { once: true });
    await dragTo([rect.left + rect.width / 2, from[1]], [[20, 0], [40, 0]]);
    expect(pressed).toBe(1);
    frames.step(16);
    expect(shift(item).x).toBeLessThan(leaving);
    await commands.touchStep({ type: "touchEnd" });
    frames.release();
    for (const animation of item.getAnimations()) animation.finish();
    await expect.poll(() => toastNamed("Far")).toBeUndefined();
  });

  it("settles from where it was let go, and can be caught again on the way", async () => {
    await renderToaster();
    const item = await show("Caught", { duration: 0 });
    const from = grip(item);
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    try {
      await dragTo(from, [[12, 0], [36, 0]]);
      await expect.poll(() => shift(item).x).toBe(36);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    // The spring starts from the 36px it was let go at: no jump, and no CSS transition on the way.
    expect(item.hasAttribute("data-ouro-settling")).toBe(true);
    expect(shift(item).x).toBe(36);
    for (let step = 0; step < 3; step++) frames.step(16);
    const flying = shift(item).x;
    expect(flying).toBeGreaterThan(2);
    expect(flying).toBeLessThan(36);
    expect(getComputedStyle(item).transitionProperty).not.toContain("translate");
    try {
      // A finger comes down: the toast stops under it, where the spring had it.
      await commands.touchStep({ type: "touchStart", x: from[0], y: from[1] });
      expect(item.hasAttribute("data-ouro-settling")).toBe(false);
      frames.step(32);
      expect(shift(item).x).toBe(flying);
      // It is off rest sideways, so a move down does not take it: let go of, it carries on home.
      await dragTo(from, [[0, 8], [0, 16]], false);
      expect(shift(item)).toEqual({ x: flying, y: 0 });
      await commands.touchStep({ type: "touchEnd" });
      expect(item.hasAttribute("data-ouro-settling")).toBe(true);
      // Caught again, and moved sideways: it follows from where it was caught.
      await dragTo(from, [[-6, 0], [-12, 0], [-20, 0]]);
      await expect.poll(() => Math.abs(shift(item).x - (flying - 20))).toBeLessThan(0.05);
      expect(item.hasAttribute("data-ouro-settling")).toBe(false);
      frames.release();
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await atRest(item);
    expect(toastNamed("Caught")).toBe(item);
  });

  it("carries on home after a finger only touched it on the way", async () => {
    await renderToaster();
    const item = await show("Touched", { duration: 0 });
    const from = grip(item);
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    try {
      await dragTo(from, [[12, 0], [36, 0]]);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    for (let step = 0; step < 3; step++) frames.step(16);
    const flying = shift(item).x;
    await commands.touchStep({ type: "touchStart", x: from[0], y: from[1] });
    expect(item.hasAttribute("data-ouro-settling")).toBe(false);
    await commands.touchStep({ type: "touchEnd" });
    expect(item.hasAttribute("data-ouro-settling")).toBe(true);
    expect(shift(item).x).toBe(flying);
    frames.release();
    await atRest(item);
  });

  it("is taken without a jump when caught above rest, where it was held back", async () => {
    await renderToaster();
    const item = await show("Above", { duration: 0 });
    const from = grip(item);
    const height = item.offsetHeight;
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    try {
      await dragTo(from, [[0, -12], [0, -90]]);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    for (let step = 0; step < 2; step++) frames.step(16);
    const flying = shift(item).y;
    expect(flying).toBeLessThan(-2);
    // The finger travel that holds a toast at `flying`: what `rubberband` turns into it.
    const travel = (flying * height) / (0.55 * (height + flying));
    try {
      await dragTo(from, [[0, 6], [0, 12]]);
      // 12px down from where it was caught, by the same curve: it moved less than 12px, and did not jump.
      await expect.poll(() => Math.abs(shift(item).y - rubberband(travel + 12, height))).toBeLessThan(0.05);
      expect(shift(item).y).toBeGreaterThan(flying);
      expect(shift(item).y).toBeLessThan(flying + 12);
      frames.release();
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await atRest(item);
  });

  it("goes back to rest when the browser cancels the touch, however far out it was", async () => {
    await renderToaster();
    const item = await show("Cancelled", { duration: 0 });
    const from = grip(item);
    let pointerId = -1;
    item.addEventListener("pointerdown", (event) => (pointerId = event.pointerId), { once: true });
    try {
      await dragTo(from, [[12, 0], [60, 0], [120, 0]]);
      await expect.poll(() => shift(item).x).toBe(120);
      await act(async () => {
        item.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true }));
      });
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    expect(item.hasAttribute("data-ouro-swiped")).toBe(false);
    await atRest(item);
    expect(toastNamed("Cancelled")).toBe(item);
  });

  it("leaves a press on its action to the action: the toast does not move", async () => {
    const undo = vi.fn();
    await renderToaster();
    const item = await show("Recipe deleted", { duration: 0, action: { label: "Undo", onClick: undo } });
    const rect = [...item.querySelectorAll("button")].find((button) => button.textContent === "Undo")!.getBoundingClientRect();
    try {
      await dragTo([rect.left + rect.width / 2, rect.top + rect.height / 2], [[-12, 0], [-60, 0]]);
      expect(item.style.translate).toBe("");
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    expect(toastNamed("Recipe deleted")).toBe(item);
  });

  it("still follows the finger with reduced motion, then returns or fades with no travel", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await renderToaster();
    const item = await show("Calm", { duration: 0 });
    const from = grip(item);
    try {
      await dragTo(from, [[12, 0], [30, 0]]);
      await expect.poll(() => shift(item).x).toBe(30);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    // Back at rest at once: no spring ran.
    expect(item.style.translate).toBe("");
    expect(item.hasAttribute("data-ouro-settling")).toBe(false);
    try {
      await dragTo(from, [[12, 0], [30, 0], [60, 0]]);
      await expect.poll(() => shift(item).x).toBe(60);
      await restFinger();
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    // Dismissed: it fades where the finger left it.
    expect(item.hasAttribute("data-ouro-swiped")).toBe(true);
    expect(shift(item).x).toBe(60);
    expect(getComputedStyle(item).transitionProperty).toBe("opacity");
    await expect.poll(() => toastNamed("Calm")).toBeUndefined();
  });
});

// Guards a workaround. Base UI's own swipe paused the toasts and fanned the stack out on a touch
// press; with that swipe off (`swipeDirection={[]}`) nothing public does, so the toast sends a
// `mousemove`, which Base UI's `Toast.Viewport` answers through its `onMouseMove`. If this
// fails after a Base UI upgrade, the viewport has stopped answering that event: look for a
// public way to pause the toasts, or for what its hover handling listens to now.
it("waits while a finger is on a toast, and fans the stack out, as a mouse over it does", async () => {
  const elsewhere = document.createElement("button");
  elsewhere.textContent = "Elsewhere";
  elsewhere.setAttribute("data-testid", "elsewhere");
  Object.assign(elsewhere.style, { position: "fixed", top: "20px", left: "20px", width: "120px", height: "48px" });
  document.body.append(elsewhere);
  nodes.push(elsewhere);
  await renderToaster();
  const item = await show("Held", { id: "held-toast", duration: 0 });
  // Arm the countdown after the entrance: Vitest's readiness polls advance fake timers too.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const expiresAt = Date.now() + 1500;
    await act(async () => toast("Held", { id: "held-toast", duration: 1500 }));
    await act(async () => vi.advanceTimersByTime(500));
    const region = document.querySelector<HTMLElement>('[data-ouro="toaster"]')!;
    expect(region.hasAttribute("data-expanded")).toBe(false);
    const [x, y] = grip(item);
    // The event is where the finger is, for an app that follows the mouse.
    const moves: Array<[number, number]> = [];
    const record = (event: MouseEvent) => moves.push([event.clientX, event.clientY]);
    addEventListener("mousemove", record);
    cleanups.push(() => removeEventListener("mousemove", record));
    let remaining: number;
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      remaining = expiresAt - Date.now();
      await expect.poll(() => region.hasAttribute("data-expanded")).toBe(true);
      expect(moves.length).toBe(1);
      expect(Math.abs(moves[0]![0] - x) < 1 && Math.abs(moves[0]![1] - y) < 1).toBe(true);
      // Twice its time passes under the finger, and it is still there.
      await act(async () => vi.advanceTimersByTime(3000));
      expect(toastNamed("Held")).toBe(item);
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    // A touch elsewhere lets the toasts go on: the rest of its time, and it closes.
    const resumedAt = Date.now();
    await commands.tap('[data-testid="elsewhere"]');
    await expect.poll(() => region.hasAttribute("data-expanded")).toBe(false);
    const untilLastMillisecond = remaining - (Date.now() - resumedAt) - 1;
    expect(untilLastMillisecond).toBeGreaterThanOrEqual(0);
    await act(async () => vi.advanceTimersByTime(untilLastMillisecond));
    expect(item.hasAttribute("data-ending-style")).toBe(false);
    await act(async () => vi.advanceTimersByTime(1));
  } finally {
    vi.useRealTimers();
  }
  await expect.poll(() => toastNamed("Held")).toBeUndefined();
});
