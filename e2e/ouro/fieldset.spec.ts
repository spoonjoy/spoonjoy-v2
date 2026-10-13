// Spoonjoy: the local fixture fails a spec on any browser warning or error (e2e/fixtures.ts).
import { expect, test } from "../fixtures";
import { openStory } from "./story";

test("a disabled fieldset disables every field inside it", async ({ page }) => {
  await openStory(page, "forms-fieldset--address");
  const shipping = page.getByRole("group", { name: "Shipping address" });
  const billing = page.getByRole("group", { name: "Billing address" });
  await expect(shipping).toHaveAccessibleDescription("Where we send your order.");
  for (const name of ["Street", "City", "Postcode"]) {
    await expect(shipping.getByRole("textbox", { name })).toBeEnabled();
    await expect(billing.getByRole("textbox", { name })).toBeDisabled();
  }
});
