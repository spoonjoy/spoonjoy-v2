// The PlanStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any bundle.
// A cook's plan lives in MealPlan and PlanEntry, a household's in HouseholdPlan and HouseholdPlanEntry (migration 0052
// says why). Each method picks the tables by the plan's scope, so nothing above this adapter knows there are two.
import type { PrismaClient } from "@prisma/client";
import { readableRecipeWhere } from "~/domains/kitchen";
import { actingCookOf, type PlanScope, type PlanSettings, type PlanStore } from "../application/plan";
import { ENTRY_SELECT, toEntry } from "./plan-entry-row";

type PlanDb = Pick<PrismaClient, "mealPlan" | "planEntry" | "householdPlan" | "householdPlanEntry" | "recipe" | "recipeSpoon">;

const PLAN_SELECT = { id: true, firstDayOfWeek: true, timeZone: true } as const;

function isHousehold(plan: PlanSettings): boolean {
  return "household" in plan.scope;
}

/** The acting cook as a recipe reader, and whose recipes the scope offers: theirs and, on a household's plan, its cooks'. */
function readerOf(scope: PlanScope) {
  const id = actingCookOf(scope);
  const householdChefIds = "household" in scope ? (scope.householdChefIds ?? new Set<string>()) : new Set<string>();
  return { viewer: { id, householdChefIds }, authors: [id, ...householdChefIds] };
}

export function prismaPlanStore(db: PlanDb): PlanStore {
  return {
    async planFor(scope) {
      const plan = "cook" in scope
        ? await db.mealPlan.upsert({ where: { ownerId: scope.cook }, create: { ownerId: scope.cook }, update: {}, select: PLAN_SELECT })
        : await db.householdPlan.upsert({ where: { householdId: scope.household }, create: { householdId: scope.household }, update: {}, select: PLAN_SELECT });
      return { ...plan, scope };
    },
    async entriesBetween(plan, from, to) {
      const live = { deletedAt: null, date: { gte: from, lte: to } };
      const rows = isHousehold(plan)
        ? await db.householdPlanEntry.findMany({ where: { householdPlanId: plan.id, ...live }, select: ENTRY_SELECT })
        : await db.planEntry.findMany({ where: { mealPlanId: plan.id, ...live }, select: ENTRY_SELECT });
      return rows.map(toEntry);
    },
    async plannableRecipeTitle(scope, recipeId) {
      const { viewer } = readerOf(scope);
      const recipe = await db.recipe.findFirst({ where: { id: recipeId, deletedAt: null, ...readableRecipeWhere(viewer) }, select: { title: true } });
      return recipe?.title ?? null;
    },
    async listPlannableRecipes(scope, limit) {
      const { viewer, authors } = readerOf(scope);
      return db.recipe.findMany({
        where: {
          deletedAt: null,
          ...readableRecipeWhere(viewer),
          AND: [{ OR: [{ chefId: { in: authors } }, { cookbooks: { some: { cookbook: { authorId: viewer.id } } } }] }],
        },
        select: { id: true, title: true },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: limit,
      });
    },
    async findEntry(plan, entryId) {
      const row = isHousehold(plan)
        ? await db.householdPlanEntry.findFirst({ where: { id: entryId, householdPlanId: plan.id }, select: ENTRY_SELECT })
        : await db.planEntry.findFirst({ where: { id: entryId, mealPlanId: plan.id }, select: ENTRY_SELECT });
      return row ? { entry: toEntry(row), removed: row.deletedAt !== null } : null;
    },
    async insertEntry(plan, addedById, entry) {
      const { id, date, mealType, position, kind, recipeId, recipeTitle, title, note, scaleFactor } = entry;
      const fields = { id, addedById, date, mealType, position, kind, recipeId, recipeTitle, title, note, scaleFactor };
      if (isHousehold(plan)) await db.householdPlanEntry.create({ data: { ...fields, householdPlanId: plan.id } });
      else await db.planEntry.create({ data: { ...fields, mealPlanId: plan.id } });
    },
    async removeEntry(plan, entryId) {
      const data = { deletedAt: new Date() };
      const { count } = isHousehold(plan)
        ? await db.householdPlanEntry.updateMany({ where: { id: entryId, householdPlanId: plan.id, deletedAt: null }, data })
        : await db.planEntry.updateMany({ where: { id: entryId, mealPlanId: plan.id, deletedAt: null }, data });
      return count > 0;
    },
    async placeEntries(plan, placements) {
      for (const { id, date, mealType, position } of placements) {
        const data = { date, mealType, position };
        if (isHousehold(plan)) await db.householdPlanEntry.updateMany({ where: { id, householdPlanId: plan.id }, data });
        else await db.planEntry.updateMany({ where: { id, mealPlanId: plan.id }, data });
      }
    },
    async markListed(plan, listed) {
      for (const { id, listedScale } of listed) {
        const data = { listedScale };
        if (isHousehold(plan)) await db.householdPlanEntry.updateMany({ where: { id, householdPlanId: plan.id }, data });
        else await db.planEntry.updateMany({ where: { id, mealPlanId: plan.id }, data });
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
