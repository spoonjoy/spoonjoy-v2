import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the three sizes step down the theme's type scale", async ({ page }) => {
  await openStory(page, "text-text--sizes-and-tones");
  const size = (text: string) =>
    page.getByText(text, { exact: false }).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const large = await size("Large:");
  const medium = await size("Medium:");
  const small = await size("Small:");
  expect(large).toBeGreaterThan(medium);
  expect(medium).toBeGreaterThan(small);
});

test("truncated text stays on one line and ends in an ellipsis", async ({ page }) => {
  await openStory(page, "text-text--truncate-and-clamp");
  const truncated = page.locator("[data-ouro=text]").nth(1);
  await expect(truncated).toBeVisible();
  expect(await truncated.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await truncated.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
});
