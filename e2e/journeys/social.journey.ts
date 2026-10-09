// Social on both devices (spec journey 10), as per-run scratch user 4: save qa_kitchen_friend's
// Saffron Risotto to a new cookbook and find it in Saved Recipes; fork it and find the fork in My
// Recipes; log a cook on it with a note and find the cook on the recipe; find the friend among
// your fellow chefs and on /chefs; and log a cook at a chosen "Cooked at" time and see that time
// kept in your own timezone.
//
// The two device projects run at the same time, and the save, fork and cooks all feed the same
// per-user lists (Saved Recipes, My Recipes, fellow chefs, /chefs), so each device signs in as its
// own account: scratch 4's base account on iPhone, its desktop twin on desktop Chrome
// (support/personas.ts's scratchStorageStateForProject). The cookbook and the cook notes carry the
// project name and a timestamp, so each run's rows are its own even on the shared recipe page.
// The fork's title is chosen by the app (the dialog has no title field), so the fork is found by
// the URL the app redirects to.
import { test, expect } from "./support/journey";
import type { Page, TestInfo } from "@playwright/test";
import { pathUrl, recipeLink, waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";

// qa_kitchen_friend's seeded recipe.
const RISOTTO = "/recipes/qa-kitchen-recipe-risotto";
const RISOTTO_TITLE = "Saffron Risotto";
const FRIEND = "qa_kitchen_friend";

// A recipe page, not /recipes/new.
const RECIPE_URL = /\/recipes\/(?!new$)[^/?#]+$/;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// The "Cooked at" test's browser timezone. Any zone other than the Worker's UTC shows ui-map
// bug 17; Los Angeles is 7 or 8 hours behind, so a shifted time is unmistakable.
const LOS_ANGELES = "America/Los_Angeles";

// The /chefs test's browser timezone, 14 hours ahead of UTC: from 10:00 UTC on, the local date
// there is already tomorrow, so a date shown in UTC instead of the viewer's own (ruling R1) fails.
const KIRITIMATI = "Pacific/Kiritimati";

// The calendar date `iso` falls on in `timeZone`, in the app's format ("Sep 27, 2026").
function calendarDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone });
}

function runSuffix(testInfo: TestInfo): string {
  return `${testInfo.project.name} ${Date.now().toString(36)}`;
}

function risottoHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: RISOTTO_TITLE, exact: true });
}

async function openRisotto(page: Page) {
  await page.goto(RISOTTO);
  await waitForHydration(page);
  await expect(page).toHaveURL(pathUrl(RISOTTO));
  await expect(risottoHeading(page)).toBeVisible();
}

function logCookDialog(page: Page) {
  return page.getByRole("dialog", { name: "Log a cook" });
}

// Opens "Log a cook" and checks that "Save spoon" waits for something to save.
async function openLogCook(page: Page) {
  await page.getByTestId("recipe-header-log-cook-action").click();
  const dialog = logCookDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save spoon", exact: true })).toBeDisabled();
  return dialog;
}

async function saveCook(page: Page) {
  const dialog = logCookDialog(page);
  await dialog.getByRole("button", { name: "Save spoon", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cook logged." })).toBeVisible();
  await expect(dialog).toBeHidden();
}

// One cook on the recipe page, by its note.
function cookRow(page: Page, note: string) {
  return page.getByRole("listitem").filter({ hasText: note });
}

// The wall-clock time `instant` shows in `timeZone`, as a datetime-local value (YYYY-MM-DDTHH:mm).
function wallClock(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test.describe("Social", () => {
  test.use({ storageState: scratchStorageStateForProject(4) });

  test("the friend's Saffron Risotto saved to a new cookbook is in Saved Recipes @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }, testInfo) => {
    const cookbook = `Journey Saved ${runSuffix(testInfo)}`;
    const saveDialog = page.getByRole("dialog", { name: "Save to cookbook" });
    const cookbookToggle = saveDialog.getByRole("button", { name: cookbook, exact: true });

    await openRisotto(page);
    await page.getByTestId("recipe-header-save-action").click();
    await expect(saveDialog).toBeVisible();
    const createAndSave = saveDialog.getByRole("button", { name: "Create & Save", exact: true });
    await expect(createAndSave).toBeDisabled();
    await saveDialog.getByLabel("Create new cookbook", { exact: true }).fill(cookbook);
    await createAndSave.click();
    await expect(cookbookToggle).toHaveAttribute("aria-pressed", "true");
    await expectAccessible();
    await page.keyboard.press("Escape");
    await expect(saveDialog).toBeHidden();

    // The recipe still reads as saved in that cookbook after a reload.
    await verifyAfterReload(async () => {
      await expect(risottoHeading(page)).toBeVisible();
    });
    await waitForHydration(page);
    await page.getByTestId("recipe-header-save-action").click();
    await expect(cookbookToggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(saveDialog).toBeHidden();

    // Saved Recipes lists it, credited to the friend and filed under the new cookbook.
    const savedRow = recipeLink(page.getByRole("region", { name: "Saved recipes" }), RISOTTO_TITLE, RISOTTO);
    await page.goto("/saved-recipes");
    await expect(page.getByRole("heading", { level: 1, name: "Saved Recipes", exact: true })).toBeVisible();
    await expect(savedRow).toContainText(`By ${FRIEND} - ${cookbook}`);
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(savedRow).toContainText(`By ${FRIEND} - ${cookbook}`);
    });
  });

  test("forking the friend's Saffron Risotto lands on the fork, which is in My Recipes @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }) => {
    await openRisotto(page);
    await page.getByTestId("recipe-header-fork-action").click();
    const forkDialog = page.getByRole("dialog", { name: `Fork "${RISOTTO_TITLE}"?` });
    await expect(forkDialog).toBeVisible();
    await expect(forkDialog).toContainText(`Clone ${RISOTTO_TITLE} by ${FRIEND} into your kitchen.`);
    await expectAccessible();
    await forkDialog.getByRole("button", { name: "Fork", exact: true }).click();

    // The app redirects to the new recipe; its URL is how the fork is found from here on.
    await expect(page).not.toHaveURL(pathUrl(RISOTTO));
    await expect(page).toHaveURL(RECIPE_URL);
    const forkPath = new URL(page.url()).pathname;
    // The fork credits the original, and its title starts from the original's.
    const forkedFrom = page
      .getByRole("link", { name: new RegExp(`${FRIEND}.*${RISOTTO_TITLE}`) })
      .and(page.locator(`[href="${RISOTTO}"]`));
    const forkHeading = page.getByRole("heading", { level: 1, name: new RegExp(`^${RISOTTO_TITLE}`) });
    await expect(forkedFrom).toBeVisible();
    await expect(forkHeading).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(page).toHaveURL(pathUrl(forkPath));
      await expect(forkedFrom).toBeVisible();
      await expect(forkHeading).toBeVisible();
    });

    // My Recipes lists the fork at its own URL.
    const myRow = page.getByRole("region", { name: "My recipes" }).locator(`a[href="${forkPath}"]`);
    await page.goto("/my-recipes");
    await expect(page.getByRole("heading", { level: 1, name: "My Recipes", exact: true })).toBeVisible();
    await expect(myRow).toContainText(RISOTTO_TITLE);
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(myRow).toContainText(RISOTTO_TITLE);
    });
  });
});

// A British phone in Kiritimati formats dates differently from the Worker, which renders in en-US
// and UTC. Any date the server formats with the runtime's default locale or timezone then differs
// from the one the browser formats on hydration, and React reports a hydration mismatch, which the
// console gate fails on (ui-map bug 15, /chefs's "Latest activity" date). Once hydrated, that date
// must be the viewer's own (ruling R1).
test.describe("Social, in a British locale in Kiritimati", () => {
  test.use({ storageState: scratchStorageStateForProject(4), locale: "en-GB", timezoneId: KIRITIMATI });

  test("a cook logged with a note shows on the recipe, and the friend is a fellow chef and on /chefs @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }, testInfo) => {
    const note = `Journey cook ${runSuffix(testInfo)}: more saffron next time`;

    // "Save spoon" stays disabled until there is a note.
    await openRisotto(page);
    const dialog = await openLogCook(page);
    await dialog.getByLabel("Note", { exact: true }).fill(note);
    await expect(dialog.getByRole("button", { name: "Save spoon", exact: true })).toBeEnabled();
    await expectAccessible();
    await saveCook(page);

    const cook = cookRow(page, note);
    await expect(cook).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(cook).toBeVisible();
    });

    // The cook links to its chef: this scratch user, whose fellow chefs now include the friend.
    const chefLink = cook.getByRole("link");
    await expect(chefLink).toHaveAttribute("href", /^\/users\/codex_e2e_/);
    const profilePath = (await chefLink.getAttribute("href")) as string;
    await waitForHydration(page);
    await chefLink.click();
    await expect(page).toHaveURL(pathUrl(profilePath));
    await expect(page.getByRole("heading", { level: 1, name: profilePath.replace("/users/", ""), exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Fellow chefs · 1", exact: true }).click();
    await expect(page).toHaveURL(pathUrl(`${profilePath}/fellow-chefs`));
    const friendRow = page.getByRole("link", { name: new RegExp(FRIEND) }).and(page.locator(`[href="/users/${FRIEND}"]`));
    await expect(friendRow).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(friendRow).toBeVisible();
    });

    // /chefs lists the friend under Fellow Chefs, with the cook in the activity.
    const fellowChef = page
      .getByRole("region", { name: "Fellow Chefs" })
      .getByRole("link", { name: new RegExp(FRIEND) });
    const cookActivity = page
      .getByRole("region", { name: "Chef activity" })
      .getByText(`You cooked ${RISOTTO_TITLE} from ${FRIEND}.`, { exact: true })
      .first();
    // "Latest activity" is the cook just logged, shown as the date it is in Kiritimati.
    const latestActivity = fellowChef.locator("time");
    await page.goto("/chefs");
    await waitForHydration(page);
    await expect(fellowChef).toHaveAttribute("href", `/?chef=${FRIEND}`);
    await expect(latestActivity).toHaveAttribute("datetime", /Z$/);
    const latestAt = (await latestActivity.getAttribute("datetime")) as string;
    await expect(fellowChef).toContainText(`Latest activity ${calendarDate(latestAt, KIRITIMATI)}`);
    await expect(cookActivity).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(fellowChef).toHaveAttribute("href", `/?chef=${FRIEND}`);
      await expect(latestActivity).toHaveAttribute("datetime", latestAt);
      await expect(fellowChef).toContainText(`Latest activity ${calendarDate(latestAt, KIRITIMATI)}`);
      await expect(cookActivity).toBeVisible();
    });

    // A tap after hydration: React finishes hydrating before it handles the tap, so a mismatch on
    // /chefs is reported (and caught by the console gate) before the page is left.
    await waitForHydration(page);
    await fellowChef.click();
    await expect(page).toHaveURL(new RegExp(`/\\?chef=${FRIEND}$`));
    await expect(page.getByRole("heading", { level: 1, name: `${FRIEND}'s Kitchen`, exact: true })).toBeVisible();
  });
});

test.describe("Social, in Los Angeles", () => {
  test.use({ storageState: scratchStorageStateForProject(4), timezoneId: LOS_ANGELES });

  test("a cook's Cooked at time is kept in the cook's own timezone @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }, testInfo) => {
    const note = `Journey cooked-at ${runSuffix(testInfo)}`;
    // Three hours ago, to the minute: the instant, and the wall-clock time a cook in Los Angeles
    // types for it. (Once a year, when Los Angeles's clocks go back, an hour of wall-clock times
    // happens twice; this test running in the three hours after that is ambiguous.)
    const cookedAt = new Date(Math.floor((Date.now() - 3 * HOUR) / MINUTE) * MINUTE);
    const cookedAtInput = wallClock(cookedAt, LOS_ANGELES);

    await openRisotto(page);
    const dialog = await openLogCook(page);
    await dialog.getByLabel("Note", { exact: true }).fill(note);
    await dialog.getByLabel("Cooked at", { exact: true }).fill(cookedAtInput);
    await expect(dialog.getByLabel("Cooked at", { exact: true })).toHaveValue(cookedAtInput);
    await saveCook(page);

    // Shown as three hours ago, not shifted by Los Angeles's offset from UTC (ui-map bug 17), and
    // stamped with the exact instant.
    const cook = cookRow(page, note);
    const cookTime = cook.locator("time");
    await expect(cook).toBeVisible();
    await expect(cookTime).toHaveText("3 hr ago");
    await expect(cookTime).toHaveAttribute("datetime", cookedAt.toISOString());
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(cookTime).toHaveText("3 hr ago");
      await expect(cookTime).toHaveAttribute("datetime", cookedAt.toISOString());
    });
  });
});
