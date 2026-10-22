import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("tabs switch panels by click and by arrow keys", async ({ page }) => {
  await openStory(page, "navigation-tabs--in-context");
  await page.getByRole("tab", { name: "Method" }).click();
  await expect(page.getByRole("tabpanel", { name: "Method" })).toContainText("knead for ten minutes");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Notes" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Notes" })).toBeVisible();
});

test("vertical tabs move with the down key and never select a disabled tab", async ({ page }) => {
  await openStory(page, "navigation-tabs--vertical");
  await page.getByRole("tab", { name: "Profile" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Kitchen" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Sharing" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tabpanel", { name: "Kitchen" })).toBeVisible();
});
