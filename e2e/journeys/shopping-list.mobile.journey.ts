// The shopping list's "New item" on iPhone brings the Item field, which sits below the list, into
// view with focus, ready to type. Read-only, so it can run alongside shopping-list.journey.ts, which uses the same
// account on iPhone (scratch 3's base account; see that file for why each device has its own).
import { test, expect } from "./support/journey";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";

test.describe("Shopping list New item on iPhone", () => {
  test.use({ storageState: scratchStorageStateForProject(3) });

  test("New item scrolls to the Item field and focuses it", async ({ page, expectAccessible }) => {
    const itemField = page.getByLabel("Item", { exact: true });

    await page.goto("/shopping-list");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Shopping list", exact: true })).toBeVisible();
    await expect(itemField).not.toBeFocused();

    await page.getByRole("main").getByRole("link", { name: "New item", exact: true }).click();
    await expect(page).toHaveURL(/\/shopping-list#add-item$/);
    await expect(itemField).toBeFocused();
    await expect(itemField).toBeInViewport();
    await expectAccessible();

    // Following it again focuses the field again.
    await itemField.blur();
    await expect(itemField).not.toBeFocused();
    await page.getByRole("main").getByRole("link", { name: "New item", exact: true }).click();
    await expect(itemField).toBeFocused();
    await expect(page).toHaveURL(pathUrl("/shopping-list"));
  });
});
