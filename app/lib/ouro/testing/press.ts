import { expect, vi } from "vitest";
import { commands } from "vitest/browser";
import { act } from "./act";

const MOVES = ["pointermove", "mousemove", "pointerover", "mouseover", "pointerenter", "mouseenter"];

/**
 * Holds the real mouse down on an element and reports its background before and during the
 * press, so a test can prove an `:active` tint. A mouse that moves onto the element also
 * hovers or highlights it, which can give the same colour, so by default the move events
 * are kept from the page (the browser still applies `:active`). Base UI lists highlight an
 * item on pointer-down; pass `clearHighlight` to drop `data-highlighted` while the button is
 * held, so only `:active` can explain the colour. `during` runs while the button is still
 * down, for checks on the pressed element. It throws if the element never tints. Run it in the `ouro-touch` project where
 * `pointer-fine:` hover rules are off.
 *
 * @example
 * const { rest, pressed, active } = await pressTint(option);
 * expect(active && pressed !== rest).toBe(true);
 * @claim "It throws if the element never" registry/ouro/lib/ouro/testing/press.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/press.touch.test.ts::fails on an element with no pressed tint)
 */
export async function pressTint(
  element: HTMLElement,
  options: { blockMoves?: boolean; clearHighlight?: boolean; during?: () => void } = {},
): Promise<{ rest: string; pressed: string; active: boolean }> {
  const { blockMoves = true, clearHighlight = false, during } = options;
  const block = (event: Event) => event.stopImmediatePropagation();
  if (blockMoves) for (const type of MOVES) window.addEventListener(type, block, true);
  element.setAttribute("data-press-target", "");
  const rest = getComputedStyle(element).backgroundColor;
  await commands.pointerPress({ selector: "[data-press-target]", action: "down" });
  try {
    let pressed = rest;
    await expect
      .poll(() => {
        if (clearHighlight) element.removeAttribute("data-highlighted");
        pressed = getComputedStyle(element).backgroundColor;
        return element.matches(":active") && pressed !== rest && element.getAnimations().length === 0;
      })
      .toBe(true);
    during?.();
    return { rest, pressed, active: element.matches(":active") };
  } finally {
    await commands.pointerPress({ selector: "[data-press-target]", action: "up" });
    element.removeAttribute("data-press-target");
    if (blockMoves) for (const type of MOVES) window.removeEventListener(type, block, true);
  }
}

/** Resolves at the first frame after the page next sees `type`, after the rest of that input's events. */
const seen = (type: string) =>
  new Promise<void>((resolve) => window.addEventListener(type, () => requestAnimationFrame(() => resolve()), { once: true }));

/** Runs the page's timers that are due now, as the held clock stands. */
const runDue = () => act(async () => vi.advanceTimersByTime(0));

/**
 * Presses the real mouse on an element and lets go `frames` animation frames later (10 by
 * default), with the page's clock held from the press until the release has landed. The release
 * comes in a later command, as late as a loaded runner sends it, and a state that ends on a timer
 * could end before it: Base UI takes a release over a Select option as choosing it from 400ms after
 * the list opens, which closes the list. While the clock is held, a timer set to run at once runs at
 * the next frame and no later one runs, so the release lands as on a quick click however late it
 * comes. It waits for the press's and the release's events in the page, not for time. Then the
 * timers still waiting run, and the clock is the page's again.
 *
 * @example
 * await pressAndLetGo('[data-ouro="button"]');
 * @claim "lets go `frames` animation frames later" registry/ouro/lib/ouro/testing/press.ts verify:fileLine(registry/ouro/lib/ouro/testing/press.ts, /\{ frames = 10, button = "left" \}/)
 * @claim "Base UI takes a release over" https://github.com/mui/base-ui/blob/47b40521eab921c2756bf9bdb0b0f07fbfdb8c8c/packages/react/src/select/trigger/SelectTrigger.tsx verify:urlOk(https://github.com/mui/base-ui/blob/47b40521eab921c2756bf9bdb0b0f07fbfdb8c8c/packages/react/src/select/trigger/SelectTrigger.tsx)
 * @claim "a timer set to run at once runs" registry/ouro/lib/ouro/testing/press.test.ts verify:testExists(registry/ouro/lib/ouro/testing/press.test.ts::pressAndLetGo runs a timer set to run at once before the release, and one set for later only once the release has landed)
 * @claim "Then the timers still waiting run" registry/ouro/lib/ouro/testing/press.test.ts verify:testExists(registry/ouro/lib/ouro/testing/press.test.ts::pressAndLetGo runs a timer set to run at once before the release, and one set for later only once the release has landed)
 */
export async function pressAndLetGo(selector: string, { frames = 10, button = "left" }: { frames?: number | undefined; button?: "left" | "right" | undefined } = {}): Promise<void> {
  const pressed = seen("pointerdown");
  const released = seen("pointerup");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await commands.pointerPress({ selector, action: "down", button });
    await pressed;
    await runDue();
    for (let index = 0; index < frames; index++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await runDue();
    }
    await commands.pointerPress({ action: "up", button });
    await released;
  } finally {
    try {
      await act(async () => vi.runOnlyPendingTimers());
    } finally {
      vi.useRealTimers();
    }
  }
}

/** Where `pressDuringScroll` found the page. */
export interface ScrollPress {
  /** Where the page was as the press reached it, before the pressed element's own handlers ran. */
  pressedAt: number;
  /** Where the page's smooth scroll was heading as those handlers ran. */
  heading: number;
  /**
   * Whether the page moved between the last two frames before the press: false with `scroll: "begins"`, where the scroll starts at the press.
   *
   * @claim "Whether the page moved between" registry/ouro/lib/ouro/testing/press.test.ts verify:testExists(registry/ouro/lib/ouro/testing/press.test.ts::pressDuringScroll presses as a smooth scroll begins, and while one is under way)
   */
  moving: boolean;
  /** The page's inline `scroll-behavior` once the press had reached the window. */
  behaviorAtPress: string;
}

/**
 * Presses an element during a smooth page scroll, and lets go with `pressAndLetGo`. The page is put
 * at `from` with `scroll-behavior: smooth` on its root; with `scroll: "begins"`, a smooth scroll to
 * `to` starts as the press goes down, ahead of the pressed element's own handlers. With
 * `scroll: "underway"`, the page sways between `from` and `to`, turning back each time it arrives,
 * and the press is sent once the page is seen moving. WebKit ends a smooth scroll within about
 * 200ms whatever its length, sooner than a loaded runner's press may follow, so a single scroll
 * could be over before the press came. Put the pressed point where it is on the element all the
 * way from `from` to `to`.
 *
 * @example
 * const { pressedAt, moving } = await pressDuringScroll("[data-press-here]", { from: 2000, to: 4000, scroll: "underway" });
 * expect(moving).toBe(true);
 * expect(window.scrollY).toBe(pressedAt);
 * @claim "a smooth scroll to" registry/ouro/lib/ouro/testing/press.test.ts verify:testExists(registry/ouro/lib/ouro/testing/press.test.ts::pressDuringScroll presses as a smooth scroll begins, and while one is under way)
 * @claim "the press is sent once the page is seen moving" registry/ouro/lib/ouro/testing/press.test.ts verify:testExists(registry/ouro/lib/ouro/testing/press.test.ts::pressDuringScroll presses as a smooth scroll begins, and while one is under way)
 * @claim "WebKit ends a smooth scroll" https://github.com/ourostack/ouro-ui/pull/354 verify:urlOk(https://github.com/ourostack/ouro-ui/pull/354)
 */
export async function pressDuringScroll(
  selector: string,
  { from, to, scroll, frames, button }: { from: number; to: number; scroll: "begins" | "underway"; frames?: number | undefined; button?: "left" | "right" | undefined },
): Promise<ScrollPress> {
  const html = document.documentElement;
  window.scrollTo({ top: from, behavior: "instant" });
  html.style.scrollBehavior = "smooth";
  let heading = from;
  let pressed = false;
  let pressedAt = -1;
  let behaviorAtPress = "";
  let last = Number.NaN;
  let moving = false;
  let movingAtPress = false;
  let seenMoving = () => {};
  const inMotion = new Promise<void>((resolve) => (seenMoving = resolve));
  const sway = () => {
    heading = heading === from ? to : from;
    window.scrollTo({ top: heading });
  };
  const swaying = () => {
    if (pressed) return;
    moving = window.scrollY !== last && !Number.isNaN(last);
    last = window.scrollY;
    if (moving) seenMoving();
    if (window.scrollY === heading) sway();
    requestAnimationFrame(swaying);
  };
  const onPress = () => {
    pressed = true;
    pressedAt = window.scrollY;
    movingAtPress = moving;
    if (scroll === "begins") sway();
  };
  const atPress = () => (behaviorAtPress = html.style.scrollBehavior);
  document.addEventListener("pointerdown", onPress, { capture: true, once: true });
  window.addEventListener("pointerdown", atPress, { once: true });
  try {
    if (scroll === "underway") {
      swaying();
      await inMotion;
    }
    await pressAndLetGo(selector, { frames, button });
  } finally {
    pressed = true;
    document.removeEventListener("pointerdown", onPress, { capture: true });
    window.removeEventListener("pointerdown", atPress);
  }
  return { pressedAt, heading, moving: movingAtPress, behaviorAtPress };
}
