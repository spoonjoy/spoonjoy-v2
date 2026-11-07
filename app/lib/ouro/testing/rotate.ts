import { expect } from "vitest";
import { commands, page } from "vitest/browser";

/**
 * Resizes the test viewport, as when a phone turns between portrait and landscape, and then
 * sets the page's zoom back to 1. In a phone context (`isMobile`), Chromium can zoom the page
 * when the viewport rotates, and rotating back does not undo it, which moves where later touch
 * input lands. Touch tests rotate with this instead of `page.viewport`; the `ouro-touch`
 * project fails any test that leaves the page zoomed.
 *
 * It also checks that nothing else had zoomed the page: if something had, it still resizes and
 * resets the zoom, so the next test starts clean, and then throws, naming the current test, so
 * a zoom during a landscape test is not silently erased by the rotation back.
 *
 * @example
 * await rotate(844, 390); // landscape
 * afterEach(() => rotate(390, 844));
 * @claim "Resizes the test viewport, as when" registry/ouro/lib/ouro/testing/rotate.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/rotate.touch.test.ts::the next test starts at zoom 1 in portrait)
 * @claim "Resizes the test viewport, as when" registry/ouro/lib/ouro/testing/rotate.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/rotate.touch.test.ts::rotate names the test and still resizes and resets the zoom when called mid-test)
 */
export async function rotate(width: number, height: number): Promise<void> {
  const zoom = await commands.pageZoom();
  try {
    await page.viewport(width, height);
  } finally {
    // Always leave the page resized and at zoom 1, so a failure here never spills into the
    // next test.
    await commands.resetPageZoom();
  }
  if (Math.abs(zoom - 1) >= 0.001) {
    const name = expect.getState().currentTestName ?? "This test";
    throw new Error(
      `"${name}" had the page zoomed to ${zoom.toFixed(2)} when rotate(${width}, ${height}) ran. Something other than a rotation zoomed it.`,
    );
  }
}
