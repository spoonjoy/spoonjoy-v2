import { test, expect } from "../fixtures";

// A fresh server restored from a backup of the QA kitchen (`server.mjs backup`, then `server.mjs
// restore` into an empty data folder). The Self-host Image workflow sets SPOONJOY_SELF_HOST_RESTORED
// once it has restored one; without it, this is skipped.
test.describe("A server restored from a backup", () => {
  test.skip(!process.env.SPOONJOY_SELF_HOST_RESTORED, "SPOONJOY_SELF_HOST_RESTORED comes from the workflow, after a restore");

  test("shows the kitchen's recipe with its photo", async ({ page }, testInfo) => {
    await page.goto("/recipes/qa-kitchen-recipe-risotto");
    await expect(page.getByRole("heading", { name: "Saffron Risotto" }).first()).toBeVisible();
    const cover = page.locator('img[src*="penne-ragu"]').first();
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("restored-recipe-with-photo.png"), fullPage: true });
  });
});
