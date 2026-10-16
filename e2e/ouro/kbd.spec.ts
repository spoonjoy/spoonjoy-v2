import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a shortcut shows the platform's notation after hydration", async ({ page }) => {
  await openStory(page, "text-kbd--in-context");
  const search = page.locator('[data-ouro="kbd"]').first();
  const apple = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod|ios/i.test(nav.userAgentData?.platform ?? nav.platform);
  });
  await expect(search).toHaveAttribute("data-platform", apple ? "apple" : "other");
  await expect(search).toContainText(apple ? "⌘" : "Ctrl+K");
});
