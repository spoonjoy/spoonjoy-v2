import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("the auth layout centers a card with the page's heading and the form", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-authlayout--in-context");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  const card = (await main.locator('[data-ouro="card"]').boundingBox())!;
  expect(Math.abs(card.x + card.width / 2 - 512)).toBeLessThanOrEqual(1);
  await page.getByRole("textbox", { name: "Email" }).fill("ari@example.com");
  await pressTab(page);
  await expect(page.locator('input[name="password"]')).toBeFocused();
  await expect(main.getByRole("link", { name: "Create an account" })).toBeVisible();
});

test("the auth layout fits a phone without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "navigation-authlayout--in-context");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
