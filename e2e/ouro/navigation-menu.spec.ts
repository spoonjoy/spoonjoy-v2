import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a navigation menu opens a panel of links, marks the current page and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-navigationmenu--in-context");
  const nav = page.getByRole("navigation", { name: "Main" });
  const recipes = nav.getByRole("button", { name: "Recipes" });
  await recipes.click();
  await expect(recipes).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /Drafts/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Bring one in from a link.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /Drafts/ })).toBeHidden();
  await expect(recipes).toBeFocused();
});

test("a navigation menu follows a link in a panel, and a plain link in the row", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-navigationmenu--in-context");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
  await nav.getByRole("button", { name: "Cookbooks" }).click();
  await page.getByRole("link", { name: "Shared with you" }).click();
  await expect(page).toHaveURL(/\/cookbooks\/shared$/);
});
