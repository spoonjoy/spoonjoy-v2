// The shopping list on iPhone leads with its Item field and the + circle beside it, in view on load
// (one-book target, Shopping), and opening the page at #add-item focuses the field, ready to type.
// Read-only, so it can run alongside shopping-list.journey.ts, which uses the same account on iPhone
// (scratch 3's base account; see that file for why each device has its own).
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";
import { requiredLabel } from "./support/forms";

test.describe("Shopping list Item field on iPhone", () => {
  test.use({ storageState: scratchStorageStateForProject(3) });

  test("the Item field and its + circle are in view on load, and #add-item focuses the field", async ({ page, expectAccessible }) => {
    const itemField = page.getByLabel(requiredLabel("Item"), { exact: true });
    const add = page.getByRole("button", { name: "Add to list", exact: true });

    await page.goto("/shopping-list");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Shopping list", exact: true })).toBeVisible();
    await expect(itemField).toBeInViewport();
    await expect(add).toBeInViewport();
    await expectAccessible();

    await page.goto("/shopping-list#add-item");
    await waitForHydration(page);
    await expect(itemField).toBeFocused();
  });
});
