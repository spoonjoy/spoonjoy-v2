// Unit conversion on Lemon Herb Rice: the cook picks metric, US or imperial in the recipe's scale popover or in
// cook mode, every amount follows, and the choice outlasts a reload. The choice is a cookie in this browser
// (`sj_units`), not account data, so the chef persona's kitchen stays as seeded; each test's browser context starts
// without the cookie, so the recipe opens as written.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";

// A checklist row's amount is the end of its checkbox's description (its aisle comes first).
function amount(text: string) {
  return new RegExp(`(^| )${text}$`);
}

async function openLemonRice(page: Page) {
  await page.goto(LEMON_RICE);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
}

// The units sit under the scale, in the "Serves" capsule's popover.
async function pickUnitsOnRecipe(page: Page, system: string) {
  await page.getByTestId("recipe-serves-trigger").click();
  const units = page.getByRole("radiogroup", { name: "Units", exact: true });
  await expect(units).toBeVisible();
  await units.getByRole("radio", { name: system, exact: true }).click();
  await expect(units.getByRole("radio", { name: system, exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(units).toBeHidden();
}

test.describe("Unit conversion", () => {
  test.use({ storageState: personaStorageStatePath("chef") });

  test("metric on the recipe page converts every amount and survives a reload", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });

    await openLemonRice(page);
    await expect(jasmineRice).toHaveAccessibleDescription(amount("1 cup"));

    await pickUnitsOnRecipe(page, "Metric");
    await expect(jasmineRice).toHaveAccessibleDescription(amount("235 ml"));

    await verifyAfterReload(async () => {
      await expect(jasmineRice).toHaveAccessibleDescription(amount("235 ml"));
    });
    await testInfo.attach("recipe-metric-after-reload", { body: await page.getByTestId("step-ingredients-block").first().screenshot(), contentType: "image/png" });

    // Back to the recipe as written.
    await pickUnitsOnRecipe(page, "Original");
    await expect(jasmineRice).toHaveAccessibleDescription(amount("1 cup"));
    await expectAccessible();
  });

  test("cook mode switches between US and imperial and keeps the choice for the recipe page", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    const panel = page.getByTestId("cook-mode-panel");
    const units = panel.getByRole("radiogroup", { name: "Units", exact: true });
    const jasmineRice = panel.getByRole("checkbox", { name: "jasmine rice", exact: true });

    await openLemonRice(page);
    await page.getByRole("link", { name: "Cook mode", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(jasmineRice).toHaveAccessibleDescription(amount("1 cup"));

    await units.getByRole("radio", { name: "Imperial", exact: true }).click();
    await expect(jasmineRice).toHaveAccessibleDescription(amount("8 ½ fl oz"));
    await testInfo.attach("cook-mode-imperial", { body: await panel.screenshot(), contentType: "image/png" });
    await expectAccessible();

    await units.getByRole("radio", { name: "Metric", exact: true }).click();
    await expect(jasmineRice).toHaveAccessibleDescription(amount("235 ml"));

    await verifyAfterReload(async () => {
      await expect(panel).toBeVisible();
      await expect(units.getByRole("radio", { name: "Metric", exact: true })).toBeChecked();
      await expect(jasmineRice).toHaveAccessibleDescription(amount("235 ml"));
    });

    await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("checkbox", { name: "jasmine rice", exact: true })).toHaveAccessibleDescription(amount("235 ml"));
  });
});

test.describe("Unit conversion on the shopping list", () => {
  test.use({ storageState: personaStorageStatePath("chef") });

  test("the list's menu switches its amounts to metric, and the choice survives a reload", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    // The chef's seeded list holds 1 cup of jasmine rice (scripts/seed-qa-kitchen.mjs).
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });

    await page.goto("/shopping-list");
    await waitForHydration(page);
    await expect(jasmineRice).toHaveAccessibleDescription(amount("1 cup"));

    await page.getByRole("button", { name: "List actions", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Metric", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Metric", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(jasmineRice).toHaveAccessibleDescription(amount("235 ml"));

    await verifyAfterReload(async () => {
      await expect(jasmineRice).toHaveAccessibleDescription(amount("235 ml"));
    });
    await testInfo.attach("shopping-list-metric-after-reload", { body: await page.getByTestId("shopping-list-checklist-board").screenshot(), contentType: "image/png" });
    await expectAccessible();
  });
});
