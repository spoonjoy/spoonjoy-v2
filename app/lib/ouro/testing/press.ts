import { expect } from "vitest";
import { commands } from "vitest/browser";

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
