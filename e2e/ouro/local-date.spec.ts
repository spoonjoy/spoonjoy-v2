import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

test("a local date shows the instant in the reader's time zone", async ({ page }) => {
  await openStory(page, "text-localdate--formats");
  const times = page.locator('[data-ouro="local-date"]');
  await expect(times).toHaveCount(4);
  // 09:30 UTC is 2:30 AM in Los Angeles in June. WebKit joins the date and time with "at".
  await expect(times.nth(2)).toHaveText(/^Jun 1, 2026(,| at) 2:30\sAM$/);
  await expect(times.nth(3)).toHaveText(/^2:30\sAM$/);
  await expect(times.first()).toHaveAttribute("datetime", "2026-06-01T09:30:00.000Z");
});

test("a calendar date stays on its day west of UTC", async ({ page }) => {
  await openStory(page, "text-localdate--calendar-date");
  const times = page.locator('[data-ouro="local-date"]');
  await expect(times.first()).toHaveText("Jun 1, 2026");
  await expect(times.first()).toHaveAttribute("datetime", "2026-06-01");
  await expect(times.nth(1)).toHaveText("Jun 2026");
});
