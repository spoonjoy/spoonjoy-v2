import { describe, expect, it } from "vitest";
import {
  MEAL_TYPES,
  addDays,
  parseLocalDate,
  parseMealType,
  planWeek,
  startOfWeek,
  validateEntryInput,
  weekDates,
  weekdayOf,
  type PlanEntry,
} from "~/domains/planning";
import { FLAG_NAMES, isFlagOn } from "~/domains/platform";

function entry(overrides: Partial<PlanEntry>): PlanEntry {
  return {
    id: "e1",
    date: "2026-11-23",
    mealType: "dinner",
    position: 0,
    kind: "note",
    recipeId: null,
    recipeTitle: null,
    title: "Leftovers",
    note: "",
    scaleFactor: 1,
    ...overrides,
  };
}

describe("planning local dates", () => {
  it("reads a real calendar day and refuses anything else", () => {
    expect(parseLocalDate("2026-11-23")).toBe("2026-11-23");
    expect(parseLocalDate("2028-02-29")).toBe("2028-02-29");
    for (const bad of ["2026-02-29", "2026-13-01", "2026-11-31", "2026-1-01", "20261123", "", "2026-11-23T00:00:00Z", null, undefined, 7]) {
      expect(parseLocalDate(bad)).toBeNull();
    }
  });

  it("adds days across months and years, and backwards", () => {
    expect(addDays("2026-11-29", 3)).toBe("2026-12-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the weekday, Sunday as 0", () => {
    expect(weekdayOf("2026-11-22")).toBe(0);
    expect(weekdayOf("2026-11-23")).toBe(1);
    expect(weekdayOf("2026-11-28")).toBe(6);
  });

  it("starts the week on the plan's first day of week", () => {
    expect(startOfWeek("2026-11-25", 1)).toBe("2026-11-23");
    expect(startOfWeek("2026-11-23", 1)).toBe("2026-11-23");
    expect(startOfWeek("2026-11-22", 1)).toBe("2026-11-16");
    expect(startOfWeek("2026-11-25", 0)).toBe("2026-11-22");
    expect(startOfWeek("2026-11-25", 6)).toBe("2026-11-21");
  });

  it("lists the seven days of a week from its start", () => {
    expect(weekDates("2026-11-23")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
  });
});

describe("planning meal types", () => {
  it("offers breakfast to dessert in the order a day is eaten", () => {
    expect(MEAL_TYPES.map((type) => type.id)).toEqual(["breakfast", "lunch", "dinner", "side", "snack", "drink", "dessert"]);
    expect(MEAL_TYPES.find((type) => type.id === "side")?.label).toBe("Side");
  });

  it("reads a meal type case-insensitively and refuses unknown ones", () => {
    expect(parseMealType(" Dinner ")).toBe("dinner");
    expect(parseMealType("brunch")).toBeNull();
    expect(parseMealType(undefined)).toBeNull();
  });
});

describe("planning entry input", () => {
  it("accepts a recipe entry with servings scale and defaults the rest", () => {
    expect(validateEntryInput({ kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: "r1", scaleFactor: 2 })).toEqual({
      ok: true,
      value: { kind: "recipe", date: "2026-11-23", mealType: "dinner", recipeId: "r1", title: "", note: "", scaleFactor: 2 },
    });
  });

  it("accepts a note entry and trims its text", () => {
    expect(validateEntryInput({ kind: "note", date: "2026-11-24", mealType: "lunch", title: "  Eat out  ", note: " Tacos? " })).toEqual({
      ok: true,
      value: { kind: "note", date: "2026-11-24", mealType: "lunch", recipeId: null, title: "Eat out", note: "Tacos?", scaleFactor: 1 },
    });
  });

  it("refuses an entry it cannot plan, saying why", () => {
    const base = { kind: "note", date: "2026-11-24", mealType: "lunch", title: "Out" };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, kind: "meal" }, "Choose a recipe or a note."],
      [{ ...base, date: "2026-02-30" }, "Choose a day for this meal."],
      [{ ...base, mealType: "brunch" }, "Choose a meal type."],
      [{ ...base, title: "   " }, "Give the note a title."],
      [{ ...base, title: "x".repeat(201) }, "Keep the title under 200 characters."],
      [{ ...base, note: "x".repeat(2001) }, "Keep the note under 2000 characters."],
      [{ ...base, kind: "recipe", title: undefined }, "Choose a recipe."],
      [{ ...base, kind: "recipe", recipeId: "  " }, "Choose a recipe."],
      [{ ...base, scaleFactor: 0 }, "Servings must be more than none and at most 50 times the recipe."],
      [{ ...base, scaleFactor: 51 }, "Servings must be more than none and at most 50 times the recipe."],
      [{ ...base, scaleFactor: Number.NaN }, "Servings must be more than none and at most 50 times the recipe."],
      [{ ...base, scaleFactor: "2" }, "Servings must be more than none and at most 50 times the recipe."],
    ];
    for (const [input, error] of cases) {
      expect(validateEntryInput(input)).toEqual({ ok: false, error });
    }
  });
});

describe("planning week", () => {
  it("puts each entry on its day, in meal order then position, and leaves out other weeks", () => {
    const entries = [
      entry({ id: "dinner-2", date: "2026-11-23", mealType: "dinner", position: 1 }),
      entry({ id: "breakfast", date: "2026-11-23", mealType: "breakfast" }),
      entry({ id: "dinner-1", date: "2026-11-23", mealType: "dinner", position: 0 }),
      entry({ id: "dinner-1b", date: "2026-11-23", mealType: "dinner", position: 0 }),
      entry({ id: "sunday", date: "2026-11-29", mealType: "snack" }),
      entry({ id: "next-week", date: "2026-11-30" }),
      entry({ id: "last-week", date: "2026-11-22" }),
    ];
    const week = planWeek(entries, "2026-11-23");
    expect(week.map((day) => day.date)).toEqual(weekDates("2026-11-23"));
    expect(week[0].entries.map((planned) => planned.id)).toEqual(["breakfast", "dinner-1", "dinner-1b", "dinner-2"]);
    expect(week[6].entries.map((planned) => planned.id)).toEqual(["sunday"]);
    expect(week.slice(1, 6).every((day) => day.entries.length === 0)).toBe(true);
  });
});

describe("planning flag", () => {
  it("hides the meal planner behind meal-planner, off in production and on in QA", () => {
    expect(FLAG_NAMES).toContain("meal-planner");
    expect(isFlagOn("meal-planner", {}, "user-1")).toBe(false);
    expect(isFlagOn("meal-planner", { SPOONJOY_FLAGS: "all" }, "user-1")).toBe(true);
  });
});
