/**
 * Format a Date / ISO string / millisecond timestamp as a human relative
 * phrase like "5 seconds ago", "2 minutes ago", "1 day ago", "1 year ago".
 *
 * Anchored optionally to `now` for testability; defaults to Date.now().
 * Future-dated inputs are treated as "just now" (clock-skew tolerance).
 */
export function formatRelativeTime(
  input: Date | string | number,
  now: number = Date.now(),
): string {
  const inputMs =
    input instanceof Date
      ? input.getTime()
      : typeof input === "number"
        ? input
        : new Date(input).getTime();
  const diffSec = Math.floor((now - inputMs) / 1000);

  if (diffSec < 5) {
    return "just now";
  }
  if (diffSec < 60) {
    return `${diffSec} seconds ago`;
  }

  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }

  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

// "Jun 1, 2026" for a day, "Jun 2026" for a month.
export type CalendarUnit = "day" | "month";

const CALENDAR_FORMAT: Record<CalendarUnit, Intl.DateTimeFormatOptions> = {
  day: { year: "numeric", month: "short", day: "numeric" },
  month: { year: "numeric", month: "short" },
};

/**
 * A calendar date as "Jun 1, 2026" (or the month, "Jun 2026"), always in en-US and in UTC.
 * Rendered markup has to come out the same on the server (a Worker: en-US, UTC) and in the
 * browser that hydrates it; a date formatted with the runtime's default locale or timezone
 * differs between the two for most viewers, and React reports a hydration mismatch. For the
 * viewer's own date, render <LocalDate> (~/components/ui/local-date), which starts from this and
 * swaps after hydration.
 */
export function formatUtcCalendarDate(input: Date | string, unit: CalendarUnit = "day"): string {
  return new Date(input).toLocaleDateString("en-US", { ...CALENDAR_FORMAT[unit], timeZone: "UTC" });
}

/**
 * The same calendar format in the runtime's own timezone: the viewer's date, in a browser.
 * Only for client-only renders (after hydration); on the Worker it is the UTC date.
 */
export function formatLocalCalendarDate(input: Date | string, unit: CalendarUnit = "day"): string {
  return new Date(input).toLocaleDateString("en-US", CALENDAR_FORMAT[unit]);
}
