// Deep links on both devices, signed out: a public recipe opens straight from its URL (and its
// "Recipes" link, with no in-app history, goes to all recipes), and a signed-in page sends the
// visitor to log in and then back to the page they asked for.
import { test, expect } from "./support/journey";
import { pathUrl, waitForHydration } from "./support/navigation";
import { persona } from "./support/personas";

const RISOTTO = "/recipes/qa-kitchen-recipe-risotto";

test.describe("Deep links, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a public recipe opens from its URL, and its Recipes link goes to all recipes", async ({ page, expectAccessible }) => {
    await page.goto(RISOTTO);
    await waitForHydration(page);
    await expect(page).toHaveURL(pathUrl(RISOTTO));
    await expect(page.getByRole("heading", { level: 1, name: "Saffron Risotto", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "saffron", exact: true })).toBeVisible();
    await expectAccessible();

    // Opened directly, so there is no in-app page to go back to (R-M2-2).
    await page.getByRole("main").getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
    await expectAccessible();
  });

  test("a signed-in page sends the visitor to log in, then back to that page", async ({ page, expectAccessible }) => {
    const friend = persona("friend");

    await page.goto("/account/settings");
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Faccount%2Fsettings$/);
    await expectAccessible();

    await page.getByLabel("Username or email").fill(friend.username);
    await page.getByLabel("Password").fill(friend.password);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/account/settings"));
    await expect(page.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();
    await expectAccessible();
  });
});
