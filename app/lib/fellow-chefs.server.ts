import type { PrismaClient } from "@prisma/client";
import { toDate, toNumber } from "~/lib/d1-coerce.server";

/**
 * Derived chef-graph helpers.
 *
 * `listFellowChefs(db, viewerUserId)` returns chefs the viewer has engaged
 * with via spoon, fork (Recipe.sourceRecipeId), or cookbook-save
 * (RecipeInCookbook). `listKitchenVisitors(db, profileUserId)` is the
 * reciprocal — chefs who have engaged with the profile owner's recipes the
 * same three ways. Both:
 *
 * - Exclude the focal user from their own list.
 * - Exclude soft-deleted spoons and soft-deleted recipes on both sides of
 *   every join.
 * - Sort by `latestInteractionAt DESC`, then `chefId DESC` for a stable
 *   pagination tiebreaker.
 * - Page via `{ limit, offset }`. Default limit 50, max 100.
 *
 * Implementation: single `$queryRawUnsafe` per call using a UNION ALL CTE
 * of three subqueries (spoons, forks, saves), grouped + aggregated. D1
 * SQLite supports every construct used here (UNION ALL, GROUP BY, SUM(CASE
 * WHEN), MAX, LIMIT/OFFSET, parameterized `?`). SUM/COUNT may return as
 * BigInt depending on the adapter — coerce to Number at the JS boundary.
 *
 * Profile fellow-chefs is a cold path (visited occasionally from a chef's
 * profile sub-page), so the single-query implementation is sufficient. If
 * production measurement ever shows this is hot, open a fresh `SJ-*` for a
 * materialized view rather than premature optimization.
 */

export interface FellowChefInteractionCounts {
  spoons: number;
  forks: number;
  cookbookSaves: number;
}

export interface FellowChefRow {
  chefId: string;
  username: string;
  photoUrl: string | null;
  interactionCounts: FellowChefInteractionCounts;
  latestInteractionAt: Date;
}

export interface ListFellowChefsOptions {
  limit?: number;
  offset?: number;
}

export interface FellowChefListResult {
  rows: FellowChefRow[];
  total: number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

function normalizeLimit(input: number | undefined): number {
  if (input === undefined) return DEFAULT_LIMIT;
  return Math.min(input, MAX_LIMIT);
}

function normalizeOffset(input: number | undefined): number {
  return input ?? 0;
}

type Side = "viewer" | "chef";

function interactionsCte(side: Side): string {
  // For `viewer` side (Fellow Chefs): focal user is the actor —
  // s.chefId = ?, fk.chefId = ?, ric.addedById = ?
  // For `chef` side (Kitchen Visitors): focal user owns the recipes —
  // r.chefId = ?, src.chefId = ?, r.chefId = ?
  const isViewer = side === "viewer";
  const spoonActor = isViewer ? "s.chefId" : "r.chefId";
  const spoonOther = isViewer ? "r.chefId" : "s.chefId";
  const forkActor = isViewer ? "fk.chefId" : "src.chefId";
  const forkOther = isViewer ? "src.chefId" : "fk.chefId";
  const saveActor = isViewer ? "ric.addedById" : "r.chefId";
  const saveOther = isViewer ? "r.chefId" : "ric.addedById";

  return `
    SELECT ${spoonOther} AS otherChefId, s.cookedAt AS interactionAt, 'spoon' AS kind
    FROM RecipeSpoon s
    JOIN Recipe r ON r.id = s.recipeId
    WHERE ${spoonActor} = ?
      AND s.deletedAt IS NULL
      AND r.deletedAt IS NULL
      AND ${spoonOther} <> ?
    UNION ALL
    SELECT ${forkOther} AS otherChefId, fk.createdAt AS interactionAt, 'fork' AS kind
    FROM Recipe fk
    JOIN Recipe src ON src.id = fk.sourceRecipeId
    WHERE ${forkActor} = ?
      AND fk.deletedAt IS NULL
      AND src.deletedAt IS NULL
      AND ${forkOther} <> ?
    UNION ALL
    SELECT ${saveOther} AS otherChefId, ric.createdAt AS interactionAt, 'save' AS kind
    FROM RecipeInCookbook ric
    JOIN Recipe r ON r.id = ric.recipeId
    WHERE ${saveActor} = ?
      AND r.deletedAt IS NULL
      AND ${saveOther} <> ?
  `;
}

interface RawAggregateRow {
  otherChefId: string;
  username: string;
  photoUrl: string | null;
  spoons: bigint;
  forks: bigint;
  cookbookSaves: bigint;
  latestInteractionAt: bigint;
}

interface RawCountRow {
  total: bigint;
}

async function runList(
  db: PrismaClient,
  side: Side,
  focalUserId: string,
  opts: ListFellowChefsOptions,
): Promise<FellowChefListResult> {
  const limit = normalizeLimit(opts.limit);
  const offset = normalizeOffset(opts.offset);
  const cte = interactionsCte(side);

  const listSql = `
    WITH interactions AS (
      ${cte}
    )
    SELECT
      u.id AS otherChefId,
      u.username AS username,
      u.photoUrl AS photoUrl,
      SUM(CASE WHEN i.kind = 'spoon' THEN 1 ELSE 0 END) AS spoons,
      SUM(CASE WHEN i.kind = 'fork'  THEN 1 ELSE 0 END) AS forks,
      SUM(CASE WHEN i.kind = 'save'  THEN 1 ELSE 0 END) AS cookbookSaves,
      MAX(i.interactionAt) AS latestInteractionAt
    FROM interactions i
    JOIN User u ON u.id = i.otherChefId
    GROUP BY u.id, u.username, u.photoUrl
    ORDER BY latestInteractionAt DESC, u.id DESC
    LIMIT ? OFFSET ?
  `;

  const countSql = `
    WITH interactions AS (
      ${cte}
    )
    SELECT COUNT(*) AS total
    FROM (SELECT otherChefId FROM interactions GROUP BY otherChefId)
  `;

  const bind = [
    focalUserId,
    focalUserId,
    focalUserId,
    focalUserId,
    focalUserId,
    focalUserId,
  ];

  const [rawRows, rawCount] = await Promise.all([
    db.$queryRawUnsafe<RawAggregateRow[]>(listSql, ...bind, limit, offset),
    db.$queryRawUnsafe<RawCountRow[]>(countSql, ...bind),
  ]);

  const rows: FellowChefRow[] = rawRows.map((row) => ({
    chefId: row.otherChefId,
    username: row.username,
    photoUrl: row.photoUrl ?? null,
    interactionCounts: {
      spoons: toNumber(row.spoons),
      forks: toNumber(row.forks),
      cookbookSaves: toNumber(row.cookbookSaves),
    },
    latestInteractionAt: toDate(row.latestInteractionAt),
  }));

  // COUNT(*) always yields exactly one row, so rawCount[0] is safe.
  const total = toNumber(rawCount[0].total);

  return { rows, total };
}

async function runCount(
  db: PrismaClient,
  side: Side,
  focalUserId: string,
): Promise<number> {
  const cte = interactionsCte(side);
  const sql = `
    WITH interactions AS (
      ${cte}
    )
    SELECT COUNT(*) AS total
    FROM (SELECT otherChefId FROM interactions GROUP BY otherChefId)
  `;
  const rows = await db.$queryRawUnsafe<RawCountRow[]>(
    sql,
    focalUserId,
    focalUserId,
    focalUserId,
    focalUserId,
    focalUserId,
    focalUserId,
  );
  return toNumber(rows[0].total);
}

export async function listFellowChefs(
  db: PrismaClient,
  viewerUserId: string,
  opts: ListFellowChefsOptions = {},
): Promise<FellowChefListResult> {
  return runList(db, "viewer", viewerUserId, opts);
}

export async function listKitchenVisitors(
  db: PrismaClient,
  profileUserId: string,
  opts: ListFellowChefsOptions = {},
): Promise<FellowChefListResult> {
  return runList(db, "chef", profileUserId, opts);
}

export async function countFellowChefs(
  db: PrismaClient,
  viewerUserId: string,
): Promise<number> {
  return runCount(db, "viewer", viewerUserId);
}

export async function countKitchenVisitors(
  db: PrismaClient,
  profileUserId: string,
): Promise<number> {
  return runCount(db, "chef", profileUserId);
}
