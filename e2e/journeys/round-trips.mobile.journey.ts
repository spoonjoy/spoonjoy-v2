// Round trips on iPhone (read-only, chef session): home -> recipe -> the recipe's Back link -> home, browser Back and Forward, the Recipes tab and its Everyone switch, and the recipe's Back link from a public recipe. Each tab or link tap
// happens exactly once and the very next assertion must pass: nothing needs a second tap. Other
// journeys in the same run add and delete their own recipes, so seeded recipes are located by their
// ids, the public list's recipe is a seeded one, and nothing asserts counts.
import { test, expect } from "./support/journey";
import { pathUrl, recipeLink, waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";
const TOMATO_SOUP = "/recipes/qa-kitchen-recipe-tomato-soup";

test.describe("Round trips on iPhone", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("the recipe's Back link, browser Back and Forward, and the Recipes tab each land on the right page", async ({ page, expectAccessible }) => {
    const main = page.getByRole("main");
    const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    // The recipe page's own Back control: its "Recipes" link at the top of the page.
    const recipeBack = main.getByRole("link", { name: "Recipes", exact: true });
    const kitchenTab = tabBar.getByRole("link", { name: "Kitchen", exact: true });
    const kitchenHeading = page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });
    const allPublicRecipes = page.getByRole("heading", { name: "All public recipes", exact: true });

    await page.goto("/");
    await waitForHydration(page);
    await expect(kitchenHeading).toBeVisible();
    await expect(kitchenTab).toHaveAttribute("aria-current", "page");
    await expectAccessible();

    // Home -> Lemon Herb Rice -> the recipe's Back link returns home, not to /recipes (R-M2-2).
    await recipeLink(main, "Lemon Herb Rice", LEMON_RICE).click();
    await expect(page).toHaveURL(pathUrl(LEMON_RICE));
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(recipeBack).toHaveAttribute("href", "/recipes");
    await expectAccessible();

    await recipeBack.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();
    await expect(kitchenTab).toHaveAttribute("aria-current", "page");

    // Home -> Roasted Tomato Soup, then browser Back and Forward: each stop shows its own content.
    await recipeLink(main, "Roasted Tomato Soup", TOMATO_SOUP).click();
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(page.getByRole("heading", { level: 1, name: "Roasted Tomato Soup", exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();
    await expect(kitchenTab).toHaveAttribute("aria-current", "page");

    await page.goForward();
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(page.getByRole("heading", { level: 1, name: "Roasted Tomato Soup", exact: true })).toBeVisible();
    await expect(main).not.toContainText("Lemon Herb Rice");
    await expectAccessible();

    // The soup was reached from home, so its the recipe's Back link returns home too.
    await recipeBack.click();
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();

    // The Recipes tab, then Everyone in its switch, reaches every public recipe (R-M2-3).
    await tabBar.getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/my-recipes"));
    await page.getByRole("navigation", { name: "Recipe lists" }).getByRole("link", { name: "Everyone", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(allPublicRecipes).toBeVisible();
    await expectAccessible();

    // A public recipe opened from the list: the recipe's Back link returns to the list. Open a
    // seeded recipe, not whichever the list shows first: journeys running alongside this one create
    // public recipes and delete them, so the first card can be gone by the time it is tapped. Each
    // run's QA stack starts from the seed, so its seeded recipes stay on the list and are never
    // deleted.
    const firstListed = main.locator('li a[href^="/recipes/qa-kitchen-recipe-"]').first();
    const firstHref = await firstListed.getAttribute("href");
    expect(firstHref).toMatch(/^\/recipes\/[^/]+$/);
    const cardText = await firstListed.innerText();
    await firstListed.click();
    await expect(page).toHaveURL(pathUrl(firstHref!));
    const recipeTitle = page.getByRole("heading", { level: 1 });
    await expect(recipeTitle).toBeVisible();
    expect(cardText).toContain((await recipeTitle.innerText()).trim());
    await expectAccessible();

    await recipeBack.click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(allPublicRecipes).toBeVisible();
  });

  test("the recipe's Back link on a recipe opened directly goes to all recipes", async ({ page }) => {
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
  });
});
