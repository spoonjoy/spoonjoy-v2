// Ingredient swaps in cook mode: Roasted Tomato Soup's first step uses garlic (scripts/seed-qa-kitchen.mjs), and cook
// mode names what to use instead of it under the ingredient. Swaps are read-only, so the chef's kitchen stays as seeded.
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

test.describe("Ingredient swaps", () => {
  test.use({ storageState: personaStorageStatePath("chef") });

  test("cook mode names a swap under an ingredient", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    const panel = page.getByTestId("cook-mode-panel");
    const garlic = panel.getByRole("checkbox", { name: "garlic", exact: true });

    await page.goto("/recipes/qa-kitchen-recipe-tomato-soup");
    await waitForHydration(page);
    await page.getByRole("link", { name: "Cook mode", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(garlic).toHaveAccessibleDescription(/Swap: ⅛ tsp garlic powder per clove/);

    await verifyAfterReload(async () => {
      await expect(garlic).toHaveAccessibleDescription(/Swap: ⅛ tsp garlic powder per clove/);
    });
    // On a phone the step list sits below the step text, so bring the garlic row and its swap into view first.
    await garlic.scrollIntoViewIfNeeded();
    await testInfo.attach("cook-mode-garlic-swap", { body: await page.screenshot(), contentType: "image/png" });
    await expectAccessible();
  });
});
