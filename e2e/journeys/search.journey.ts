// Search journey (read-only): the chef searches by title and ingredient, moves between scopes,
// runs a pantry query, hits the empty state with odd input, and uses the /recipes search box.
// QA also holds unrelated legacy data, and other journeys can create recipes with the seeded titles
// (a throwaway fork of Lemon Herb Rice) while these run, so these tests only assert on seeded
// qa-kitchen records, located by name and seeded URL, and never on result counts or positions.
import { test, expect } from "./support/journey";
import { seededCookbookLink, seededRecipeLink } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";
const TOMATO_SOUP = "/recipes/qa-kitchen-recipe-tomato-soup";
const RISOTTO = "/recipes/qa-kitchen-recipe-risotto";
const WEEKNIGHT = "/cookbooks/qa-kitchen-cookbook-weeknight";

test.describe("Search", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("a title search survives opening a result and coming back", async ({ page, expectAccessible }) => {
    await page.goto("/search");
    await page.getByLabel("Search terms", { exact: true }).fill("saffron");
    await page.getByLabel("Search terms", { exact: true }).press("Enter");
    await expect(page).toHaveURL(/[?&]q=saffron(?:&|$)/);
    await expect(page.getByRole("heading", { name: 'Results for "saffron"', exact: true })).toBeVisible();
    const results = page.getByRole("region", { name: "Search results" });
    await expect(seededRecipeLink(results, "Saffron Risotto", RISOTTO)).toBeVisible();
    // The result's link is named by the card's type, title and byline, not by its title alone, and
    // described by the matching text.
    await expect(seededRecipeLink(results, "Saffron Risotto", RISOTTO)).toHaveAccessibleName("Recipe Saffron Risotto Recipe by qa_kitchen_friend");
    await expect(seededRecipeLink(results, "Saffron Risotto", RISOTTO)).toHaveAccessibleDescription(/saffron/i);
    await expectAccessible();

    await seededRecipeLink(results, "Saffron Risotto", RISOTTO).click();
    await expect(page).toHaveURL(/\/recipes\/qa-kitchen-recipe-risotto(?:[?#].*)?$/);
    await expect(page.getByRole("heading", { level: 1, name: "Saffron Risotto", exact: true })).toBeVisible();
    await expectAccessible();

    await page.goBack();
    await expect(page).toHaveURL(/[?&]q=saffron(?:&|$)/);
    await expect(page.getByRole("heading", { name: 'Results for "saffron"', exact: true })).toBeVisible();
    await expect(page.getByLabel("Search terms", { exact: true })).toHaveValue("saffron");
    await expectAccessible();
  });

  test("Back and Forward between two searches keep the box and the results in step", async ({ page, expectAccessible }) => {
    await page.goto("/search");
    await page.getByLabel("Search terms", { exact: true }).fill("lemon");
    await page.getByLabel("Search terms", { exact: true }).press("Enter");
    await expect(page).toHaveURL(/[?&]q=lemon(?:&|$)/);
    await expect(page.getByRole("heading", { name: 'Results for "lemon"', exact: true })).toBeVisible();
    // If the first search was a full-document submit (typed before hydration), wait until React
    // Router has started hydrating this document before the second search. React Router sets
    // this global while hydrating, after React's root event listeners exist, so Enter goes
    // through the app's handler (a client-side navigation) rather than a native form submit.
    await page.waitForFunction(() => "__reactRouterDataRouter" in window);

    await page.getByLabel("Search terms", { exact: true }).fill("saffron");
    await page.getByLabel("Search terms", { exact: true }).press("Enter");
    await expect(page).toHaveURL(/[?&]q=saffron(?:&|$)/);
    await expect(page.getByRole("heading", { name: 'Results for "saffron"', exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/[?&]q=lemon(?:&|$)/);
    await expect(page.getByRole("heading", { name: 'Results for "lemon"', exact: true })).toBeVisible();
    await expect(page.getByLabel("Search terms", { exact: true })).toHaveValue("lemon");
    await expectAccessible();

    await page.goForward();
    await expect(page).toHaveURL(/[?&]q=saffron(?:&|$)/);
    await expect(page.getByRole("heading", { name: 'Results for "saffron"', exact: true })).toBeVisible();
    await expect(page.getByLabel("Search terms", { exact: true })).toHaveValue("saffron");
    await expectAccessible();
  });

  test("an ingredient search finds the recipe that uses it", async ({ page, expectAccessible }) => {
    await page.goto("/search");
    await page.getByLabel("Search terms", { exact: true }).fill("arborio");
    await page.getByLabel("Search terms", { exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: 'Results for "arborio"', exact: true })).toBeVisible();
    await expect(
      seededRecipeLink(page.getByRole("region", { name: "Search results" }), "Saffron Risotto", RISOTTO),
    ).toBeVisible();
    await expectAccessible();
  });

  test("scope links narrow the results to one kind of thing", async ({ page, expectAccessible }) => {
    await page.goto("/search?q=lemon");
    const main = page.getByRole("main");
    const results = page.getByRole("region", { name: "Search results" });

    await main.getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(/[?&]scope=recipes(?:&|$)/);
    await expect(main.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();
    await expect(seededRecipeLink(results, "Lemon Herb Rice", LEMON_RICE)).toBeVisible();
    await expect(results.getByRole("link", { name: /^Cookbook / })).toHaveCount(0);
    await expectAccessible();

    await main.getByRole("link", { name: "Cookbooks", exact: true }).click();
    await expect(page).toHaveURL(/[?&]scope=cookbooks(?:&|$)/);
    await expect(main.getByRole("heading", { name: "Cookbooks", exact: true })).toBeVisible();
    await expect(seededCookbookLink(results, "Weeknight Dinners", WEEKNIGHT)).toBeVisible();
    await expect(results.getByRole("link", { name: /^Recipe / })).toHaveCount(0);
    await expectAccessible();
  });

  test("a comma-separated pantry query finds recipes matching any ingredient", async ({ page, expectAccessible }) => {
    await page.goto("/search");
    await page.getByLabel("Search terms", { exact: true }).fill("tomato, lemon");
    await page.getByLabel("Search terms", { exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: 'Results for "tomato, lemon"', exact: true })).toBeVisible();
    const results = page.getByRole("region", { name: "Search results" });
    await expect(seededRecipeLink(results, "Roasted Tomato Soup", TOMATO_SOUP)).toBeVisible();
    await expect(seededRecipeLink(results, "Lemon Herb Rice", LEMON_RICE)).toBeVisible();
    await expectAccessible();
  });

  test("no-match and odd input show the empty state without page errors", async ({ page, expectAccessible }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    const searchBox = page.getByLabel("Search terms", { exact: true });
    const emptyState = page.getByRole("heading", { name: "No matches yet", exact: true });

    await page.goto("/search");
    await searchBox.fill("zzqqxxnomatch");
    await searchBox.press("Enter");
    await expect(page.getByRole("heading", { name: 'Results for "zzqqxxnomatch"', exact: true })).toBeVisible();
    await expect(emptyState).toBeVisible();
    await expectAccessible();

    await searchBox.fill("%%");
    await searchBox.press("Enter");
    await expect(page.getByRole("heading", { name: 'Results for "%%"', exact: true })).toBeVisible();
    await expect(emptyState).toBeVisible();
    await expectAccessible();

    await searchBox.fill("<script>");
    await searchBox.press("Enter");
    await expect(page.getByRole("heading", { name: 'Results for "<script>"', exact: true })).toBeVisible();
    await expect(emptyState).toBeVisible();
    await expectAccessible();

    expect(pageErrors).toEqual([]);
  });

  test("the recipes page search box finds and clears a search", async ({ page, expectAccessible }) => {
    await page.goto("/recipes");
    const main = page.getByRole("main");
    await main.getByLabel("Search recipes", { exact: true }).fill("tomato");
    await main.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/[?&]q=tomato(?:&|$)/);
    await expect(main.getByRole("heading", { name: 'Recipes for "tomato"', exact: true })).toBeVisible();
    await expect(seededRecipeLink(main, "Roasted Tomato Soup", TOMATO_SOUP)).toBeVisible();
    await expectAccessible();

    // "Clear" is a link styled as a button (Button with href), so it has the link role.
    await main.getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL(/\/recipes(?:#.*)?$/);
    await expect(main.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
    await expectAccessible();
  });
});
