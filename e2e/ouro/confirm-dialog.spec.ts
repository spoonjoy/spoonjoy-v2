import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("Cancel has focus first; confirming shows the busy state, then closes", async ({ page }) => {
  await openStory(page, "overlays-confirmdialog--destructive");
  await page.getByRole("button", { name: "Delete recipe" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete recipe?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  const confirm = dialog.getByRole("button", { name: "Delete" });
  await confirm.click();
  await expect(confirm).toHaveAttribute("aria-busy", "true");
  await expect(dialog).toBeHidden({ timeout: 5000 });
});

test("an outside press does not dismiss it", async ({ page }) => {
  await openStory(page, "overlays-confirmdialog--destructive");
  await page.getByRole("button", { name: "Delete recipe" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete recipe?" });
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
});

test("a failing action keeps it open with the error", async ({ page }) => {
  await openStory(page, "overlays-confirmdialog--failing-action");
  await page.getByRole("button", { name: "Leave cookbook" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Leave cookbook?" });
  await dialog.getByRole("button", { name: "Leave" }).click();
  await expect(dialog.getByText("You're offline. Try again.")).toBeVisible();
  await expect(dialog).toBeVisible();
});
