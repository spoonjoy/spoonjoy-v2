import { describe, expect, it } from "vitest";
import { parseFeedOptions, renderCalendar, type FeedEntry } from "~/domains/planning";

const NOW = new Date("2026-11-23T12:00:00Z");

function feedEntry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: "e1",
    date: "2026-11-24",
    mealType: "dinner",
    position: 0,
    kind: "recipe",
    recipeId: "r1",
    recipeTitle: "Miso Glazed Salmon",
    title: "",
    note: "",
    scaleFactor: 2,
    recipe: { servings: "4 servings", description: "Sweet, salty; quick" },
    ...overrides,
  };
}

function lines(ics: string) {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

describe("calendar feed options", () => {
  it("defaults to every meal and note, all day, an hour long, in UTC, titled by type and title", () => {
    expect(parseFeedOptions(new URLSearchParams())).toEqual({
      types: null,
      includeNotes: true,
      timeZone: "UTC",
      durationMinutes: 60,
      summary: "${type}: ${title}",
      description: "${note}\n\n${url}",
      times: {},
    });
  });

  it("reads meal types, notes, a time zone, a duration, templates and a start time per meal type", () => {
    const params = new URLSearchParams("types=dinner&types=lunch&types=brunch&include_notes=false&tz=America/New_York&duration=90&summary=${title}&description=${servings}&dinner=18:30&lunch=25:00");
    expect(parseFeedOptions(params)).toEqual({
      types: ["dinner", "lunch"],
      includeNotes: false,
      timeZone: "America/New_York",
      durationMinutes: 90,
      summary: "${title}",
      description: "${servings}",
      times: { dinner: "18:30" },
    });
  });

  it("falls back on a time zone it doesn't know and keeps the duration between a minute and a day", () => {
    expect(parseFeedOptions(new URLSearchParams("tz=Not/AZone&duration=0")).timeZone).toBe("UTC");
    expect(parseFeedOptions(new URLSearchParams("duration=0")).durationMinutes).toBe(1);
    expect(parseFeedOptions(new URLSearchParams("duration=5000")).durationMinutes).toBe(1440);
    expect(parseFeedOptions(new URLSearchParams("duration=lots")).durationMinutes).toBe(60);
  });
});

describe("calendar feed", () => {
  const base = { name: "Spoonjoy meal plan", origin: "https://spoonjoy.app", now: NOW };

  it("writes an RFC 5545 calendar that refreshes hourly, with CRLF line ends", () => {
    const ics = renderCalendar({ ...base, entries: [], options: parseFeedOptions(new URLSearchParams()) });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(lines(ics)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Spoonjoy//Meal plan//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Spoonjoy meal plan",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
      "END:VCALENDAR",
      "",
    ]);
  });

  it("makes a meal without a start time an all-day event, filling the templates' merge fields", () => {
    const ics = renderCalendar({ ...base, entries: [feedEntry()], options: parseFeedOptions(new URLSearchParams("description=${servings} · ${description} · ${unknown}")) });
    const event = lines(ics).slice(lines(ics).indexOf("BEGIN:VEVENT"), lines(ics).indexOf("END:VEVENT") + 1);
    expect(event).toEqual([
      "BEGIN:VEVENT",
      "UID:plan-entry-e1@spoonjoy.app",
      "DTSTAMP:20261123T120000Z",
      "DTSTART;VALUE=DATE:20261124",
      "DTEND;VALUE=DATE:20261125",
      "SUMMARY:Dinner: Miso Glazed Salmon",
      "DESCRIPTION:8 servings · Sweet\\, salty\\; quick · ${unknown}",
      "URL:https://spoonjoy.app/recipes/r1?scale=2",
      "CATEGORIES:Dinner",
      "END:VEVENT",
    ]);
  });

  it("starts a meal at its type's time in the feed's time zone, for the feed's duration", () => {
    const options = parseFeedOptions(new URLSearchParams("tz=America/Los_Angeles&dinner=18:30&duration=90"));
    const ics = lines(renderCalendar({ ...base, entries: [feedEntry({ scaleFactor: 1 })], options }));
    expect(ics).toContain("DTSTART:20261125T023000Z");
    expect(ics).toContain("DTEND:20261125T040000Z");
    expect(ics).toContain("URL:https://spoonjoy.app/recipes/r1");
  });

  it("writes a note with its own title and text, and leaves notes or other meal types out when asked", () => {
    const note = feedEntry({ id: "n1", kind: "note", recipeId: null, recipeTitle: null, recipe: null, title: "Eat out", note: "Tacos\non Main", mealType: "lunch", scaleFactor: 1 });
    const withNotes = lines(renderCalendar({ ...base, entries: [note], options: parseFeedOptions(new URLSearchParams()) }));
    expect(withNotes).toContain("SUMMARY:Lunch: Eat out");
    expect(withNotes).toContain("DESCRIPTION:Tacos\\non Main\\n\\n");
    expect(withNotes.some((line) => line.startsWith("URL:"))).toBe(false);
    expect(lines(renderCalendar({ ...base, entries: [note], options: parseFeedOptions(new URLSearchParams("include_notes=false")) }))).not.toContain("BEGIN:VEVENT");
    expect(lines(renderCalendar({ ...base, entries: [note, feedEntry()], options: parseFeedOptions(new URLSearchParams("types=dinner")) })).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("folds a line longer than 75 octets without splitting a character", () => {
    const long = feedEntry({ recipeTitle: "Crème brûlée ".repeat(10).trim() });
    const raw = renderCalendar({ ...base, entries: [long], options: parseFeedOptions(new URLSearchParams()) });
    for (const line of raw.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines(raw)).toContain(`SUMMARY:Dinner: ${"Crème brûlée ".repeat(10).trim()}`);
  });

  it("shows a recipe planned without its title, or with servings that aren't a number, as it is", () => {
    const ics = lines(renderCalendar({
      ...base,
      entries: [feedEntry({ recipeTitle: null, recipe: { servings: "a crowd", description: null } })],
      options: parseFeedOptions(new URLSearchParams("summary=${title}&description=${servings}|${description}")),
    }));
    expect(ics).toContain("SUMMARY:Planned recipe");
    expect(ics).toContain("DESCRIPTION:a crowd|");
  });
});
