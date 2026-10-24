import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the skip link shows on the first Tab and Enter moves focus past the header", async ({ page, browserName }) => {
  await openStory(page, "navigation-skiplink--in-context");
  const link = page.getByRole("link", { name: "Skip to the recipe" });
  await expect(link).toBeAttached();
  expect((await link.boundingBox())!.width).toBeLessThanOrEqual(1);
  // WebKit reaches links with Alt+Tab (Option+Tab), whatever the system's keyboard setting.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(link).toBeFocused();
  await expect.poll(async () => (await link.boundingBox())!.width).toBeGreaterThan(40);
  const url = page.url();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  expect(page.url()).toBe(url);
});
