import type { AppLoadContext } from "react-router";
import type { CookingNowEntry } from "~/lib/cooking-now";
import { cookingNowD1Query, cookingNowRowsFromD1, listCookingNow, type CookingNowRow } from "~/lib/cooking-now.server";
import { d1ReadBatch, requestD1 } from "~/lib/d1-read.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { getRequestDb } from "~/lib/route-platform.server";

/** A Cooking now row as the web's strip, banner and count show it. */
export function cookingNowEntry(row: CookingNowRow): CookingNowEntry {
  const { activeCover, ...recipe } = row.recipe;
  return {
    recipe: {
      id: recipe.id,
      title: recipe.title,
      coverImageUrl: getRecipeCoverDisplay(recipe, activeCover ? [activeCover] : [])?.displayUrl ?? null,
      href: `/recipes/${recipe.id}`,
    },
    activeStepId: row.activeStepId,
    activeStepIndex: row.activeStepIndex,
    stepCount: row.stepCount,
    checkedCount: row.checkedCount,
    totalCount: row.totalCount,
    allCheckedAt: row.allCheckedAt?.toISOString() ?? null,
    touchedAt: row.touchedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * The cook's list for the web. On a Worker it is one raw D1 read and never constructs a Prisma
 * client: every signed-in page asks for it, and the browser often abandons the request when the
 * cook navigates, which must not leave a half-built Prisma client behind for other requests.
 */
export async function readCookingNowEntries(context: AppLoadContext, userId: string, now = Date.now()): Promise<CookingNowEntry[]> {
  const d1 = requestD1(context);
  if (!d1) return (await listCookingNow(await getRequestDb(context), userId, now)).map(cookingNowEntry);
  const [rows] = await d1ReadBatch(d1, [cookingNowD1Query({ sql: `cn."userId" = ?`, values: [userId] }, now)]);
  return cookingNowRowsFromD1(rows!).map(cookingNowEntry);
}
