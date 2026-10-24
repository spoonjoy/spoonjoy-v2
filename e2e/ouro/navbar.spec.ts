import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the navbar marks the current page and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-navbar--in-context");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
  await nav.getByRole("link", { name: "Cookbooks" }).click();
  await expect(page).toHaveURL(/\/cookbooks$/);
});

test("on a phone the navbar's links open in a sheet that Escape closes, back on the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "navigation-navbar--in-context");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
  await expect(sheet.getByRole("link", { name: "Shopping list" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(menu).toBeFocused();
});
