// Cooking on both devices (chef session): the ingredient checklist, step outputs and scale persist
// across reloads and visits, cook mode walks the steps with scaled quantities, and cook mode adds
// exactly one history entry that Exit or Back removes (R-M2-4), so leaving the recipe afterwards
// takes one Back. Cooking progress lives in each browser context's localStorage, so these tests
// write nothing on the server and the two device projects cannot interfere. The app sets the
// storage-schema version key itself on first load (app/lib/client-storage-schema.ts), and every
// test loads a page before it checks anything, so no test seeds that key.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { pathUrl, recipeLink, waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";
const JASMINE_RICE_QUANTITY = "ingredient-quantity-qa-kitchen-recipe-lemon-rice-ingredient-1-jasmine-rice";
// The recipe with no hash: cook mode closed.
const LEMON_RICE_URL = new RegExp(`^https?://[^/]+${LEMON_RICE}$`);
const LEMON_RICE_COOK_URL = new RegExp(`^https?://[^/]+${LEMON_RICE}#cook$`);

function recipeHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true });
}

function kitchenHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });
}

// Home, then Lemon Herb Rice through its link, so the recipe has an in-app page before it.
async function openLemonRiceFromHome(page: Page) {
  await page.goto("/");
  await waitForHydration(page);
  await expect(kitchenHeading(page)).toBeVisible();
  await recipeLink(page.getByRole("main"), "Lemon Herb Rice", LEMON_RICE).click();
  await expect(page).toHaveURL(pathUrl(LEMON_RICE));
  await expect(recipeHeading(page)).toBeVisible();
}

async function openLemonRiceDirectly(page: Page) {
  await page.goto(LEMON_RICE);
  await waitForHydration(page);
  await expect(recipeHeading(page)).toBeVisible();
}

// Two presses of "Increase scale": 1× -> 1.25× -> 1.5×.
async function scaleToOneAndAHalf(page: Page) {
  const increase = page.getByRole("button", { name: "Increase scale" });
  const display = page.getByTestId("scale-display");
  await increase.click();
  await expect(display).toHaveText("1.25×");
  await increase.click();
  await expect(display).toHaveText("1.5×");
}

test.describe("Cooking Lemon Herb Rice", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("the checklist and scale persist across a reload and a visit elsewhere @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
    const jasmineRiceQuantity = page.getByTestId(JASMINE_RICE_QUANTITY);
    const scaleDisplay = page.getByTestId("scale-display");

    await openLemonRiceFromHome(page);
    await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
    await expect(jasmineRiceQuantity).toHaveText("1 cup");

    await jasmineRice.click();
    await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
    await scaleToOneAndAHalf(page);
    await expect(jasmineRiceQuantity).toHaveText("1 ½ cup");

    await verifyAfterReload(async () => {
      await expect(scaleDisplay).toHaveText("1.5×");
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await expect(jasmineRiceQuantity).toHaveText("1 ½ cup");
    });

    // Home and back to the recipe: the progress is still there.
    await openLemonRiceFromHome(page);
    await expect(scaleDisplay).toHaveText("1.5×");
    await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
    await expect(jasmineRiceQuantity).toHaveText("1 ½ cup");
    await expectAccessible();
  });

  test("a step output checks off and stays checked after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    // Step 3 ("Combine") uses step 1's output.
    const cookedRice = page.getByRole("checkbox", { name: "Step 1: Cook the rice", exact: true });

    await openLemonRiceDirectly(page);
    await expect(cookedRice).toHaveAttribute("aria-checked", "false");
    await cookedRice.click();
    await expect(cookedRice).toHaveAttribute("aria-checked", "true");

    await verifyAfterReload(async () => {
      await expect(cookedRice).toHaveAttribute("aria-checked", "true");
    });
    await expectAccessible();
  });

  test("cook mode walks every step with scaled quantities, and Exit leaves one Back to the page before", async ({ page, expectAccessible }) => {
    const panel = page.getByTestId("cook-mode-panel");
    const nextStep = panel.getByRole("button", { name: "Next step" });
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });

    await openLemonRiceFromHome(page);
    await jasmineRice.click();
    await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
    await scaleToOneAndAHalf(page);

    await page.getByRole("link", { name: "Cook mode", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(LEMON_RICE_COOK_URL);
    await expect(panel).toContainText("Step 1 of 3");
    await expect(page.getByRole("region", { name: "Cook the rice", exact: true })).toBeVisible();
    // Step 1's quantities follow the scale, and the checklist carries over.
    await expect(panel.getByTestId(JASMINE_RICE_QUANTITY)).toHaveText("1 ½ cup");
    await expect(panel.getByRole("checkbox", { name: "jasmine rice", exact: true })).toHaveAttribute("aria-checked", "true");
    // Nothing covers the step controls on a phone (R-M2-5): the dock is hidden in cook mode.
    await expect(page.getByRole("navigation", { name: "Spoonjoy navigation" })).toBeHidden();
    await expectAccessible();

    await nextStep.click();
    await expect(panel).toContainText("Step 2 of 3");
    await expect(page.getByRole("region", { name: "Make the dressing", exact: true })).toBeVisible();

    await nextStep.click();
    await expect(panel).toContainText("Step 3 of 3");
    await expect(page.getByRole("region", { name: "Combine", exact: true })).toBeVisible();
    await expect(nextStep).toBeDisabled();

    await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(LEMON_RICE_URL);
    await expect(recipeHeading(page)).toBeVisible();
    await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("scale-display")).toHaveText("1.5×");
    await expectAccessible();

    // Exit removed cook mode's history entry, so one Back leaves the recipe (R-M2-4).
    await page.goBack();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading(page)).toBeVisible();
    await expectAccessible();
  });

  test("browser Back closes cook mode, and a second Back leaves the recipe", async ({ page, expectAccessible }) => {
    const panel = page.getByTestId("cook-mode-panel");

    await openLemonRiceFromHome(page);
    await page.getByRole("link", { name: "Cook mode", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(LEMON_RICE_COOK_URL);

    await page.goBack();
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(LEMON_RICE_URL);
    await expect(recipeHeading(page)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading(page)).toBeVisible();
    await expectAccessible();
  });

  test("after cook mode, the recipe's Back control returns to the page before the recipe", async ({ page, isMobile, expectAccessible }) => {
    const panel = page.getByTestId("cook-mode-panel");
    // On a phone that is the dock's Back item; on desktop (no dock) the page's "Recipes" link.
    // Both keep an /recipes href for a recipe opened directly (R-M2-2).
    const backControl = isMobile
      ? page.getByRole("navigation", { name: "Spoonjoy navigation" }).getByRole("link", { name: "Back", exact: true })
      : page.getByRole("main").getByRole("link", { name: "Recipes", exact: true });

    await openLemonRiceFromHome(page);
    await page.getByRole("link", { name: "Cook mode", exact: true }).click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(LEMON_RICE_URL);
    await expect(backControl).toHaveAttribute("href", "/recipes");

    await backControl.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading(page)).toBeVisible();
    await expectAccessible();
  });

  test("Clear progress unchecks everything and stays cleared after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
    const cookedRice = page.getByRole("checkbox", { name: "Step 1: Cook the rice", exact: true });
    const checkedRows = page.locator('[role="checkbox"][aria-checked="true"]');
    const scaleDisplay = page.getByTestId("scale-display");

    await openLemonRiceDirectly(page);
    await jasmineRice.click();
    await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
    await cookedRice.click();
    await expect(cookedRice).toHaveAttribute("aria-checked", "true");
    // Clear progress keeps the scale; 1.25× after the reload shows the saved progress was read.
    await page.getByRole("button", { name: "Increase scale" }).click();
    await expect(scaleDisplay).toHaveText("1.25×");

    await page.getByTestId("clear-progress-button").click();
    await expect(checkedRows).toHaveCount(0);
    await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
    await expect(cookedRice).toHaveAttribute("aria-checked", "false");

    await verifyAfterReload(async () => {
      await expect(scaleDisplay).toHaveText("1.25×");
      await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
      await expect(cookedRice).toHaveAttribute("aria-checked", "false");
      await expect(checkedRows).toHaveCount(0);
    });
    await expectAccessible();
  });
});
