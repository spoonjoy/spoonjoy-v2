// Nutrition on Lemon Herb Rice: the recipe's page shows calories and macros per serving from USDA FoodData Central,
// says how many of its ingredients they cover, and shows the same after a reload. Read-only, so it uses the chef
// persona's seeded recipe.
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";

test.describe("Nutrition", () => {
  test.use({ storageState: personaStorageStatePath("chef") });

  test("a recipe's page shows calories and macros per serving, after a reload", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    const nutrition = page.getByTestId("recipe-nutrition");

    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(nutrition.getByRole("heading", { level: 2, name: "Nutrition", exact: true })).toBeVisible();
    await expect(nutrition.getByText(/^Per serving, from \d+ of \d+ ingredients?\.$/)).toBeVisible();
    await expect(nutrition.getByText(/^\d+ kcal$/)).toBeVisible();
    await expect(nutrition.getByRole("link", { name: "USDA FoodData Central", exact: true })).toHaveAttribute("href", "https://fdc.nal.usda.gov/");

    await verifyAfterReload(async () => {
      await expect(nutrition.getByText(/^\d+ kcal$/)).toBeVisible();
    });
    await nutrition.scrollIntoViewIfNeeded();
    await testInfo.attach("recipe-nutrition-after-reload", { body: await nutrition.screenshot(), contentType: "image/png" });
    await expectAccessible();
  });
});
