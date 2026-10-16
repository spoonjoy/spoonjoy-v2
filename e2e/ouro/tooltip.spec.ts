import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("shows on hover and hides when the pointer leaves", async ({ page }) => {
  await openStory(page, "overlays-tooltip--playground");
  await page.getByRole("button", { name: "Save" }).hover();
  const tooltip = page.getByText("Add to cookbook");
  await expect(tooltip).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(tooltip).toBeHidden();
});

test("shows on keyboard focus and hides on Escape", async ({ page }) => {
  await openStory(page, "overlays-tooltip--playground");
  await pressTab(page);
  await expect(page.getByRole("button", { name: "Save" })).toBeFocused();
  const tooltip = page.getByText("Add to cookbook");
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
});

test.describe("on a touch phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("never opens from a tap", async ({ page }) => {
    await openStory(page, "overlays-tooltip--playground");
    await page.getByRole("button", { name: "Save" }).tap();
    // A focus open is immediate, but a hover open waits for the delay (600ms): wait past it.
    await page.waitForTimeout(1500);
    await expect(page.getByText("Add to cookbook")).toHaveCount(0);
  });
});
