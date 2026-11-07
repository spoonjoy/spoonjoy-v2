import { expect, test } from "../ouro-fixtures";
import { holdClock, openStory, pressTab } from "./story";

test("a press shows a toast that is announced politely and can be dismissed", async ({ page }) => {
  await page.clock.install();
  await openStory(page, "feedback-toast--playground");
  // The toast's five seconds wait for the clock, which stands still from here.
  await holdClock(page);
  await page.getByRole("button", { name: "Save recipe" }).click();
  const region = page.getByRole("region", { name: "Notifications" });
  const toast = region.getByRole("dialog", { name: "Recipe saved" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Find it in your cookbook.");
  // A polite live region in the Notifications landmark says the message and description, not the
  // buttons, once it has been on the page 100ms (Safari drops words given to a newer one).
  await page.clock.runFor(150);
  await expect(region.locator('[aria-live="polite"]')).toHaveText("Recipe savedFind it in your cookbook.");
  await toast.hover();
  // The pointer over the toasts pauses its countdown, and Base UI removes a closed toast on the clock.
  await page.clock.resume();
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toHaveCount(0);
});

test("the Undo action runs and dismisses its toast", async ({ page }) => {
  await page.clock.install();
  await openStory(page, "feedback-toast--with-action");
  // "Recipe restored" has five seconds, which wait for the clock, standing still from here.
  await holdClock(page);
  await page.getByRole("button", { name: "Delete recipe" }).click();
  const deleted = page.getByRole("dialog", { name: "Recipe deleted" });
  await deleted.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("dialog", { name: "Recipe restored" })).toBeVisible();
  // Base UI removes a closed toast on the clock.
  await page.clock.resume();
  await expect(deleted).toHaveCount(0);
});

test("a screen reader finds every toast and its buttons in the collapsed stack, before anything is focused or hovered", async ({ page }) => {
  await page.clock.install();
  await openStory(page, "feedback-toast--stack");
  // The timed toasts wait for the clock, which stands still from here.
  await holdClock(page);
  const region = page.getByRole("region", { name: "Notifications" });
  // Roles as assistive technology gets them: nothing hidden from it counts.
  await expect(region.getByRole("alertdialog", { name: "Couldn't sync" })).toBeVisible();
  await expect(region.getByRole("dialog")).toHaveCount(2);
  await expect(region.getByRole("button", { name: "Undo" })).toHaveCount(1);
  await expect(region.getByRole("button", { name: "Dismiss" })).toHaveCount(3);
  await expect(region).not.toHaveAttribute("data-expanded");
});

test("F6 moves focus to the toasts, and Escape closes the focused one", async ({ page }) => {
  await openStory(page, "feedback-toast--stack");
  // The front toast is destructive: an alertdialog.
  const toasts = page.locator('[data-ouro="toast"]');
  await expect(toasts).toHaveCount(3);
  await page.keyboard.press("F6");
  await pressTab(page);
  const focused = page.locator('[data-ouro="toast"]:focus');
  await expect(focused).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(toasts).toHaveCount(2);
});
