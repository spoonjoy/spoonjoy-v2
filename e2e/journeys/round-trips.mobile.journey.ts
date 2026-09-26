// Round trips on iPhone (read-only, chef session): home -> recipe -> dock Back -> home, browser Back
// and Forward, the pantry's Recipes link, and dock Back from a public recipe. Each dock or link tap
// happens exactly once and the very next assertion must pass: nothing needs a second tap. QA also
// holds unrelated data, so recipes are located by their seeded ids and nothing asserts counts or
// positions.
import { test, expect } from "./support/journey";
import { pathUrl, recipeLink, waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";
const TOMATO_SOUP = "/recipes/qa-kitchen-recipe-tomato-soup";
const RISOTTO = "/recipes/qa-kitchen-recipe-risotto";

test.describe("Round trips on iPhone", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("dock Back, browser Back and Forward, and the pantry Recipes link each land on the right page", async ({ page, expectAccessible }) => {
    const main = page.getByRole("main");
    const dock = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    const dockBack = dock.getByRole("link", { name: /Back/ });
    const kitchenPlace = dock.getByRole("link", { name: "My Kitchen", exact: true });
    const kitchenHeading = page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });
    const allPublicRecipes = page.getByRole("heading", { name: "All public recipes", exact: true });

    await page.goto("/");
    await waitForHydration(page);
    await expect(kitchenHeading).toBeVisible();
    await expect(kitchenPlace).toHaveAttribute("aria-current", "page");
    await expectAccessible();

    // Home -> Lemon Herb Rice -> dock Back returns home, not to /recipes (R-M2-2).
    await recipeLink(main, "Lemon Herb Rice", LEMON_RICE).click();
    await expect(page).toHaveURL(pathUrl(LEMON_RICE));
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(dockBack).toHaveAttribute("href", "/recipes");
    await expectAccessible();

    await dockBack.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();
    await expect(kitchenPlace).toHaveAttribute("aria-current", "page");

    // Home -> Roasted Tomato Soup, then browser Back and Forward: each stop shows its own content.
    await recipeLink(main, "Roasted Tomato Soup", TOMATO_SOUP).click();
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(page.getByRole("heading", { level: 1, name: "Roasted Tomato Soup", exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();
    await expect(kitchenPlace).toHaveAttribute("aria-current", "page");

    await page.goForward();
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(page.getByRole("heading", { level: 1, name: "Roasted Tomato Soup", exact: true })).toBeVisible();
    await expect(main).not.toContainText("Lemon Herb Rice");
    await expectAccessible();

    // The soup was reached from home, so its dock Back returns home too.
    await dockBack.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();

    // Pantry -> Recipes reaches every public recipe (R-M2-3).
    await dock.getByRole("button", { name: "Open pantry navigation" }).click();
    await page.getByTestId("mobile-pantry").getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(allPublicRecipes).toBeVisible();
    await expectAccessible();

    // A friend's public recipe opened from the list: dock Back returns to the list.
    await recipeLink(main, "Saffron Risotto", RISOTTO).click();
    await expect(page).toHaveURL(pathUrl(RISOTTO));
    await expect(page.getByRole("heading", { level: 1, name: "Saffron Risotto", exact: true })).toBeVisible();
    await expectAccessible();

    await dockBack.click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(allPublicRecipes).toBeVisible();
  });

  test("dock Back on a recipe opened directly goes to all recipes", async ({ page }) => {
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();

    await page.getByRole("navigation", { name: "Spoonjoy navigation" }).getByRole("link", { name: /Back/ }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
  });
});
