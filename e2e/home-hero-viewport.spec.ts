import { expect, test } from "@playwright/test";

const EMPTY_STORAGE = { cookies: [], origins: [] };

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide desktop", width: 1920, height: 1080 },
] as const;

test.describe("guest home hero viewport reveal", () => {
  test.use({ storageState: EMPTY_STORAGE });

  for (const viewport of VIEWPORTS) {
    test(`reveals the following content in the first viewport on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      const brandSignal = page.getByText("The Recipe App");
      const headline = page.getByRole("heading", { name: "Your food should look as good as it tastes." });
      const continuation = page.getByRole("heading", { name: "Collect" });

      await expect(brandSignal).toBeVisible();
      await expect(headline).toBeVisible();
      await expect(page.getByText(/Spoonjoy is a photo-first kitchen for the recipes you actually cook/i)).toBeVisible();

      const heroBox = await headline.locator("xpath=ancestor::section[1]").boundingBox();
      const brandBox = await brandSignal.boundingBox();
      const headlineBox = await headline.boundingBox();
      const continuationBox = await continuation.boundingBox();
      const pageMetrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));

      expect(heroBox, `${viewport.name}: hero section should be measurable`).not.toBeNull();
      expect(brandBox, `${viewport.name}: brand signal should be measurable`).not.toBeNull();
      expect(headlineBox, `${viewport.name}: headline should be measurable`).not.toBeNull();
      expect(continuationBox, `${viewport.name}: continuation heading should be measurable`).not.toBeNull();

      expect(heroBox!.height, `${viewport.name}: hero must leave a stable reveal below the first viewport`).toBeLessThanOrEqual(viewport.height - 128);
      expect(continuationBox!.y, `${viewport.name}: next section heading should be visible without scrolling`).toBeLessThanOrEqual(viewport.height - 96);
      expect(brandBox!.y, `${viewport.name}: brand signal should stay inside the first viewport`).toBeGreaterThanOrEqual(0);
      expect(headlineBox!.y + headlineBox!.height, `${viewport.name}: headline should not overlap continuation content`).toBeLessThan(continuationBox!.y);
      expect(pageMetrics.scrollWidth, `${viewport.name}: layout should not create horizontal overflow`).toBeLessThanOrEqual(pageMetrics.viewportWidth + 1);
    });
  }
});
