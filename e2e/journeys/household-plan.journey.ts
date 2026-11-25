// A household's meal plan on both devices, as scratch user 15 (AGENTS.md's scratch index table): the cook makes a
// household and a Groceries list for it, plans two seeded recipes on the household's week, and adds the two meals to
// the list. Both recipes use chicken stock by the cup, so the list holds one combined line for it. A third meal
// planned afterwards makes the button offer that one meal alone, and adding it puts only its lines on the list. After
// a reload the plan says the week is on the list, and the list holds all three meals. The week is a fixed one far
// from today, so the run's date never moves the days.
//
// The two device projects run at the same time, so each device signs in as its own account: scratch 15's base account
// on iPhone, its desktop twin on desktop Chrome (support/personas.ts's scratchStorageStateForProject). The household's
// name carries a run tag, so each run's household is its own. The households flag is on in QA.
import { test, expect } from "./support/journey";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";

const WEEK = "2027-03-01";
const HOUSEHOLD_URL = /\/households\/[0-9a-f-]{36}$/;
// The QA kitchen's seeded recipes (scripts/seed-qa-kitchen.mjs): Lemon Herb Rice uses 2 cups of chicken stock and
// Saffron Risotto 4, and each has three other ingredients of its own.
const LEMON_RICE = { id: "qa-kitchen-recipe-lemon-rice", title: "Lemon Herb Rice" };
const RISOTTO = { id: "qa-kitchen-recipe-risotto", title: "Saffron Risotto" };
// Roasted Tomato Soup's three ingredients share none with the other two.
const TOMATO_SOUP = { id: "qa-kitchen-recipe-tomato-soup", title: "Roasted Tomato Soup" };
const COMBINED_STOCK = "6 cup chicken stock";
const LINES_FOR_THREE_MEALS = 10;

/** Attaches a screenshot of one element, scrolled into view first, so the phone's tab bar never covers it. */
async function attachElement(testInfo: TestInfo, name: string, element: Locator) {
  await element.scrollIntoViewIfNeeded();
  await testInfo.attach(name, { body: await element.screenshot({ animations: "disabled" }), contentType: "image/png" });
}

/** Plans `recipe` on the week's first day from the link a recipe page gives, and waits for it to show. */
async function planRecipe(page: Page, planPath: string, recipe: { id: string; title: string }) {
  await page.goto(`${planPath}?week=${WEEK}&recipe=${recipe.id}`);
  await waitForHydration(page);
  const sheet = page.getByRole("dialog", { name: "Add to Monday, Mar 1", exact: true });
  await expect(sheet.getByRole("combobox", { name: "Recipe", exact: true })).toHaveValue(recipe.id);
  await sheet.getByRole("button", { name: "Add to plan", exact: true }).click();
  await expect(sheet).toBeHidden();
  const monday = page.getByRole("region", { name: "Monday, Mar 1", exact: true });
  await expect(monday.getByRole("link", { name: new RegExp(`^${recipe.title}`) })).toBeVisible();
}

test.describe("Household meal plan", () => {
  test.use({ storageState: scratchStorageStateForProject(15) });

  test("a household's planned meals go on its list once each, with shared ingredients combined @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    // Some 15 page loads on a shared QA Worker, so it gets more than the 60 s default.
    test.setTimeout(120_000);
    const name = `The Ortiz kitchen ${Date.now().toString(36)}`;

    // A household with a Groceries list.
    await page.goto("/households");
    await waitForHydration(page);
    await page.getByLabel("Household name").fill(name);
    await page.getByRole("button", { name: "Create household", exact: true }).click();
    await expect(page).toHaveURL(HOUSEHOLD_URL);
    const householdPath = new URL(page.url()).pathname;
    await page.getByRole("link", { name: /Shopping lists/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Shopping lists", exact: true })).toBeVisible();
    await page.getByLabel("List name").fill("Groceries");
    await page.getByRole("button", { name: "Make list", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Groceries", exact: true })).toBeVisible();
    const listPath = new URL(page.url()).pathname;

    // The household's plan, opened from Shared on the household's page.
    await page.goto(householdPath);
    await waitForHydration(page);
    await page.getByRole("link", { name: /Meal plan/ }).click();
    // Wait for the plan's own URL: the household's name is on the household page too.
    const planPath = `${householdPath}/plan`;
    await expect(page).toHaveURL(pathUrl(planPath));
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    // Two recipes on Monday.
    await planRecipe(page, planPath, LEMON_RICE);
    await planRecipe(page, planPath, RISOTTO);
    await page.goto(`${planPath}?week=${WEEK}`);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Week of Mar 1", exact: true })).toBeVisible();
    await expectAccessible();
    await attachElement(testInfo, "household-plan-week", page.getByRole("main"));

    // The two meals go on Groceries, with the stock on one line.
    await expect(page.getByRole("combobox", { name: "Shopping list", exact: true })).toHaveValue(/.+/);
    await page.getByRole("button", { name: "Add 2 meals to the list", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 2 meals to Groceries." })).toBeVisible();
    const done = page.getByRole("button", { name: "This week is on your list", exact: true });
    await expect(done).toHaveAttribute("aria-disabled", "true");
    await attachElement(testInfo, "household-plan-week-added", page.getByRole("main"));

    // A third meal planned afterwards is the only one the button offers, and adding it adds only its lines.
    await planRecipe(page, planPath, TOMATO_SOUP);
    await page.getByRole("button", { name: "Add 1 meal to the list", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 1 meal to Groceries." })).toBeVisible();

    // After a reload the plan still says so, from what each meal recorded. The week's own address, without the
    // ?recipe= that opens the add sheet.
    await page.goto(`${planPath}?week=${WEEK}`);
    await waitForHydration(page);
    await verifyAfterReload(async () => {
      await expect(done).toHaveAttribute("aria-disabled", "true");
      const monday = page.getByRole("region", { name: "Monday, Mar 1", exact: true });
      await expect(monday.getByText(/On your list/)).toHaveCount(3);
    });
    await attachElement(testInfo, "household-plan-week-on-list", page.getByRole("main"));

    await page.goto(listPath);
    await waitForHydration(page);
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Groceries", exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: COMBINED_STOCK, exact: true })).toHaveCount(1);
      await expect(page.getByRole("checkbox", { name: /chicken stock/ })).toHaveCount(1);
      await expect(page.getByRole("checkbox", { name: "6 whole tomato", exact: true })).toHaveCount(1);
      await expect(page.getByRole("main").getByRole("checkbox")).toHaveCount(LINES_FOR_THREE_MEALS);
    });
    await expectAccessible();
    await attachElement(testInfo, "household-list-after-week", page.getByRole("main"));
  });
});
