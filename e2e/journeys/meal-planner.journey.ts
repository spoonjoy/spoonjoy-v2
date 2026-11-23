// Meal planner on both devices, as scratch user 9 (AGENTS.md's scratch index table): open the week, plan another
// chef's seeded recipe at twice its size from the page a recipe links to, add a note, and remove the note; each change
// survives a reload. The week is a fixed one far from today, so the run's date never moves the days.
//
// A cook has one plan, and the two device projects run at the same time, so each device signs in as its own account:
// scratch 9's base account on iPhone, its desktop twin on desktop Chrome (support/personas.ts's
// scratchStorageStateForProject). Each device owns its whole plan, so the test asserts on the week's full contents.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";

const WEEK = "2027-03-01";
const SALMON = { id: "qa-kitchen-recipe-salmon", title: "Miso Glazed Salmon" };
const PLAN_SALMON = `/plan?week=${WEEK}&recipe=${SALMON.id}`;

function day(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function recipeForm(page: Page) {
  return page.getByRole("region", { name: "Plan a recipe", exact: true });
}

function noteForm(page: Page) {
  return page.getByRole("region", { name: "Add a note", exact: true });
}

test.describe("Meal planner", () => {
  test.use({ storageState: scratchStorageStateForProject(9) });

  test("a planned recipe and a note land on their days, and a removed note stays gone @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    const tuesday = day(page, "Tuesday, Mar 2");
    const thursday = day(page, "Thursday, Mar 4");

    await page.goto(PLAN_SALMON);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Week of Mar 1", exact: true })).toBeVisible();
    await expect(day(page, "Monday, Mar 1").getByText("Nothing planned yet.", { exact: true })).toBeVisible();
    await expectAccessible();

    // The recipe the page was opened for is chosen; plan it for Tuesday's dinner at twice its size.
    await expect(recipeForm(page).getByRole("combobox", { name: "Recipe", exact: true })).toHaveValue(SALMON.id);
    await recipeForm(page).getByRole("combobox", { name: "Day", exact: true }).selectOption({ label: "Tuesday, Mar 2" });
    await recipeForm(page).getByRole("combobox", { name: "Meal", exact: true }).selectOption({ label: "Dinner" });
    await recipeForm(page).getByRole("textbox", { name: "Scale", exact: true }).fill("2");
    await recipeForm(page).getByRole("button", { name: "Add to plan", exact: true }).click();
    await expect(page).toHaveURL(pathUrl(`/plan?week=2027-03-02`));
    const salmon = tuesday.getByRole("link", { name: new RegExp(`^${SALMON.title}`) });
    await expect(salmon).toHaveAttribute("href", `/recipes/${SALMON.id}`);
    await expect(tuesday.getByText("Dinner · 2× the recipe", { exact: true })).toBeVisible();

    // A note for Thursday's lunch.
    await noteForm(page).getByRole("combobox", { name: "Day", exact: true }).selectOption({ label: "Thursday, Mar 4" });
    await noteForm(page).getByRole("combobox", { name: "Meal", exact: true }).selectOption({ label: "Lunch" });
    await noteForm(page).getByRole("textbox", { name: "Title", exact: true }).fill("Eat out");
    await noteForm(page).getByRole("textbox", { name: "Note", exact: true }).fill("Tacos on Main Street");
    await noteForm(page).getByRole("button", { name: "Add note", exact: true }).click();
    await expect(thursday.getByText("Eat out", { exact: true })).toBeVisible();
    await expect(thursday.getByText("Lunch · Tacos on Main Street", { exact: true })).toBeVisible();

    await verifyAfterReload(async () => {
      await expect(salmon).toBeVisible();
      await expect(tuesday.getByText("Dinner · 2× the recipe", { exact: true })).toBeVisible();
      await expect(thursday.getByText("Eat out", { exact: true })).toBeVisible();
    });
    await expectAccessible();
    await testInfo.attach("meal-planner-week", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });

    // Remove the note; the recipe stays.
    await thursday.getByRole("button", { name: "Remove Eat out from Thursday", exact: true }).click();
    await expect(thursday.getByText("Nothing planned yet.", { exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(thursday.getByText("Nothing planned yet.", { exact: true })).toBeVisible();
      await expect(salmon).toBeVisible();
    });
  });
});
