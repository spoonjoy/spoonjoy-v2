import type {} from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

/**
 * Moves the real mouse off the test frame, onto the host page beside it, so no element in the
 * frame is hovered when a test starts. Playwright keeps the mouse where the last test left it,
 * and a browser re-checks :hover after layout, so a button rendered under that spot turns
 * :hover on its own, and with it the theme's --ouro-action-hover colour (spoonjoy-v2#678).
 * The frame's box comes from Playwright; the point is never guessed. Throws when the frame
 * fills the page, since no point would be off it.
 */
export const parkPointer: BrowserCommand<[]> = async ({ page, frame }) => {
  const box = await (await (await frame()).frameElement()).boundingBox();
  const size = page.viewportSize();
  if (!box || !size) throw new Error("parkPointer: the test frame or the page has no size");
  const spots: Array<[number, number]> = [
    [box.x + box.width + 1, box.y],
    [box.x, box.y + box.height + 1],
    [box.x - 1, box.y],
    [box.x, box.y - 1],
  ];
  const spot = spots.find(([x, y]) => x >= 0 && y >= 0 && x < size.width && y < size.height);
  if (!spot) throw new Error(`parkPointer: the test frame (${box.width}x${box.height}) fills the page (${size.width}x${size.height})`);
  await page.mouse.move(spot[0], spot[1]);
};
