import { test, expect, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { persona } from "./support/personas";
import { signInThroughForm } from "./support/sign-in";

test.describe("Sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signs in with a username and stays signed in after reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    const chef = persona("chef");
    await page.goto("/login");
    await expectAccessible();
    await page.getByLabel("Username or email").fill(chef.username);
    await page.getByLabel("Password").fill(chef.password);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
    await expectAccessible();
    await verifyAfterReload(async () => {
      await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
      await page.goto("/login");
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test("signs in with an email address", async ({ page }) => {
    const chef = persona("chef");
    await page.goto("/login");
    await page.getByLabel("Username or email").fill(chef.email.toUpperCase());
    await page.getByLabel("Password").fill(chef.password);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
  });

  test("a wrong password shows an error and stays on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username or email").fill(persona("friend").username);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(page.getByText("Invalid username, email, or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("logging out ends the session", async ({ browser }) => {
    // A fresh context signed in through the real form, not the stored newbie storage state,
    // so this test owns the session it logs out and neither depends on nor disturbs the
    // stored persona sessions that signed-in journeys start from.
    const context = await browser.newContext();
    const page = await context.newPage();
    // This page isn't the fixture-provided `page`, so the auto-used consoleGate fixture in
    // support/journey.ts never sees it; watch it the same way by hand instead.
    const consoleWatcher = watchConsole(page);
    await signInThroughForm(page, "newbie");
    await page.goto("/logout");
    await expect(page).not.toHaveURL(/\/recipes/);
    await page.goto("/account/settings");
    await expect(page).toHaveURL(/\/login/);
    consoleWatcher.dispose();
    assertNoConsoleIssues(consoleWatcher.issues);
    await context.close();
  });
});
