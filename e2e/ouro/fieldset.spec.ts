import { expect, test } from "../ouro-fixtures";
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
