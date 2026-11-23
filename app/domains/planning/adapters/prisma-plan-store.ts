// The PlanStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any bundle.
import type { PrismaClient } from "@prisma/client";
import type { PlanStore } from "../application/plan";
import type { PlanEntry } from "../model/plan-entry";
import type { MealType } from "../model/meal-type";

type PlanDb = Pick<PrismaClient, "mealPlan" | "planEntry" | "recipe">;

type EntryRow = {
  id: string;
  mealPlanId: string;
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

const ENTRY_SELECT = {
  id: true, mealPlanId: true, date: true, mealType: true, position: true, kind: true, recipeId: true,
  recipeTitle: true, title: true, note: true, scaleFactor: true, deletedAt: true,
} as const;

function toEntry(row: EntryRow): PlanEntry {
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

export function prismaPlanStore(db: PlanDb): PlanStore {
  return {
    async planFor(ownerId) {
      const select = { id: true, firstDayOfWeek: true, timeZone: true } as const;
      return db.mealPlan.upsert({ where: { ownerId }, create: { ownerId }, update: {}, select });
    },
    async entriesBetween(planId, from, to) {
      const rows = await db.planEntry.findMany({
        where: { mealPlanId: planId, deletedAt: null, date: { gte: from, lte: to } },
        select: ENTRY_SELECT,
      });
      return rows.map(toEntry);
    },
    async plannableRecipeTitle(_ownerId, recipeId) {
      const recipe = await db.recipe.findFirst({ where: { id: recipeId, deletedAt: null }, select: { title: true } });
      return recipe?.title ?? null;
    },
    async findEntry(entryId) {
      const row = await db.planEntry.findUnique({ where: { id: entryId }, select: ENTRY_SELECT });
      return row ? { entry: toEntry(row), planId: row.mealPlanId, removed: row.deletedAt !== null } : null;
    },
    async insertEntry(planId, addedById, entry) {
      const { id, date, mealType, position, kind, recipeId, recipeTitle, title, note, scaleFactor } = entry;
      await db.planEntry.create({
        data: { id, mealPlanId: planId, addedById, date, mealType, position, kind, recipeId, recipeTitle, title, note, scaleFactor },
      });
    },
    async removeEntry(planId, entryId) {
      const { count } = await db.planEntry.updateMany({ where: { id: entryId, mealPlanId: planId, deletedAt: null }, data: { deletedAt: new Date() } });
      return count > 0;
    },
    async placeEntries(planId, placements) {
      for (const { id, date, mealType, position } of placements) {
        await db.planEntry.updateMany({ where: { id, mealPlanId: planId }, data: { date, mealType, position } });
      }
    },
  };
}
