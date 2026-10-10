import type { PrismaClient, RecipeCover } from "@prisma/client";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { mapModel, RECIPE_COVER_COLUMNS, selectColumns } from "~/lib/d1-models.server";
import {
  touchNativeSyncCookbooksForRecipeOperation,
  touchNativeSyncRecipeOperation,
} from "~/lib/native-sync-invalidation.server";

/**
 * A cover generation runs in the background after its request answers, and the Worker can
 * die before the job writes an outcome (the 30 seconds `waitUntil` allows, an eviction, a
 * deploy). The cover then says "processing" forever and its spinner never stops. Nothing
 * runs on a schedule here, so the reads that show covers settle them instead: a cover still
 * processing this long after its generation started is failed, as its job would have done.
 * The job's own time budget is far shorter, so a live job is never failed under it.
 */
export const STUCK_COVER_GENERATION_AFTER_MS = 10 * 60_000;

export const STUCK_COVER_FAILURE_REASON = "Generation stopped before it finished.";

type StuckCheckCover = Pick<
  RecipeCover,
  "id" | "imageUrl" | "status" | "generationStatus" | "generationStartedAt" | "createdAt" | "archivedAt"
>;

export function isStuckCoverGeneration(cover: StuckCheckCover, now: Date): boolean {
  if (cover.status === "archived" || cover.archivedAt) return false;
  if (cover.status !== "processing" && cover.generationStatus !== "processing") return false;
  // A cover created processing never set the column: its creation is the start.
  const startedAt = cover.generationStartedAt ?? cover.createdAt;
  return now.getTime() - startedAt.getTime() >= STUCK_COVER_GENERATION_AFTER_MS;
}

/** Where the stuck covers are failed and read back: Prisma, or the request's D1 binding. */
export interface StuckCoverStore {
  /**
   * Fails the given covers that are still stuck at `cutoff`, re-checking every condition so a
   * job that finished in between keeps its own outcome, and touches the recipe and its
   * cookbooks for native sync, all as one batch.
   */
  failStuck(recipeId: string, coverIds: string[], cutoff: Date, now: Date): Promise<void>;
  read(recipeId: string, coverIds: string[]): Promise<RecipeCover[]>;
}

/** A failed generation leaves a cover that has an image usable, as markStylizationFailed does. */
const FAILED_GENERATION = { generationStatus: "failed", failureReason: STUCK_COVER_FAILURE_REASON } as const;

export function prismaStuckCoverStore(db: PrismaClient): StuckCoverStore {
  return {
    async failStuck(recipeId, coverIds, cutoff, now) {
      const stillStuck = (image: { imageUrl: string } | { NOT: { imageUrl: string } }) => ({
        id: { in: coverIds },
        recipeId,
        archivedAt: null,
        status: { not: "archived" },
        ...image,
        AND: [
          { OR: [{ status: "processing" }, { generationStatus: "processing" }] },
          { OR: [{ generationStartedAt: { lte: cutoff } }, { generationStartedAt: null, createdAt: { lte: cutoff } }] },
        ],
      });
      await db.$transaction([
        db.recipeCover.updateMany({ where: stillStuck({ imageUrl: "" }), data: { status: "failed", ...FAILED_GENERATION } }),
        db.recipeCover.updateMany({ where: stillStuck({ NOT: { imageUrl: "" } }), data: { status: "ready", ...FAILED_GENERATION } }),
        touchNativeSyncRecipeOperation(db, recipeId, now),
        touchNativeSyncCookbooksForRecipeOperation(db, recipeId, now),
      ]);
    },
    async read(recipeId, coverIds) {
      return db.recipeCover.findMany({ where: { id: { in: coverIds }, recipeId } });
    },
  };
}

// DateTime columns hold ISO text when written through D1 and integer milliseconds when
// written by Prisma's native SQLite driver; compare them as epoch milliseconds either way.
const STARTED = `COALESCE("generationStartedAt", "createdAt")`;
const D1_GENERATION_STARTED_MS = `(CASE WHEN typeof(${STARTED}) IN ('integer', 'real') THEN ${STARTED}
  ELSE CAST(strftime('%s', ${STARTED}) AS INTEGER) * 1000 END)`;

export function d1StuckCoverStore(d1: D1ReadDatabase): StuckCoverStore {
  return {
    async failStuck(recipeId, coverIds, cutoff, now) {
      const touchedAt = d1Timestamp(now);
      await d1WriteBatch(d1, [
        [
          `UPDATE "RecipeCover"
           SET "status" = CASE WHEN "imageUrl" = '' THEN 'failed' ELSE 'ready' END,
               "generationStatus" = ?, "failureReason" = ?
           WHERE "id" IN (${coverIds.map(() => "?").join(", ")}) AND "recipeId" = ?
             AND "archivedAt" IS NULL AND "status" <> 'archived'
             AND ("status" = 'processing' OR "generationStatus" = 'processing')
             AND ${D1_GENERATION_STARTED_MS} <= ?`,
          FAILED_GENERATION.generationStatus,
          FAILED_GENERATION.failureReason,
          ...coverIds,
          recipeId,
          cutoff.getTime(),
        ],
        [`UPDATE "Recipe" SET "updatedAt" = ? WHERE "id" = ?`, touchedAt, recipeId],
        [
          `UPDATE "Cookbook" SET "updatedAt" = ?
           WHERE "id" IN (SELECT "cookbookId" FROM "RecipeInCookbook" WHERE "recipeId" = ?)`,
          touchedAt,
          recipeId,
        ],
      ]);
    },
    async read(recipeId, coverIds) {
      const [rows] = await d1ReadBatch(d1, [[
        `SELECT ${selectColumns(RECIPE_COVER_COLUMNS, "c")} FROM "RecipeCover" c
         WHERE c."id" IN (${coverIds.map(() => "?").join(", ")}) AND c."recipeId" = ?`,
        ...coverIds,
        recipeId,
      ]]);
      return rows.map((row) => mapModel(RECIPE_COVER_COLUMNS, row));
    },
  };
}

/**
 * Fails the recipe's stuck generations among `covers`, then returns the covers as they now
 * read. A read that finds none stuck does nothing at all. A null stands for a missing cover
 * (a recipe with no active cover) and passes through.
 */
export async function settleStuckCoverGenerations<T extends StuckCheckCover | null>(
  store: StuckCoverStore,
  recipeId: string,
  covers: T[],
  now = new Date(),
): Promise<T[]> {
  const stuck = covers.filter((cover): cover is NonNullable<T> => cover !== null && isStuckCoverGeneration(cover, now));
  if (stuck.length === 0) return covers;

  const ids = [...new Set(stuck.map((cover) => cover.id))];
  await store.failStuck(recipeId, ids, new Date(now.getTime() - STUCK_COVER_GENERATION_AFTER_MS), now);
  const settled = new Map((await store.read(recipeId, ids)).map((cover) => [cover.id, cover]));
  return covers.map((cover) => cover && { ...cover, ...settled.get(cover.id) }) as T[];
}
