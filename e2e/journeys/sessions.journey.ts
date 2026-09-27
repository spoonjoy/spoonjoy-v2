// "Sign out everywhere" revokes every other browser session and keeps this one. It signs a user
// out of every session, so it runs as a throwaway user (codex-e2e-*, removed by the workflow's QA
// cleanup) and never as a QA persona, whose shared sessions parallel journeys depend on.
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { createDisposableE2EUser } from "../support/disposable-auth";
import { pathUrl, waitForHydration } from "./support/navigation";

test.describe("Sessions", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signing out everywhere keeps this browser signed in and signs the other browser out @mutates", async ({ page, browser, verifyAfterReload, expectAccessible }) => {
    const user = createDisposableE2EUser();

    // Browser A: sign up as the throwaway user, which also signs A in.
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Username", { exact: true }).fill(user.username);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByLabel("Confirm Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));

    // Browser B: a separate context with its own cookie jar signs in as the same user. It isn't
    // the fixture-provided `page`, so its console is watched by hand, as in sign-in.journey.ts.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    const otherConsole = watchConsole(otherPage);
    try {
      await otherPage.goto("/login");
      await waitForHydration(otherPage);
      await otherPage.getByLabel("Username or email").fill(user.username);
      await otherPage.getByLabel("Password").fill(user.password);
      await otherPage.getByRole("button", { name: "Log In", exact: true }).click();
      await expect(otherPage).toHaveURL(pathUrl("/recipes"));
      await otherPage.goto("/account/settings");
      await expect(otherPage).toHaveURL(pathUrl("/account/settings"));
      await expect(otherPage.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();

      // Browser A: sign out everywhere, confirming the prompt.
      await page.goto("/account/settings");
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
