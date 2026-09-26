import { test, expect } from "./support/journey";
import { persona } from "./support/personas";

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
    const context = await browser.newContext({ storageState: persona("newbie").storageState });
    const page = await context.newPage();
    await page.goto("/recipes");
    await expect(page).toHaveURL(/\/recipes/);
    await page.goto("/logout");
    await expect(page).not.toHaveURL(/\/recipes/);
    await page.goto("/account/settings");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
