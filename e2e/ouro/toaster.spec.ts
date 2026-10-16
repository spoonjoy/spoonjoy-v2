import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("a press shows a toast that is announced politely and can be dismissed", async ({ page }) => {
  await openStory(page, "feedback-toast--playground");
  await page.getByRole("button", { name: "Save recipe" }).click();
  const region = page.getByRole("region", { name: "Notifications" });
  await expect(region).toHaveAttribute("aria-live", "polite");
  const toast = region.getByRole("dialog", { name: "Recipe saved" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Find it in your cookbook.");
  // Base UI hides the close button from screen readers until the stack expands on hover or focus.
  await toast.hover();
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toHaveCount(0);
});

test("the Undo action runs and dismisses its toast", async ({ page }) => {
  await openStory(page, "feedback-toast--with-action");
  await page.getByRole("button", { name: "Delete recipe" }).click();
  const deleted = page.getByRole("dialog", { name: "Recipe deleted" });
  await deleted.getByRole("button", { name: "Undo" }).click();
  await expect(deleted).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Recipe restored" })).toBeVisible();
});

test("F6 moves focus to the toasts, and Escape closes the focused one", async ({ page }) => {
  await openStory(page, "feedback-toast--stack");
  // The front toast is destructive: an alertdialog, hidden from screen readers until focused, since an alert speaks it.
  const toasts = page.locator('[data-ouro="toast"]');
  await expect(toasts).toHaveCount(3);
  await page.keyboard.press("F6");
  await pressTab(page);
  const focused = page.locator('[data-ouro="toast"]:focus');
  await expect(focused).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(toasts).toHaveCount(2);
});
