import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("Space toggles a focused row, and focus stays on it", async ({ page }) => {
  await openStory(page, "lists-checklist--in-context");
  const yogurt = page.getByRole("checkbox", { name: "Greek yogurt" });
  await expect(page.getByRole("group", { name: "Ingredients" })).toBeVisible();
  await expect(yogurt).not.toBeChecked();
  await yogurt.focus();
  await page.keyboard.press("Space");
  await expect(yogurt).toBeChecked();
  await expect(yogurt).toBeFocused();
  await page.keyboard.press("Space");
  await expect(yogurt).not.toBeChecked();
});

test("a click on the amount toggles the row, and Clear checked clears it", async ({ page }) => {
  await openStory(page, "lists-checklist--in-context");
  await page.getByText("2 tbsp").click();
  await expect(page.getByRole("checkbox", { name: "chia seeds" })).toBeChecked();
  await page.getByRole("button", { name: "Clear checked" }).click();
  for (const name of ["rolled oats", "milk", "chia seeds"]) await expect(page.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Clear checked" })).toHaveCount(0);
});

test("checked rows leave when removed, and new rows arrive", async ({ page }) => {
  await openStory(page, "lists-checklist--long-list");
  await expect(page.getByRole("checkbox")).toHaveCount(12);
  await page.getByRole("button", { name: "Remove checked" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(8);
  await page.getByRole("button", { name: "Add an item" }).click();
  await expect(page.getByRole("checkbox", { name: "extra item 1" })).toBeVisible();
});
