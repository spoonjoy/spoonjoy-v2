import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a click on the label or Space toggles the checkbox", async ({ page }) => {
  await openStory(page, "forms-checkbox--states");
  const box = page.getByRole("checkbox", { name: "Email me new recipes" });
  await expect(box).not.toBeChecked();
  await page.getByText("Email me new recipes").click();
  await expect(box).toBeChecked();
  await box.press("Space");
  await expect(box).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "I accept the terms" })).toHaveAccessibleDescription("Accept the terms to continue.");
  await expect(page.getByRole("checkbox", { name: "Publish to the community" })).toBeDisabled();
});

test("a select-all box is mixed while some items are checked", async ({ page }) => {
  await openStory(page, "forms-checkbox--indeterminate");
  const all = page.getByRole("checkbox", { name: "All herbs" });
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await all.click();
  for (const name of ["Basil", "Mint", "Sage"]) await expect(page.getByRole("checkbox", { name })).toBeChecked();
  await expect(all).toHaveAttribute("aria-checked", "true");
});
