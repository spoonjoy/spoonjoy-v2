// The FeedLinkStore on Prisma: D1 in the Worker, SQLite in tests. Type-only Prisma import, so this file is safe in any bundle.
import type { PrismaClient } from "@prisma/client";
import type { FeedLinkStore } from "../application/feed-link";
import { ENTRY_SELECT, toEntry } from "./plan-entry-row";

type FeedDb = Pick<PrismaClient, "calendarFeed" | "planEntry">;

export function prismaFeedLinkStore(db: FeedDb): FeedLinkStore {
  return {
    async setLink(planId, tokenHash, now) {
      await db.calendarFeed.upsert({
        where: { mealPlanId: planId },
        create: { mealPlanId: planId, tokenHash, createdAt: now },
        update: { tokenHash, createdAt: now },
      });
    },
    async deleteLink(planId) {
      const { count } = await db.calendarFeed.deleteMany({ where: { mealPlanId: planId } });
      return count > 0;
    },
    async linkMadeAt(planId) {
      const row = await db.calendarFeed.findUnique({ where: { mealPlanId: planId }, select: { createdAt: true } });
      return row?.createdAt ?? null;
    },
    async planForLink(tokenHash) {
      const row = await db.calendarFeed.findUnique({ where: { tokenHash }, select: { mealPlanId: true, mealPlan: { select: { ownerId: true } } } });
      return row ? { planId: row.mealPlanId, ownerId: row.mealPlan.ownerId } : null;
    },
    async feedEntries(planId, from, to) {
      const rows = await db.planEntry.findMany({
        where: { mealPlanId: planId, deletedAt: null, date: { gte: from, lte: to } },
        select: { ...ENTRY_SELECT, recipe: { select: { servings: true, description: true } } },
        orderBy: [{ date: "asc" }, { position: "asc" }],
      });
      return rows.map((row) => ({ ...toEntry(row), recipe: row.recipe }));
    },
  };
}
