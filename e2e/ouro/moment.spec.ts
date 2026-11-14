import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a moment names what happened and offers the way forward", async ({ page }) => {
  await openStory(page, "feedback-moment--kinds");
  await expect(page.getByRole("heading", { level: 3, name: "No messages yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
  await expect(page.locator('[data-moment="success"]')).toHaveCount(1);
});

test("a success moment celebrates when it appears, and a dismissed moment hands focus on", async ({ page }) => {
  await openStory(page, "feedback-moment--celebration");
  await page.getByRole("button", { name: "Send hello" }).click();
  await expect(page.getByRole("heading", { name: "Hello sent" })).toBeVisible();
  await expect(page.locator('[data-moment="success"][data-celebrate]')).toHaveCount(1);
  await openStory(page, "feedback-moment--dismissible");
  await page.getByRole("button", { name: "Dismiss" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Closed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show the welcome again" })).toBeFocused();
});
