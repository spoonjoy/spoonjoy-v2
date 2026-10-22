import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Sheet, type SheetProps } from "~/components/ouro/sheet/sheet";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await commands.touchStep({ type: "touchEnd" });
  document.documentElement.style.removeProperty("--ouro-duration-sheet");
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await rotate(390, 844);
});

const popup = () => document.querySelector<HTMLElement>('[data-ouro="sheet"]');

/** The sheet's translation in px, from its computed transform. */
function translation(element: HTMLElement): { x: number; y: number } {
  const matrix = new DOMMatrix(getComputedStyle(element).transform);
  return { x: matrix.m41, y: matrix.m42 };
}

/** Waits until the sheet stands still at rest: no animation, and two reads agree. */
async function settled() {
  let last = Number.NaN;
  await expect
    .poll(
      () => {
        const sheet = popup();
        if (!sheet || sheet.hasAttribute("data-starting-style")) return false;
        const { x, y } = translation(sheet);
        const still = Math.abs(x + y - last) < 0.01;
        last = x + y;
        return still && sheet.getAnimations().length === 0;
      },
      { interval: 50 },
    )
    .toBe(true);
}

async function openSheet(props: Partial<SheetProps> = {}, body: ReactNode = <p style={{ margin: 0, height: 320 }}>Pick a cookbook for this recipe.</p>) {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <Sheet title="Save to cookbook" trigger={<Button>Save</Button>} {...(props as object)}>
        {body}
      </Sheet>,
    ),
  );
  await commands.tap('[data-ouro="button"]');
  await settled();
  return popup()!;
}

/** Where a finger takes the sheet by its header, outside the scrolling body. */
function grip(sheet: HTMLElement): [number, number] {
  const rect = sheet.getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + 12];
}

/** A tap with no wait before it: touch input straight at the element's middle. Playwright's own tap first waits for the element to hold still. */
async function tapNow(element: Element) {
  const rect = element.getBoundingClientRect();
  await commands.touchStep({ type: "touchStart", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  await commands.touchStep({ type: "touchEnd" });
}

/**
 * Stops the sheet where it stands, and resolves once it has stopped. `pause()` on a running
 * animation is itself pending: the animation runs on until the next frame, which takes the
 * hold time, so a read straight after `pause()` is a frame early (about 0.8px at 60 fps here,
 * and more on a slow runner, whose frames are longer). Waiting for `ready` reads where it stopped.
 */
async function freeze(sheet: HTMLElement) {
  const animations = sheet.getAnimations();
  for (const animation of animations) animation.pause();
  await Promise.all(animations.map((animation) => animation.ready));
}

/** Keeps the finger still until it has no velocity left. */
async function restFinger() {
  const since = performance.now();
  await expect.poll(() => performance.now() - since).toBeGreaterThan(150);
}

/**
 * Drags the sheet by (dx, dy), lets go with a finger at rest, and stops its way back to
 * rest part-way: the sheet stands off its rest position, as it does for a moment after any
 * release. The settle is made long first, so a slow machine still finds it under way.
 * Returns where the sheet stands.
 */
async function releaseAndFreeze(sheet: HTMLElement, dx: number, dy: number, from = grip(sheet)) {
  document.documentElement.style.setProperty("--ouro-duration-sheet", "20s");
  const [x, y] = from;
  try {
    await commands.touchStep({ type: "touchStart", x, y });
    for (let step = 1; step <= 6; step++) await commands.touchStep({ type: "touchMove", x: x + (dx * step) / 6, y: y + (dy * step) / 6 });
    await restFinger();
  } finally {
    await commands.touchStep({ type: "touchEnd" });
  }
  await expect.poll(() => sheet.getAnimations().length).toBeGreaterThan(0);
  await freeze(sheet);
  return translation(sheet);
}

describe("Sheet on a phone", () => {
  it("stays under the finger when it is caught on its way back to rest, and follows from there", async () => {
    const sheet = await openSheet();
    const frozen = (await releaseAndFreeze(sheet, 0, 120)).y;
    // Well off its rest position, where a jump to rest would show.
    expect(frozen).toBeGreaterThan(40);
    const [x, y] = grip(sheet);
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      await act(async () => {});
      expect(sheet.hasAttribute("data-swiping")).toBe(true);
      expect(Math.abs(translation(sheet).y - frozen)).toBeLessThan(1);
      // Base UI starts to count at the second move; from there the sheet follows 1:1.
      for (const step of [10, 20, 30, 40]) await commands.touchStep({ type: "touchMove", x, y: y + step });
      await expect.poll(() => Math.abs(translation(sheet).y - (frozen + 20))).toBeLessThan(1);
      await restFinger();
    } finally {
      document.documentElement.style.removeProperty("--ouro-duration-sheet");
      await commands.touchStep({ type: "touchEnd" });
    }
    // Let go, it comes to rest where it belongs.
    await settled();
    expect(Math.abs(translation(sheet).y)).toBeLessThan(0.5);
  });

  it("does not jump when a finger comes down on it while it is still opening", async () => {
    document.documentElement.style.setProperty("--ouro-duration-sheet", "20s");
    const host = document.createElement("div");
    document.body.append(host);
    nodes.push(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <Sheet title="Save to cookbook" trigger={<Button>Save</Button>}>
          <p style={{ margin: 0, height: 320 }}>Pick a cookbook for this recipe.</p>
        </Sheet>,
      ),
    );
    await commands.tap('[data-ouro="button"]');
    await expect.poll(() => (popup()?.getAnimations().length ?? 0) > 0 && !popup()!.hasAttribute("data-starting-style")).toBe(true);
    const sheet = popup()!;
    await freeze(sheet);
    const frozen = translation(sheet).y;
    expect(frozen).toBeGreaterThan(40);
    const [x, y] = grip(sheet);
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      await act(async () => {});
      // Base UI starts no drag before the sheet is open. Drag or not, the sheet stays where it was.
      expect(Math.abs(translation(sheet).y - frozen)).toBeLessThan(1);
      await commands.touchStep({ type: "touchMove", x, y: y + 10 });
      await commands.touchStep({ type: "touchMove", x, y: y + 20 });
      expect(translation(sheet).y).toBeGreaterThanOrEqual(frozen - 1);
    } finally {
      document.documentElement.style.removeProperty("--ouro-duration-sheet");
      await commands.touchStep({ type: "touchEnd" });
    }
  });

  it("stays under the finger when a sheet with snap points is caught on its way back to one", async () => {
    const sheet = await openSheet({ snapPoints: [0.5, 1] });
    const snap = translation(sheet).y;
    expect(snap).toBeGreaterThan(200);
    const frozen = (await releaseAndFreeze(sheet, 0, 120)).y;
    expect(frozen - snap).toBeGreaterThan(40);
    const [x, y] = grip(sheet);
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      await act(async () => {});
      expect(Math.abs(translation(sheet).y - frozen)).toBeLessThan(1);
      for (const step of [10, 20, 30, 40]) await commands.touchStep({ type: "touchMove", x, y: y + step });
      await expect.poll(() => Math.abs(translation(sheet).y - (frozen + 20))).toBeLessThan(1);
      await restFinger();
    } finally {
      document.documentElement.style.removeProperty("--ouro-duration-sheet");
      await commands.touchStep({ type: "touchEnd" });
    }
    await settled();
    expect(Math.abs(translation(sheet).y - snap)).toBeLessThan(0.5);
  });

  it("stays under the finger when a side sheet is caught on its way back to rest", async () => {
    const sheet = await openSheet({ side: "right" });
    const frozen = (await releaseAndFreeze(sheet, 110, 0)).x;
    expect(frozen).toBeGreaterThan(40);
    const [x, y] = grip(sheet);
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      await act(async () => {});
      expect(Math.abs(translation(sheet).x - frozen)).toBeLessThan(1);
      for (const step of [10, 20, 30, 40]) await commands.touchStep({ type: "touchMove", x: x + step, y });
      await expect.poll(() => Math.abs(translation(sheet).x - (frozen + 20))).toBeLessThan(1);
      await restFinger();
    } finally {
      document.documentElement.style.removeProperty("--ouro-duration-sheet");
      await commands.touchStep({ type: "touchEnd" });
    }
    await settled();
    expect(Math.abs(translation(sheet).x)).toBeLessThan(0.5);
  });

  it("stays under a finger that catches it by its scrolling body, where the drag starts with the first move", async () => {
    const sheet = await openSheet({}, <div style={{ height: 2000 }}>A long list of cookbooks.</div>);
    const body = sheet.querySelector<HTMLElement>("[data-ouro-sheet-content]")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const frozen = (await releaseAndFreeze(sheet, 0, 120)).y;
    expect(frozen).toBeGreaterThan(40);
    const rect = body.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + 80;
    try {
      // The body is at its top, so a pull down drags the sheet, but only once the finger moves.
      await commands.touchStep({ type: "touchStart", x, y });
      await act(async () => {});
      expect(sheet.hasAttribute("data-swiping")).toBe(false);
      for (const step of [10, 20]) await commands.touchStep({ type: "touchMove", x, y: y + step });
      await expect.poll(() => sheet.hasAttribute("data-swiping")).toBe(true);
      // Counted from where the finger came down: the sheet is 20px on from where it was caught.
      await expect.poll(() => Math.abs(translation(sheet).y - (frozen + 20))).toBeLessThan(1);
      await commands.touchStep({ type: "touchMove", x, y: y + 30 });
      await expect.poll(() => Math.abs(translation(sheet).y - (frozen + 30))).toBeLessThan(1);
      await restFinger();
    } finally {
      document.documentElement.style.removeProperty("--ouro-duration-sheet");
      await commands.touchStep({ type: "touchEnd" });
    }
    await settled();
    expect(Math.abs(translation(sheet).y)).toBeLessThan(0.5);
    expect(body.scrollTop).toBe(0);
  });

  it("gets the click of a tap made right after a flick that does not dismiss it", async () => {
    const save = vi.fn();
    const sheet = await openSheet({}, <Button onClick={save}>Save here</Button>);
    const button = sheet.querySelector('[data-ouro-sheet-content] [data-ouro="button"]')!;
    let clicks = 0;
    const count = () => clicks++;
    sheet.addEventListener("click", count);
    const [x, y] = grip(sheet);
    // A fast flick up: the sheet stretches and comes back. Chromium would start a fling when a
    // fast swipe ends, although nothing scrolls, and the tap that stops a fling gets no click.
    await commands.touchDrag({ from: [x, y], to: [x, y - 120], steps: 10, durationMs: 100 });
    expect(popup()).toBe(sheet);
    // The tap follows at once, on the button, while the sheet is still on its way back. The
    // sheet stays under the finger for the tap, so the click lands on the button.
    await tapNow(button);
    await expect.poll(() => clicks).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(popup()).toBe(sheet);
    // At rest, the button is where the finger finds it.
    await settled();
    await tapNow(button);
    await expect.poll(() => save.mock.calls.length).toBe(2);
    expect(clicks).toBe(2);
  });
});
