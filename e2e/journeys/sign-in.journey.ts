import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { persona } from "./support/personas";
import { signInThroughForm } from "./support/sign-in";
import { fillSecret } from "./support/secret-input";

test.describe("Sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signs in with a username and stays signed in after reload @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    const chef = persona("chef");
    await page.goto("/login");
    await expectAccessible();
    await page.getByLabel("Username or email").fill(chef.username);
    await fillSecret(page.getByLabel("Password"), chef.password);
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
    await fillSecret(page.getByLabel("Password"), chef.password);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
  });

  test("a wrong password shows an error and stays on the login page", async ({ page, expectConsoleError }) => {
    // The login action correctly answers bad credentials with a 401, and browsers log any
    // failed resource load (including a same-origin fetch's non-2xx response) as a console
    // error regardless of whether the app handled it — this one is expected, not an app bug.
    // Scoped to the login action's own request so an unrelated 401 elsewhere on the page can't
    // be credited instead: the <Form method="post"> submits via React Router's single-fetch
    // action call, which always targets "<pathname>.data" (react-router's singleFetchUrl, in
    // node_modules/react-router/dist/development/chunk-HHGH3NKS.js) — "/login.data" here, since
    // "/login" has no trailing slash either branch of that helper appends ".data" the same way.
    expectConsoleError(/Failed to load resource: the server responded with a status of 401/, {
      url: /\/login\.data$/,
    });
    await page.goto("/login");
    await page.getByLabel("Username or email").fill(persona("friend").username);
    await fillSecret(page.getByLabel("Password"), "definitely-not-the-password");
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
    // support/journey.ts never sees it; watch it the same way by hand instead. try/finally
    // keeps dispose()/context.close() running even if an assertion below fails (instead of
    // leaking the context and skipping the console check), and a failing assertion still
    // surfaces any console issues alongside it rather than the console check masking it.
    const consoleWatcher = watchConsole(page);
    try {
      await signInThroughForm(page, "newbie");
      await page.goto("/logout");
      await expect(page).not.toHaveURL(/\/recipes/);
      await page.goto("/account/settings");
      await expect(page).toHaveURL(/\/login/);
    } catch (error) {
      throw appendConsoleIssues(error, consoleWatcher.issues);
    } finally {
      consoleWatcher.dispose();
      await context.close();
    }
    assertNoConsoleIssues(consoleWatcher.issues);
  });
});
