import { parseLocalDate, weekDates, type LocalDate } from "./local-date";
import { mealTypeOrder, parseMealType, type MealType } from "./meal-type";

export type PlanEntryKind = "recipe" | "note";

/** One planned meal: a recipe at a scale, or a note ("Eat out"), on a day and a meal type. */
export type PlanEntry = {
  id: string;
  date: LocalDate;
  mealType: MealType;
  /** Order inside its day and meal type. */
  position: number;
  kind: PlanEntryKind;
  recipeId: string | null;
  /** The recipe's title when it was planned, so a deleted recipe still reads. */
  recipeTitle: string | null;
  title: string;
  note: string;
  /** Servings multiplier for this entry only: servings = the recipe's servings x scaleFactor. */
  scaleFactor: number;
  /** The scale already put on a shopping list: 0 until the meal is on one. It never goes down. */
  listedScale: number;
};

export type PlanEntryInput = Pick<PlanEntry, "kind" | "date" | "mealType" | "recipeId" | "title" | "note" | "scaleFactor">;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_SCALE_FACTOR = 50;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Whether a value is a servings scale a planned meal can have: more than none and at most MAX_SCALE_FACTOR. */
export function isScaleFactor(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value <= MAX_SCALE_FACTOR;
}

/** A new entry from untrusted input (a form, the API or an agent), or the reason it can't be planned. */
export function validateEntryInput(input: Record<string, unknown>): Validated<PlanEntryInput> {
  const kind = input.kind;
  if (kind !== "recipe" && kind !== "note") return { ok: false, error: "Choose a recipe or a note." };
  const date = parseLocalDate(input.date);
  if (!date) return { ok: false, error: "Choose a day for this meal." };
  const mealType = parseMealType(input.mealType);
  if (!mealType) return { ok: false, error: "Choose a meal type." };
  const title = text(input.title);
  const note = text(input.note);
  const recipeId = kind === "recipe" ? text(input.recipeId) : "";
  if (kind === "recipe" && !recipeId) return { ok: false, error: "Choose a recipe." };
  if (kind === "note" && !title) return { ok: false, error: "Give the note a title." };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: "Keep the title under 200 characters." };
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: "Keep the note under 2000 characters." };
  const scaleFactor = input.scaleFactor ?? 1;
  if (!isScaleFactor(scaleFactor)) {
    return { ok: false, error: "Servings must be more than none and at most 50 times the recipe." };
  }
  return { ok: true, value: { kind, date, mealType, recipeId: recipeId || null, title, note, scaleFactor } };
}

export type PlanDay = { date: LocalDate; entries: PlanEntry[] };

function compareEntries(a: PlanEntry, b: PlanEntry): number {
  return mealTypeOrder(a.mealType) - mealTypeOrder(b.mealType) || a.position - b.position || a.id.localeCompare(b.id);
}

/** The seven days from `start`, each with its entries in meal order; entries on other days are left out. */
export function planWeek(entries: readonly PlanEntry[], start: LocalDate): PlanDay[] {
  return weekDates(start).map((date) => ({
    date,
    entries: entries.filter((planned) => planned.date === date).sort(compareEntries),
  }));
}

type ListedMeal = Pick<PlanEntry, "kind" | "recipeId" | "scaleFactor" | "listedScale">;

/**
 * How much of a planned meal's recipe still has to go on the shopping list: all of its scale until it is on one, then
 * only what the scale grew by. Nothing once the scale went down (the list keeps what it has), and nothing for a note.
 */
export function scaleToList(meal: ListedMeal): number {
  if (meal.kind !== "recipe" || !meal.recipeId) return 0;
  // Rounded to thousandths, so 0.3 less 0.1 is 0.2 and not 0.19999999999999998.
  const left = Math.round((meal.scaleFactor - meal.listedScale) * 1000) / 1000;
  return Math.max(left, 0);
}

/** Whether a planned recipe is on the shopping list at its whole scale. A note never is. */
export function isOnList(meal: ListedMeal): boolean {
  return meal.kind === "recipe" && meal.listedScale > 0 && scaleToList(meal) === 0;
}
