import type { Locator, Page } from "@playwright/test";

/**
 * Opens one Storybook story on its own, by story id (for example
 * `"overlays-sheet--playground"`), and waits for it to render and for the app's web fonts
 * to load, so text no longer changes width under a spec that measures. A font first used by
 * content that appears later (an opened menu, a heavier weight) loads later: before measuring
 * such content, wait again with `await page.evaluate(() => document.fonts.ready.then(() => {}))`.
 * The Storybook comes from
 * the `OURO_E2E_URL` environment variable, default `http://localhost:6006`: the
 * Storybook that shows the Ouro UI stories installed in this app, compiled with the
 * app's own Tailwind and theme.
 */
export async function openStory(page: Page, id: string): Promise<void> {
  const base = process.env["OURO_E2E_URL"] ?? "http://localhost:6006";
  const url = new URL(`iframe.html?id=${id}&viewMode=story`, base.endsWith("/") ? base : `${base}/`);
  await page.goto(url.href);
  await page.locator("#storybook-root > *").first().waitFor();
  // A font starts loading when a layout first uses it, so lay the story out before asking.
  await page.evaluate(() => {
    document.body.getBoundingClientRect();
    return document.fonts.ready.then(() => undefined);
  });
}

/**
 * Stops the page's clock where it is, so a state that lasts a set time (a confirmation, a toast,
 * a save in progress) stays until the spec moves the clock on with `page.clock.runFor(ms)` or lets
 * it run again with `page.clock.resume()`: a loaded runner can take longer than that time between
 * two steps. Call `page.clock.install()` before `openStory`, so the page's timers are the clock's.
 */
export async function holdClock(page: Page): Promise<void> {
  // pauseAt takes a time ahead of the page's clock, which runs on while the request travels: aim a
  // little ahead, and further each time the clock got there first.
  for (let ahead = 50; ; ahead *= 2) {
    const at = await page.evaluate((ms) => Date.now() + ms, ahead);
    try {
      await page.clock.pauseAt(at);
      return;
    } catch (error) {
      if (ahead >= 3200 || !String(error).includes("Cannot fast-forward to the past")) throw error;
    }
  }
}

/** Waits for an element's transitions (opening, springing back) to finish, then returns its box. */
export async function settledBox(element: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await element.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const box = await element.boundingBox();
  if (!box) throw new Error("settledBox: the element is not visible");
  return box;
}

/**
 * Drags vertically with the real mouse over `durationMs`, slowly enough that the release
 * velocity does not count as a flick (Playwright's own `steps` moves have no delay).
 */
export async function slowDrag(page: Page, x: number, fromY: number, toY: number, durationMs = 600): Promise<void> {
  const steps = 15;
  await page.mouse.move(x, fromY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x, fromY + ((toY - fromY) * step) / steps);
    await page.waitForTimeout(durationMs / steps);
  }
  await page.mouse.up();
}

/**
 * Presses Tab, or Shift+Tab with `{ shift: true }`, so that focus moves to the next tab stop
 * in every browser. WebKit on a Mac follows the system's "Keyboard navigation" setting: with
 * it off, the default, Tab skips buttons, links and every control that is not a text field.
 * Option+Tab is WebKit's key for "every control, whatever the setting", so this presses that
 * there and plain Tab everywhere else. Use it instead of `page.keyboard.press("Tab")`.
 */
export async function pressTab(page: Page, { shift = false }: { shift?: boolean } = {}): Promise<void> {
  const webkitOnMac = process.platform === "darwin" && page.context().browser()?.browserType().name() === "webkit";
  await page.keyboard.press(`${shift ? "Shift+" : ""}${webkitOnMac ? "Alt+" : ""}Tab`);
}
