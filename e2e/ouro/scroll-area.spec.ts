import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a scroll area scrolls with the wheel and the keyboard", async ({ page }) => {
  await openStory(page, "layout-scrollarea--in-context");
  const region = page.getByRole("region", { name: "Method" });
  await region.hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await region.evaluate((el) => (el.scrollTop = 0));
  await region.focus();
  await page.keyboard.press("End");
  await expect.poll(() => region.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
  await expect(page.getByText("10. Warm the ribs in the sauce and serve.")).toBeInViewport();
});

test("a horizontal scroll area keeps its row on one line", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "layout-scrollarea--in-context");
  const tags = page.getByRole("region", { name: "Tags" });
  expect(await tags.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
