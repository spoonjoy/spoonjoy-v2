// A PlanEntry or HouseholdPlanEntry row as the Prisma adapters read it; both tables have these columns. Not exported from the context's index: only adapters use it.
import type { PlanEntry } from "../model/plan-entry";
import type { MealType } from "../model/meal-type";

export type EntryRow = {
  id: string;
  date: string;
  mealType: string;
  position: number;
  kind: string;
  recipeId: string | null;
  recipeTitle: string | null;
  title: string;
  note: string;
  scaleFactor: number;
  deletedAt: Date | null;
};

export const ENTRY_SELECT = {
  id: true, date: true, mealType: true, position: true, kind: true, recipeId: true,
  recipeTitle: true, title: true, note: true, scaleFactor: true, deletedAt: true,
} as const;

export function toEntry(row: EntryRow): PlanEntry {
  return {
    id: row.id,
    date: row.date,
    // Rows are written through validateEntryInput, so the stored meal type is one of MEAL_TYPES.
    mealType: row.mealType as MealType,
    position: row.position,
    kind: row.kind === "recipe" ? "recipe" : "note",
    recipeId: row.recipeId,
    recipeTitle: row.recipeTitle,
    title: row.title,
    note: row.note,
    scaleFactor: row.scaleFactor,
  };
}
