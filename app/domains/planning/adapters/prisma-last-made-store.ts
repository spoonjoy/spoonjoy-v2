// The LastMadeStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any bundle.
import type { PrismaClient } from "@prisma/client";
import type { LastMadeStore } from "../application/last-made";

type LastMadeDb = Pick<PrismaClient, "planEntry" | "recipeSpoon">;

export function prismaLastMadeStore(db: LastMadeDb): LastMadeStore {
  return {
    async setEntryCooked(ownerId, entryId, at) {
      const { count } = await db.planEntry.updateMany({
        where: { id: entryId, deletedAt: null, mealPlan: { ownerId } },
        data: { cookedAt: at },
      });
      return count > 0;
    },
    async loggedCooks(ownerId, recipeIds) {
      const rows = await db.recipeSpoon.findMany({
        where: { chefId: ownerId, deletedAt: null, recipeId: { in: [...recipeIds] } },
        select: { recipeId: true, cookedAt: true },
      });
      return rows.map((row) => ({ recipeId: row.recipeId, at: row.cookedAt }));
    },
    async cookedEntries(ownerId, recipeIds) {
      const rows = await db.planEntry.findMany({
        where: { deletedAt: null, cookedAt: { not: null }, recipeId: { in: [...recipeIds] }, mealPlan: { ownerId } },
        select: { recipeId: true, cookedAt: true },
      });
      // The where clause leaves out rows without a recipe or a cooked time.
      return rows.map((row) => ({ recipeId: row.recipeId as string, at: row.cookedAt as Date }));
    },
  };
}
