import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the route progress bar shows across the top while a navigation runs and says Loading", async ({ page }) => {
  await openStory(page, "feedback-routeprogress--in-context");
  const status = page.locator('[data-ouro="route-progress"]');
  const bar = status.locator('[data-ouro-part="bar"]');
  await expect(status).toHaveText("");
  await expect(bar).toHaveCSS("opacity", "0");
  await page.getByRole("switch", { name: "Loading the next page" }).click();
  await expect(status).toHaveText("Loading");
  await expect(bar).toHaveCSS("opacity", "1");
  const box = (await status.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBe(2);
  await page.getByRole("switch", { name: "Loading the next page" }).click();
  await expect(bar).toHaveCSS("opacity", "0");
  await expect(status).toHaveText("");
});
