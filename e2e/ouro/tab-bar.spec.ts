import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("on a phone the tab bar marks the current tab and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "navigation-tabbar--in-context");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  const box = (await nav.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expect(nav.getByRole("link", { name: "Search" })).toBeVisible();
  await nav.getByRole("link", { name: "Cookbooks" }).click();
  await expect(page).toHaveURL(/\/cookbooks$/);
});

test("from 640px the tab bar hides", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-tabbar--in-context");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
});
