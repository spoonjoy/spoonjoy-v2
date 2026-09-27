import { useSyncExternalStore } from "react";
import { formatLocalCalendarDate, formatUtcCalendarDate, type CalendarUnit } from "~/lib/time";

// Nothing to subscribe to: the value only changes between the server and the browser.
function subscribe() {
  return () => {};
}

// False on the server and while hydrating server markup, true in the browser after that. React
// renders hydration with the server value, so the markup matches, then re-renders with the client
// value; a client-only render (a client-side navigation) uses the client value straight away.
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * A calendar date ("Jun 1, 2026", or "Jun 2026" with unit="month") in the viewer's own timezone,
 * in a <time> carrying the exact instant. Only the browser knows the viewer's timezone, so the
 * server (a UTC Worker) renders the UTC date, hydration repeats it so the markup matches, and the
 * browser then shows the local date. The two differ only when the viewer's day (or month) is not
 * the UTC one.
 */
export function LocalDate({ value, unit = "day" }: { value: Date | string; unit?: CalendarUnit }) {
  const iso = new Date(value).toISOString();
  const hydrated = useHydrated();
  return (
    <time dateTime={iso}>{hydrated ? formatLocalCalendarDate(iso, unit) : formatUtcCalendarDate(iso, unit)}</time>
  );
}
