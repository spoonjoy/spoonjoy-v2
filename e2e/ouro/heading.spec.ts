import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("headings form the document outline, and no level is larger than the one above it", async ({ page }) => {
  await openStory(page, "text-heading--headings");
  const sizes: number[] = [];
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const heading = page.getByRole("heading", { level, name: `Heading level ${level}` });
    await expect(heading).toBeVisible();
    sizes.push(await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)));
  }
  for (let level = 1; level < sizes.length; level++) expect(sizes[level]).toBeLessThanOrEqual(sizes[level - 1]!);
  expect(sizes[0]).toBeGreaterThan(sizes[5]!);
});

test("a display heading is a hero headline, larger than any level's default size", async ({ page }) => {
  await openStory(page, "text-heading--display");
  const display = page.getByRole("heading", { level: 1, name: "Dinner, sorted before you get home." });
  await expect(display).toBeVisible();
  const [size, root] = await display.evaluate((el) => [
    parseFloat(getComputedStyle(el).fontSize),
    parseFloat(getComputedStyle(document.documentElement).fontSize),
  ]);
  // Level 1's default, `2xl`, is 1.875rem; display is at least 2.5rem.
  expect(size).toBeGreaterThanOrEqual(2.5 * root!);
});
