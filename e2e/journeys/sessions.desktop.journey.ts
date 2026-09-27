// "Sign out everywhere" revokes every other browser session and keeps this one. It signs its user
// out of every session, so it runs as scratch user 6 (the Sessions index in AGENTS.md), never a
// QA persona whose shared sessions parallel journeys depend on. Desktop only: the behaviour isn't
// device-specific, and an iPhone instance running at the same time would revoke this one's
// sessions (and the other way round) mid-run.
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { scratchStorageStatePath } from "./support/personas";
import { signInScratchThroughForm } from "./support/sign-in";
import { pathUrl, waitForHydration } from "./support/navigation";

const SCRATCH_INDEX = 6;

test.describe("Sessions", () => {
  // Browser A starts from scratch user 6's stored session.
  test.use({ storageState: scratchStorageStatePath(SCRATCH_INDEX) });

  test("signing out everywhere keeps this browser signed in and signs the other browser out @mutates", async ({ page, browser, verifyAfterReload, expectAccessible }) => {
    // Browser B: a separate context with its own cookie jar signs in as the same scratch user
    // through the login form. It isn't the fixture-provided `page`, so its console is watched by
    // hand, as in sign-in.journey.ts.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    const otherConsole = watchConsole(otherPage);
    try {
      await signInScratchThroughForm(otherPage, SCRATCH_INDEX);
      await otherPage.goto("/account/settings");
      await expect(otherPage).toHaveURL(pathUrl("/account/settings"));
      await expect(otherPage.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();

      // Browser A: sign out everywhere, confirming the prompt.
      await page.goto("/account/settings");
      await expect(page).toHaveURL(pathUrl("/account/settings"));
      await waitForHydration(page);
      await page.getByRole("button", { name: "Sign out everywhere", exact: true }).click();
      await expect(page.getByRole("button", { name: "Confirm sign out everywhere", exact: true })).toBeVisible();
      await expectAccessible();
      await page.getByRole("button", { name: "Confirm sign out everywhere", exact: true }).click();
      await expect(page.getByText("You've been signed out everywhere else. You're still signed in here.")).toBeVisible();

      // A is still signed in after a fresh document load.
      await verifyAfterReload(async () => {
        await expect(page).toHaveURL(pathUrl("/account/settings"));
        await expect(page.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();
      });

      // B's session was revoked: reloading its settings page sends it to log in.
      await otherPage.reload();
      await expect(otherPage).toHaveURL(/\/login\?redirectTo=%2Faccount%2Fsettings$/);
      await otherPage.goto("/account/settings");
      await expect(otherPage).toHaveURL(/\/login\?redirectTo=%2Faccount%2Fsettings$/);
    } catch (error) {
      throw appendConsoleIssues(error, otherConsole.issues);
    } finally {
      otherConsole.dispose();
      await otherContext.close();
    }
    assertNoConsoleIssues(otherConsole.issues);
  });
});
