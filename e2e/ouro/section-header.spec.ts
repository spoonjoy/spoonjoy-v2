import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a section header is the section's h2 with its See all link on the title's row, on a phone too", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "layout-sectionheader--in-context");
  const title = page.getByRole("heading", { level: 2, name: "Your recipes" });
  await expect(title).toBeVisible();
  const seeAll = page.getByRole("link", { name: "See all" });
  const titleBox = (await title.boundingBox())!;
  const linkBox = (await seeAll.boundingBox())!;
  expect(linkBox.y).toBeLessThan(titleBox.y + titleBox.height);
  expect(linkBox.x).toBeGreaterThan(titleBox.x + titleBox.width - 1);
  await expect(page.getByRole("heading", { level: 2, name: "Cookbook shelf" })).toBeVisible();
});
