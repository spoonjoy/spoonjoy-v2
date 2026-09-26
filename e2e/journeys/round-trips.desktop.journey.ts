// Round trips on desktop Chrome (read-only, chef session): every link in the desktop Main
// navigation lands on its page and is the one marked current, and the recipe page's "Recipes" link
// returns to the page the cook came from. Each click happens exactly once and the very next
// assertion must pass. QA also holds unrelated data, so recipes are located by their seeded ids and
// nothing asserts counts or positions.
import { test, expect } from "./support/journey";
import { pathUrl, recipeLink, waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";
const TOMATO_SOUP = "/recipes/qa-kitchen-recipe-tomato-soup";

test.describe("Round trips on desktop", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("every Main navigation link lands on its page and is the one marked current", async ({ page, expectAccessible }) => {
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const kitchen = nav.getByRole("link", { name: "Kitchen", exact: true });
    const recipes = nav.getByRole("link", { name: "Recipes", exact: true });
    const myRecipes = nav.getByRole("link", { name: "My Recipes", exact: true });
    const saved = nav.getByRole("link", { name: "Saved", exact: true });
    const cookbooks = nav.getByRole("link", { name: "Cookbooks", exact: true });
    const shoppingList = nav.getByRole("link", { name: "Shopping List", exact: true });
    const chefs = nav.getByRole("link", { name: "Chefs", exact: true });
    const kitchenSearch = nav.getByRole("link", { name: "Kitchen Search", exact: true });

    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true })).toBeVisible();
    await expect(kitchen).toHaveAttribute("data-current", "true");
    await expectAccessible();

    // Recipes is reachable when signed in (R-M2-3).
    await recipes.click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
    await expect(recipes).toHaveAttribute("data-current", "true");
    await expect(kitchen).toHaveAttribute("data-current", "false");
    await expectAccessible();

    await myRecipes.click();
    await expect(page).toHaveURL(pathUrl("/my-recipes"));
    await expect(page.getByRole("heading", { level: 1, name: "My Recipes", exact: true })).toBeVisible();
    await expect(myRecipes).toHaveAttribute("data-current", "true");
    await expect(recipes).toHaveAttribute("data-current", "false");
    await expectAccessible();

    await saved.click();
    await expect(page).toHaveURL(pathUrl("/saved-recipes"));
    await expect(page.getByRole("heading", { level: 1, name: "Saved Recipes", exact: true })).toBeVisible();
    await expect(saved).toHaveAttribute("data-current", "true");
    await expectAccessible();

    await cookbooks.click();
    await expect(page).toHaveURL(pathUrl("/cookbooks"));
    await expect(page.getByRole("heading", { level: 1, name: "Cookbooks", exact: true })).toBeVisible();
    await expect(cookbooks).toHaveAttribute("data-current", "true");
    await expectAccessible();

    await shoppingList.click();
    await expect(page).toHaveURL(pathUrl("/shopping-list"));
    await expect(page.getByRole("heading", { level: 1, name: "Shopping list", exact: true })).toBeVisible();
    await expect(shoppingList).toHaveAttribute("data-current", "true");
    await expectAccessible();

    await chefs.click();
    await expect(page).toHaveURL(pathUrl("/chefs"));
    await expect(page.getByRole("heading", { level: 1, name: "Chefs", exact: true })).toBeVisible();
    await expect(chefs).toHaveAttribute("data-current", "true");
    await expectAccessible();

    await kitchenSearch.click();
    await expect(page).toHaveURL(pathUrl("/search"));
    await expect(page.getByRole("heading", { level: 1, name: "Find the thing you meant to cook.", exact: true })).toBeVisible();
    await expect(kitchenSearch).toHaveAttribute("data-current", "true");
    await expectAccessible();

    await kitchen.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true })).toBeVisible();
    await expect(kitchen).toHaveAttribute("data-current", "true");
    await expect(kitchenSearch).toHaveAttribute("data-current", "false");
  });

  test("the recipe page's Recipes link goes back to the page the cook came from", async ({ page, expectAccessible }) => {
    const main = page.getByRole("main");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    // The recipe page's own link; the Main navigation also has a "Recipes" link, so scope to main.
    const recipesLink = main.getByRole("link", { name: "Recipes", exact: true });
    const myRecipesHeading = page.getByRole("heading", { level: 1, name: "My Recipes", exact: true });
    const kitchenHeading = page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });
    const soupHeading = page.getByRole("heading", { level: 1, name: "Roasted Tomato Soup", exact: true });

    // My Recipes -> Lemon Herb Rice -> "Recipes" returns to My Recipes, not /recipes (R-M2-2).
    await page.goto("/my-recipes");
    await waitForHydration(page);
    await expect(myRecipesHeading).toBeVisible();

    await recipeLink(main, "Lemon Herb Rice", LEMON_RICE).click();
    await expect(page).toHaveURL(pathUrl(LEMON_RICE));
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(recipesLink).toHaveAttribute("href", "/recipes");
    await expectAccessible();

    await recipesLink.click();
    await expect(page).toHaveURL(pathUrl("/my-recipes"));
    await expect(myRecipesHeading).toBeVisible();
    await expect(nav.getByRole("link", { name: "My Recipes", exact: true })).toHaveAttribute("data-current", "true");

    // Kitchen -> Roasted Tomato Soup -> "Recipes" returns to the kitchen.
    await nav.getByRole("link", { name: "Kitchen", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();

    await recipeLink(main, "Roasted Tomato Soup", TOMATO_SOUP).click();
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(soupHeading).toBeVisible();

    await recipesLink.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();

    // Forward and Back again: each stop shows its own content, nothing stale.
    await page.goForward();
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(soupHeading).toBeVisible();
    await expect(main).not.toContainText("Lemon Herb Rice");

    await page.goBack();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();
    await expect(nav.getByRole("link", { name: "Kitchen", exact: true })).toHaveAttribute("data-current", "true");
  });

  test("the Recipes link on a recipe opened directly goes to all recipes", async ({ page }) => {
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
  });
});
