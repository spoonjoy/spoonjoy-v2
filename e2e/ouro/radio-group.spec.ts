import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("the group is one tab stop, and the arrow keys move and pick, skipping disabled choices", async ({ page }) => {
  await openStory(page, "forms-radiogroup--sizes");
  const group = page.getByRole("radiogroup", { name: "Size" });
  await expect(group).toHaveAccessibleDescription("How many people you're cooking for.");
  await pressTab(page);
  const medium = group.getByRole("radio", { name: "Medium" });
  await expect(medium).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const large = group.getByRole("radio", { name: "Large" });
  await expect(large).toBeFocused();
  await expect(large).toBeChecked();
  // Party is disabled, so the arrow wraps to Small.
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "Small" })).toBeChecked();
  await expect(group.getByRole("radio", { name: "Party" })).toBeDisabled();
});

test("a click on a label picks its radio", async ({ page }) => {
  await openStory(page, "forms-radiogroup--horizontal");
  const group = page.getByRole("radiogroup", { name: "Crust" });
  await group.getByText("Deep dish").click();
  await expect(group.getByRole("radio", { name: "Deep dish" })).toBeChecked();
  await expect(group.getByRole("radio", { name: "Thin" })).not.toBeChecked();
});
