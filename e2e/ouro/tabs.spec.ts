import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("tabs switch panels by click and by arrow keys", async ({ page }) => {
  await openStory(page, "navigation-tabs--in-context");
  await page.getByRole("tab", { name: "Method" }).click();
  await expect(page.getByRole("tabpanel", { name: "Method" })).toContainText("knead for ten minutes");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Notes" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Notes" })).toBeVisible();
});

test("vertical tabs move with the down key and never select a disabled tab", async ({ page }) => {
  await openStory(page, "navigation-tabs--vertical");
  await page.getByRole("tab", { name: "Profile" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Kitchen" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Sharing" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tabpanel", { name: "Kitchen" })).toBeVisible();
});

test("tabs that are links mark the current page and move with Tab, not the arrow keys", async ({ page }) => {
  await openStory(page, "navigation-tabs--links");
  const nav = page.getByRole("navigation", { name: "Search scope" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(page.getByRole("tab")).toHaveCount(0);
  const recipes = nav.getByRole("link", { name: "Recipes" });
  await expect(recipes).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(recipes).toHaveAttribute("href", "/search?q=soup&scope=recipes");
  await recipes.focus();
  await page.keyboard.press("ArrowRight");
  await expect(recipes).toBeFocused();
  await pressTab(page);
  await expect(nav.getByRole("link", { name: "Cookbooks" })).toBeFocused();
  await pressTab(page, { shift: true });
  await expect(recipes).toBeFocused();
});

test("vertical link tabs stack in a column and mark the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-tabs--links-vertical");
  const nav = page.getByRole("navigation", { name: "Search scope" });
  const all = await nav.getByRole("link", { name: "All" }).boundingBox();
  const chefs = nav.getByRole("link", { name: "Chefs" });
  expect((await chefs.boundingBox())!.y).toBeGreaterThan(all!.y);
  expect((await chefs.boundingBox())!.x).toBe(all!.x);
  await expect(chefs).toHaveAttribute("aria-current", "page");
});
