// Cooking Lemon Herb Rice on both devices: the ingredient checklist, step outputs and scale persist
// across reloads and visits, cook mode walks the steps with scaled quantities and resumes at the
// step it was left on, and cook mode adds exactly one history entry that Exit or Back removes
// (R-M2-4), so leaving the recipe afterwards takes one Back.
//
// On QA a signed-in cook's progress lives in their account (cook-session sync, bug 16), not in the
// browser, so it outlasts a test's browser context. The tests that change progress therefore run
// as scratch index 7 with per-device twins — the base account on iPhone WebKit, its desktop twin
// on desktop Chrome (AGENTS.md's scratch table) — so the two device projects never race on one
// account, reset that cook's Lemon Herb Rice progress through the cook-session API before they
// start, and wait for the account's answer to the saving PATCH before a reload, so the reload
// proves the account kept the change. The history tests
// open the recipe from the chef's kitchen home (a scratch cook's home lists no recipes) and change
// no progress, so the chef's progress on Lemon Herb Rice stays untouched.
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { cookProgressSaved, resetCookProgress } from "./support/cook-progress";
import { expectNoHydrationErrors } from "./support/hydration";
import { pathUrl, recipeLink, seededRecipeLink, waitForHydration } from "./support/navigation";
import { personaStorageStatePath, scratchForProject, scratchStorageStateForProject } from "./support/personas";

const LEMON_RICE_ID = "qa-kitchen-recipe-lemon-rice";
const LEMON_RICE = `/recipes/${LEMON_RICE_ID}`;
// The seeded ingredient id (scripts/seed-qa-kitchen.mjs: <recipe id>-ingredient-<step>-<slug>).
const JASMINE_RICE_ID = `${LEMON_RICE_ID}-ingredient-1-jasmine-rice`;
// A checklist row's amount is the end of its checkbox's description (its aisle comes first).
function amount(text: string) {
  return new RegExp(`(^| )${text}$`);
}
// The recipe with no hash: cook mode closed.
const LEMON_RICE_URL = new RegExp(`^https?://[^/]+${LEMON_RICE}$`);
const LEMON_RICE_COOK_URL = new RegExp(`^https?://[^/]+${LEMON_RICE}#cook$`);
const SCRATCH_INDEX = 7;
const TOMATO_SOUP_ID = "qa-kitchen-recipe-tomato-soup";
const TOMATO_SOUP = `/recipes/${TOMATO_SOUP_ID}`;

function recipeHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true });
}

function kitchenHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });
}

function syncStatus(page: Page) {
  return page.getByTestId("cook-sync-status").locator("p:not([aria-hidden])");
}

// Home, then Lemon Herb Rice through its link, so the recipe has an in-app page before it.
async function openLemonRiceFromHome(page: Page) {
  await page.goto("/");
  await waitForHydration(page);
  await expect(kitchenHeading(page)).toBeVisible();
  await recipeLink(page.getByRole("main"), "Lemon Herb Rice", LEMON_RICE).click();
  await expect(page).toHaveURL(pathUrl(LEMON_RICE));
  await expect(recipeHeading(page)).toBeVisible();
  await expectNoHydrationErrors(page);
}

// Opens the recipe and waits until the page has read the cook's progress from their account. The
// server renders it with no progress; the progress arrives after hydration, which must not mismatch.
async function openLemonRiceDirectly(page: Page) {
  await page.goto(LEMON_RICE);
  await waitForHydration(page);
  await expect(recipeHeading(page)).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Progress synced");
  await expectNoHydrationErrors(page);
}

// Search, then Lemon Herb Rice through its result link: an in-app navigation, so the recipe page
// mounts on the client (not a full document load) and still shows the account's progress.
async function openLemonRiceFromSearch(page: Page) {
  await page.goto("/search?q=lemon");
  await waitForHydration(page);
  const results = page.getByRole("region", { name: "Search results" });
  await seededRecipeLink(results, "Lemon Herb Rice", LEMON_RICE).click();
  await expect(page).toHaveURL(pathUrl(LEMON_RICE));
  await expect(recipeHeading(page)).toBeVisible();
  await expect(syncStatus(page)).toHaveText("Progress synced");
}

// A point on the page, not in the viewport: the click that checks an ingredient may scroll it into
// view, and only a shift of the page's own layout counts.
function pageTop(locator: Locator) {
  return locator.evaluate(async (element) => {
    await document.fonts.ready;
    return Math.round(element.getBoundingClientRect().top + window.scrollY);
  });
}

/**
 * Whether every checked row of the checklist holding `box` sits below every unchecked one, in
 * the DOM and on screen once rows stop moving (Ari: a ticked ingredient sinks to the bottom).
 */
function checkedRowsSunk(box: Locator) {
  return box.evaluate(async (element) => {
    const list = element.closest('[data-ouro="checklist"]')!;
    const rows = [...list.querySelectorAll<HTMLElement>('[data-slot="checklist-row"]')];
    await Promise.allSettled(rows.flatMap((row) => row.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const states = rows.map((row) => ({
      checked: row.querySelector('[role="checkbox"]')!.getAttribute("aria-checked") === "true",
      top: row.getBoundingClientRect().top,
    }));
    const unchecked = states.filter((state) => !state.checked);
    const checked = states.filter((state) => state.checked);
    const domOrder = states.every((state, index) => !state.checked || states.slice(index).every((later) => later.checked));
    return checked.length > 0 && domOrder && checked.every((row) => unchecked.every((other) => row.top > other.top));
  });
}

// The whole page as the cook sees it, saved under test-results/ (the journeys-report artifact).
async function savePageScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

// Two presses of "Increase scale": 1× -> 1.25× -> 1.5×.
async function scaleToOneAndAHalf(page: Page) {
  const increase = page.getByRole("button", { name: "Increase scale" });
  const display = page.getByRole("textbox", { name: "Scale", exact: true });
  await increase.click();
  await expect(display).toHaveValue("1.25");
  await increase.click();
  await expect(display).toHaveValue("1.5");
}

test.describe("Cooking Lemon Herb Rice", () => {
  test.describe("progress", () => {
    // Scratch 7's base account on iPhone, its desktop twin on desktop Chrome. A stored session
    // path, never the credentials file, which `playwright test --list` must not need.
    test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

    test.beforeEach(async ({ page }, testInfo) => {
      await resetCookProgress(page, LEMON_RICE_ID, scratchForProject(SCRATCH_INDEX, testInfo.project.name).id);
    });

    test("the checklist and scale persist across a reload and a visit elsewhere @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
      const scaleDisplay = page.getByRole("textbox", { name: "Scale", exact: true });

      await openLemonRiceDirectly(page);
      await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
      await expect(jasmineRice).toHaveAccessibleDescription(amount("1 cup"));

      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) =>
        progress.scaleFactor === 1.5 && progress.checkedIngredientIds.includes(JASMINE_RICE_ID));
      await jasmineRice.click();
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await scaleToOneAndAHalf(page);
      await expect(jasmineRice).toHaveAccessibleDescription(amount("1 ½ cups"));
      await saved;

      await verifyAfterReload(async () => {
        await expect(scaleDisplay).toHaveValue("1.5");
        await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
        await expect(jasmineRice).toHaveAccessibleDescription(amount("1 ½ cups"));
      });

      // Somewhere else and back to the recipe through the app: the progress is still there.
      await openLemonRiceFromSearch(page);
      await expect(scaleDisplay).toHaveValue("1.5");
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await expect(jasmineRice).toHaveAccessibleDescription(amount("1 ½ cups"));
      await expectAccessible();
    });

    test("checking the first ingredient moves nothing on the page @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
      const stepsHeading = page.getByRole("heading", { level: 2, name: "Steps", exact: true });
      const stepOneTitle = page.getByRole("heading", { level: 3, name: "Cook the rice", exact: true });
      const clearProgress = page.getByTestId("clear-progress-button");

      await openLemonRiceDirectly(page);
      await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
      await expect(clearProgress).toBeHidden();
      const stepsHeadingBefore = await pageTop(stepsHeading);
      const stepOneTitleBefore = await pageTop(stepOneTitle);
      await savePageScreenshot(page, testInfo, "recipe-before-first-check");

      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.checkedIngredientIds.includes(JASMINE_RICE_ID));
      await jasmineRice.click();
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await saved;
      await expect(syncStatus(page)).toHaveText("Progress synced");
      await expect(clearProgress).toBeVisible();
      await savePageScreenshot(page, testInfo, "recipe-after-first-check");
      await expect.poll(() => checkedRowsSunk(jasmineRice)).toBe(true);

      // Clear progress and the sync line already had their room, so the first check (Ari's report:
      // the page jumped down) shifts neither the Steps heading nor step 1.
      expect(await pageTop(stepsHeading)).toBe(stepsHeadingBefore);
      expect(await pageTop(stepOneTitle)).toBe(stepOneTitleBefore);

      // A reload that opens with the check already made lays the page out the same way.
      await verifyAfterReload(async () => {
        await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
        await expect(syncStatus(page)).toHaveText("Progress synced");
        await expect(clearProgress).toBeVisible();
        expect(await pageTop(stepsHeading)).toBe(stepsHeadingBefore);
        expect(await pageTop(stepOneTitle)).toBe(stepOneTitleBefore);
        await expect.poll(() => checkedRowsSunk(jasmineRice)).toBe(true);
      });
      await expectAccessible();
    });

    test("a step output checks off and stays checked after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      // Step 3 ("Combine") uses step 1's output.
      const cookedRice = page.getByRole("checkbox", { name: "Step 1: Cook the rice", exact: true });

      await openLemonRiceDirectly(page);
      await expect(cookedRice).toHaveAttribute("aria-checked", "false");
      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.checkedStepOutputIds.length === 1);
      await cookedRice.click();
      await expect(cookedRice).toHaveAttribute("aria-checked", "true");
      await saved;

      await verifyAfterReload(async () => {
        await expect(cookedRice).toHaveAttribute("aria-checked", "true");
      });
      await expectAccessible();
    });

    test("cook mode walks every step with scaled quantities and resumes at the step it was left on @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");
      const nextStep = panel.getByRole("button", { name: "Next step" });
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });

      await openLemonRiceDirectly(page);
      // Only the final state matches: rice checked, 1.5×, and step 3 (index 2) current.
      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) =>
        progress.activeStepIndex === 2 && progress.scaleFactor === 1.5 && progress.checkedIngredientIds.includes(JASMINE_RICE_ID));
      await jasmineRice.click();
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await scaleToOneAndAHalf(page);

      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(page).toHaveURL(LEMON_RICE_COOK_URL);
      await expect(panel).toContainText("Step 1 of 3");
      await expect(page.getByRole("region", { name: "Cook the rice", exact: true })).toBeVisible();
      // Step 1's quantities follow the scale, and the checklist carries over.
      await expect(panel.getByRole("checkbox", { name: "jasmine rice", exact: true })).toHaveAccessibleDescription(amount("1 ½ cups"));
      await expect(panel.getByRole("checkbox", { name: "jasmine rice", exact: true })).toHaveAttribute("aria-checked", "true");
      // Nothing covers the step controls on a phone (R-M2-5): the tab bar is hidden in cook mode.
      await expect(page.getByRole("navigation", { name: "Spoonjoy navigation" })).toBeHidden();
      await expectAccessible();

      await nextStep.click();
      await expect(panel).toContainText("Step 2 of 3");
      await expect(page.getByRole("region", { name: "Make the dressing", exact: true })).toBeVisible();

      await nextStep.click();
      await expect(panel).toContainText("Step 3 of 3");
      await expect(page.getByRole("region", { name: "Combine", exact: true })).toBeVisible();
      await expect(nextStep).toBeDisabled();

      await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(LEMON_RICE_URL);
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("textbox", { name: "Scale", exact: true })).toHaveValue("1.5");
      // The account keeps the current step by its id, so it survives the steps being reordered.
      expect((await saved).activeStepId).toBe(`${LEMON_RICE_ID}-step-3`);

      await verifyAfterReload(async () => {
        await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
        await expect(page.getByRole("textbox", { name: "Scale", exact: true })).toHaveValue("1.5");
      });

      // The current step is part of the saved progress: cook mode reopens on step 3.
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Step 3 of 3");
      await expect(page.getByRole("region", { name: "Combine", exact: true })).toBeVisible();
      await expectAccessible();
    });

    test("a cook-mode timer keeps running on another step, survives a reload, and can be cancelled @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");
      const stepTimer = panel.getByTestId("cook-mode-timer");
      const tray = panel.getByRole("region", { name: "Running timers" });
      const riceTimer = tray.getByRole("listitem").filter({ hasText: "Step 1 · Cook the rice" });

      await openLemonRiceDirectly(page);
      // The reload below must find cook mode on step 2, so wait for the account to save that step.
      const onStepTwo = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.activeStepIndex === 1);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toContainText("Step 1 of 3");
      // Step 1 ("Cook the rice") is seeded with a 15 minute timer.
      await expect(stepTimer).toContainText("Step 1 · Cook the rice · 15 min");
      await stepTimer.getByRole("button", { name: "Start timer", exact: true }).click();
      await expect(stepTimer.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
      await expect(stepTimer).toContainText("14:5");

      // Moving on to the dressing keeps the rice timer counting, in the tray.
      await panel.getByRole("button", { name: "Next step" }).click();
      await expect(panel).toContainText("Step 2 of 3");
      await expect(riceTimer).toContainText("Step 1 · Cook the rice");
      await expect(riceTimer).toContainText("14:");
      // Previous has just changed from disabled to enabled. Measure its actual
      // settled enabled ink, not the released opacity transition in between.
      const previous = panel.getByRole("button", { name: "Previous step", exact: true });
      await expect(previous).toBeEnabled();
      await expect.poll(() => previous.evaluate((element) =>
        getComputedStyle(element).opacity === "1" &&
        element.getAnimations({ subtree: true }).every((animation) =>
          animation.playState === "finished" || animation.playState === "idle"),
      )).toBe(true);
      await expectAccessible();
      expect((await onStepTwo).activeStepId).toBe(`${LEMON_RICE_ID}-step-2`);

      // The timer is anchored to its end time, so a reload keeps it running.
      await verifyAfterReload(async () => {
        await expect(panel).toContainText("Step 2 of 3");
        await expect(riceTimer).toContainText("14:");
      });

      await riceTimer.getByRole("link", { name: "Go to Step 1 · Cook the rice", exact: true }).click();
      await expect(panel).toContainText("Step 1 of 3");
      await expect(stepTimer.getByRole("button", { name: "Pause timer", exact: true })).toBeVisible();
      await stepTimer.getByRole("button", { name: "Cancel timer", exact: true }).click();
      await expect(stepTimer.getByRole("button", { name: "Start timer", exact: true })).toBeVisible();
      await expect(stepTimer).toContainText("15:00");
      await expect(tray).toBeHidden();
    });

    test("Clear progress unchecks everything and stays cleared after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
      const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
      const cookedRice = page.getByRole("checkbox", { name: "Step 1: Cook the rice", exact: true });
      const checkedRows = page.locator('[role="checkbox"][aria-checked="true"]');
      const scaleDisplay = page.getByRole("textbox", { name: "Scale", exact: true });

      await openLemonRiceDirectly(page);
      // Only the final state matches: nothing checked at 1.25× (the scale changes after the checks).
      const saved = cookProgressSaved(page, LEMON_RICE_ID, (progress) =>
        progress.scaleFactor === 1.25 && progress.checkedIngredientIds.length === 0 && progress.checkedStepOutputIds.length === 0);
      await jasmineRice.click();
      await expect(jasmineRice).toHaveAttribute("aria-checked", "true");
      await cookedRice.click();
      await expect(cookedRice).toHaveAttribute("aria-checked", "true");
      // Clear progress keeps the scale; 1.25× after the reload shows the saved progress was read.
      await page.getByRole("button", { name: "Increase scale" }).click();
      await expect(scaleDisplay).toHaveValue("1.25");

      await page.getByTestId("clear-progress-button").click();
      await expect(checkedRows).toHaveCount(0);
      await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
      await expect(cookedRice).toHaveAttribute("aria-checked", "false");
      await saved;

      await verifyAfterReload(async () => {
        await expect(scaleDisplay).toHaveValue("1.25");
        await expect(jasmineRice).toHaveAttribute("aria-checked", "false");
        await expect(cookedRice).toHaveAttribute("aria-checked", "false");
        await expect(checkedRows).toHaveCount(0);
      });
      await expectAccessible();
    });
  });

  // Cooking now: each tab keeps its own recipe, mode and step, and the Kitchen lists every recipe
  // in progress. Same scratch cook as the progress tests, so they never race on one account.
  test.describe("Cooking now", () => {
    test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

    test.beforeEach(async ({ page }, testInfo) => {
      const cookId = scratchForProject(SCRATCH_INDEX, testInfo.project.name).id;
      await resetCookProgress(page, LEMON_RICE_ID, cookId);
      await resetCookProgress(page, TOMATO_SOUP_ID, cookId);
    });

    test("two tabs on one recipe keep their own steps, and each comes back to its own after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible, expectConsoleError }, testInfo) => {
      const panel = page.getByTestId("cook-mode-panel");
      // Two tabs save one cook session, so a save can carry a revision the other tab already
      // replaced. The server answers 409 with its state and the tab replays its change on top
      // (app/lib/cook-session-sync.ts); the steps asserted below are the contract. Some browsers log
      // that 409, so accept exactly that diagnostic for this session's URL, in either tab. WebKit has logged
      // it twice in tab one, and each allowance covers one copy, so allow up to two.
      const conflict = /^Failed to load resource: the server responded with a status of 409(?: \((?:Conflict)?\))?$/;
      const sessionUrl = /\/api\/cook-sessions\/qa-kitchen-recipe-lemon-rice$/;
      expectConsoleError(conflict, { url: sessionUrl, optional: true });
      expectConsoleError(conflict, { url: sessionUrl, optional: true });
      const isReplayedConflict = (issue: { text: string; location?: string }) => conflict.test(issue.text) && sessionUrl.test(issue.location ?? "");

      // Tab one opens cook mode and moves to step 2; the account saves step 2.
      await openLemonRiceDirectly(page);
      const onStepTwo = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.activeStepIndex === 1);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toContainText("Step 1 of 3");
      await panel.getByRole("button", { name: "Next step" }).click();
      await expect(panel).toContainText("Step 2 of 3");
      await onStepTwo;

      // Tab two: the same cook (same browser context), its own sessionStorage. A fresh tab starts
      // at the account's step, then moves on to step 3 without moving tab one.
      const second = await page.context().newPage();
      waitForHydrationOnLoad(second);
      const secondConsole = watchConsole(second);
      try {
        const secondPanel = second.getByTestId("cook-mode-panel");
        await openLemonRiceDirectly(second);
        const onStepThree = cookProgressSaved(second, LEMON_RICE_ID, (progress) => progress.activeStepIndex === 2);
        await second.getByRole("link", { name: "Cook mode", exact: true }).click();
        await expect(secondPanel).toContainText("Step 2 of 3");
        await secondPanel.getByRole("button", { name: "Next step" }).click();
        await expect(secondPanel).toContainText("Step 3 of 3");
        await onStepThree;
        await savePageScreenshot(second, testInfo, "cooking-now-second-tab");

        // Tab two comes back to step 3 in cook mode after a reload.
        await second.reload();
        // Cook mode has no sync status; the step comes from this tab's own state.
        await waitForHydration(second);
        await expect(second).toHaveURL(LEMON_RICE_COOK_URL);
        await expect(secondPanel).toContainText("Step 3 of 3");
      } catch (error) {
        throw appendConsoleIssues(error, secondConsole.issues);
      } finally {
        secondConsole.dispose();
        await second.close();
      }
      assertNoConsoleIssues(secondConsole.issues.filter((issue) => !isReplayedConflict(issue)));

      // Tab one is still on its own step 2, and still is after a reload.
      await page.bringToFront();
      await expect(panel).toContainText("Step 2 of 3");
      await savePageScreenshot(page, testInfo, "cooking-now-first-tab");
      await verifyAfterReload(async () => {
        await expect(page).toHaveURL(LEMON_RICE_COOK_URL);
        await expect(panel).toContainText("Step 2 of 3");
      });
      await savePageScreenshot(page, testInfo, "cooking-now-after-reload");
      await expectAccessible();

      // Leaving for the Kitchen and going back to the recipe from its card reopens cook mode on step 2.
      await page.goto("/");
      await waitForHydration(page);
      const strip = page.getByRole("region", { name: "Cooking now" });
      await strip.getByRole("link", { name: "Back to Lemon Herb Rice", exact: true }).click();
      await expect(page).toHaveURL(LEMON_RICE_COOK_URL);
      await expect(panel).toContainText("Step 2 of 3");
    });

    test("the Kitchen lists every recipe in progress and offers Back to the one just cooked @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
      const strip = page.getByRole("region", { name: "Cooking now" });
      // The one recipe just cooked leads the strip as its Back to card.
      const hero = strip.getByTestId("cooking-now-hero");
      // The navbar pill on a wide window, the Kitchen tab's badge on a phone.
      const count = page.getByTestId("cooking-now-pill").or(page.getByTestId("tab-cooking-now-count")).filter({ visible: true });
      const lemonCard = strip.getByRole("article", { name: "Lemon Herb Rice" });

      // One recipe in progress: the strip shows it once, as the card that offers Back to it.
      await openLemonRiceDirectly(page);
      const riceChecked = cookProgressSaved(page, LEMON_RICE_ID, (progress) => progress.checkedIngredientIds.includes(JASMINE_RICE_ID));
      await page.getByRole("checkbox", { name: "jasmine rice", exact: true }).click();
      await riceChecked;

      await page.goto("/");
      await waitForHydration(page);
      await expect(kitchenHeading(page)).toBeVisible();
      await expect(hero.getByRole("link", { name: "Back to Lemon Herb Rice", exact: true })).toHaveAttribute("href", LEMON_RICE);
      await expect(strip.getByRole("article")).toHaveCount(1);
      await expect(hero).toHaveAccessibleName("Lemon Herb Rice");
      await expect(lemonCard.getByTestId("cooking-now-step")).toHaveText("Step 1 of 3");
      await expect(lemonCard.getByTestId("cooking-now-checked")).toHaveText("1 of 5 checked");
      await expect(count).toContainText("1");
      await savePageScreenshot(page, testInfo, "cooking-now-banner");
      await expectAccessible();

      // A second recipe in progress: both are listed as cards, newest first, and neither leads
      // as Back to because there is no single recipe to go back to.
      await page.goto(TOMATO_SOUP);
      await waitForHydration(page);
      await expect(syncStatus(page)).toHaveText("Progress synced");
      const soupChecked = cookProgressSaved(page, TOMATO_SOUP_ID, (progress) => progress.checkedIngredientIds.length === 1);
      await page.getByRole("checkbox", { name: "tomato", exact: true }).click();
      await soupChecked;

      await page.goto("/");
      await waitForHydration(page);
      await verifyAfterReload(async () => {
        await expect(strip.getByRole("article")).toHaveCount(2);
        await expect(strip.getByRole("article").first()).toHaveAccessibleName("Roasted Tomato Soup");
        await expect(hero).toBeHidden();
        await expect(count).toContainText("2");
      });
      const newWindow = lemonCard.getByRole("link", { name: "Open in new window: Lemon Herb Rice", exact: true });
      await expect(newWindow).toHaveAttribute("href", LEMON_RICE);
      await expect(newWindow).toHaveAttribute("target", "_blank");
      await savePageScreenshot(page, testInfo, "cooking-now-strip");
      await expectAccessible();

      // Open goes straight back to the recipe with its progress.
      await lemonCard.getByRole("link", { name: "Open Lemon Herb Rice", exact: true }).click();
      await expect(page).toHaveURL(pathUrl(LEMON_RICE));
      await expect(syncStatus(page)).toHaveText("Progress synced");
      await expect(page.getByRole("checkbox", { name: "jasmine rice", exact: true })).toHaveAttribute("aria-checked", "true");
    });
  });

  test.describe("history", () => {
    // The stored session path, not persona("chef").storageState: persona() reads the per-run
    // credentials file, which `playwright test --list` must not need.
    test.use({ storageState: personaStorageStatePath("chef") });

    test("Exit leaves one Back to the page before the recipe", async ({ page, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");

      await openLemonRiceFromHome(page);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(page).toHaveURL(LEMON_RICE_COOK_URL);

      await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(LEMON_RICE_URL);
      await expect(recipeHeading(page)).toBeVisible();

      // Exit removed cook mode's history entry, so one Back leaves the recipe (R-M2-4).
      await page.goBack();
      await expect(page).toHaveURL(pathUrl("/"));
      await expect(kitchenHeading(page)).toBeVisible();
      await expectAccessible();
    });

    test("browser Back closes cook mode, and a second Back leaves the recipe", async ({ page, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");

      await openLemonRiceFromHome(page);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(page).toHaveURL(LEMON_RICE_COOK_URL);

      await page.goBack();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(LEMON_RICE_URL);
      await expect(recipeHeading(page)).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(pathUrl("/"));
      await expect(kitchenHeading(page)).toBeVisible();
      await expectAccessible();
    });

    test("after cook mode, the recipe's Back control returns to the page before the recipe", async ({ page, expectAccessible }) => {
      const panel = page.getByTestId("cook-mode-panel");
      // The page's own "Recipes" link at the top, on a phone and on desktop alike. It keeps an
      // /recipes href for a recipe opened directly (R-M2-2).
      const backControl = page.getByRole("main").getByRole("link", { name: "Recipes", exact: true });

      await openLemonRiceFromHome(page);
      await page.getByRole("link", { name: "Cook mode", exact: true }).click();
      await expect(panel).toBeVisible();
      await panel.getByRole("button", { name: "Exit cook mode", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(LEMON_RICE_URL);
      await expect(backControl).toHaveAttribute("href", "/recipes");

      await backControl.click();
      await expect(page).toHaveURL(pathUrl("/"));
      await expect(kitchenHeading(page)).toBeVisible();
      await expectAccessible();
    });
  });
});
