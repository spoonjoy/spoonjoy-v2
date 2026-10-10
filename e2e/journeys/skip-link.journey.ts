// The "Skip to main content" link (chef session, on both iPhone and desktop). It is the first
// thing a keyboard reaches on every page, and it stays out of sight until it has focus: unfocused,
// it paints nothing, even on a scrolled page (a link parked above the top edge used to show up
// mid-page in full-page screenshots). Focused, it shows whole at the top-left corner, and
// following it moves focus to the page's main content, which hides it again.
//
// Read-only.
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

// A long page, so there is room to scroll.
const LONG_PAGE = "/recipes";

async function boxOf(locator: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} has no bounding box (not rendered).`);
  return box;
}

// How much of the element the browser actually paints: its box, shrunk by any clip-path inset.
async function paintedArea(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const clip = getComputedStyle(element).clipPath;
    const inset = /^inset\(([\d.]+)%\)$/.exec(clip);
    const keep = inset ? Math.max(0, 1 - (2 * Number(inset[1])) / 100) : 1;
    return rect.width * keep * rect.height * keep;
  });
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: "the page scrolled" }).toBeGreaterThan(0);
}

test.describe("Skip to main content", () => {
  test.use({ storageState: personaStorageStatePath("chef") });

  test("stays hidden until focused, shows at the top when focused, and moves focus to the main content", async ({ page }) => {
    await page.goto(LONG_PAGE);
    await waitForHydration(page);
    const link = page.getByRole("link", { name: "Skip to main content" });

    await test.step("unfocused, it paints nothing, at the top or scrolled down", async () => {
      await expect(link).not.toBeFocused();
      expect(await paintedArea(link), "painted area at the top of the page").toBeLessThanOrEqual(1);
      await scrollToBottom(page);
      expect(await paintedArea(link), "painted area on a scrolled page").toBeLessThanOrEqual(1);
    });

    await test.step("focused, it shows whole at the top-left corner of the screen", async () => {
      await link.focus();
      await expect(link).toBeFocused();
      const box = await boxOf(link, "the focused skip link");
      expect(box.y, "top edge").toBeGreaterThanOrEqual(0);
      expect(box.y, "top edge").toBeLessThan(8);
      expect(box.width, "width").toBeGreaterThan(100);
      expect(box.height, "height").toBeGreaterThan(24);
      expect(await paintedArea(link), "painted area").toBeCloseTo(box.width * box.height, 0);
    });

    await test.step("following it focuses the main content and hides it again", async () => {
      await link.press("Enter");
      await expect(page.locator("main#main")).toBeFocused();
      expect(await paintedArea(link), "painted area after skipping").toBeLessThanOrEqual(1);
    });
  });
});
