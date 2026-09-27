import { useEffect, useState } from "react";
import { formatLocalCalendarDate, formatUtcCalendarDate } from "~/lib/time";

/**
 * A calendar date ("Jun 1, 2026") in the viewer's own timezone, in a <time> carrying the exact
 * instant. Only the browser knows the viewer's timezone, so the server (a UTC Worker) renders the
 * UTC date, the browser's first render repeats it so hydration matches, and an effect then swaps
 * in the local date. The two differ only when the viewer's day is not the UTC day.
 */
export function LocalDate({ value }: { value: Date | string }) {
  const iso = new Date(value).toISOString();
  const [localDate, setLocalDate] = useState<string | null>(null);

  useEffect(() => {
    setLocalDate(formatLocalCalendarDate(iso));
  }, [iso]);

  return <time dateTime={iso}>{localDate ?? formatUtcCalendarDate(iso)}</time>;
}
