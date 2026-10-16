import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("typing filters the list, and Enter picks the highlighted item", async ({ page }) => {
  await openStory(page, "forms-combobox--modes");
  const herb = page.getByRole("combobox", { name: "Herb", exact: true });
  await herb.fill("");
  await herb.pressSequentially("ros");
  await expect(page.getByRole("option")).toHaveText(["Rosemary"]);
  await herb.press("ArrowDown");
  await herb.press("Enter");
  await expect(herb).toHaveValue("Rosemary");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("multiple shows chips, and a chip's button removes it", async ({ page }) => {
  await openStory(page, "forms-combobox--modes");
  await expect(page.getByRole("button", { name: "Remove Basil" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Basil" }).click();
  await expect(page.getByRole("button", { name: "Remove Basil" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Mint" })).toBeVisible();
});

test("allowCustomValue keeps free text", async ({ page }) => {
  await openStory(page, "forms-combobox--modes");
  const cuisine = page.getByRole("combobox", { name: "Cuisine" });
  await cuisine.pressSequentially("Georgian");
  await pressTab(page);
  await expect(cuisine).toHaveValue("Georgian");
});
