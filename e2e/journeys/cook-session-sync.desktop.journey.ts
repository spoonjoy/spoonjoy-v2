// Cooking progress follows a signed-in cook from one device to another (bug 16): an ingredient
// checked in one browser shows checked in a second browser signed in as the same cook, and
// unchecking it there clears it in the first. It runs as scratch index 8's desktop twin (the
// cook-session sync index in AGENTS.md's table), a per-run cook no other journey uses, so its
// progress on Lemon Herb Rice is its own; the cooking journeys use scratch 7's twins on the same
// recipe, and the chef's progress stays untouched. Both browser contexts run in the desktop-chrome
// project, so they are the same account — which is the point. Desktop only: an iPhone copy running
// at the same time would need its own account and adds nothing device-specific.
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import type { Page } from "@playwright/test";
import { resetCookProgress } from "./support/cook-progress";
import { waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";

const SCRATCH_INDEX = 8;
const LEMON_RICE_ID = "qa-kitchen-recipe-lemon-rice";
const LEMON_RICE = `/recipes/${LEMON_RICE_ID}`;

function jasmineRice(page: Page) {
  return page.getByRole("checkbox", { name: "jasmine rice", exact: true });
}

// Opens Lemon Herb Rice and waits until the page has read the cook's progress from their account.
async function openLemonRice(page: Page) {
  await page.goto(LEMON_RICE);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
  await expect(page.getByTestId("cook-sync-status")).toHaveText("Progress synced");
}

test.describe("Cook progress across devices", () => {
  // Browser A starts from scratch 8's desktop twin (this file runs on desktop-chrome only).
  test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

  test("an ingredient checked on one device is checked on the other, and clearing it there clears it here @mutates", async ({ page, browser, verifyAfterReload, expectAccessible }) => {
    const scaleDisplay = page.getByTestId("scale-display");
    await resetCookProgress(page, LEMON_RICE_ID);

    // Browser A checks the jasmine rice and scales up; the account has both once it says so.
    await openLemonRice(page);
    await expect(jasmineRice(page)).toHaveAttribute("aria-checked", "false");
    await jasmineRice(page).click();
    await expect(jasmineRice(page)).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Increase scale" }).click();
    await expect(scaleDisplay).toHaveText("1.25×");
    await expect(page.getByTestId("cook-sync-status")).toHaveText("Progress synced");
    await expectAccessible();

    // Browser B: a separate context with its own storage. In Playwright Test, browser.newContext()
    // inherits the test's `use` options, including the storageState above, so B is signed in as
    // the same cook but starts with none of A's local progress. It isn't the fixture-provided
    // `page`, so its console is watched by hand, as in sessions.desktop.journey.ts.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    const otherConsole = watchConsole(otherPage);
    try {
      // B sees A's check and scale, and still does after a reload.
      await openLemonRice(otherPage);
      await expect(jasmineRice(otherPage)).toHaveAttribute("aria-checked", "true");
      await expect(otherPage.getByTestId("scale-display")).toHaveText("1.25×");
      await otherPage.reload();
      await waitForHydration(otherPage);
      await expect(otherPage.getByTestId("cook-sync-status")).toHaveText("Progress synced");
      await expect(jasmineRice(otherPage)).toHaveAttribute("aria-checked", "true");

      // B clears the jasmine rice, and it stays cleared after B reloads.
      await jasmineRice(otherPage).click();
      await expect(jasmineRice(otherPage)).toHaveAttribute("aria-checked", "false");
      await expect(otherPage.getByTestId("cook-sync-status")).toHaveText("Progress synced");
      await otherPage.reload();
      await waitForHydration(otherPage);
      await expect(otherPage.getByTestId("cook-sync-status")).toHaveText("Progress synced");
      await expect(jasmineRice(otherPage)).toHaveAttribute("aria-checked", "false");
    } catch (error) {
      throw appendConsoleIssues(error, otherConsole.issues);
    } finally {
      otherConsole.dispose();
      await otherContext.close();
    }
    assertNoConsoleIssues(otherConsole.issues);

    // Browser A, reloaded, shows B's change: the jasmine rice is clear and the scale is kept.
    await verifyAfterReload(async () => {
      await expect(page.getByTestId("cook-sync-status")).toHaveText("Progress synced");
      await expect(jasmineRice(page)).toHaveAttribute("aria-checked", "false");
      await expect(scaleDisplay).toHaveText("1.25×");
    });
    await expectAccessible();
  });
});
