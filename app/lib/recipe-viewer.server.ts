// The one place that builds the signed-in reader Kitchen's canRead and readable-recipe queries take: the user and the
// cooks who share a household with them, so household recipes read for those cooks. Reads it from D1 when the request
// has a binding, else Prisma. It does not ask the households flag: with no household rows the set is empty.
import {
  chefIdsFromD1Rows,
  chefIdsSharingWithD1Query,
  d1HouseholdStore,
  householdChefIdsFor,
  prismaHouseholdChefIds,
  type HouseholdMemberReader,
} from "~/domains/households-and-identity";
import type { RecipeViewer } from "~/domains/kitchen";
import type { D1Query, D1ReadDatabase, D1Row } from "~/lib/d1-read.server";

export type RecipeViewerSources = { d1?: D1ReadDatabase | null; db?: HouseholdMemberReader | null };

/** The reader for this user, or null when nobody is signed in. */
export async function recipeViewerFor(
  userId: string | null | undefined,
  { d1, db }: RecipeViewerSources,
): Promise<Exclude<RecipeViewer, undefined>> {
  if (!userId) return null;
  if (d1) return { id: userId, householdChefIds: await householdChefIdsFor(d1HouseholdStore(d1), userId) };
  if (db) return { id: userId, householdChefIds: await prismaHouseholdChefIds(db, userId) };
  throw new Error("recipeViewerFor needs a D1 binding or a Prisma client");
}

const NO_ROWS: D1Query = [`SELECT NULL AS "userId" WHERE 0`];

/** recipeViewerFor's lookup as one statement, for a D1 reader that checks canRead after a batch it already sends. */
export function recipeViewerD1Query(userId: string | null | undefined): D1Query {
  return userId ? chefIdsSharingWithD1Query(userId) : NO_ROWS;
}

/** The reader from the rows recipeViewerD1Query returned. */
export function recipeViewerFromD1Rows(userId: string | null | undefined, rows: readonly D1Row[]): Exclude<RecipeViewer, undefined> {
  return userId ? { id: userId, householdChefIds: new Set(chefIdsFromD1Rows(rows)) } : null;
}
