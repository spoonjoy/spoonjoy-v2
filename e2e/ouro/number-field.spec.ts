import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("the steppers and arrow keys change the number within its bounds", async ({ page }) => {
  await openStory(page, "forms-numberfield--states");
  const servings = page.getByRole("textbox", { name: "Servings" });
  await expect(servings).toHaveValue("4");
  await page.getByRole("button", { name: "Increase" }).first().click();
  await expect(servings).toHaveValue("5");
  await servings.press("ArrowDown");
  await servings.press("ArrowDown");
  await expect(servings).toHaveValue("3");
  await expect(servings).toHaveAccessibleDescription("Scales the shopping list.");
});

test("a typed number is formatted for the locale on blur", async ({ page }) => {
  await openStory(page, "forms-numberfield--formats");
  const price = page.getByRole("textbox", { name: "Price" });
  await price.fill("12.5");
  await pressTab(page);
  await expect(price).toHaveValue("$12.50");
});
