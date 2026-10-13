import { afterEach, beforeEach } from "vitest";
import { commands } from "vitest/browser";

// Vitest setup for the `ouro-touch` project: a test that leaves the phone page zoomed fails,
// naming itself, because later touch input would land in the wrong place. The zoom is reset
// first, so the next test starts clean. This hook is registered before the test files' own,
// so it runs after them, once they have rotated back.

// Every test starts as a touch phone. Chromium drops a page's touch emulation after a
// screenshot that reaches beyond the viewport, which is what Vitest takes when a test fails on
// a tall page; without this, one failure fails every later test that needs a coarse pointer.
beforeEach(() => commands.restoreTouch());

afterEach(async ({ task }) => {
  const zoom = await commands.pageZoom();
  if (Math.abs(zoom - 1) < 0.001) return;
  await commands.resetPageZoom();
  throw new Error(
    `"${task.name}" left the page zoomed to ${zoom.toFixed(2)}. Rotate the viewport with rotate() from testing/rotate.ts, which resets the zoom, instead of page.viewport().`,
  );
});
