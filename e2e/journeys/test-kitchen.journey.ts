// The Test Kitchen (signed out): anyone can cook Spoonjoy's showcase recipe without an account. Its
// progress lives in this browser only, so ticks survive a reload, X-ray outlines every Ouro HX
// component, and "Reset the kitchen" starts over. Nothing here touches QA data.
import { test, expect } from "./support/journey";
import { expectNoHydrationErrors } from "./support/hydration";
import { waitForHydration } from "./support/navigation";

const FIRST_STEP = ["cooked chickpeas", "olive oil", "smoked paprika", "salt"];

test.describe("Test Kitchen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor ticks off step one, sees it after a reload, opens X-ray and resets the kitchen @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await page.goto("/test-kitchen");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Spoonjoy Test Kitchen", exact: true })).toBeVisible();
    await expectNoHydrationErrors(page);
    await expectAccessible();

    const ingredients = page.getByRole("group", { name: "Ingredients", exact: true }).first();
    await ingredients.getByRole("checkbox", { name: "cooked chickpeas", exact: true }).click();
    await ingredients.getByRole("checkbox", { name: "olive oil", exact: true }).click();
    await ingredients.getByRole("checkbox", { name: "smoked paprika", exact: true }).click();
    await ingredients.getByRole("checkbox", { name: "salt", exact: true }).click();
    const expectFirstStepTicked = async () => {
      for (const name of FIRST_STEP) {
        await expect(page.getByRole("checkbox", { name, exact: true })).toHaveAttribute("aria-checked", "true");
      }
    };
    await expectFirstStepTicked();
    await verifyAfterReload(async () => {
      await waitForHydration(page);
      await expectFirstStepTicked();
    });

    const xray = page.getByRole("switch", { name: "X-ray", exact: true });
    await xray.click();
    const bar = page.getByRole("group", { name: "X-ray", exact: true });
    await expect(bar).toBeVisible();
    await expect(page.locator('[data-ouro-control="inspector"][data-ouro-part="tag"]').first()).toBeAttached();
    await bar.getByRole("button", { name: /close/i }).click();
    await expect(bar).toBeHidden();
    await expect(xray).toHaveAttribute("aria-checked", "false");

    await page.getByRole("button", { name: "Reset the kitchen", exact: true }).click();
    const expectFresh = async () => {
      for (const name of FIRST_STEP) {
        await expect(page.getByRole("checkbox", { name, exact: true })).toHaveAttribute("aria-checked", "false");
      }
    };
    await expectFresh();
    await verifyAfterReload(async () => {
      await waitForHydration(page);
      await expectFresh();
    });
  });

  test("?xray opens X-ray on arrival", async ({ page }) => {
    await page.goto("/test-kitchen?xray");
    await waitForHydration(page);
    await expect(page.getByRole("group", { name: "X-ray", exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "X-ray", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
