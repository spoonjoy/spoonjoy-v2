// Who may read a recipe. Every reader (pages, the REST API, MCP tools, search, the sitemap, OG images, saved, forked
// and cooked views, and the Apple app's payloads) asks canRead, or the query form of it in adapters/readable-recipes.
//
// - public: anyone, signed in or not.
// - household: its cook and the cooks who share a household with them.
// - private: only its cook.
//
// A stored value that is missing or unknown reads as private, so a bad row is never shown to anyone but its cook.

export const RECIPE_VISIBILITIES = ["private", "household", "public"] as const;

export type RecipeVisibility = (typeof RECIPE_VISIBILITIES)[number];

/** What a new recipe gets when its cook has not chosen another default in settings. */
export const DEFAULT_RECIPE_VISIBILITY: RecipeVisibility = "public";

/** The signed-in reader, or null when signed out. householdChefIds are the cooks who share a household with them. */
export type RecipeViewer = { id: string; householdChefIds?: ReadonlySet<string> } | null | undefined;

export type RecipeAccess = { chefId: string; visibility: string | null | undefined };

/** A visibility level from user or API input, or null when it is not one. */
export function parseRecipeVisibility(value: unknown): RecipeVisibility | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (RECIPE_VISIBILITIES as readonly string[]).includes(normalized) ? (normalized as RecipeVisibility) : null;
}

/** The signed-in viewer's id, or null when signed out. */
export function viewerIdOf(viewer: RecipeViewer): string | null {
  return viewer?.id ? viewer.id : null;
}

/** Whether this viewer may read this recipe. Deleted recipes are each reader's own concern. */
export function canRead(viewer: RecipeViewer, recipe: RecipeAccess): boolean {
  if (recipe.visibility === "public") return true;
  const viewerId = viewerIdOf(viewer);
  if (!viewerId) return false;
  if (recipe.chefId === viewerId) return true;
  return recipe.visibility === "household" && (viewer?.householdChefIds?.has(recipe.chefId) ?? false);
}

/** The levels a cook can choose today. Household joins when households ship. */
export const SELECTABLE_RECIPE_VISIBILITIES = ["public", "private"] as const satisfies readonly RecipeVisibility[];

function selectable(value: unknown): RecipeVisibility | null {
  const level = parseRecipeVisibility(value);
  return level && (SELECTABLE_RECIPE_VISIBILITIES as readonly string[]).includes(level) ? level : null;
}

/** A new recipe's visibility: the cook's choice, else their default for new recipes, else public. */
export function newRecipeVisibility(requested: unknown, cookDefault: unknown): RecipeVisibility {
  return selectable(requested) ?? selectable(cookDefault) ?? DEFAULT_RECIPE_VISIBILITY;
}
