import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { Item } from "~/components/ouro/item/item";
import { Reorderable } from "~/components/ouro/reorderable/reorderable";
import { act } from "~/lib/ouro/testing/act";
import { holdFrames } from "~/lib/ouro/testing/frames";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
const cleanups: Array<() => void> = [];
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Waits until the page has stopped scrolling: two frames agree. */
async function pageAtRest() {
  await expect
    .poll(async () => {
      const before = scrollY;
      await frame();
      await frame();
      return scrollY === before;
    })
    .toBe(true);
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await commands.touchStep({ type: "touchEnd" });
  await pageAtRest();
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  scrollTo(0, 0);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await rotate(390, 844);
});

const steps = ["Sear the ribs", "Soften the onions", "Add the wine", "Braise for three hours", "Rest overnight"];

/** A list of steps between two blocks, so the page itself can scroll. */
async function renderSteps({ count = steps.length, before = 120, after = 1600 } = {}) {
  const onReorder = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <div style={{ padding: 16 }}>
        <div style={{ height: before }} />
        <Reorderable
          label="Steps"
          items={Array.from({ length: count }, (_, index) => steps[index] ?? `Step ${index + 1}`).map((step, index) => ({
            id: `step-${index + 1}`,
            label: step,
            content: <Item title={step} description={`Step ${index + 1}`} />,
          }))}
          onReorder={onReorder}
        />
        <div style={{ height: after }} />
      </div>,
    ),
  );
  const list = host.querySelector<HTMLElement>("[data-ouro-reorderable-list]")!;
  return { host, list, onReorder };
}

const rows = (list: HTMLElement) => [...list.children] as HTMLElement[];
const handle = (list: HTMLElement, name: string) => list.querySelector<HTMLButtonElement>(`button[aria-label="Reorder ${name}"]`)!;
const order = (list: HTMLElement) => rows(list).map((row) => row.querySelector("button")!.getAttribute("aria-label")!.replace("Reorder ", ""));

function middle(element: Element): [number, number] {
  const rect = element.getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

/** Whether a tap at (x, y) lands on `target`. */
const hits = (target: Element, x: number, y: number) => target.contains(document.elementFromPoint(x, y));

describe("Reorderable on a phone", () => {
  it.each([
    ["portrait", 390, 844],
    ["landscape", 844, 390],
  ])("gives each handle a 44px touch target that takes the touch from the page in %s", async (_name, width, height) => {
    await rotate(width, height);
    const { list } = await renderSteps();
    for (const step of steps) {
      const grip = handle(list, step);
      grip.scrollIntoView({ block: "center" });
      expect(getComputedStyle(grip).touchAction).toBe("none");
      const [cx, cy] = middle(grip);
      expect(hits(grip, cx, cy - 21) && hits(grip, cx, cy + 21), step).toBe(true);
      expect(hits(grip, cx - 21, cy) && hits(grip, cx + 21, cy), step).toBe(true);
    }
  });

  it("opens a sheet of moves on a tap of the handle, for a touch that cannot drag", async () => {
    const { list, onReorder } = await renderSteps();
    await commands.tap('button[aria-label="Reorder Soften the onions"]');
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(document.querySelector('[data-ouro="menu"]')!.getAttribute("data-ouro-presentation")).toBe("sheet");
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Move up", "Move down", "Move to top", "Move to bottom", "Close"]);
    // The sheet has slid in: on the way, a fraction of a pixel of travel makes a 44px height read as 43.9999.
    await expect.poll(() => document.querySelector('[data-ouro="menu"]')!.getAnimations().length).toBe(0);
    // Each move is a 44px target with 16px text.
    for (const item of items) {
      expect(item.getBoundingClientRect().height, item.textContent).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(item).fontSize, item.textContent).toBe("16px");
    }
    // The tap dragged nothing and picked nothing up.
    expect(list.hasAttribute("data-dragging")).toBe(false);
    expect(list.querySelector("[data-grabbed]")).toBeNull();
    items[1]!.setAttribute("data-test-move", "down");
    await commands.tap('[data-test-move="down"]');
    await expect.poll(() => onReorder.mock.calls).toEqual([[["step-1", "step-3", "step-2", "step-4", "step-5"], { id: "step-2", from: 1, to: 2 }]]);
    expect(order(list).slice(0, 3)).toEqual(["Sear the ribs", "Add the wine", "Soften the onions"]);
    await expect.poll(() => document.querySelector("[data-ouro-announcer]")?.textContent).toBe("Soften the onions moved. Position 3 of 5.");
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    expect(scrollY).toBe(0);
  });

  it("opens the same sheet on a screen reader's double tap, a click with no touch, and disables the moves that cannot apply", async () => {
    const { list, onReorder } = await renderSteps();
    await act(async () => handle(list, "Rest overnight").click());
    await expect.element(page.getByRole("menu")).toBeVisible();
    const item = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((found) => found.textContent === name)!;
    // The last row cannot go down.
    expect(item("Move down").hasAttribute("data-disabled")).toBe(true);
    expect(item("Move to bottom").hasAttribute("data-disabled")).toBe(true);
    expect(item("Move up").hasAttribute("data-disabled")).toBe(false);
    await act(async () => item("Move to top").click());
    await expect.poll(() => onReorder.mock.calls).toEqual([[["step-5", "step-1", "step-2", "step-3", "step-4"], { id: "step-5", from: 4, to: 0 }]]);
    expect(order(list)[0]).toBe("Rest overnight");
    await expect.poll(() => document.querySelector("[data-ouro-announcer]")?.textContent).toBe("Rest overnight moved. Position 1 of 5.");
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
  });

  it("moves a row with a touch drag on its handle, without scrolling the page", async () => {
    const { list, onReorder } = await renderSteps();
    const [x, y] = middle(handle(list, "Sear the ribs"));
    const [, target] = middle(rows(list)[2]!);
    // Drag to just past the middle of the third row, with a little sideways drift.
    await commands.touchDrag({ from: [x, y], to: [x + 14, target + 6], steps: 12 });
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    expect(onReorder).toHaveBeenCalledWith(["step-2", "step-3", "step-1", "step-4", "step-5"], { id: "step-1", from: 0, to: 2 });
    expect(order(list).slice(0, 3)).toEqual(["Soften the onions", "Add the wine", "Sear the ribs"]);
    expect(scrollY).toBe(0);
    expect(list.hasAttribute("data-dragging")).toBe(false);
    // The rows spring into their places, and then nothing is left displaced.
    await expect.poll(() => list.hasAttribute("data-ouro-settling")).toBe(false);
    for (const row of rows(list)) expect(row.style.transform).toBe("");
  });

  it("opens the sheet of moves on a tap right after a fast drag", async () => {
    const { list, onReorder } = await renderSteps();
    const [x, y] = middle(handle(list, "Sear the ribs"));
    const [, target] = middle(rows(list)[2]!);
    let taken = 0;
    const listener = (event: TouchEvent) => {
      if (event.defaultPrevented) taken++;
    };
    addEventListener("touchmove", listener);
    cleanups.push(() => removeEventListener("touchmove", listener));
    // 100ms from touch-down to lift. Chromium would start a fling when a drag this fast
    // ends, although nothing scrolls, and the tap that stops a fling gets no click: the
    // handle takes the drag's touch moves, so there is no fling.
    await commands.touchDrag({ from: [x, y], to: [x, target + 6], steps: 10, durationMs: 100 });
    expect(taken).toBeGreaterThan(0);
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    await expect.poll(() => list.hasAttribute("data-ouro-settling")).toBe(false);
    await commands.tap('button[aria-label="Reorder Sear the ribs"]');
    await expect.element(page.getByRole("menu")).toBeVisible();
  });

  it("springs the dropped row into its place from under the finger, frame by frame", async () => {
    const { list, onReorder } = await renderSteps();
    const dragged = rows(list)[0]!;
    const height = dragged.getBoundingClientRect().height;
    const [x, y] = middle(handle(list, "Sear the ribs"));
    // The springs' frames are the test's to step, so the row is seen at every one of them on any machine.
    const frames = holdFrames();
    cleanups.push(() => frames.release());
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      for (let step = 1; step <= 8; step++) await commands.touchStep({ type: "touchMove", x, y: y + (height * 1.3 * step) / 8 });
      await expect.poll(() => list.hasAttribute("data-dragging")).toBe(true);
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    const seen = [dragged.style.transform];
    while (dragged.hasAttribute("data-ouro-settling")) {
      frames.step(16);
      seen.push(dragged.style.transform);
    }
    // The rows it passed come to rest too.
    frames.until(() => !list.hasAttribute("data-ouro-settling"));
    frames.release();
    // Many frames on the way to its place, the last exactly on it, with no CSS transition or animation doing it.
    expect(seen.length).toBeGreaterThan(8);
    expect(seen.at(-1)).toBe("");
    expect(seen.slice(0, -1).every((transform) => /^translateY\(-?[\d.e-]+px\)$/.test(transform))).toBe(true);
    expect(dragged.getAnimations().length).toBe(0);
    expect(order(list).slice(0, 2)).toEqual(["Soften the onions", "Sear the ribs"]);
  });

  it("puts a dropped row in its place at once with reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { list, onReorder } = await renderSteps();
    const [x, y] = middle(handle(list, "Sear the ribs"));
    const [, target] = middle(rows(list)[1]!);
    await commands.touchDrag({ from: [x, y], to: [x, target + 12], steps: 10 });
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    // No spring: by the time the drop is reported, every row is where it belongs.
    expect(list.hasAttribute("data-ouro-settling")).toBe(false);
    for (const row of rows(list)) expect(row.style.transform).toBe("");
    expect(order(list).slice(0, 2)).toEqual(["Soften the onions", "Sear the ribs"]);
  });

  it("lets a touch that starts on a row, outside its handle, scroll the page", async () => {
    const { list, onReorder } = await renderSteps();
    const row = rows(list)[2]!;
    const text = row.querySelector<HTMLElement>("[data-ouro-reorderable-content]")!;
    expect(getComputedStyle(text).touchAction).toBe("auto");
    expect(getComputedStyle(row).touchAction).toBe("auto");
    let prevented = false;
    const listener = (event: TouchEvent) => {
      if (event.defaultPrevented) prevented = true;
    };
    addEventListener("touchmove", listener);
    const [x, y] = middle(text);
    try {
      await commands.touchDrag({ from: [x, y + 40], to: [x, y - 160], steps: 12 });
      await expect.poll(() => scrollY).toBeGreaterThan(50);
    } finally {
      removeEventListener("touchmove", listener);
    }
    expect(prevented).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
    expect(order(list)).toEqual(steps);
  });

  it("keeps the row under a held finger and shifts the rows it passes", async () => {
    const { list, onReorder } = await renderSteps();
    const first = rows(list)[0]!;
    const second = rows(list)[1]!;
    const height = first.getBoundingClientRect().height;
    const [x, y] = middle(handle(list, "Sear the ribs"));
    const startTop = first.getBoundingClientRect().top;
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      for (let step = 1; step <= 8; step++) await commands.touchStep({ type: "touchMove", x, y: y + (height * 1.2 * step) / 8 });
      await expect.poll(() => list.hasAttribute("data-dragging")).toBe(true);
      // The row has moved with the finger: 1.2 times its height, past the middle of the second row.
      await expect.poll(() => Math.round(first.getBoundingClientRect().top - startTop)).toBe(Math.round(height * 1.2));
      expect(first.hasAttribute("data-dragging")).toBe(true);
      // The second row makes room, sliding up by the dragged row's height.
      await expect.poll(() => second.style.transform).toBe(`translateY(${-height}px)`);
      expect(onReorder).not.toHaveBeenCalled();
      expect(scrollY).toBe(0);
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    expect(order(list).slice(0, 2)).toEqual(["Soften the onions", "Sear the ribs"]);
  });

  it("scrolls the page while the finger holds a row near the bottom edge, and drops it where it ends up", async () => {
    // Twelve rows, taller than the screen: the last ones start out of view.
    const { list, onReorder } = await renderSteps({ count: 12, before: 300, after: 300 });
    const [x, y] = middle(handle(list, "Sear the ribs"));
    try {
      await commands.touchStep({ type: "touchStart", x, y });
      for (let step = 1; step <= 6; step++) await commands.touchStep({ type: "touchMove", x, y: y + ((innerHeight - 12 - y) * step) / 6 });
      // The finger rests 12px above the bottom edge: the page scrolls on its own.
      await expect.poll(() => scrollY).toBeGreaterThan(150);
      // The dragged row is still under the finger.
      const dragged = rows(list)[0]!.getBoundingClientRect();
      expect(dragged.top).toBeLessThan(innerHeight);
      expect(dragged.bottom).toBeGreaterThan(innerHeight - 80);
    } finally {
      await commands.touchStep({ type: "touchEnd" });
    }
    await expect.poll(() => onReorder.mock.calls.length).toBe(1);
    const [ids, move] = onReorder.mock.calls[0] as [string[], { id: string; from: number; to: number }];
    expect(move.id).toBe("step-1");
    // It was dropped beyond the rows that were on screen when the drag began.
    expect(move.to).toBeGreaterThanOrEqual(8);
    expect(ids[move.to]).toBe("step-1");
  });
});
