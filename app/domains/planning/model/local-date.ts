// A calendar day in the plan's own time zone, as "YYYY-MM-DD". Never a timestamp, so a dinner planned for Tuesday
// stays on Tuesday wherever the cook or the server is.
export type LocalDate = string;

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtc(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day `value` names, or null when it is not a real calendar day in YYYY-MM-DD form. */
export function parseLocalDate(value: unknown): LocalDate | null {
  if (typeof value !== "string" || !SHAPE.test(value)) return null;
  return fromUtc(toUtc(value)) === value ? value : null;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(date: LocalDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** The first day of the week holding `date`, for a plan whose weeks start on `firstDayOfWeek` (0 Sunday .. 6 Saturday). */
export function startOfWeek(date: LocalDate, firstDayOfWeek: number): LocalDate {
  return addDays(date, -((weekdayOf(date) - firstDayOfWeek + 7) % 7));
}

export function weekDates(start: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, offset) => addDays(start, offset));
}

/** Today's date where the plan lives; an unknown time zone falls back to UTC. */
export function todayIn(timeZone: string, now: Date): LocalDate {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
