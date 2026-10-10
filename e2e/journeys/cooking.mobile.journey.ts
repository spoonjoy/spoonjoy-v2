// The recipe's "Add to list" action on iPhone uses the recipe's current scale (1.25×) and then shows that the
// ingredients are on the list. It writes to a shopping list, so it runs as a throwaway user
// (codex-e2e-*, removed by the workflow's QA cleanup) who forks Lemon Herb Rice, leaving the
// personas' lists untouched.
import { test, expect } from "./support/journey";
import { pathUrl, waitForHydration } from "./support/navigation";
import { createDisposableJourneyUser, fillSecret } from "./support/secret";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";

test.describe("Recipe list action on iPhone", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Add to list adds ingredients at the current scale and then reads as already on the list @mutates", async ({ page, verifyAfterReload, expectAccessible }) => {
    const user = createDisposableJourneyUser();
    const listAction = page.getByTestId("recipe-header-list-action");
    const scaleDisplay = page.getByTestId("scale-display");
    const increaseScale = page.getByRole("button", { name: "Increase scale" });

    // Sign up as the throwaway user.
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Username", { exact: true }).fill(user.username);
    await fillSecret(page.getByLabel("Password", { exact: true }), user.password);
    await fillSecret(page.getByLabel("Confirm password", { exact: true }), user.password);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    // A new account with nowhere to return to lands in its own Kitchen (product audit 2026-10-09,
    // finding 11: it used to land in the public recipe box).
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true })).toBeVisible();

    // Fork Lemon Herb Rice, so the throwaway user owns the copy whose ingredients get added.
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await page.getByTestId("recipe-header-fork-action").click();
    const forkDialog = page.getByRole("dialog", { name: 'Fork "Lemon Herb Rice"?' });
    await expect(forkDialog).toBeVisible();
    await forkDialog.getByRole("button", { name: "Fork", exact: true }).click();
    await expect(page).not.toHaveURL(pathUrl(LEMON_RICE));
    await expect(page).toHaveURL(/\/recipes\/[^/?#]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(page.getByTestId("recipe-header-edit-action")).toBeVisible();

    // 1.25×, one press of 0.25, so the list gets fractional amounts to write out.
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.25×");

    await expect(listAction).toHaveText("Add to list");
    await listAction.click();
    // The toast appears once QA's add-and-reload round trip finishes, which can be slow.
    await expect(page.getByRole("status").filter({ hasText: "4 items added at 1.25x" })).toBeVisible({ timeout: 15_000 });
    await expect(listAction).toHaveText("In list");
    await expect(listAction).toHaveAttribute("aria-pressed", "true");
    await expectAccessible();

    // The list holds the 1.25× amounts written the way the recipe writes them (product audit
    // 2026-10-09, finding 8: parsley read "0.3125 cup"). Jasmine rice 1 cup -> 1 ¼ cups, chicken stock
    // 2 cups -> 2 ½ cups, parsley ¼ cup -> ⅓ cup, and 1 ¼ lemons round up to the 2 a shopper buys.
    const jasmineRice = page.getByRole("checkbox", { name: "jasmine rice", exact: true });
    const chickenStock = page.getByRole("checkbox", { name: "chicken stock", exact: true });
    const parsley = page.getByRole("checkbox", { name: "parsley", exact: true });
    const lemon = page.getByRole("checkbox", { name: "lemon", exact: true });
    const expectWrittenAmounts = async () => {
      await expect(jasmineRice).toContainText("1 ¼ cups");
      await expect(chickenStock).toContainText("2 ½ cups");
      await expect(parsley).toContainText("⅓ cup");
      await expect(parsley).not.toContainText("0.3125");
      // A counted thing shows its number alone, not "2 whole".
      await expect(lemon).toHaveText(/lemon2$/);
    };
    await page.goto("/shopping-list");
    await expectWrittenAmounts();

    await verifyAfterReload(expectWrittenAmounts);
    await expectAccessible();
  });
});
