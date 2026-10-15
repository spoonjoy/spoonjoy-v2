import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a click on the label or Space flips the switch", async ({ page }) => {
  await openStory(page, "forms-switch--settings");
  const timers = page.getByRole("switch", { name: "Cooking timers" });
  const awake = page.getByRole("switch", { name: "Keep screen awake" });
  await expect(timers).toBeChecked();
  await expect(awake).not.toBeChecked();
  await page.getByText("Keep screen awake").click();
  await expect(awake).toBeChecked();
  await timers.press("Space");
  await expect(timers).not.toBeChecked();
  await expect(timers).toHaveAccessibleDescription("Sound an alarm when a step is done.");
});
