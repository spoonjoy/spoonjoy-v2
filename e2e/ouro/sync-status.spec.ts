import { expect, test } from "../ouro-fixtures";
import { holdClock, openStory } from "./story";

test("sync status says Saving then Saved as you type, Offline without a connection, and saves on Retry", async ({ page }) => {
  await page.clock.install();
  await openStory(page, "feedback-syncstatus--in-context");
  const status = page.locator('[data-ouro="sync-status"]');
  await expect(status).toHaveAttribute("data-status", "saved");
  // The story saves 700ms after the last keystroke; that waits for the clock, standing still from here.
  await holdClock(page);
  await page.getByRole("textbox", { name: "Trail notes" }).pressSequentially(" Muddy.");
  await expect(status).toHaveAttribute("data-status", "saving");
  await page.clock.runFor(699);
  await expect(status).toHaveAttribute("data-status", "saving");
  await page.clock.runFor(1);
  await expect(status).toHaveAttribute("data-status", "saved");
  await page.clock.resume();
  await page.getByRole("switch", { name: "Connected" }).click();
  await expect(status).toHaveAttribute("data-status", "offline");
  await expect(page.getByText("Offline: changes are kept on this device").last()).toBeVisible();
  await page.getByRole("switch", { name: "Connected" }).click();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(status).toHaveAttribute("data-status", "saved");
});
