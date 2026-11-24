// Puts a moved-in recipe's tags, categories and tools on it through Kitchen's organizers, beside any it has. Kitchen
// makes the organizers the cook doesn't have yet and matches the rest by name, whatever their case.
import { organizersOnRecipe, setRecipeOrganizers, type OrganizerKind, type OrganizerStore } from "~/domains/kitchen";

export interface MovedInOrganizers {
  ownerId: string;
  recipeId: string;
  tags: string[];
  categories: string[];
  tools: string[];
}

const KINDS: ReadonlyArray<readonly [OrganizerKind, "tags" | "categories" | "tools"]> = [["tag", "tags"], ["category", "categories"], ["tool", "tools"]];

/** Adds them only, so moving the same backup in again changes nothing, and none the cook gave the recipe comes off. */
export async function attachMovedInOrganizers(store: OrganizerStore, moved: MovedInOrganizers): Promise<void> {
  for (const [kind, field] of KINDS) {
    const names = moved[field];
    if (!names.length) continue;
    // Kitchen sets a recipe's organizers of a kind to exactly the names it's given, so the ones it has go in too.
    const current = await organizersOnRecipe(store, moved.recipeId, kind);
    const result = await setRecipeOrganizers(store, moved.ownerId, moved.recipeId, kind, [...current.map((organizer) => organizer.name), ...names]);
    if (!result.ok) throw new Error("the recipe is no longer in your kitchen");
  }
}
