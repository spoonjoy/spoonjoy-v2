import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a relative time says how long ago, and keeps itself current", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-06-01T12:00:00Z") });
  await openStory(page, "text-relativetime--in-context");
  const first = page.locator('[data-ouro="relative-time"]').first();
  await expect(first).toHaveText("2 minutes ago");
  await page.clock.runFor(60_000);
  await expect(first).toHaveText("3 minutes ago");
  await expect(page.locator('[data-ouro="relative-time"]').last()).toHaveText("last week");
});

test.describe("west of UTC", () => {
  test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

  test("a calendar date counts days from the reader's own today, and its title is that day", async ({ page }) => {
    // 12:00 UTC on June 1 is 5 AM on June 1 in Los Angeles.
    await page.clock.install({ time: new Date("2026-06-01T12:00:00Z") });
    await openStory(page, "text-relativetime--calendar-date");
    const due = page.locator('[data-ouro="relative-time"]');
    await expect(due).toHaveText("tomorrow");
    await expect(due).toHaveAttribute("title", "Jun 2, 2026");
    await expect(due).toHaveAttribute("datetime", "2026-06-02");
  });
});

test.describe("east of UTC", () => {
  test.use({ timezoneId: "Asia/Tokyo", locale: "en-US" });

  test("a calendar date turns over at the reader's own midnight", async ({ page }) => {
    // 20:00 UTC on June 1 is 5 AM on June 2 in Tokyo.
    await page.clock.install({ time: new Date("2026-06-01T20:00:00Z") });
    await openStory(page, "text-relativetime--calendar-date");
    const due = page.locator('[data-ouro="relative-time"]');
    await expect(due).toHaveText("today");
    await expect(due).toHaveAttribute("title", "Jun 2, 2026");
  });
});
