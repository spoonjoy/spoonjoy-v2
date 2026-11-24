// Meal planner on both devices, as scratch user 9 (AGENTS.md's scratch index table): open the week from the page a
// recipe links to, plan that chef's seeded recipe at twice its size by pressing an empty day, add a note from another
// day's Add, put the week on the shopping list (the salmon's ingredients at twice their amounts), and remove the note;
// each change survives a reload. The week is a fixed one far from today, so the run's date never moves the days.
//
// A cook has one plan, and the two device projects run at the same time, so each device signs in as its own account:
// scratch 9's base account on iPhone, its desktop twin on desktop Chrome (support/personas.ts's
// scratchStorageStateForProject). Each device owns its whole plan, so the test asserts on the week's full contents.
import { test, expect } from "./support/journey";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { personaStorageStatePath, scratchStorageStateForProject } from "./support/personas";

const WEEK = "2027-03-01";
const SALMON = { id: "qa-kitchen-recipe-salmon", title: "Miso Glazed Salmon" };
const PLAN_SALMON = `/plan?week=${WEEK}&recipe=${SALMON.id}`;

function day(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function addSheet(page: Page, name: string) {
  return page.getByRole("dialog", { name: `Add to ${name}`, exact: true });
}

/** Attaches a screenshot of one element, scrolled into view first, so the phone's tab bar never covers it. */
async function attachElement(testInfo: TestInfo, name: string, element: Locator) {
  await element.scrollIntoViewIfNeeded();
  await testInfo.attach(name, { body: await element.screenshot({ animations: "disabled" }), contentType: "image/png" });
}

test.describe("Meal planner", () => {
  test.use({ storageState: scratchStorageStateForProject(9) });

  test("a planned recipe and a note land on their days, and a removed note stays gone @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    const tuesday = day(page, "Tuesday, Mar 2");
    const thursday = day(page, "Thursday, Mar 4");

    await page.goto(PLAN_SALMON);
    await waitForHydration(page);
    // Opened from a recipe's link, the week opens its first day's sheet on that recipe; close it to pick the day.
    const mondaySheet = addSheet(page, "Monday, Mar 1");
    await expect(mondaySheet.getByRole("combobox", { name: "Recipe", exact: true })).toHaveValue(SALMON.id);
    await mondaySheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(mondaySheet).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Week of Mar 1", exact: true })).toBeVisible();
    await expectAccessible();

    // An empty day is the way to plan it: no "nothing planned" line, just its button.
    const planTuesday = tuesday.getByRole("button", { name: "Plan a meal for Tuesday", exact: true });
    await expect(page.getByText("Nothing planned yet.", { exact: true })).toHaveCount(0);
    await attachElement(testInfo, "meal-planner-empty-day", tuesday);
    await planTuesday.click();
    const tuesdaySheet = addSheet(page, "Tuesday, Mar 2");
    await expect(tuesdaySheet.getByRole("combobox", { name: "Recipe", exact: true })).toHaveValue(SALMON.id);
    await tuesdaySheet.getByRole("combobox", { name: "Meal", exact: true }).selectOption({ label: "Dinner" });
    await tuesdaySheet.getByRole("textbox", { name: "Scale", exact: true }).fill("2");
    await expectAccessible();
    await attachElement(testInfo, "meal-planner-day-sheet-recipe", tuesdaySheet);
    await tuesdaySheet.getByRole("button", { name: "Add to plan", exact: true }).click();
    await expect(tuesdaySheet).toBeHidden();
    await expect(page).toHaveURL(pathUrl(`/plan?week=2027-03-02`));
    const salmon = tuesday.getByRole("link", { name: new RegExp(`^${SALMON.title}`) });
    await expect(salmon).toHaveAttribute("href", `/recipes/${SALMON.id}?scale=2`);
    await expect(tuesday.getByText("Dinner · 2× the recipe", { exact: true })).toBeVisible();
    await expect(planTuesday).toHaveCount(0);

    // A note for Thursday's lunch, from the day's own Add.
    await thursday.getByRole("button", { name: "Add to Thursday", exact: true }).click();
    const thursdaySheet = addSheet(page, "Thursday, Mar 4");
    await thursdaySheet.getByRole("radio", { name: "Note", exact: true }).click();
    await thursdaySheet.getByRole("combobox", { name: "Meal", exact: true }).selectOption({ label: "Lunch" });
    await thursdaySheet.getByRole("textbox", { name: "Title", exact: true }).fill("Eat out");
    await thursdaySheet.getByRole("textbox", { name: "Note", exact: true }).fill("Tacos on Main Street");
    await attachElement(testInfo, "meal-planner-day-sheet-note", thursdaySheet);
    await thursdaySheet.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(thursdaySheet).toBeHidden();
    await expect(thursday.getByText("Eat out", { exact: true })).toBeVisible();
    await expect(thursday.getByText("Lunch · Tacos on Main Street", { exact: true })).toBeVisible();
    await attachElement(testInfo, "meal-planner-day-with-meals", tuesday);

    await verifyAfterReload(async () => {
      await expect(salmon).toBeVisible();
      await expect(tuesday.getByText("Dinner · 2× the recipe", { exact: true })).toBeVisible();
      await expect(thursday.getByText("Eat out", { exact: true })).toBeVisible();
    });
    await expectAccessible();
    await testInfo.attach("meal-planner-week", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });

    // Put the week on the shopping list: the salmon's ingredients, doubled, survive a reload of the list.
    await page.getByRole("button", { name: "Add this week to my list", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 1 recipe to your shopping list." })).toBeVisible();
    await page.getByRole("link", { name: "Open the list", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/shopping-list"));
    await waitForHydration(page);
    const listed = { salmon: /(^| )4\b/, "white miso": /(^| )4\b/, mirin: /(^| )2\b/ };
    await verifyAfterReload(async () => {
      for (const [name, amount] of Object.entries(listed)) {
        await expect(page.getByRole("checkbox", { name, exact: true })).toHaveAccessibleDescription(amount);
      }
    });
    await expectAccessible();
    await testInfo.attach("meal-planner-shopping-list", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
    await page.goto(`/plan?week=${WEEK}`);
    await waitForHydration(page);

    // Remove the note; the recipe stays.
    await thursday.getByRole("button", { name: "Remove Eat out from Thursday", exact: true }).click();
    await expect(thursday.getByRole("button", { name: "Plan a meal for Thursday", exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(thursday.getByRole("button", { name: "Plan a meal for Thursday", exact: true })).toBeVisible();
      await expect(salmon).toBeVisible();
    });
  });

  test.describe("as the seeded chef", () => {
    test.use({ storageState: personaStorageStatePath("chef") });

    test("the recipe picker offers the chef's own recipes and the ones saved in their cookbooks", async ({ page, expectAccessible }) => {
      await page.goto(`/plan?week=${WEEK}`);
      await waitForHydration(page);
      await day(page, "Monday, Mar 1").getByRole("button", { name: "Add to Monday", exact: true }).click();
      const picker = addSheet(page, "Monday, Mar 1").getByRole("combobox", { name: "Recipe", exact: true });
      // Lemon Herb Rice is the chef's own; Saffron Risotto is the friend's, saved in the chef's Weeknight Dinners.
      await expect(picker.getByRole("option", { name: "Lemon Herb Rice", exact: true })).toBeAttached();
      await expect(picker.getByRole("option", { name: "Saffron Risotto", exact: true })).toBeAttached();
      // The friend's salmon is public but not saved, so it is offered only from its own page's link.
      await expect(picker.getByRole("option", { name: "Miso Glazed Salmon", exact: true })).toHaveCount(0);
      await expectAccessible();
    });
  });
});
