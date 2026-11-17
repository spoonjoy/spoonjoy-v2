import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { keepFocusClear, type FocusClearHandle } from "~/lib/ouro/keep-focus-clear";
import { holdFrames } from "~/lib/ouro/testing/frames";
import { pressTab } from "~/lib/ouro/testing/tab";

// A 390 by 844 window, the toasts' stack at its bottom end: a 58px front toast over the window's
// bottom 16px and a 16px column, and an older toast peeking 12px above it. The stack covers 758px
// to 828px down the window; its front toast covers 770px to 828px. The fade and the settle time are
// the two delays the helper waits on, both on fake timers, so a test decides when they end.

const FADE_MS = 300;
const SETTLE_MS = 600;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A control that covers the stack's front toast and the bottom of its column. */
const COVERED: Box = { left: 100, top: 790, width: 100, height: 30 };
/** A control out of the stack's way, in the window's middle. */
const MIDDLE: Box = { left: 100, top: 300, width: 100, height: 30 };
/** A control at the window's top edge, under a stack that hangs from the top. */
const TOP: Box = { left: 100, top: 20, width: 100, height: 30 };

const added: Element[] = [];
let handle: FocusClearHandle | undefined;
let bodyMargin = "";

/** The toaster's fade, as its styles have it, but long: a test ends it, or the fallback does. */
const fadeStyle = document.createElement("style");
fadeStyle.textContent = '[data-ouro="toaster"] { transition: opacity 60s; } [data-ouro-toaster-fading] { opacity: 0; }';

beforeEach(async () => {
  document.head.append(fadeStyle);
  await page.viewport(390, 844);
  bodyMargin = document.body.style.margin;
  document.body.style.margin = "0";
  document.documentElement.style.scrollPaddingBottom = "";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  fadeStyle.remove();
  handle?.release();
  handle = undefined;
  for (const node of added.splice(0)) node.remove();
  document.body.style.margin = bodyMargin;
  document.documentElement.style.scrollPaddingBottom = "";
  vi.useRealTimers();
});

/** Places a node fixed in the window, at `rect` or with the CSS given, and adds it to the page. */
function fixed<T extends HTMLElement>(node: T, rect: Box | string): T {
  node.style.cssText = typeof rect === "string" ? rect : `position: fixed; left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; height: ${rect.height}px;`;
  document.body.append(node);
  added.push(node);
  return node;
}

/** A control that takes keyboard focus, named for `caseOf`. */
function control(name: string, rect: Box, tag: "button" | "input" = "button"): HTMLElement {
  const node = document.createElement(tag);
  node.dataset.case = name;
  if (tag === "button") node.textContent = name;
  return fixed(node, rect);
}

/** A control a pointer focuses by a click but keyboard focus does not show: a text input would show it. */
function pointerControl(name: string, rect: Box): HTMLElement {
  const node = document.createElement("div");
  node.dataset.case = name;
  node.tabIndex = -1;
  node.textContent = name;
  return fixed(node, rect);
}

/** A fixed element that touches the window's top edge, as a header does. */
const header = (rect: Box | string) => fixed(document.createElement("div"), rect);

const caseOf = (name: string) => document.querySelector<HTMLElement>(`[data-case="${name}"]`)!;

/** The toaster's viewport: a zero-height anchor 16px above the window's bottom, its toasts hung from it. */
function stage({ toasts = 2, edge = "bottom" }: { toasts?: number; edge?: string } = {}): HTMLElement {
  const bar = document.createElement("div");
  bar.dataset.ouro = "toaster";
  bar.dataset.edge = edge;
  fixed(bar, "position: fixed; left: 16px; bottom: 16px; width: 358px; height: 0;");
  if (toasts > 0) toast(bar, "bottom: 0; left: 0; width: 358px; height: 58px;");
  if (toasts > 1) toast(bar, "bottom: 12px; left: 2px; width: 322px; height: 58px;");
  return bar;
}

function toast(bar: HTMLElement, css: string): HTMLElement {
  const node = document.createElement("div");
  node.dataset.ouro = "toast";
  node.style.cssText = `position: absolute; ${css}`;
  bar.append(node);
  return node;
}

/** The page for one test: a control to Tab from, the toasts, and a keeper of them with focus on the control. */
function setup(options?: { toasts?: number; edge?: string }): HTMLElement {
  // Outside the column, and off the top edge: a control there is not a header.
  const start = control("start", { left: 380, top: 820, width: 10, height: 10 });
  const bar = stage(options);
  handle = keepFocusClear(bar);
  start.focus();
  return bar;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Waits for frames, so the frame that looks at focus has run. */
async function frames(count = 2) {
  for (let index = 0; index < count; index++) await frame();
}

/** Moves keyboard focus to the control named `name` with Tab presses, as a person does. */
async function tab(name: string) {
  for (let presses = 0; presses < 10 && document.activeElement?.getAttribute("data-case") !== name; presses++) await pressTab();
  expect(document.activeElement?.getAttribute("data-case")).toBe(name);
  await frames();
}

const advance = (ms: number) => vi.advanceTimersByTime(ms);

const stateOf = (bar: HTMLElement) => ({
  moved: bar.getAttribute("data-ouro-toaster-moved"),
  collapsed: bar.hasAttribute("data-ouro-toaster-collapsed"),
  fading: bar.hasAttribute("data-ouro-toaster-fading"),
  edge: bar.getAttribute("data-edge"),
});

const padding = () => document.documentElement.style.scrollPaddingBottom;
const movedTop = (bar: HTMLElement) => bar.style.getPropertyValue("--ouro-toaster-moved-top");

describe("keepFocusClear", () => {
  describe("where the stack goes", () => {
    it("leaves the stack at the bottom for a control no part of it covers, however long it rests", async () => {
      const bar = setup();
      control("middle", MIDDLE);
      await tab("middle");
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
      advance(SETTLE_MS);
      await frames();
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("moves the stack to the top for a control the bottom stack covers and the top edge clears", async () => {
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
      expect(bar.getAttribute("data-ouro-toaster-fading")).toBe("");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
      expect(movedTop(bar)).toBe("16px");
    });

    it("prefers the top to the collapsed stack when both clear the control", async () => {
      const bar = setup();
      control("edge", { left: 100, top: 752, width: 100, height: 17 });
      await tab("edge");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
    });

    it("moves the stack to the top when the moved stack ends exactly at the window's bottom edge", async () => {
      const bar = setup();
      header({ left: 0, top: 0, width: 390, height: 758 });
      control("sliver", { left: 100, top: 770, width: 100, height: 4 });
      await tab("sliver");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
      expect(movedTop(bar)).toBe("774px");
    });

    it("collapses to the front toast when the top edge is out of reach and only the front toast leaves the control", async () => {
      const bar = setup();
      header({ left: 0, top: 0, width: 390, height: 760 });
      control("peek", { left: 100, top: 752, width: 100, height: 17 });
      await tab("peek");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: true, fading: false, edge: "bottom" });
      expect(bar.getAttribute("data-ouro-toaster-collapsed")).toBe("");
      expect(padding()).toBe("74px");
    });

    it("leaves the stack where it is when the front toast covers the control and the top edge is out of reach", async () => {
      const bar = setup();
      header({ left: 0, top: 0, width: 390, height: 760 });
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("leaves a toaster at the top edge alone, and keeps the page's own padding for it", async () => {
      document.documentElement.style.scrollPaddingBottom = "7px";
      const bar = setup({ edge: "top" });
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "top" });
      expect(padding()).toBe("7px");
      handle!.release();
      expect(bar.getAttribute("data-edge")).toBe("top");
    });

    it("moves a collapsed stack to the top once the top edge is clear", async () => {
      const bar = setup();
      const blocker = header({ left: 0, top: 0, width: 390, height: 760 });
      control("peek", { left: 100, top: 752, width: 100, height: 17 });
      control("front", { left: 100, top: 790, width: 100, height: 30 });
      await tab("peek");
      advance(FADE_MS);
      expect(stateOf(bar).collapsed).toBe(true);
      blocker.style.display = "none";
      await tab("front");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("stays collapsed for a control only the front toast covers while the top edge is out of reach", async () => {
      const bar = setup();
      header({ left: 0, top: 0, width: 390, height: 760 });
      control("peek", { left: 100, top: 752, width: 100, height: 17 });
      control("front", { left: 100, top: 790, width: 100, height: 30 });
      await tab("peek");
      advance(FADE_MS);
      await tab("front");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: true, fading: false, edge: "bottom" });
    });
  });

  describe("what covers a control", () => {
    // A control that touches the stack's edge is not covered; one that overlaps it by a pixel is.
    it.each<[string, Box, boolean]>([
      ["a control touching the column's left edge leaves the stack at the bottom", { left: 0, top: 790, width: 16, height: 30 }, false],
      ["a control overlapping the column's left edge by a pixel moves the stack", { left: 0, top: 790, width: 17, height: 30 }, true],
      ["a control touching the column's right edge leaves the stack at the bottom", { left: 374, top: 790, width: 16, height: 30 }, false],
      ["a control overlapping the column's right edge by a pixel moves the stack", { left: 373, top: 790, width: 16, height: 30 }, true],
      ["a control touching the stack's top edge leaves the stack at the bottom", { left: 100, top: 728, width: 100, height: 30 }, false],
      ["a control overlapping the stack's top edge by a pixel moves the stack", { left: 100, top: 729, width: 100, height: 30 }, true],
      ["a control touching the stack's bottom edge leaves the stack at the bottom", { left: 100, top: 828, width: 100, height: 30 }, false],
      ["a control overlapping the stack's bottom edge by a pixel moves the stack", { left: 100, top: 827, width: 100, height: 30 }, true],
    ])("%s", async (_, rect, moves) => {
      const bar = setup();
      control("edge", rect);
      await tab("edge");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe(moves ? "top" : null);
    });

    it.each([
      ["a column's left edge", 17],
      ["the column's middle", 195],
      ["the column's right edge", 373],
    ])("counts a header over %s, which the stack moves below", async (_, left) => {
      const bar = setup();
      header({ left, top: 0, width: 1, height: 100 });
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("116px");
    });

    it("counts a fixed header over the column, and moves the stack below it", async () => {
      const bar = setup();
      header({ left: 0, top: 0, width: 390, height: 100 });
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("116px");
    });

    it("counts a fixed bar below the window's top edge whose child reaches it, and moves the stack below the bar", async () => {
      const bar = setup();
      const lower = header({ left: 0, top: 40, width: 390, height: 40 });
      const reach = document.createElement("div");
      reach.style.cssText = "position: absolute; left: 0; top: -40px; width: 390px; height: 10px;";
      lower.append(reach);
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("96px");
    });

    it("counts a sticky header at the window's top, and moves the stack below it", async () => {
      const bar = setup();
      const sticky = document.createElement("div");
      sticky.style.cssText = "position: sticky; top: 0; height: 100px;";
      document.body.prepend(sticky);
      added.push(sticky);
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("116px");
    });

    it("moves the stack below the lowest header at the top edge when two overlap", async () => {
      const bar = setup();
      header({ left: 0, top: 0, width: 390, height: 40 });
      header({ left: 0, top: 0, width: 390, height: 100 });
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("116px");
    });

    it("does not count a fixed header outside the stack's column", async () => {
      const bar = setup();
      header({ left: 380, top: 0, width: 10, height: 760 });
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("16px");
    });

    it("does not count a fixed header that is hidden", async () => {
      const bar = setup();
      header("position: fixed; left: 0; top: 0; width: 390px; height: 760px; visibility: hidden;");
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("16px");
    });

    it("does not count a fixed header that is hidden, even when a visible child sits under the point", async () => {
      const bar = setup();
      const hidden = header("position: fixed; left: 0; top: 0; width: 390px; height: 760px; visibility: hidden;");
      const child = document.createElement("div");
      child.style.cssText = "visibility: visible; height: 20px;";
      hidden.append(child);
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("16px");
    });

    it("does not count the toaster's own elements at the window's top edge", async () => {
      const bar = setup();
      const own = document.createElement("div");
      bar.append(own);
      own.style.cssText = "position: fixed; top: 0; left: 16px; width: 358px; height: 60px;";
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(movedTop(bar)).toBe("16px");
    });

    it("does not treat a control inside the stack as a control to move the stack for", async () => {
      const bar = setup();
      const inside = document.createElement("button");
      inside.dataset.case = "inside";
      inside.textContent = "Undo";
      inside.style.cssText = "position: absolute; left: 0; top: 0;";
      bar.querySelector('[data-ouro="toast"]')!.append(inside);
      await tab("inside");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("does not move the stack for a pointer's focus on a control it covers", async () => {
      const bar = setup();
      const field = pointerControl("pointer", { left: 100, top: 752, width: 100, height: 17 });
      await userEvent.click(field);
      await frames(3);
      expect(document.activeElement).toBe(field);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("does not move the stack for a pointer's press on a text field it covers, which :focus-visible shows as keyboard focus", async () => {
      const bar = setup();
      const field = control("field", COVERED, "input");
      await userEvent.click(field);
      await frames(3);
      expect(document.activeElement).toBe(field);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("moves the stack for keyboard focus on a control it covers after a pointer press", async () => {
      const bar = setup();
      control("covered", COVERED);
      const field = control("field", MIDDLE, "input");
      await userEvent.click(field);
      await frames(3);
      await pressTab({ shift: true });
      expect(document.activeElement).toBe(caseOf("covered"));
      await frames();
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
    });

    it("moves the stack for a control it covers that a script focuses before anyone presses a key or a pointer", async () => {
      const bar = setup();
      control("covered", COVERED);
      caseOf("covered").focus();
      await frames();
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
    });

    it("reads each element of the window's top edge once a measure, though several points sit under it", async () => {
      setup();
      const top = header({ left: 0, top: 0, width: 390, height: 100 });
      control("covered", COVERED);
      const points = vi.spyOn(document, "elementsFromPoint");
      const styles = vi.spyOn(window, "getComputedStyle");
      await tab("covered");
      advance(FADE_MS);
      // Each measure asks six points what is under them, and reads the header once.
      const measures = points.mock.calls.length / 6;
      expect(measures).toBeGreaterThan(0);
      expect(styles.mock.calls.filter(([node]) => node === top)).toHaveLength(measures);
      vi.restoreAllMocks();
    });
  });

  describe("settling", () => {
    it("moves back to the bottom only once the stack has rested for the settle time from its last move", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("middle", MIDDLE);
      await tab("covered");
      advance(FADE_MS);
      await tab("middle");
      advance(SETTLE_MS - 1);
      expect(stateOf(bar).moved).toBe("top");
      advance(1);
      expect(stateOf(bar).fading).toBe(true);
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
      expect(movedTop(bar)).toBe("");
    });

    it("measures the settle time from each landing, so an earlier move's timer does not end a later rest", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("top", TOP);
      control("covered-again", COVERED);
      control("middle", MIDDLE);
      await tab("covered");
      advance(FADE_MS);
      advance(200);
      await tab("top");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBeNull();
      await tab("covered-again");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
      await tab("middle");
      advance(SETTLE_MS - FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
      advance(FADE_MS);
      expect(stateOf(bar).fading).toBe(true);
    });

    it("forgets it has rested on each landing, so a rest that began before a move does not carry over", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("top", TOP);
      control("covered-again", COVERED);
      control("middle", MIDDLE);
      await tab("covered");
      advance(FADE_MS);
      advance(SETTLE_MS);
      await tab("top");
      advance(FADE_MS);
      await tab("covered-again");
      advance(FADE_MS);
      await tab("middle");
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("keeps a stack at the top for a pointer's focus on a control it covers, once it has rested", async () => {
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      advance(SETTLE_MS);
      const field = pointerControl("pointer", { left: 100, top: 30, width: 100, height: 30 });
      await userEvent.click(field);
      await frames(3);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("looks again once the stack lands, for focus that moved under its new place during the fade", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("top", TOP);
      await tab("covered");
      expect(stateOf(bar).fading).toBe(true);
      await tab("top");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: true, edge: "top" });
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("does not move a stack that has moved back to the bottom again once it has rested", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("top", TOP);
      await tab("covered");
      advance(FADE_MS);
      await tab("top");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBeNull();
      advance(SETTLE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("moves back on the frame after focus falls to nothing, once the stack has rested", async () => {
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      advance(SETTLE_MS);
      (document.activeElement as HTMLElement).blur();
      await frames();
      expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("stays at the top when focus moves to another control the bottom stack covers, once it has rested", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("covered-too", { left: 100, top: 800, width: 100, height: 20 });
      await tab("covered");
      advance(FADE_MS);
      advance(SETTLE_MS);
      await tab("covered-too");
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("stays at the top when focus moves to a control only the full stack at the bottom covers, once it has rested", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("peek", { left: 100, top: 752, width: 100, height: 17 });
      await tab("covered");
      advance(FADE_MS);
      advance(SETTLE_MS);
      await tab("peek");
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("moves the stack again for a control it covers once it has come back to the bottom", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("middle", MIDDLE);
      control("covered-again", { left: 100, top: 800, width: 100, height: 20 });
      await tab("covered");
      advance(FADE_MS);
      await tab("middle");
      advance(SETTLE_MS);
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBeNull();
      await tab("covered-again");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("does not move the stack for focus that changes while no toast is laid out", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("middle", MIDDLE);
      await tab("covered");
      advance(FADE_MS);
      advance(SETTLE_MS);
      for (const toast of bar.querySelectorAll('[data-ouro="toast"]')) toast.remove();
      await tab("middle");
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });
  });

  it("does not decide at focusout when focus moves to another control, but once focus has landed on it", async () => {
    const bar = setup();
    control("covered", COVERED);
    control("middle", MIDDLE);
    await tab("covered");
    advance(FADE_MS);
    advance(SETTLE_MS);
    expect(stateOf(bar).moved).toBe("top");
    caseOf("middle").focus();
    expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    await frames();
    expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
  });

  it("does not move for focus that falls to nothing and lands on a control the bottom covers in the same task", async () => {
    const bar = setup();
    control("covered", COVERED);
    await tab("covered");
    advance(FADE_MS);
    advance(SETTLE_MS);
    expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    // A press blurs the control and focuses the next one before any frame; the stack looks once focus has landed.
    (document.activeElement as HTMLElement).blur();
    caseOf("covered").focus();
    await frames();
    expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
  });

  describe("the fade", () => {
    it("lands a move on the viewport's own opacity transition, without waiting for the fallback", async () => {
      const bar = setup();
      bar.style.transition = "";
      control("covered", COVERED);
      await tab("covered");
      expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
      bar.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName: "opacity" }));
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("does not land on a transition of a toast in the stack, nor on another property of the viewport", async () => {
      const bar = setup();
      bar.style.transition = "";
      control("covered", COVERED);
      await tab("covered");
      bar.querySelector('[data-ouro="toast"]')!.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName: "opacity" }));
      bar.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName: "transform" }));
      expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
      expect(bar.hasAttribute("data-ouro-toaster-moved")).toBe(false);
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
    });

    it("lands a move after the fallback time when no transition ends", async () => {
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS - 1);
      expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
      advance(1);
      expect(stateOf(bar).moved).toBe("top");
    });

    it("lands a move on the next frame when no fade starts, without waiting for the fallback", async () => {
      const bar = setup();
      bar.style.transition = "none";
      control("covered", COVERED);
      const fades: boolean[] = [];
      const watcher = new MutationObserver(() => fades.push(bar.hasAttribute("data-ouro-toaster-fading")));
      watcher.observe(bar, { attributes: true, attributeFilter: ["data-ouro-toaster-fading"] });
      // The fake clock never moves, so the fallback never runs.
      await tab("covered");
      await frames();
      watcher.disconnect();
      expect(fades).toEqual([true, false]);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("lands a move on the next frame when only another property of the viewport transitions", async () => {
      const bar = setup();
      bar.style.transition = "transform 60s";
      const style = document.createElement("style");
      style.textContent = "[data-ouro-toaster-fading] { transform: translateY(1px); }";
      document.head.append(style);
      added.push(style);
      control("covered", COVERED);
      await tab("covered");
      await frames();
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("does not land a move on a frame after the keeper lets go mid-fade", async () => {
      const bar = setup();
      bar.style.transition = "none";
      control("covered", COVERED);
      const held = holdFrames();
      await pressTab();
      held.until(() => bar.hasAttribute("data-ouro-toaster-fading"));
      handle!.release();
      handle = undefined;
      held.step();
      held.step();
      held.release();
      expect(bar.hasAttribute("data-ouro-toaster-moved")).toBe(false);
    });

    it("does not land a move on the cancel of the last landing's fade-in, which a new move causes", async () => {
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      bar.dispatchEvent(new TransitionEvent("transitioncancel", { bubbles: true, propertyName: "opacity" }));
      expect(bar.hasAttribute("data-ouro-toaster-fading")).toBe(true);
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: "top", collapsed: false, fading: false, edge: "top" });
    });

    it("does not start a second fade while one is fading", async () => {
      const bar = setup();
      control("covered", COVERED);
      control("covered-too", { left: 100, top: 795, width: 100, height: 20 });
      await tab("covered");
      const changes: string[] = [];
      const watcher = new MutationObserver((records) => changes.push(...records.map((record) => String(record.attributeName))));
      watcher.observe(bar, { attributes: true, attributeFilter: ["data-ouro-toaster-fading", "data-ouro-toaster-moved"] });
      await tab("covered-too");
      watcher.disconnect();
      expect(changes).toEqual([]);
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
    });
  });

  describe("the padding", () => {
    it("gives the page's scroll padding the stack's height and its bottom gap while the stack is at the bottom", () => {
      setup();
      expect(padding()).toBe("86px");
    });

    it("gives the page's own padding back while the stack is at the top, and its own again at the bottom", async () => {
      document.documentElement.style.scrollPaddingBottom = "7px";
      const bar = setup();
      expect(padding()).toBe("86px");
      control("covered", COVERED);
      control("top", TOP);
      await tab("covered");
      advance(FADE_MS);
      expect(padding()).toBe("7px");
      await tab("top");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBeNull();
      expect(padding()).toBe("86px");
    });

    it("measures the stack again when refreshed, so the padding follows the front toast's height", () => {
      setup();
      const front = document.querySelector<HTMLElement>('[data-ouro="toast"]')!;
      front.style.height = "100px";
      front.style.bottom = "0";
      handle!.refresh();
      expect(padding()).toBe("116px");
    });

    it("ignores a toast that is not displayed when it measures the stack", () => {
      const bar = setup();
      toast(bar, "display: none; bottom: 0; left: 0; width: 358px; height: 58px;");
      handle!.refresh();
      expect(padding()).toBe("86px");
    });

    it("keeps the page's own padding while no toast is laid out", () => {
      document.documentElement.style.scrollPaddingBottom = "7px";
      const bar = setup({ toasts: 0 });
      expect(bar.querySelectorAll('[data-ouro="toast"]')).toHaveLength(0);
      expect(padding()).toBe("7px");
    });

    it("keeps the page's own padding to give back when it is refreshed twice before it is released", () => {
      document.documentElement.style.scrollPaddingBottom = "7px";
      setup();
      handle!.refresh();
      handle!.refresh();
      handle!.release();
      expect(padding()).toBe("7px");
    });
  });

  describe("without an active element", () => {
    it("decides nothing while the document reports no active element", () => {
      const bar = setup();
      Object.defineProperty(document, "activeElement", { configurable: true, get: () => null });
      try {
        document.dispatchEvent(new FocusEvent("focusout"));
        handle!.refresh();
        expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
      } finally {
        delete (document as { activeElement?: Element | null }).activeElement;
      }
    });
  });

  describe("releasing", () => {
    it("lets go of the page: restores its padding, moves the stack back to the bottom and clears its state", async () => {
      document.documentElement.style.scrollPaddingBottom = "7px";
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(stateOf(bar).moved).toBe("top");
      handle!.release();
      expect(padding()).toBe("7px");
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
      expect(movedTop(bar)).toBe("");
    });

    it("stops a move that is fading when it is released, so nothing lands after", async () => {
      const bar = setup();
      control("covered", COVERED);
      await tab("covered");
      handle!.release();
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("stops its settle timer when it is released, so a later rest moves nothing", async () => {
      const bar = setup();
      control("top", TOP);
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      handle!.release();
      await pressTab({ shift: true });
      await pressTab();
      await frames();
      advance(SETTLE_MS);
      await frames();
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("does not decide for a frame still pending when it is released", async () => {
      const bar = setup();
      control("covered", COVERED);
      await pressTab();
      handle!.release();
      await frames(3);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });

    it("stops listening to focus, the window's size and the viewport's transitions when it is released", async () => {
      document.documentElement.style.scrollPaddingBottom = "7px";
      const bar = setup();
      handle!.release();
      window.dispatchEvent(new Event("resize"));
      bar.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName: "opacity" }));
      expect(padding()).toBe("7px");
      control("covered", COVERED);
      await tab("covered");
      advance(FADE_MS);
      expect(stateOf(bar)).toEqual({ moved: null, collapsed: false, fading: false, edge: "bottom" });
    });
  });
});
