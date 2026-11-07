import { expect, test } from "../ouro-fixtures";
import { openStory, settledBox } from "./story";

test("a segmented control switches the view and slides its thumb", async ({ page }) => {
  await openStory(page, "navigation-segmentedcontrol--in-context");
  const grid = page.getByRole("radio", { name: "Grid" });
  await grid.click();
  await expect(grid).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("as a grid")).toBeVisible();
  const thumb = page.locator("[data-ouro-segment-thumb]");
  const [thumbBox, gridBox] = [await settledBox(thumb), await settledBox(grid)];
  expect(Math.abs(thumbBox.x - gridBox.x)).toBeLessThan(1);
});

test("pressing the pressed segment keeps it pressed", async ({ page }) => {
  await openStory(page, "navigation-segmentedcontrol--in-context");
  const list = page.getByRole("radio", { name: "List" });
  await list.click();
  await expect(list).toHaveAttribute("aria-checked", "true");
});

test("the arrow keys check the next segment", async ({ page }) => {
  await openStory(page, "navigation-segmentedcontrol--in-context");
  await page.getByRole("radio", { name: "List" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Grid" })).toBeFocused();
});
