import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a timer counts down by the clock, pauses and resumes, and says Time's up at zero", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await openStory(page, "feedback-timer--playground");
  const timer = page.getByRole("group", { name: "Pasta" });
  const time = timer.getByRole("timer");
  await expect(time).toHaveText("10:00");
  await timer.getByRole("button", { name: "Start" }).click();
  await page.clock.runFor(61_000);
  await expect(time).toHaveText("8:59");
  await timer.getByRole("button", { name: "Pause" }).click();
  await page.clock.runFor(30_000);
  await expect(time).toHaveText(/^8:59/);
  await timer.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(540_000);
  await expect(timer.getByText("Time's up")).toBeVisible();
  await expect(time).toHaveText("0:00");
  await timer.getByRole("button", { name: "Dismiss" }).click();
  await expect(time).toHaveText("10:00");
});
