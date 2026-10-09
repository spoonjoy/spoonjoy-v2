// Cooking Lemon Herb Rice on both devices: the ingredient checklist, step outputs and scale persist
// across reloads and visits, cook mode walks the steps with scaled quantities and resumes at the
// step it was left on, and cook mode adds exactly one history entry that Exit or Back removes
// (R-M2-4), so leaving the recipe afterwards takes one Back.
//
// On QA a signed-in cook's progress lives in their account (cook-session sync, bug 16), not in the
// browser, so it outlasts a test's browser context. The tests that change progress therefore run
// as scratch index 7 with per-device twins — the base account on iPhone WebKit, its desktop twin
// on desktop Chrome (AGENTS.md's scratch table) — so the two device projects never race on one
// account, reset that cook's Lemon Herb Rice progress through the cook-session API before they
// start, and wait for the account's answer to the saving PATCH before a reload, so the reload
// proves the account kept the change. The history tests
// open the recipe from the chef's kitchen home (a scratch cook's home lists no recipes) and change
// no progress, so the chef's progress on Lemon Herb Rice stays untouched.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { cookProgressSaved, resetCookProgress } from "./support/cook-progress";
import { pathUrl, recipeLink, seededRecipeLink, waitForHydration } from "./support/navigation";
import { personaStorageStatePath, scratchForProject, scratchStorageStateForProject } from "./support/personas";

const LEMON_RICE_ID = "qa-kitchen-recipe-lemon-rice";
const LEMON_RICE = `/recipes/${LEMON_RICE_ID}`;
// The seeded ingredient id (scripts/seed-qa-kitchen.mjs: <recipe id>-ingredient-<step>-<slug>).
const JASMINE_RICE_ID = `${LEMON_RICE_ID}-ingredient-1-jasmine-rice`;
const JASMINE_RICE_QUANTITY = `ingredient-quantity-${JASMINE_RICE_ID}`;
// The recipe with no hash: cook mode closed.
const LEMON_RICE_URL = new RegExp(`^https?://[^/]+${LEMON_RICE}$`);
const LEMON_RICE_COOK_URL = new RegExp(`^https?://[^/]+${LEMON_RICE}#cook$`);
const SCRATCH_INDEX = 7;

function recipeHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true });
}

function kitchenHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });
}

function syncStatus(page: Page) {
  return page.getByTestId("cook-sync-status");
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

// Opens the recipe and waits until the page has read the cook's progress from their account.
async function openLemonRiceDirectly(page: Page) {
  await page.goto(LEMON_RICE);
  await waitForHydration(page);
  await expect(recipeHeading(page)).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Progress synced");
}

// Search, then Lemon Herb Rice through its result link: an in-app navigation, so the recipe page
// mounts on the client (not a full document load) and still shows the account's progress.
async function openLemonRiceFromSearch(page: Page) {
  await page.goto("/search?q=lemon");
  await waitForHydration(page);
  const results = page.getByRole("region", { name: "Search results" });
  await seededRecipeLink(results, "Recipe Lemon Herb Rice", LEMON_RICE).click();
  await expect(page).toHaveURL(pathUrl(LEMON_RICE));
  await expect(recipeHeading(page)).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Progress synced");
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
  test.describe("progress", () => {
    // Scratch 7's base account on iPhone, its desktop twin on desktop Chrome. A stored session
    // path, never the credentials file, which `playwright test --list` must not need.
    test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

    test.beforeEach(async ({ page }, testInfo) => {
      await resetCookProgress(page, LEMON_RICE_ID, scratchForProject(SCRATCH_INDEX, testInfo.project.name).id);
    });

    test("the checklist and scale persist across a reload and a visit elsewhere @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
      const jasmineRiceQuantity = page.getByTestId(JASMINE_RICE_QUANTITY);
      const scaleDisplay = page.getByTestId("scale-display");

      await openLemonRiceDirectly(page);
      await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
      await expect(jasmineRiceQuantity).toHaveText("1 cup");

      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) =>
        progress.scaleFactor === 1.5 && progress.checkedIngredientIds.includes(JASMINE_RICE_ID));
      await jasmineRice.click();
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await scaleToOneAndAHalf(page);
      await expect(jasmineRiceQuantity).toHaveText("1 ½ cup");
      await saved;

      await verifyAfterReload(async () => {
        await expect(scaleDisplay).toHaveText("1.5×");
        await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
        await expect(jasmineRiceQuantity).toHaveText("1 ½ cup");
      });

      // Somewhere else and back to the recipe through the app: the progress is still there.
      await openLemonRiceFromSearch(page);
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
      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.checkedStepOutputIds.length === 1);
      await cookedRice.click();
      await expect(cookedRice).toHaveAttribute("aria-checked", "true");
      await saved;

      await verifyAfterReload(async () => {
        await expect(cookedRice).toHaveAttribute("aria-checked", "true");
      });
      await expectAccessible();
    });

    test("cook mode walks every step with scaled quantities and resumes at the step it was left on @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");
      const nextStep = panel.getByRole("button", { name: "Next step" });
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });

      await openLemonRiceDirectly(page);
      // Only the final state matches: rice checked, 1.5×, and step 3 (index 2) current.
      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) =>
        progress.activeStepIndex === 2 && progress.scaleFactor === 1.5 && progress.checkedIngredientIds.includes(JASMINE_RICE_ID));
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
      // Nothing covers the step controls on a phone (R-M2-5): the tab bar is hidden in cook mode.
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
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("scale-display")).toHaveText("1.5×");
      await saved;

      await verifyAfterReload(async () => {
        await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
        await expect(page.getByTestId("scale-display")).toHaveText("1.5×");
      });

      // The current step is part of the saved progress: cook mode reopens on step 3.
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Step 3 of 3");
      await expect(page.getByRole("region", { name: "Combine", exact: true })).toBeVisible();
      await expectAccessible();
    });

    test("a cook-mode timer keeps running on another step, survives a reload, and can be cancelled @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");
      const stepTimer = panel.getByTestId("cook-mode-timer");
      const tray = panel.getByRole("region", { name: "Running timers" });
      const riceTimer = tray.getByTestId("cook-timer-tray-item-1");

      await openLemonRiceDirectly(page);
      // The reload below must find cook mode on step 2, so wait for the account to save that step.
      const onStepTwo = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.activeStepIndex === 1);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toContainText("Step 1 of 3");
      // Step 1 ("Cook the rice") is seeded with a 15 minute timer.
      await expect(stepTimer).toContainText("15 min timer");
      await stepTimer.getByRole("button", { name: "Start timer", exact: true }).click();
      await expect(stepTimer.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
      await expect(stepTimer).toContainText("14:5");

      // Moving on to the dressing keeps the rice timer counting, in the tray.
      await panel.getByRole("button", { name: "Next step" }).click();
      await expect(panel).toContainText("Step 2 of 3");
      await expect(riceTimer).toContainText("Step 1 · Cook the rice");
      await expect(riceTimer).toContainText("14:");
      await expectAccessible();
      await onStepTwo;

      // The timer is anchored to its end time, so a reload keeps it running.
      await verifyAfterReload(async () => {
        await expect(panel).toContainText("Step 2 of 3");
        await expect(riceTimer).toContainText("14:");
      });

      await riceTimer.getByRole("button", { name: "Go to step 1", exact: true }).click();
      await expect(panel).toContainText("Step 1 of 3");
      await expect(stepTimer.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
      await stepTimer.getByRole("button", { name: "Cancel timer", exact: true }).click();
      await expect(stepTimer.getByRole("button", { name: "Start timer", exact: true })).toBeVisible();
      await expect(stepTimer).toContainText("15:00");
      await expect(tray).toBeHidden();
    });

    test("Clear progress unchecks everything and stays cleared after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
      const cookedRice = page.getByRole("checkbox", { name: "Step 1: Cook the rice", exact: true });
      const checkedRows = page.locator('[role="checkbox"][aria-checked="true"]');
      const scaleDisplay = page.getByTestId("scale-display");

      await openLemonRiceDirectly(page);
      // Only the final state matches: nothing checked at 1.25× (the scale changes after the checks).
      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) =>
        progress.scaleFactor === 1.25 && progress.checkedIngredientIds.length === 0 && progress.checkedStepOutputIds.length === 0);
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
      await saved;

      await verifyAfterReload(async () => {
        await expect(scaleDisplay).toHaveText("1.25×");
        await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
        await expect(cookedRice).toHaveAttribute("aria-checked", "false");
        await expect(checkedRows).toHaveCount(0);
      });
      await expectAccessible();
    });
  });

  test.describe("history", () => {
    // The stored session path, not persona("chef").storageState: persona() reads the per-run
    // credentials file, which `playwright test --list` must not need.
    test.use({ storageState: personaStorageStatePath("chef") });

    test("Exit leaves one Back to the page before the recipe", async ({ page, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");

      await openLemonRiceFromHome(page);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(page).toHaveURL(LEMON_RICE_COOK_URL);

      await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(LEMON_RICE_URL);
      await expect(recipeHeading(page)).toBeVisible();

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

    test("after cook mode, the recipe's Back control returns to the page before the recipe", async ({ page, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");
      // The page's own "Recipes" link at the top, on a phone and on desktop alike. It keeps an
      // /recipes href for a recipe opened directly (R-M2-2).
      const backControl = page.getByRole("main").getByRole("link", { name: "Recipes", exact: true });

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
  });
});
