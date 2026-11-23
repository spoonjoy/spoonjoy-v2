// The private calendar feed: the plan as an RFC 5545 calendar a phone or desktop calendar subscribes to. Options come
// from the feed URL's query, and the title and description are templates with merge fields such as ${title}.
import { addDays, type LocalDate } from "./local-date";
import { MEAL_TYPES, parseMealType, type MealType } from "./meal-type";
import type { PlanEntry } from "./plan-entry";

export type FeedOptions = {
  /** Meal types to include; null for every type. */
  types: MealType[] | null;
  includeNotes: boolean;
  timeZone: string;
  durationMinutes: number;
  summary: string;
  description: string;
  /** A start time ("18:30") per meal type; a meal type without one becomes an all-day event. */
  times: Partial<Record<MealType, string>>;
};

export type FeedEntry = PlanEntry & { recipe: { servings: string | null; description: string | null } | null };

const DEFAULT_SUMMARY = "${type}: ${title}";
const DEFAULT_DESCRIPTION = "${note}\n\n${url}";
const DEFAULT_DURATION = 60;

function knownTimeZone(value: string | null): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function duration(value: string | null): number {
  const minutes = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(minutes)) return DEFAULT_DURATION;
  return Math.min(1440, Math.max(1, minutes));
}

function clockTime(value: string | null): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : null;
}

/** Reads the feed's options from its URL query, falling back on a default for anything missing or out of range. */
export function parseFeedOptions(params: URLSearchParams): FeedOptions {
  const types = params.getAll("types").map(parseMealType).filter((type): type is MealType => type !== null);
  const times: Partial<Record<MealType, string>> = {};
  for (const type of MEAL_TYPES) {
    const time = clockTime(params.get(type.id));
    if (time) times[type.id] = time;
  }
  return {
    types: types.length > 0 ? types : null,
    includeNotes: params.get("include_notes") !== "false",
    timeZone: knownTimeZone(params.get("tz")),
    durationMinutes: duration(params.get("duration")),
    summary: params.get("summary") || DEFAULT_SUMMARY,
    description: params.get("description") ?? DEFAULT_DESCRIPTION,
    times,
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - utcMs;
}

/** The instant a wall-clock time on a day falls at in a time zone. */
function zonedInstant(date: LocalDate, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, as RFC 5545 requires, never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function scaledServings(servings: string | null, scaleFactor: number): string {
  if (!servings) return "";
  const match = /^(\d+(?:\.\d+)?)(.*)$/s.exec(servings.trim());
  if (!match) return servings;
  return `${Number((Number(match[1]) * scaleFactor).toFixed(2))}${match[2]}`;
}

function fill(template: string, fields: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (whole, name: string) => (name in fields ? fields[name] : whole));
}

const MEAL_LABELS = Object.fromEntries(MEAL_TYPES.map((meal) => [meal.id, meal.label])) as Record<MealType, string>;

function mealLabel(type: MealType): string {
  return MEAL_LABELS[type];
}

function recipeUrl(origin: string, entry: FeedEntry): string {
  if (entry.kind !== "recipe" || !entry.recipeId) return "";
  const path = `${origin}/recipes/${encodeURIComponent(entry.recipeId)}`;
  return entry.scaleFactor === 1 ? path : `${path}?scale=${entry.scaleFactor}`;
}

function event(entry: FeedEntry, options: FeedOptions, origin: string, stamp: string, host: string): string[] {
  const url = recipeUrl(origin, entry);
  const fields: Record<string, string> = {
    type: mealLabel(entry.mealType),
    title: entry.kind === "recipe" ? (entry.recipeTitle ?? "Planned recipe") : entry.title,
    note: entry.note,
    url,
    id: entry.recipeId ?? "",
    servings: scaledServings(entry.recipe?.servings ?? null, entry.scaleFactor),
    description: entry.recipe?.description ?? "",
  };
  const time = options.times[entry.mealType];
  const when = time
    ? (() => {
        const start = zonedInstant(entry.date, time, options.timeZone);
        return [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start + options.durationMinutes * 60_000)}`];
      })()
    : [`DTSTART;VALUE=DATE:${entry.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(entry.date, 1).replace(/-/g, "")}`];
  return [
    "BEGIN:VEVENT",
    `UID:plan-entry-${entry.id}@${host}`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${escapeText(fill(options.summary, fields))}`,
    `DESCRIPTION:${escapeText(fill(options.description, fields))}`,
    ...(url ? [`URL:${url}`] : []),
    `CATEGORIES:${escapeText(fields.type)}`,
    "END:VEVENT",
  ];
}

/** The plan's entries as a calendar, filtered and shaped by the feed's options. */
export function renderCalendar(input: { name: string; origin: string; now: Date; entries: readonly FeedEntry[]; options: FeedOptions }): string {
  const { options } = input;
  const stamp = utcStamp(input.now.getTime());
  const host = new URL(input.origin).host;
  const events = input.entries
    .filter((entry) => (entry.kind === "note" ? options.includeNotes : true))
    .filter((entry) => options.types === null || options.types.includes(entry.mealType))
    .flatMap((entry) => event(entry, options, input.origin, stamp, host));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spoonjoy//Meal plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events,
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
