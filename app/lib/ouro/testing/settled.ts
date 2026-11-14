import { expect } from "vitest";

export { settled };

/**
 * Waits until an element has stopped moving. It waits while the element has a starting or an ending
 * style, or while a finite animation or transition runs in its subtree, and then until its box holds
 * still from one poll read to the next. Use it after a popup or sheet opens and before a press goes to
 * one of its items: a press on an item that is still rising can go down on one item and come up on the
 * next, which drops the click. A function target waits for an element that mounts later; an infinite
 * animation, such as a spinner, does not hold it.
 *
 * @example
 * await userEvent.click(trigger);
 * await settled(() => document.querySelector('[role="menu"][data-ouro-presentation]'));
 * await userEvent.click(page.getByRole("menuitemradio", { name: "Dark" }));
 */
async function settled(target: Element | (() => Element | null)): Promise<void> {
  let previous: string | undefined;
  await expect
    .poll(() => {
      const box = restingBox(typeof target === "function" ? target() : target);
      const held = box !== undefined && box === previous;
      previous = box;
      return held;
    })
    .toBe(true);
}

/** The element's box as a string, or undefined while it is still moving or styled as entering or leaving. */
function restingBox(element: Element | null): string | undefined {
  if (!element || element.hasAttribute("data-starting-style") || element.hasAttribute("data-ending-style")) return undefined;
  if (element.getAnimations({ subtree: true }).some(isMoving)) return undefined;
  const { top, left, width, height } = element.getBoundingClientRect();
  return [top, left, width, height].join(" ");
}

/** Whether an animation is running and will end, so a spinner that repeats forever does not count. */
function isMoving(animation: Animation): boolean {
  return animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity;
}
