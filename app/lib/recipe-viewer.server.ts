// The one place that builds the signed-in reader Kitchen's canRead and readable-recipe queries take: the user and the
// cooks who share a household with them, so household recipes read for those cooks. Reads it from D1 when the request
// has a binding, else Prisma. It does not ask the households flag: with no household rows the set is empty.
import { d1HouseholdStore, householdChefIdsFor, prismaHouseholdChefIds, type HouseholdMemberReader } from "~/domains/households-and-identity";
import type { RecipeViewer } from "~/domains/kitchen";
import type { D1ReadDatabase } from "~/lib/d1-read.server";

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
