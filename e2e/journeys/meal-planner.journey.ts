// Meal planner on both devices, as scratch user 9 (AGENTS.md's scratch index table): open the week from the page a
// recipe links to, plan that chef's seeded recipe at twice its size by pressing an empty day, add a note from another
// day's Add, put the week on the shopping list (the salmon's ingredients at twice their amounts), and remove the note;
// each change survives a reload. The week is a fixed one far from today, so the run's date never moves the days. Then
// make the plan's calendar link, fetch the calendar at it with no session, and turn it off, so the link is refused.
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

/**
 * The tops of the day headings, grouped by the grid row their day sits in, so a row's headings can be compared: an
 * empty day's header, with no Add, must be as tall as one with its Add.
 */
async function headingTopsByRow(page: Page) {
  const tops = await page.getByRole("region", { name: /^\w+day, \w+ \d+$/ }).evaluateAll((regions) =>
    regions.map((region) => ({
      row: Math.round(region.getBoundingClientRect().top),
      heading: (region.querySelector("h2, h3") as HTMLElement).getBoundingClientRect().top,
    })));
  const rows = new Map<number, number[]>();
  for (const { row, heading } of tops) rows.set(row, [...(rows.get(row) ?? []), heading]);
  return [...rows.values()];
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
    // One control for one action: an empty day has no Add in its header beside its button.
    await expect(tuesday.getByRole("button", { name: "Add to Tuesday", exact: true })).toHaveCount(0);
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
    // A day with meals adds more from its header's Add.
    await expect(tuesday.getByRole("button", { name: "Add to Tuesday", exact: true })).toBeVisible();

    // A note for Thursday's lunch, from the empty day's own button.
    await thursday.getByRole("button", { name: "Plan a meal for Thursday", exact: true }).click();
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
    // Day headings in one grid row share a top, within 1px, whether or not the day has its Add.
    const rows = await headingTopsByRow(page);
    expect(rows.flat()).toHaveLength(7);
    for (const headings of rows) expect(Math.max(...headings) - Math.min(...headings)).toBeLessThanOrEqual(1);
    await testInfo.attach("meal-planner-week", { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });

    // Put the week on the shopping list: the salmon's ingredients, doubled, survive a reload of the list. The button
    // counts the one recipe (the note needs nothing), then says the week is on the list and marks the salmon.
    await page.getByRole("button", { name: "Add 1 meal to the list", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 1 meal to your shopping list." })).toBeVisible();
    await expect(page.getByRole("button", { name: "This week is on your list", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(tuesday.getByText("Dinner · 2× the recipe · On your list", { exact: true })).toBeVisible();
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

  test("Plan opens from the bar, between Cookbooks and Shopping, and stays the current page after a reload", async ({ page, isMobile }, testInfo) => {
    // The phone's tab bar, or the desktop's top bar.
    const bar = isMobile ? page.getByRole("navigation", { name: "Spoonjoy navigation" }) : page.locator('header[data-ouro="navbar"]');
    const shot = isMobile ? "plan-tab-bar-iphone" : "plan-top-bar-desktop";
    await page.goto("/");
    await waitForHydration(page);
    const links = await bar.getByRole("link").allTextContents();
    const cookbooks = links.indexOf("Cookbooks");
    expect(links[cookbooks + 1], "the link after Cookbooks").toBe("Plan");
    expect(links[cookbooks + 2], "the link after Plan").toMatch(/^Shopping/);
    await bar.getByRole("link", { name: "Plan", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/plan"));
    await page.reload({ waitUntil: "load" });
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: /^Week of / })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Plan", exact: true })).toHaveAttribute("aria-current", "page");
    await testInfo.attach(shot, { body: await bar.screenshot({ animations: "disabled" }), contentType: "image/png" });
  });

  test("a calendar link serves the plan's meals to any calendar app until the cook turns it off @mutates", async ({ page, playwright, verifyAfterReload, expectAccessible }, testInfo) => {
    // This week, opened to plan the salmon, so the meal lands today: inside the feed's four weeks back to thirteen ahead.
    await page.goto(`/plan?recipe=${SALMON.id}`);
    await waitForHydration(page);
    const todaySheet = page.getByRole("dialog", { name: /^Add to / });
    await expect(todaySheet.getByRole("combobox", { name: "Recipe", exact: true })).toHaveValue(SALMON.id);
    await todaySheet.getByRole("button", { name: "Add to plan", exact: true }).click();
    await expect(todaySheet).toBeHidden();
    await expect(page).toHaveURL(/\/plan\?week=\d{4}-\d{2}-\d{2}$/);

    const addToCalendar = page.getByRole("button", { name: "Add to calendar", exact: true });
    const sheet = page.getByRole("dialog", { name: "Add your meal plan to a calendar", exact: true });
    const linkField = sheet.getByRole("textbox", { name: "Calendar link", exact: true });
    await addToCalendar.click();
    await expect(sheet.getByText(/Anyone with the link can see your plan/)).toBeVisible();
    await sheet.getByRole("button", { name: "Make a calendar link", exact: true }).click();
    await expect(sheet.getByRole("status")).toHaveText("Made your calendar link. Copy it now: Spoonjoy shows it only this once.");
    await expect(linkField).toHaveValue(/^https?:\/\/[^/]+\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const feedUrl = await linkField.inputValue();
    await expect(sheet.getByRole("link", { name: "Open in calendar app", exact: true })).toHaveAttribute("href", feedUrl.replace(/^https?:/, "webcal:"));
    await expect(sheet.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
    await expectAccessible();
    await attachElement(testInfo, "meal-planner-calendar-link-made", sheet);

    // A calendar app has no session: the link alone gets the plan, with the salmon on it.
    const calendarApp = await playwright.request.newContext();
    const feed = await calendarApp.get(feedUrl);
    expect(feed.status(), "the feed at the new link").toBe(200);
    expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(await feed.text()).toContain(`SUMMARY:Dinner: ${SALMON.title}`);

    // The link is shown once: after a reload the sheet says when it was made, and offers a new link instead.
    await verifyAfterReload(async () => {
      await addToCalendar.click();
      await expect(sheet.getByText(/^You made your link on /)).toBeVisible();
      await expect(linkField).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Make a new link", exact: true })).toBeVisible();
    });
    await attachElement(testInfo, "meal-planner-calendar-link-existing", sheet);

    await sheet.getByRole("button", { name: "Turn off link", exact: true }).click();
    await expect(sheet.getByRole("status")).toHaveText("Turned off your calendar link. Calendars subscribed to it stop getting your plan.");
    await expect(sheet.getByRole("button", { name: "Make a calendar link", exact: true })).toBeVisible();
    expect((await calendarApp.get(feedUrl)).status(), "the feed at the turned-off link").toBe(404);
    await verifyAfterReload(async () => {
      await addToCalendar.click();
      await expect(sheet.getByRole("button", { name: "Make a calendar link", exact: true })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Turn off link", exact: true })).toHaveCount(0);
    });
    await calendarApp.dispose();
  });

  test.describe("as the seeded chef", () => {
    test.use({ storageState: personaStorageStatePath("chef") });

    test("the recipe picker offers the chef's own recipes and the ones saved in their cookbooks", async ({ page, expectAccessible }) => {
      await page.goto(`/plan?week=${WEEK}`);
      await waitForHydration(page);
      await day(page, "Monday, Mar 1").getByRole("button", { name: "Plan a meal for Monday", exact: true }).click();
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
