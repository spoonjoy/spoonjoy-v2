// The recipe dock's list action on iPhone uses the recipe's current scale and then shows that the
// ingredients are on the list. It writes to a shopping list, so it runs as a throwaway user
// (codex-e2e-*, removed by the workflow's QA cleanup) who forks Lemon Herb Rice, leaving the
// personas' lists untouched.
import { test, expect } from "./support/journey";
import { createDisposableE2EUser } from "../support/disposable-auth";
import { pathUrl, waitForHydration } from "./support/navigation";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";

test.describe("Recipe dock list action on iPhone", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the dock adds ingredients at the current scale and then reads as already on the list @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    const user = createDisposableE2EUser();
    const dock = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    const scaleDisplay = page.getByTestId("scale-display");
    const increaseScale = page.getByRole("button", { name: "Increase scale" });

    // Sign up as the throwaway user.
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Username", { exact: true }).fill(user.username);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByLabel("Confirm Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));

    // Fork Lemon Herb Rice, so the throwaway user owns the copy whose ingredients get added.
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await page.getByTestId("recipe-header-fork-action").click();
    const forkDialog = page.getByRole("dialog", { name: 'Fork "Lemon Herb Rice"?' });
    await expect(forkDialog).toBeVisible();
    await forkDialog.getByRole("button", { name: "Fork", exact: true }).click();
    await expect(page).not.toHaveURL(pathUrl(LEMON_RICE));
    await expect(page).toHaveURL(/\/recipes\/[^/?#]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(dock.getByRole("link", { name: "Edit", exact: true })).toBeVisible();

    // 2×, four presses of 0.25.
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.25×");
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.5×");
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.75×");
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("2×");

    await dock.getByRole("button", { name: "Add ingredients to shopping list", exact: true }).click();
    // The toast appears once QA's add-and-reload round trip finishes, which can be slow.
    await expect(page.getByRole("status").filter({ hasText: "4 items added at 2x" })).toBeVisible({ timeout: 15_000 });
    await expect(dock.getByRole("button", { name: "Ingredients already in shopping list", exact: true })).toBeVisible();
    await expectAccessible();

    // The list holds the 2× quantities (jasmine rice 1 cup -> 2 cup, chicken stock 2 cup -> 4 cup).
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
    const chickenStock = page.getByRole("checkbox", { name: "chicken stock", exact: true });
    await page.goto("/shopping-list");
    await expect(jasmineRice).toContainText("2 cup");
    await expect(chickenStock).toContainText("4 cup");

    await verifyAfterReload(async () => {
      await expect(jasmineRice).toContainText("2 cup");
      await expect(chickenStock).toContainText("4 cup");
    });
    await expectAccessible();
  });
});
