// "Cooked at" comes from a datetime-local field: a wall-clock time with no timezone. Only the
// cook's browser knows which timezone they meant, so the browser turns it into an instant before
// it is sent, and the server accepts only instants (recipe-detail.server.ts). The server runs in
// UTC, so reading a bare wall-clock time there would shift the cook by the cook's own offset.
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/**
 * A datetime-local value ("2026-09-26T07:30", optionally with seconds) read as the browser's own
 * wall-clock time, as an ISO 8601 instant ("2026-09-26T14:30:00.000Z" in Los Angeles). An empty
 * value stays empty, and anything that isn't a datetime-local value is returned unchanged for the
 * server to accept (an instant) or reject.
 *
 * The parts are read by hand rather than with `new Date(value)`, which some older WebKit builds
 * read as UTC.
 */
export function localDateTimeToIso(value: string): string {
  const match = DATETIME_LOCAL.exec(value.trim());
  if (!match) return value;
  const [, year, month, day, hour, minute, second = "0", fraction = "0"] = match;
  // setFullYear, not the Date constructor, which reads years 0-99 as 1900-1999.
  const local = new Date(0);
  local.setFullYear(Number(year), Number(month) - 1, Number(day));
  local.setHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, "0")));
  return local.toISOString();
}
