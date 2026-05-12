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
