// New user journey: what someone with a brand-new account meets first. Both tests here are
// read-only. The empty shopping list uses the permanent qa_kitchen_newbie persona, whose list the
// seed leaves empty and no other journey writes to. The signup test submits /signup with a
// username that is too short, so the action rejects it and no account is created; it is the only
// journey allowed to use /signup for that reason (see AGENTS.md's Validation section). That
// submit still counts as one attempt against QA's auth rate limit (see personas.setup.ts).
import { test, expect } from "./support/journey";
import { createDisposableJourneyUser } from "./support/secret";
import { pathUrl, waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

test.describe("New user", () => {
  test.describe("with an empty shopping list", () => {
    // The stored session path, not persona("newbie").storageState: persona() reads the per-run
    // credentials file, which `playwright test --list` must not need.
    test.use({ storageState: personaStorageStatePath("newbie") });

    test("Explore recipes on the empty list leads to the public recipes", async ({ page, expectAccessible }) => {
      await page.goto("/shopping-list");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "Your shopping list is empty", exact: true })).toBeVisible();
      await expectAccessible();

      await main.getByRole("link", { name: "Explore recipes", exact: true }).click();
      await expect(page).toHaveURL(pathUrl("/recipes"));
      await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
      await expectAccessible();
    });
  });

  test.describe("signing up", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("a two-letter username shows the app's message and creates no account", async ({ page, expectAccessible, expectConsoleError }) => {
      // The signup action answers invalid fields with a 400, and browsers log any non-2xx
      // response as a console error even though the app handles it. Scoped to the action's own
      // single-fetch request ("/signup.data"), as sign-in.journey.ts does for the login 401.
      expectConsoleError(/Failed to load resource: the server responded with a status of 400/, {
        url: /\/signup\.data$/,
      });
      // A unique address in the disposable codex-e2e namespace, so the email is valid and not
      // taken and the username is the only field the action rejects.
      const email = createDisposableJourneyUser().email;
      await page.goto("/signup");
      // Submit through the app, so the answer comes back without a page load and focus is
      // moved by the page, not by a fresh document.
      await waitForHydration(page);
      const username = page.getByLabel("Username", { exact: true });
      await page.getByLabel("Email", { exact: true }).fill(email);
      await username.fill("ab");
      await page.getByRole("button", { name: "Sign Up", exact: true }).click();

      await expect(page.getByText("Username must be at least 3 characters", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(pathUrl("/signup"));
      await expect(username).toHaveAttribute("aria-invalid", "true");
      await expect(username).toBeFocused();
      await expect(username).toHaveValue("ab");
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
      await expectAccessible();

      // No account and no session: a signed-in page still sends this browser to the login page.
      await page.goto("/account/settings");
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
