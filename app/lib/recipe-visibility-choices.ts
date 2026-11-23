// Which visibility levels a cook can choose, on a recipe or as their default for new ones: none while recipe_visibility
// is off for them, and household only while households is on for them too. Reading a household recipe never depends on
// these flags; only the choice does.
import { selectableRecipeVisibilities, type RecipeVisibility } from "~/domains/kitchen";
import { isFlagOn, type FlagEnv } from "~/domains/platform";

/** The levels this cook can choose, most open first, or null while the choice is off for them. */
export function recipeVisibilityChoices(env: object | null | undefined, userId: string | null | undefined): readonly RecipeVisibility[] | null {
  const flags = env as FlagEnv;
  if (!isFlagOn("recipe_visibility", flags, userId)) return null;
  return selectableRecipeVisibilities(isFlagOn("households", flags, userId));
}
