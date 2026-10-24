import type { PrismaClient, RecipeCover } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1WriteBatch } from "~/lib/d1-write.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";

// Cooking now: the recipes a cook has in progress, so a cook following several recipes can get
// back to each one after the site or app closes. The CookSession Durable Object is the server of
// record for progress; the "CookingNow" table is a list derived from it, one row per (user,
// recipe), written by the Worker after every cook-session start or progress write.
//
// A recipe is on the list while it has progress: something checked, or a current step past the
// first. It leaves the list when:
//
// - the cook clears progress (a write that takes the checked count from some to none), until the
//   cook checks something again or moves to another step;
// - the cook logs a cook of it (a cook logged after the row's last touch hides it; a later
//   cook-session write lists it again);
// - everything has been checked for COOKING_NOW_DONE_MS;
// - it has not been touched for COOKING_NOW_IDLE_MS;
// - the recipe is deleted.

/** A recipe untouched this long leaves the list. */
export const COOKING_NOW_IDLE_MS = 3 * 24 * 60 * 60 * 1000;
/** A recipe with everything checked leaves the list this long after the last item was checked. */
export const COOKING_NOW_DONE_MS = 30 * 60 * 1000;
/** The most rows the list returns. */
export const COOKING_NOW_LIMIT = 50;

/** One cook-session state, as the Durable Object answered a start or a progress write. */
export interface CookingNowWrite {
  userId: string;
  recipeId: string;
  attemptId: string;
  revision: number;
  activeStepId: string | null;
  activeStepIndex: number;
  /** Checked ingredients plus checked step outputs. */
  checkedCount: number;
  /** When the write happened, in epoch milliseconds. */
  touchedAt: number;
}

// Counts come from the recipe as it is now. The checked count never exceeds the total, so a
// check the recipe no longer has cannot make a recipe look finished.
//
// On a conflict (the row exists) the update only applies when it is not older than the row: a
// different attempt, or the same attempt at the same or a later revision. Two writes answered in
// one order can reach D1 in the other; the older one then changes nothing. The same revision
// applies again so a retry, or a start that resumed the session, still touches the row.
//
// `listed`: checking something lists the recipe; going from some checked to none (Clear progress)
// unlists it; moving to another step lists it again; anything else leaves it as it was. A new row
// is listed when it has any progress.
const UPSERT_SQL = `INSERT INTO "CookingNow" (
    "userId", "recipeId", "attemptId", "revision", "listed", "activeStepId", "activeStepIndex",
    "stepCount", "checkedCount", "totalCount", "allCheckedAt", "touchedAt"
  )
  SELECT ?, ?, ?, ?,
    CASE WHEN counts."checked" > 0 OR ? > 0 THEN 1 ELSE 0 END,
    ?, ?, counts."steps", counts."checked", counts."total",
    CASE WHEN counts."total" > 0 AND counts."checked" >= counts."total" THEN ? END,
    ?
  FROM (
    SELECT steps."n" AS "steps", ingredients."n" + outputs."n" AS "total",
      MIN(?, ingredients."n" + outputs."n") AS "checked"
    FROM (SELECT COUNT(*) AS "n" FROM "RecipeStep" WHERE "recipeId" = ?) AS steps,
      (SELECT COUNT(*) AS "n" FROM "Ingredient" WHERE "recipeId" = ?) AS ingredients,
      (SELECT COUNT(*) AS "n" FROM "StepOutputUse" WHERE "recipeId" = ?) AS outputs
  ) AS counts
  WHERE true
  ON CONFLICT ("userId", "recipeId") DO UPDATE SET
    "listed" = CASE
      WHEN excluded."checkedCount" > 0 THEN 1
      WHEN "CookingNow"."checkedCount" > 0 THEN 0
      WHEN excluded."activeStepIndex" <> "CookingNow"."activeStepIndex"
        OR excluded."activeStepId" IS NOT "CookingNow"."activeStepId" THEN 1
      ELSE "CookingNow"."listed"
    END,
    "attemptId" = excluded."attemptId",
    "revision" = excluded."revision",
    "activeStepId" = excluded."activeStepId",
    "activeStepIndex" = excluded."activeStepIndex",
    "stepCount" = excluded."stepCount",
    "checkedCount" = excluded."checkedCount",
    "totalCount" = excluded."totalCount",
    "allCheckedAt" = CASE
      WHEN excluded."allCheckedAt" IS NULL THEN NULL
      ELSE COALESCE("CookingNow"."allCheckedAt", excluded."allCheckedAt")
    END,
    "touchedAt" = MAX(excluded."touchedAt", "CookingNow"."touchedAt")
  WHERE excluded."attemptId" <> "CookingNow"."attemptId"
    OR excluded."revision" >= "CookingNow"."revision"`;

// Rows no reader would return any more; keeps each cook's list small.
const PRUNE_SQL = `DELETE FROM "CookingNow"
  WHERE "userId" = ? AND ("touchedAt" <= ? OR "allCheckedAt" <= ?)`;

/**
 * Records one cook-session state in the cook's Cooking now list. Retry-safe: the upsert is keyed
 * by (user, recipe) and sets values taken from the state, so running it again leaves the same row
 * (see docs/d1-write-retry.md). Throws `D1WriteUnavailableError` when every try fails.
 */
export async function recordCookingNow(d1: D1ReadDatabase, write: CookingNowWrite): Promise<void> {
  const { userId, recipeId, touchedAt } = write;
  await retryD1Write({ scope: "cooking_now.record" }, () => d1WriteBatch(d1, [
    [PRUNE_SQL, userId, touchedAt - COOKING_NOW_IDLE_MS, touchedAt - COOKING_NOW_DONE_MS],
    [
      UPSERT_SQL,
      userId,
      recipeId,
      write.attemptId,
      write.revision,
      write.activeStepIndex,
      write.activeStepId,
      write.activeStepIndex,
      touchedAt,
      touchedAt,
      write.checkedCount,
      recipeId,
      recipeId,
      recipeId,
    ],
  ]));
}

export interface CookingNowRecipe {
  id: string;
  title: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  activeCover: RecipeCover | null;
}

export interface CookingNowRow {
  recipe: CookingNowRecipe;
  activeStepId: string | null;
  activeStepIndex: number;
  stepCount: number;
  checkedCount: number;
  totalCount: number;
  /** When everything became checked, or null. */
  allCheckedAt: Date | null;
  touchedAt: Date;
  /** When the recipe leaves the list unless it is touched again. */
  expiresAt: Date;
}

type CookingNowDb = Pick<PrismaClient, "cookingNow" | "recipeSpoon">;

/** The cook's Cooking now list, most recently touched first. */
export async function listCookingNow(db: CookingNowDb, userId: string, now: number = Date.now()): Promise<CookingNowRow[]> {
  const rows = await db.cookingNow.findMany({
    where: {
      userId,
      listed: true,
      touchedAt: { gt: BigInt(now - COOKING_NOW_IDLE_MS) },
      OR: [{ allCheckedAt: null }, { allCheckedAt: { gt: BigInt(now - COOKING_NOW_DONE_MS) } }],
      recipe: { deletedAt: null },
    },
    orderBy: [{ touchedAt: "desc" }, { recipeId: "asc" }],
    take: COOKING_NOW_LIMIT,
    select: {
      recipeId: true,
      activeStepId: true,
      activeStepIndex: true,
      stepCount: true,
      checkedCount: true,
      totalCount: true,
      allCheckedAt: true,
      touchedAt: true,
      recipe: {
        select: { id: true, title: true, activeCoverId: true, activeCoverVariant: true, coverMode: true, activeCover: true },
      },
    },
  });
  if (rows.length === 0) return [];

  // A cook logged at or after a row's last touch means that cook is finished.
  const oldestTouch = rows.reduce((oldest, row) => (row.touchedAt < oldest ? row.touchedAt : oldest), rows[0].touchedAt);
  const cooks = await db.recipeSpoon.findMany({
    where: {
      chefId: userId,
      recipeId: { in: rows.map((row) => row.recipeId) },
      deletedAt: null,
      createdAt: { gte: new Date(Number(oldestTouch)) },
    },
    select: { recipeId: true, createdAt: true },
  });
  const lastCook = new Map<string, number>();
  for (const cook of cooks) {
    lastCook.set(cook.recipeId, Math.max(lastCook.get(cook.recipeId) ?? 0, cook.createdAt.getTime()));
  }

  return rows
    .filter((row) => (lastCook.get(row.recipeId) ?? -Infinity) < Number(row.touchedAt))
    .map((row) => {
      const touchedAt = Number(row.touchedAt);
      const allCheckedAt = row.allCheckedAt === null ? null : Number(row.allCheckedAt);
      const expiresAt = Math.min(
        touchedAt + COOKING_NOW_IDLE_MS,
        allCheckedAt === null ? Infinity : allCheckedAt + COOKING_NOW_DONE_MS,
      );
      return {
        recipe: row.recipe,
        activeStepId: row.activeStepId,
        activeStepIndex: row.activeStepIndex,
        stepCount: row.stepCount,
        checkedCount: row.checkedCount,
        totalCount: row.totalCount,
        allCheckedAt: allCheckedAt === null ? null : new Date(allCheckedAt),
        touchedAt: new Date(touchedAt),
        expiresAt: new Date(expiresAt),
      };
    });
}
