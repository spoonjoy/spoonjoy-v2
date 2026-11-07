import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

// The message shows in Celebrate's badge, and screen readers hear it through the shared announcer,
// a hidden status region that takes the same text about 100 ms later. So the badge is found inside
// Celebrate: a page-wide getByText finds both once the announcer has spoken, and a check that came
// that late failed as a strict-mode violation.
const CELEBRATE = '[data-ouro="celebrate"]';
const ANNOUNCER = "[data-ouro-announcer]";

test("finishing the last task bursts confetti from the message", async ({ page }) => {
  await openStory(page, "feedback-celebrate--in-context");
  await expect(page.locator(CELEBRATE).getByText("All done for today")).toHaveCount(0);
  for (const chore of ["Water the plants", "Take out the bins", "Book the dentist"]) await page.getByLabel(chore).check();
  await expect(page.locator(CELEBRATE).getByText("All done for today")).toBeVisible();
  await expect(page.locator(ANNOUNCER)).toHaveText("All done for today");
  await expect(page.locator(CELEBRATE).locator('[data-ouro-part="piece"]')).toHaveCount(12);
});

test("with reduced motion the message shows and no confetti flies", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStory(page, "feedback-celebrate--in-context");
  for (const chore of ["Water the plants", "Take out the bins", "Book the dentist"]) await page.getByLabel(chore).check();
  await expect(page.locator(CELEBRATE).getByText("All done for today")).toBeVisible();
  await expect(page.locator(ANNOUNCER)).toHaveText("All done for today");
  await expect(page.locator(CELEBRATE).locator('[data-ouro-part="piece"]').first()).toBeHidden();
});
