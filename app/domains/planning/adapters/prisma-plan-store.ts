// The PlanStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any bundle.
import type { PrismaClient } from "@prisma/client";
import { readableRecipeWhere } from "~/domains/kitchen";
import type { PlanStore } from "../application/plan";
import { ENTRY_SELECT, toEntry } from "./plan-entry-row";

type PlanDb = Pick<PrismaClient, "mealPlan" | "planEntry" | "recipe" | "recipeSpoon">;

export function prismaPlanStore(db: PlanDb): PlanStore {
  return {
    async planFor(scope) {
      if (!("cook" in scope)) throw new Error("Household plans aren't stored yet.");
      const select = { id: true, firstDayOfWeek: true, timeZone: true } as const;
      const plan = await db.mealPlan.upsert({ where: { ownerId: scope.cook }, create: { ownerId: scope.cook }, update: {}, select });
      return { ...plan, scope };
    },
    async entriesBetween(plan, from, to) {
      const rows = await db.planEntry.findMany({
        where: { mealPlanId: plan.id, deletedAt: null, date: { gte: from, lte: to } },
        select: ENTRY_SELECT,
      });
      return rows.map(toEntry);
    },
    async plannableRecipeTitle(cookId, recipeId) {
      const recipe = await db.recipe.findFirst({ where: { id: recipeId, deletedAt: null, ...readableRecipeWhere({ id: cookId }) }, select: { title: true } });
      return recipe?.title ?? null;
    },
    async ownAndSavedRecipes(cookId, limit) {
      return db.recipe.findMany({
        where: {
          deletedAt: null,
          ...readableRecipeWhere({ id: cookId }),
          AND: [{ OR: [{ chefId: cookId }, { cookbooks: { some: { cookbook: { authorId: cookId } } } }] }],
        },
        select: { id: true, title: true },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: limit,
      });
    },
    async findEntry(plan, entryId) {
      const row = await db.planEntry.findFirst({ where: { id: entryId, mealPlanId: plan.id }, select: ENTRY_SELECT });
      return row ? { entry: toEntry(row), removed: row.deletedAt !== null } : null;
    },
    async insertEntry(plan, addedById, entry) {
      const { id, date, mealType, position, kind, recipeId, recipeTitle, title, note, scaleFactor } = entry;
      await db.planEntry.create({
        data: { id, mealPlanId: plan.id, addedById, date, mealType, position, kind, recipeId, recipeTitle, title, note, scaleFactor },
      });
    },
    async removeEntry(plan, entryId) {
      const { count } = await db.planEntry.updateMany({ where: { id: entryId, mealPlanId: plan.id, deletedAt: null }, data: { deletedAt: new Date() } });
      return count > 0;
    },
    async placeEntries(plan, placements) {
      for (const { id, date, mealType, position } of placements) {
        await db.planEntry.updateMany({ where: { id, mealPlanId: plan.id }, data: { date, mealType, position } });
      }
    },

    async lastCooked(chefId, recipeIds) {
      const groups = await db.recipeSpoon.groupBy({
        by: ["recipeId"],
        where: { chefId, recipeId: { in: [...recipeIds] }, deletedAt: null },
        _max: { cookedAt: true },
      });
      // A group exists only for a recipe with a live cook, and cookedAt is never null, so _max always has one.
      return groups.map((group) => ({ recipeId: group.recipeId, cookedAt: group._max.cookedAt as Date }));
    },
  };
}
