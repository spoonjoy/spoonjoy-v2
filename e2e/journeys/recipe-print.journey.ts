// Printing a recipe on both devices (read-only, signed out): with print media the page keeps the title,
// yield, steps, ingredients and where the recipe lives, and drops the tab bar, the page actions, the
// scale control, the cook's tick boxes and the cooks log (product audit 2026-10-09, finding 14). It
// prints the seeded Lemon Herb Rice and changes nothing.
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";

test.describe("Printing a recipe", () => {
  test("the printed page is the recipe, without the screen controls", async ({ page }) => {
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await page.emulateMedia({ media: "print" });

    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Steps", exact: true })).toBeVisible();
    await expect(page.getByText("Simmer rice in stock until tender.", { exact: true })).toBeVisible();
    await expect(page.getByText("jasmine rice", { exact: true })).toBeVisible();
    await expect(page.getByTestId("recipe-print-source")).toContainText(LEMON_RICE);

    await expect(page.getByRole("navigation", { name: "Spoonjoy navigation" })).toBeHidden();
    await expect(page.getByTestId("recipe-masthead")).toBeHidden();
    await expect(page.getByTestId("recipe-header-controls")).toBeHidden();
    await expect(page.getByTestId("recipe-cooks")).toBeHidden();
    await expect(page.getByText("Tap ingredients as you go", { exact: true })).toBeHidden();
    await expect(page.locator("#steps .sj-checklist-box").first()).toBeHidden();
    await expect(page.locator(".sj-skip-link")).toBeHidden();

    // Back on screen, everything returns.
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByTestId("recipe-header-controls")).toBeVisible();
    await expect(page.getByTestId("recipe-print-source")).toBeHidden();
  });
});
