import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Item } from "~/components/ouro/item/item";
import { SwipeActions, type SwipeActionsProps } from "~/components/ouro/swipe-actions/swipe-actions";
import { rubberband } from "~/lib/ouro/spring";
import { act } from "~/lib/ouro/testing/act";
import { holdFrames, type HeldFrames } from "~/lib/ouro/testing/frames";

// Real touch swipes are in swipe-actions.touch.test.tsx. Here the pointer events are
// dispatched, so the same paths run in Chromium and WebKit, with a pen and a mouse too,
// and each event carries a time the test sets, so a release is as fast or slow as it says.

let root: Root | undefined;
let host: HTMLElement;
const nodes: Element[] = [];

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error");
});
/** Animation frames, when a test holds them still to look at a spring mid-flight. */
let frames: HeldFrames | undefined;
const freeze = () => (frames ??= holdFrames());
afterEach(async () => {
  frames?.release();
  frames = undefined;
  await act(async () => root?.unmount());
  root = undefined;
  for (const node of nodes.splice(0)) node.remove();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  history.replaceState(null, "", location.pathname + location.search);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

async function render(node: ReactNode, dir?: "rtl") {
  if (!root) {
    host = document.createElement("div");
    host.style.width = "360px";
    host.dir = dir ?? "ltr";
    document.body.append(host);
    nodes.push(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(node));
  return host.querySelector<HTMLElement>('[data-ouro="swipe-actions"]')!;
}

const calls = () => ({ pin: vi.fn(), archive: vi.fn(), remove: vi.fn() });

function row(spies = calls(), props: Partial<SwipeActionsProps> = {}) {
  return (
    <SwipeActions
      label="Short ribs"
      leading={[{ label: "Pin", tone: "primary", onClick: spies.pin }]}
      trailing={[
        { label: "Delete", tone: "destructive", onClick: spies.remove },
        { label: "Archive", onClick: spies.archive },
      ]}
      {...props}
    >
      <Item href="#short-ribs" title="Short ribs" />
    </SwipeActions>
  );
}

/**
 * Rounds to hundredths of a px: a style serializes fewer decimals than a measured width has. Halves
 * round away from zero, so an offset of -147.625 and a width of 147.625 agree (Math.round takes
 * -14762.5 to -14762), as they did not with the fonts of Playwright's image.
 */
const hundredths = (value: number) => (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
const track = (element: HTMLElement) => element.querySelector<HTMLElement>("[data-ouro-swipe-actions-track]")!;
const content = (element: HTMLElement) => element.querySelector<HTMLElement>("[data-ouro-swipe-actions-content]")!;
const strip = (element: HTMLElement, side: "leading" | "trailing") => element.querySelector<HTMLElement>(`[data-ouro-swipe-actions-side="${side}"]`);
const action = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll<HTMLButtonElement>("[data-ouro-swipe-actions-side] button")].find((button) => button.textContent === name)!;
const menuButton = (element: HTMLElement) => element.querySelector<HTMLButtonElement>("[data-ouro-swipe-actions-menu] button")!;
/** The offset the component set on the track, in px. */
const offset = (element: HTMLElement) => hundredths(Number.parseFloat(/translateX\((.+)px\)/.exec(track(element).style.transform)?.[1] ?? "0"));
/** Waits for the row to come to rest after a release. */
/** Brings every spring to rest: steps the frames a test holds and gives them back, or waits for real ones. */
const rest = async (element: HTMLElement) => {
  if (!frames) return expect.poll(() => element.hasAttribute("data-ouro-settling")).toBe(false);
  frames.until(() => !element.hasAttribute("data-ouro-settling"));
  frames.release();
  frames = undefined;
};
const width = (element: HTMLElement, side: "leading" | "trailing") => hundredths(strip(element, side)!.getBoundingClientRect().width);

/** The time the next dispatched event carries, in ms. */
let clock = 1000;
/** This fixture's touch is distinct from the native mouse it interleaves. */
const syntheticPointerId = 1001;
/** Lets `ms` pass before the next event: 16 is a finger still moving, 300 one that has rested. */
const wait = (ms: number) => {
  clock += ms;
};

/** Dispatches one pointer event, as a one-finger touch unless `init` says otherwise, and flushes React. */
async function pointer(target: EventTarget, type: string, x: number, y: number, init: PointerEventInit = {}) {
  await act(async () => {
    // While the pointer is down its button is held, as a real one's is.
    const buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0;
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: syntheticPointerId, pointerType: "touch", isPrimary: true, buttons, clientX: x, clientY: y, ...init });
    Object.defineProperty(event, "timeStamp", { value: clock });
    target.dispatchEvent(event);
  });
}

/**
 * A swipe by `dx` from (200, 20) on the row's content: down, four moves 16ms apart and
 * (unless `hold`) up. The finger rests before it lifts, so the distance decides, unless
 * `flick`, when it lifts while moving. Waits for the row to come to rest.
 */
async function swipe(element: HTMLElement, dx: number, { hold = false, flick = false, init = {} as PointerEventInit } = {}) {
  wait(1000);
  await pointer(content(element), "pointerdown", 200, 20, init);
  for (let step = 1; step <= 4; step++) {
    wait(16);
    await pointer(window, "pointermove", 200 + (dx * step) / 4, 20, init);
  }
  if (hold) return;
  wait(flick ? 16 : 300);
  // The spring runs on frames the test steps, 16ms apart, so it settles the same on any machine.
  freeze();
  await pointer(window, "pointerup", 200 + dx, 20, init);
  await rest(element);
}

/** Moves the held finger from `from` to `to` px left of where it began, in eight moves 16ms apart: longer than the 100ms a velocity is read over. */
async function slide(from: number, to: number) {
  for (let step = 1; step <= 8; step++) {
    wait(16);
    await pointer(window, "pointermove", 200 - (from + ((to - from) * step) / 8), 20);
  }
}

/** A click as a pointer sends it (`detail` 1) or as the keyboard does (`detail` 0); returns whether its default was prevented. */
async function click(target: Element, detail: number) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
  // Keep a click the row lets through from changing the test page's address.
  const guard = (bubbled: Event) => {
    seen = true;
    prevented = bubbled.defaultPrevented;
    bubbled.preventDefault();
  };
  let seen = false;
  let prevented = false;
  document.addEventListener("click", guard);
  await act(async () => {
    target.dispatchEvent(event);
  });
  document.removeEventListener("click", guard);
  return { reached: seen, prevented: seen ? prevented : event.defaultPrevented };
}

describe("SwipeActions", () => {
  it("renders the row closed, with both sides out of reach and an actions button named after the row", async () => {
    const element = await render(row());
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(page.getByRole("link", { name: "Short ribs" }).element()).toBeTruthy();
    expect(strip(element, "leading")!.inert).toBe(true);
    expect(strip(element, "trailing")!.inert).toBe(true);
    expect(menuButton(element).getAttribute("aria-label")).toBe("Actions for Short ribs");
    expect(menuButton(element).getBoundingClientRect().width).toBeGreaterThan(20);
    // The hidden sides are clipped: they widen neither the page nor the row, and the row cannot scroll to them.
    expect(getComputedStyle(element).overflowX).toBe("clip");
    expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);
    element.scrollLeft = 50;
    expect(element.scrollLeft).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("names the actions button from actionsLabel", async () => {
    const element = await render(row(calls(), { actionsLabel: "Actions pour {label}" }));
    expect(menuButton(element).getAttribute("aria-label")).toBe("Actions pour Short ribs");
  });

  it("gives every action to the keyboard through the actions menu, leading first", async () => {
    const spies = calls();
    const element = await render(row(spies));
    // A side left open by a swipe closes when the menu opens.
    await swipe(element, -120);
    expect(element.getAttribute("data-open")).toBe("trailing");
    menuButton(element).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => element.hasAttribute("data-open")).toBe(false);
    await expect.element(page.getByRole("menu")).toBeVisible();
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items.slice(0, 3)).toEqual(["Pin", "Delete", "Archive"]);
    expect(page.getByRole("menuitem", { name: "Delete" }).element().getAttribute("data-tone")).toBe("destructive");
    expect(page.getByRole("menuitem", { name: "Pin" }).element().hasAttribute("data-tone")).toBe(false);
    await userEvent.click(page.getByRole("menuitem", { name: "Archive" }));
    expect(spies.archive).toHaveBeenCalledTimes(1);
    expect(spies.remove).not.toHaveBeenCalled();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
  });

  it("colors each action by its tone, the side by its primary action, and falls back to secondary", async () => {
    const element = await render(
      <SwipeActions
        label="Short ribs"
        trailing={[
          { label: "Delete", tone: "destructive", onClick: () => {} },
          { label: "Done", tone: "success", onClick: () => {} },
          { label: "Snooze", tone: "warning", onClick: () => {} },
          { label: "More", onClick: () => {} },
        ]}
      >
        Row
      </SwipeActions>,
    );
    const probe = document.createElement("div");
    host.append(probe);
    const color = (className: string) => {
      probe.className = className;
      return getComputedStyle(probe).backgroundColor;
    };
    expect(getComputedStyle(action(element, "Delete")).backgroundColor).toBe(color("bg-destructive"));
    expect(getComputedStyle(action(element, "Done")).backgroundColor).toBe(color("bg-success"));
    expect(getComputedStyle(action(element, "Snooze")).backgroundColor).toBe(color("bg-warning"));
    expect(getComputedStyle(action(element, "More")).backgroundColor).toBe(color("bg-secondary"));
    expect(getComputedStyle(strip(element, "trailing")!).backgroundColor).toBe(color("bg-destructive"));
    expect(action(element, "Delete").hasAttribute("data-primary")).toBe(true);
    expect(action(element, "More").hasAttribute("data-primary")).toBe(false);
    // No leading actions: no leading side.
    expect(strip(element, "leading")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("opens a side with a dispatched touch swipe past half its width, and closes it with a swipe back", async () => {
    const element = await render(row());
    await swipe(element, -120);
    expect(element.getAttribute("data-open")).toBe("trailing");
    await expect.poll(() => offset(element)).toBe(-width(element, "trailing"));
    expect(strip(element, "trailing")!.inert).toBe(false);
    expect(strip(element, "trailing")!.hasAttribute("data-open")).toBe(true);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    // A small move while open leaves it open; a move back past half closes it.
    await swipe(element, 20);
    expect(element.getAttribute("data-open")).toBe("trailing");
    await expect.poll(() => offset(element)).toBe(-width(element, "trailing"));
    await swipe(element, 120);
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
  });

  it("swipes with a pen, and never with a mouse", async () => {
    const element = await render(row());
    await swipe(element, -120, { init: { pointerType: "mouse" } });
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    await swipe(element, 90, { init: { pointerType: "pen" } });
    expect(element.getAttribute("data-open")).toBe("leading");
    await expect.poll(() => offset(element)).toBe(width(element, "leading"));
  });

  it("marks the row while a finger drags it and follows the finger", async () => {
    const element = await render(row());
    // At rest the row has no layer of its own; it gets one while it moves.
    expect(getComputedStyle(track(element)).willChange).toBe("auto");
    await swipe(element, -60, { hold: true });
    expect(element.hasAttribute("data-dragging")).toBe(true);
    expect(getComputedStyle(track(element)).willChange).toBe("transform");
    // The transform is on the track itself, 1:1 with the finger, with no transition to lag behind it.
    expect(track(element).style.transform).toBe("translateX(-60px)");
    expect(track(element).style.getPropertyValue("--ouro-swipe-x")).toBe("");
    expect(getComputedStyle(track(element)).transitionDuration).toBe("0s");
    await pointer(window, "pointermove", 200 - 137, 20);
    expect(offset(element)).toBe(-137);
    // Past the row's own width it resists: 540px beyond moves it a part of that, not none.
    await pointer(window, "pointermove", 200 - 900, 20);
    expect(offset(element)).toBeCloseTo(-(360 + rubberband(540, 360)), 2);
    expect(offset(element)).toBeLessThan(-360);
    expect(element.hasAttribute("data-full")).toBe(true);
    await pointer(window, "pointermove", 200 + 900, 20);
    expect(offset(element)).toBeCloseTo(360 + rubberband(540, 360), 2);
    await pointer(window, "pointermove", 200, 20);
    expect(offset(element)).toBe(0);
    wait(300);
    await pointer(window, "pointerup", 200, 20);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    expect(element.hasAttribute("data-full")).toBe(false);
  });

  it("opens on a short flick toward the actions and closes on a flick back, whatever the distance", async () => {
    const element = await render(row());
    // 24px, far short of half the actions' width, but the finger was still moving when it lifted.
    await swipe(element, -24, { flick: true });
    expect(element.getAttribute("data-open")).toBe("trailing");
    expect(offset(element)).toBe(-width(element, "trailing"));
    // The same 24px with a finger that rested first: the distance decides, and it stays as it was.
    await swipe(element, 24);
    expect(element.getAttribute("data-open")).toBe("trailing");
    await swipe(element, 24, { flick: true });
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(offset(element)).toBe(0);
  });

  it("goes by the direction the finger was moving at release, not by how far it had gone", async () => {
    const element = await render(row());
    // Out to 140px, well past half, then flicked back toward closed.
    await swipe(element, -140, { hold: true });
    await slide(140, 110);
    wait(16);
    await pointer(window, "pointerup", 200 - 110, 20);
    expect(element.hasAttribute("data-open")).toBe(false);
    await rest(element);
    expect(offset(element)).toBe(0);
  });

  it("does not run the primary action when a full swipe is flicked back, and opens the side instead of nothing", async () => {
    const spies = calls();
    const element = await render(row(spies));
    await swipe(element, -300, { hold: true });
    expect(element.hasAttribute("data-full")).toBe(true);
    await slide(300, 250);
    expect(element.hasAttribute("data-full")).toBe(true);
    wait(16);
    await pointer(window, "pointerup", 200 - 250, 20);
    expect(spies.remove).not.toHaveBeenCalled();
    expect(element.hasAttribute("data-open")).toBe(false);
    await rest(element);
    // A flick never runs an action by itself either: a short fast one only opens the row.
    await swipe(element, -40, { flick: true });
    expect(spies.remove).not.toHaveBeenCalled();
    expect(element.getAttribute("data-open")).toBe("trailing");
  });

  it("springs to rest from where the finger left it, past the target after a flick and never after a slow release", async () => {
    const element = await render(row());
    const open = -width(element, "trailing");
    /** Lets go at `x` after `ms` and returns where the row is at each 16ms frame until it rests. */
    const settle = async (x: number, ms: number) => {
      wait(ms);
      freeze();
      await pointer(window, "pointerup", x, 20);
      const seen = [offset(element)];
      while (element.hasAttribute("data-ouro-settling")) {
        frames!.step(16);
        seen.push(offset(element));
      }
      await rest(element);
      return seen;
    };
    await swipe(element, -100, { hold: true });
    const flicked = await settle(100, 16);
    // The spring starts where the finger let go, and its first frame is near there, not a jump to the end.
    expect(flicked[0]).toBe(-100);
    expect(Math.abs(flicked[1]! - -100)).toBeLessThan(60);
    // The flick's speed carried on into the spring: it passed the open position and came back to it.
    expect(Math.min(...flicked)).toBeLessThan(open - 1);
    expect(flicked.at(-1)).toBe(open);

    await swipe(element, 100, { hold: true });
    const placed = await settle(300, 300);
    // A slow release closes without passing closed, one frame closer each time.
    expect(placed[0]).toBe(hundredths(open + 100));
    expect(Math.max(...placed)).toBeLessThanOrEqual(0);
    for (let index = 1; index < placed.length; index++) expect(placed[index]!).toBeGreaterThanOrEqual(placed[index - 1]!);
    expect(placed.at(-1)).toBe(0);
    expect(placed.length).toBeGreaterThan(6);
  });

  it("can be caught by a new swipe while it springs to rest, and carries on from there", async () => {
    const element = await render(row());
    const open = -width(element, "trailing");
    await swipe(element, -120, { hold: true });
    wait(300);
    freeze();
    await pointer(window, "pointerup", 80, 20);
    expect(element.hasAttribute("data-ouro-settling")).toBe(true);
    expect(getComputedStyle(track(element)).willChange).toBe("transform");
    frames!.until(() => offset(element) < -121);
    expect(offset(element)).toBeGreaterThan(open);
    // A press stops it there, under the finger, before the finger has moved.
    wait(1000);
    await pointer(content(element), "pointerdown", 200, 20);
    expect(element.hasAttribute("data-ouro-settling")).toBe(false);
    const caught = offset(element);
    expect(caught).toBeLessThan(-120);
    expect(caught).toBeGreaterThan(open);
    frames!.step(32);
    expect(offset(element)).toBe(caught);
    // Once the press is a swipe, the row is the finger's again, from where it was caught.
    wait(16);
    await pointer(window, "pointermove", 188, 20);
    expect(element.hasAttribute("data-ouro-settling")).toBe(false);
    expect(element.hasAttribute("data-dragging")).toBe(true);
    frames!.step(32);
    // Nothing but the finger moves it now, 1:1: no frame does.
    expect(offset(element)).toBe(hundredths(caught - 12));
    wait(16);
    await pointer(window, "pointermove", 180, 20);
    expect(offset(element)).toBe(hundredths(caught - 20));
    wait(300);
    await pointer(window, "pointerup", 180, 20);
    await rest(element);
    expect(offset(element)).toBe(open);

    // Mid-settle a tap, or a touch that turns into a scroll, stops the row only for as long as it lasts: the row then goes on its way.
    for (const end of ["tap", "scroll"]) {
      await swipe(element, 60, { hold: true });
      wait(300);
      freeze();
      await pointer(window, "pointerup", 260, 20);
      frames!.step(16);
      expect(element.hasAttribute("data-ouro-settling")).toBe(true);
      wait(1000);
      await pointer(content(element), "pointerdown", 200, 20);
      expect(element.hasAttribute("data-ouro-settling"), end).toBe(false);
      const stopped = offset(element);
      expect(stopped).toBeGreaterThan(open);
      if (end === "tap") await pointer(window, "pointerup", 200, 20);
      else await pointer(window, "pointermove", 202, 60);
      expect(element.hasAttribute("data-ouro-settling"), end).toBe(true);
      expect(offset(element), end).toBe(stopped);
      await rest(element);
      expect(offset(element), end).toBe(open);
      expect(element.getAttribute("data-open")).toBe("trailing");
    }
  });

  it("leaves a row a mouse presses to finish springing: a mouse does not swipe", async () => {
    const element = await render(row());
    await swipe(element, -120, { hold: true });
    wait(300);
    freeze();
    await pointer(window, "pointerup", 80, 20);
    frames!.step(16);
    await pointer(content(element), "pointerdown", 200, 20, { pointerType: "mouse" });
    expect(element.hasAttribute("data-ouro-settling")).toBe(true);
    await pointer(window, "pointerup", 200, 20, { pointerType: "mouse" });
    await rest(element);
    expect(offset(element)).toBe(-width(element, "trailing"));
  });

  it("captures the pointer once the swipe is the row's, not before", async () => {
    const element = await render(row());
    const capture = vi.spyOn(element, "setPointerCapture");
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointermove", 194, 20);
    expect(capture).not.toHaveBeenCalled();
    await pointer(window, "pointermove", 180, 20);
    expect(capture.mock.calls).toEqual([[syntheticPointerId]]);
    await pointer(window, "pointermove", 160, 20);
    expect(capture).toHaveBeenCalledTimes(1);
    wait(300);
    await pointer(window, "pointerup", 160, 20);
    // A vertical move, the page's scroll, captures nothing.
    capture.mockClear();
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointermove", 202, 60);
    expect(capture).not.toHaveBeenCalled();
  });

  it("stops moving when it unmounts while it springs to rest", async () => {
    const element = await render(row());
    freeze();
    const cancelled = vi.spyOn(window, "cancelAnimationFrame");
    await swipe(element, -120, { hold: true });
    wait(300);
    await pointer(window, "pointerup", 80, 20);
    expect(element.hasAttribute("data-ouro-settling")).toBe(true);
    await act(async () => root!.unmount());
    root = undefined;
    expect(cancelled).toHaveBeenCalled();
  });

  it("runs the primary action on a full swipe of either side", async () => {
    const spies = calls();
    const element = await render(row(spies));
    await swipe(element, -300);
    expect(spies.remove).toHaveBeenCalledTimes(1);
    expect(spies.archive).not.toHaveBeenCalled();
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
    await swipe(element, 300);
    expect(spies.pin).toHaveBeenCalledTimes(1);
  });

  it("carries a full swipe's speed into the close: the row goes on outward a moment, then comes back", async () => {
    const spies = calls();
    const element = await render(row(spies));
    await swipe(element, -300, { hold: true });
    expect(element.hasAttribute("data-full")).toBe(true);
    wait(16);
    freeze();
    await pointer(window, "pointerup", -100, 20);
    expect(spies.remove).toHaveBeenCalledTimes(1);
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(offset(element)).toBe(-300);
    // Let go while moving outward fast, it does not turn round on the spot.
    frames!.step(16);
    expect(offset(element)).toBeLessThan(-310);
    await rest(element);
    expect(offset(element)).toBe(0);
  });

  it("follows the finger with reduced motion too, with the actions in sight, and jumps to rest on release", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const spies = calls();
    const element = await render(row(spies));
    await swipe(element, -60, { hold: true });
    // Following a finger is not an animation.
    expect(track(element).style.transform).toBe("translateX(-60px)");
    expect(getComputedStyle(strip(element, "trailing")!).opacity).toBe("1");
    await pointer(window, "pointermove", 200 - 250, 20);
    // So a full swipe shows what it is about to do before it does it.
    expect(offset(element)).toBe(-250);
    expect(element.hasAttribute("data-full")).toBe(true);
    await pointer(window, "pointermove", 200 - 100, 20);
    wait(300);
    const asked = vi.spyOn(window, "requestAnimationFrame");
    await pointer(window, "pointerup", 100, 20);
    // No spring: the row is open, at rest, at once.
    expect(element.getAttribute("data-open")).toBe("trailing");
    expect(element.hasAttribute("data-ouro-settling")).toBe(false);
    expect(offset(element)).toBe(-width(element, "trailing"));
    expect(asked).not.toHaveBeenCalled();
    expect(spies.remove).not.toHaveBeenCalled();
  });

  it("does not open toward a side with no actions", async () => {
    const spies = calls();
    const element = await render(row(spies, { leading: undefined }));
    await swipe(element, 300, { hold: true });
    // The row gives a little, so the finger is not pushing on a wall, and it is never a full swipe.
    expect(offset(element)).toBeCloseTo(rubberband(300, 360), 2);
    expect(offset(element)).toBeLessThan(150);
    expect(element.hasAttribute("data-full")).toBe(false);
    wait(16);
    await pointer(window, "pointerup", 500, 20);
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(spies.remove).not.toHaveBeenCalled();
    // It springs back to closed.
    await rest(element);
    expect(offset(element)).toBe(0);
  });

  it("reads the same gesture mirrored in a right-to-left page", async () => {
    const spies = calls();
    const element = await render(row(spies, { leading: undefined }), "rtl");
    await swipe(element, 120);
    expect(element.getAttribute("data-open")).toBe("trailing");
    await expect.poll(() => offset(element)).toBe(width(element, "trailing"));
    // Toward the end, where there are no actions, nothing opens.
    await swipe(element, -300);
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
  });

  it("leaves a vertical move to the page and ignores what follows it", async () => {
    const element = await render(row());
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointermove", 204, 24);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    await pointer(window, "pointermove", 206, 60);
    // The gesture is the page's now: a later sideways move does nothing.
    await pointer(window, "pointermove", 60, 60);
    await pointer(window, "pointerup", 60, 60);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
  });

  it("treats a press that barely moves as a tap", async () => {
    const element = await render(row());
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointermove", 195, 22);
    await pointer(window, "pointerup", 195, 22);
    expect(element.hasAttribute("data-open")).toBe(false);
    // The tap's click reaches the link.
    expect(await click(page.getByRole("link", { name: "Short ribs" }).element(), 1)).toEqual({ reached: true, prevented: false });
  });

  it("follows one finger: other pointers neither start nor steer the swipe", async () => {
    const element = await render(row());
    await userEvent.hover(page.getByRole("button", { name: "Actions for Short ribs" }));
    await pointer(content(element), "pointerdown", 200, 20, { isPrimary: false, pointerId: 7 });
    await pointer(window, "pointermove", 80, 20, { pointerId: 7 });
    expect(element.hasAttribute("data-dragging")).toBe(false);

    await pointer(content(element), "pointerdown", 200, 20);
    let nativeMouseMoved = false;
    const hearMouse = (event: PointerEvent) => {
      if (event.isTrusted && event.pointerType === "mouse" && event.buttons === 0) nativeMouseMoved = true;
    };
    window.addEventListener("pointermove", hearMouse);
    try {
      await userEvent.hover(page.getByRole("link", { name: "Short ribs" }));
    } finally {
      window.removeEventListener("pointermove", hearMouse);
    }
    expect(nativeMouseMoved).toBe(true);
    // A second press during the gesture does not restart it.
    await pointer(content(element), "pointerdown", 400, 20, { pointerId: 2, isPrimary: false });
    await pointer(window, "pointermove", 20, 20, { pointerId: 2 });
    expect(element.hasAttribute("data-dragging")).toBe(false);
    await pointer(window, "pointermove", 140, 20);
    await expect.poll(() => offset(element)).toBe(-60);
    await pointer(window, "pointerup", 140, 20, { pointerId: 2 });
    await pointer(window, "pointercancel", 140, 20, { pointerId: 2 });
    expect(element.hasAttribute("data-dragging")).toBe(true);
    await pointer(window, "pointermove", 80, 20);
    wait(300);
    await pointer(window, "pointerup", 80, 20);
    expect(element.getAttribute("data-open")).toBe("trailing");
  });

  it("goes back to where it was when the browser cancels the gesture", async () => {
    const element = await render(row());
    // Cancelled before it became a swipe: nothing to undo.
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointercancel", 200, 20);
    await expect.poll(() => offset(element)).toBe(0);
    // Cancelled mid-swipe from closed: closed.
    await swipe(element, -100, { hold: true });
    await pointer(window, "pointercancel", 100, 20);
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
    // Cancelled mid-swipe from open: open, at the side's width again.
    await swipe(element, -120);
    await swipe(element, 100, { hold: true });
    await expect.poll(() => offset(element)).toBe(hundredths(100 - width(element, "trailing")));
    await pointer(window, "pointercancel", 300, 20);
    expect(element.getAttribute("data-open")).toBe("trailing");
    await expect.poll(() => offset(element)).toBe(-width(element, "trailing"));
  });

  it("swallows the click that ends a swipe, once, and never a keyboard click", async () => {
    const element = await render(row());
    const link = page.getByRole("link", { name: "Short ribs" }).element();
    await swipe(element, -30);
    expect(element.hasAttribute("data-open")).toBe(false);
    // Enter on the link right after a swipe is its own action.
    expect(await click(link, 0)).toEqual({ reached: true, prevented: false });
    expect(await click(link, 1)).toEqual({ reached: false, prevented: true });
    expect(await click(link, 1)).toEqual({ reached: true, prevented: false });
    // A new press forgets the swipe, whatever the pointer.
    await swipe(element, -30);
    await pointer(content(element), "pointerdown", 200, 20, { pointerType: "mouse" });
    expect(await click(link, 1)).toEqual({ reached: true, prevented: false });
  });

  it("forgets a swipe at the next press, even on content that keeps its presses to itself", async () => {
    const element = await render(
      <SwipeActions label="Short ribs" trailing={[{ label: "Delete", onClick: () => {} }]}>
        <div style={{ padding: 20 }}>
          <span data-testid="selfish" onPointerDown={(event) => event.stopPropagation()}>
            <a href="#short-ribs">Short ribs</a>
          </span>
        </div>
      </SwipeActions>,
    );
    const link = page.getByRole("link", { name: "Short ribs" }).element();
    await swipe(element, -30);
    // No click followed the swipe. The next tap is on the content that stops its presses from reaching the row.
    await pointer(link, "pointerdown", 40, 30);
    await pointer(window, "pointerup", 40, 30);
    expect(await click(link, 1)).toEqual({ reached: true, prevented: false });
  });

  it("opens every action as a menu at the finger on a long press, and that press is not a tap or a swipe", async () => {
    const spies = calls();
    const element = await render(row(spies));
    const link = page.getByRole("link", { name: "Short ribs" }).element();
    await swipe(element, -120);
    expect(element.getAttribute("data-open")).toBe("trailing");
    // A finger goes down on the row and stays. The browser reports the long press as a context menu.
    wait(1000);
    await pointer(content(element), "pointerdown", 200, 20);
    const asked = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 20 });
    await act(async () => {
      content(element).dispatchEvent(asked);
    });
    // The row's menu opens in place of the browser's, and the side the row had open closes.
    expect(asked.defaultPrevented).toBe(true);
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(document.querySelector('[data-ouro="menu"]')!.getAttribute("data-ouro-presentation")).toBe("menu");
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["Pin", "Delete", "Archive"]);
    expect(page.getByRole("menuitem", { name: "Delete" }).element().getAttribute("data-tone")).toBe("destructive");
    expect(element.hasAttribute("data-open")).toBe(false);
    // The finger slips sideways on its way up: it is choosing from the menu, not swiping the row.
    wait(16);
    await pointer(window, "pointermove", 150, 20);
    expect(element.hasAttribute("data-dragging")).toBe(false);
    await pointer(window, "pointerup", 150, 20);
    // The click a browser may send when that finger lifts is not a tap on the row's link.
    expect(await click(link, 1)).toEqual({ reached: false, prevented: true });
    await userEvent.click(page.getByRole("menuitem", { name: "Archive" }));
    expect(spies.archive).toHaveBeenCalledTimes(1);
    expect(spies.remove).not.toHaveBeenCalled();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    // Closed, the row takes taps again.
    expect(await click(link, 1)).toEqual({ reached: true, prevented: false });
  });

  it("leaves a mouse's right-click to the browser, on the row and in its actions menu", async () => {
    const element = await render(row());
    const rightClick = async (target: Element) => {
      const asked = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 20 });
      await act(async () => {
        target.dispatchEvent(asked);
      });
      return asked.defaultPrevented;
    };
    await pointer(content(element), "pointerdown", 200, 20, { pointerType: "mouse", button: 2, buttons: 2 });
    // The browser's own menu, with "Open in new tab" for the row's link: the row's does not open.
    expect(await rightClick(content(element))).toBe(false);
    await pointer(window, "pointerup", 200, 20, { pointerType: "mouse", button: 2 });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(element.hasAttribute("data-open")).toBe(false);
    // A right-click inside the open actions menu is the menu's own business.
    await act(async () => menuButton(element).click());
    await expect.element(page.getByRole("menu")).toBeVisible();
    await rightClick(page.getByRole("menuitem", { name: "Archive" }).element());
    expect(document.querySelectorAll('[role="menu"]').length).toBe(1);
  });

  it("keeps a row closed that a long press caught on its way open", async () => {
    const element = await render(row());
    await swipe(element, -120, { hold: true });
    wait(300);
    freeze();
    await pointer(window, "pointerup", 80, 20);
    frames!.step(16);
    expect(element.getAttribute("data-open")).toBe("trailing");
    // A finger stops the row mid-spring and stays down until the long press opens the menu.
    wait(1000);
    await pointer(content(element), "pointerdown", 200, 20);
    await act(async () => {
      content(element).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 20 }));
    });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(element.hasAttribute("data-open")).toBe(false);
    // Lifting the finger does not send the row back to where it was going.
    await pointer(window, "pointerup", 200, 20);
    expect(element.hasAttribute("data-open")).toBe(false);
    await rest(element);
    expect(offset(element)).toBe(0);
  });

  it("does not open the long-press menu under a finger that is already swiping", async () => {
    const element = await render(row());
    await swipe(element, -120, { hold: true });
    await act(async () => {
      content(element).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 20 }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(element.hasAttribute("data-dragging")).toBe(true);
    wait(300);
    await pointer(window, "pointerup", 80, 20);
    expect(element.getAttribute("data-open")).toBe("trailing");
  });

  it("leaves a press or a click inside its actions menu to the menu", async () => {
    const spies = calls();
    const element = await render(row(spies));
    // A swipe that sprang back, with no click after it: the row still expects that click.
    await swipe(element, -30);
    await act(async () => menuButton(element).click());
    await expect.element(page.getByRole("menu")).toBeVisible();
    // React hands the row the menu's events, although the menu is elsewhere in the page.
    // A pointer's click on an item is the item's, not the click that ends the swipe.
    await act(async () => {
      page.getByRole("menuitem", { name: "Archive" }).element().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(spies.archive).toHaveBeenCalledTimes(1);
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    // And a touch that goes down on an item and slips sideways is not a swipe of the row behind it.
    await act(async () => menuButton(element).click());
    await expect.element(page.getByRole("menu")).toBeVisible();
    await pointer(page.getByRole("menuitem", { name: "Archive" }).element(), "pointerdown", 200, 300, { pointerId: 9 });
    await pointer(window, "pointermove", 150, 300, { pointerId: 9 });
    expect(element.hasAttribute("data-dragging")).toBe(false);
    await pointer(window, "pointerup", 150, 300, { pointerId: 9 });
    expect(element.hasAttribute("data-open")).toBe(false);
  });

  it("closes an open row on a click in it: a pointer's click stops there, the keyboard's goes on to the link", async () => {
    const element = await render(row());
    const link = page.getByRole("link", { name: "Short ribs" }).element();
    await swipe(element, -120);
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointerup", 200, 20);
    expect(element.getAttribute("data-open")).toBe("trailing");
    expect(await click(link, 1)).toEqual({ reached: false, prevented: true });
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);

    await swipe(element, -120);
    await pointer(content(element), "pointerdown", 200, 20);
    await pointer(window, "pointerup", 200, 20);
    expect(await click(link, 0)).toEqual({ reached: true, prevented: false });
    expect(element.hasAttribute("data-open")).toBe(false);
  });

  it("runs an action from its button and closes, moving focus from the button to the actions button", async () => {
    const spies = calls();
    const element = await render(row(spies));
    await swipe(element, -120);
    const archive = action(element, "Archive");
    archive.focus();
    expect(document.activeElement).toBe(archive);
    await pointer(archive, "pointerdown", 400, 20);
    await pointer(window, "pointerup", 400, 20);
    await act(async () => archive.click());
    expect(spies.archive).toHaveBeenCalledTimes(1);
    expect(spies.remove).not.toHaveBeenCalled();
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(strip(element, "trailing")!.inert).toBe(true);
    expect(document.activeElement).toBe(menuButton(element));
  });

  it.each(["actions button", "page body"] as const)("closes on Escape only, and keeps that Escape from the page (%s focus)", async (focus) => {
    const element = await render(row());
    const keyboardTarget = focus === "actions button" ? menuButton(element) : document.body;
    if (focus === "actions button") keyboardTarget.focus({ preventScroll: true });
    // Activate the frame before opening even when Escape belongs to the whole page.
    else await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(keyboardTarget);
    const keys: string[] = [];
    const listener = (event: KeyboardEvent) => keys.push(event.key);
    document.addEventListener("keydown", listener);
    try {
      await swipe(element, -120);
      expect(element.getAttribute("data-open")).toBe("trailing");
      expect(document.activeElement).toBe(keyboardTarget);
      await userEvent.keyboard("a");
      expect(element.getAttribute("data-open")).toBe("trailing");
      await userEvent.keyboard("{Escape}");
      await act(async () => {});
      expect(element.hasAttribute("data-open")).toBe(false);
      await expect.poll(() => offset(element)).toBe(0);
      // Closed, Escape is the page's again.
      await userEvent.keyboard("{Escape}");
      expect(keys).toEqual(["a", "Escape"]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  it("closes on a press or a scroll outside the row, not on one inside it", async () => {
    const element = await render(row());
    const outside = document.createElement("div");
    outside.style.cssText = "height:40px;overflow:auto";
    outside.innerHTML = '<div style="height:400px"></div>';
    host.append(outside);
    await swipe(element, -120);
    await act(async () => {
      content(element).dispatchEvent(new Event("scroll"));
    });
    await pointer(action(element, "Delete"), "pointerdown", 440, 20, { pointerType: "mouse" });
    expect(element.getAttribute("data-open")).toBe("trailing");
    await pointer(outside, "pointerdown", 10, 300, { pointerType: "mouse" });
    expect(element.hasAttribute("data-open")).toBe(false);
    await rest(element);

    await swipe(element, -120);
    expect(element.getAttribute("data-open")).toBe("trailing");
    outside.scrollTop = 80;
    await expect.poll(() => element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
  });

  it("closes a side whose actions the app removes, and survives losing them mid-swipe", async () => {
    const spies = calls();
    const element = await render(row(spies));
    await swipe(element, -120);
    expect(element.getAttribute("data-open")).toBe("trailing");
    await render(row(spies, { trailing: [] }));
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
    expect(strip(element, "trailing")).toBeNull();

    await render(row(spies));
    await swipe(element, -400, { hold: true });
    expect(element.hasAttribute("data-full")).toBe(true);
    await render(row(spies, { trailing: undefined }));
    await pointer(window, "pointerup", -200, 20);
    expect(spies.remove).not.toHaveBeenCalled();
    expect(element.hasAttribute("data-open")).toBe(false);
    await expect.poll(() => offset(element)).toBe(0);
  });

  it("stops listening when it unmounts mid-swipe", async () => {
    const element = await render(row());
    const removed = vi.spyOn(window, "removeEventListener");
    await swipe(element, -60, { hold: true });
    await act(async () => root!.unmount());
    root = undefined;
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]));
    await pointer(window, "pointermove", 20, 20);
    await pointer(window, "pointerup", 20, 20);
  });

  it("renders without an actions button when it has no actions, and says so", async () => {
    const element = await render(
      <SwipeActions label="Short ribs">
        <Item title="Short ribs" />
      </SwipeActions>,
    );
    expect(element.querySelector("[data-ouro-swipe-actions-menu]")).toBeNull();
    await swipe(element, -200);
    expect(element.hasAttribute("data-open")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] SwipeActions: it has no actions. Fix: <SwipeActions label="…" trailing={[{ label: "Delete", tone: "destructive", onClick: remove }]}>.',
    );
  });

  it.each([
    ["no label", { label: "" }, "label is required; it names the row for its actions button", '<SwipeActions label="Braised short ribs">'],
    ["actions", { actions: [] }, "actions is not a prop; name the side", 'trailing={[{ label: "Delete", tone: "destructive", onClick: remove }]}'],
    ["left", { left: [] }, "left is not a prop; the sides follow the reading direction", 'leading={[{ label: "Pin", onClick: pin }]}'],
    ["right", { right: [] }, "right is not a prop; the sides follow the reading direction", 'trailing={[{ label: "Delete", tone: "destructive", onClick: remove }]}'],
    ["leftActions", { leftActions: [] }, "leftActions is not a prop", 'leading={[{ label: "Pin", onClick: pin }]}'],
    ["rightActions", { rightActions: [] }, "rightActions is not a prop", 'trailing={[{ label: "Delete", tone: "destructive", onClick: remove }]}'],
    ["onDelete", { onDelete: () => {} }, "onDelete is not a prop; deleting is an action", 'trailing={[{ label: "Delete", tone: "destructive", onClick: remove }]}'],
    [
      "a renamed tone",
      { trailing: [{ label: "Delete", tone: "danger", onClick: () => {} }] },
      'the action "Delete" has tone: "danger", which is not a tone; use "primary", "secondary", "destructive", "success", "warning"',
      '{ label: "Delete", tone: "destructive", onClick: … }',
    ],
    [
      "an unknown tone",
      { trailing: [{ label: "Flag", tone: "accent", onClick: () => {} }] },
      'the action "Flag" has tone: "accent", which is not a tone; use "primary", "secondary", "destructive", "success", "warning"',
      '{ label: "Flag", tone: "primary", onClick: … }',
    ],
    [
      "a made-up tone",
      { trailing: [{ label: "Flag", tone: "red", onClick: () => {} }] },
      'the action "Flag" has tone: "red", which is not a tone; use "primary", "secondary", "destructive", "success", "warning"',
      '{ label: "Flag", tone: "destructive", onClick: … }',
    ],
    ["onPress on an action", { trailing: [{ label: "Delete", onPress: () => {}, onClick: () => {} }] }, 'the action "Delete" has onPress, which is not a field', '{ label: "Delete", onClick: … }'],
    [
      "variant on an action",
      { trailing: [{ label: "Delete", variant: "destructive", onClick: () => {} }] },
      'the action "Delete" has variant, which is not a field',
      '{ label: "Delete", tone: "destructive", onClick: … }',
    ],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    await render(row(calls(), extra as unknown as Partial<SwipeActionsProps>));
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] SwipeActions: ${problem}. Fix: ${fix}.`);
  });

  it("renders an action with a tone that is not one as secondary", async () => {
    const element = await render(row(calls(), { trailing: [{ label: "Flag", tone: "red" as never, onClick: () => {} }] }));
    expect(action(element, "Flag").getAttribute("data-tone")).toBe("secondary");
  });

  it("takes layout classes and warns about appearance classes", async () => {
    const element = await render(row(calls(), { className: "mt-2" }));
    expect(element.classList.contains("mt-2")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    root = undefined;
    await render(row(calls(), { className: "bg-red-500" }));
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] SwipeActions: "bg-red-500" sets appearance, and className is for layout only. Fix: remove "bg-red-500"; give an action a tone: { label: "Delete", tone: "destructive", onClick: remove }.',
    );
  });

  it("renders to a string with the row, its hidden actions and the actions button, without warnings", () => {
    const html = renderToString(row());
    expect(html).toContain('data-ouro="swipe-actions"');
    expect(html).toContain('href="#short-ribs"');
    expect(html).toContain('aria-label="Actions for Short ribs"');
    expect(html).toMatch(/data-ouro-swipe-actions-side="trailing"[^>]* inert=""/);
    expect(html).toContain("Delete");
    expect(warn).not.toHaveBeenCalled();
  });
});
