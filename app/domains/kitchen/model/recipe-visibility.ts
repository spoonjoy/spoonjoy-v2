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

/** The levels every cook who can choose a visibility has. Household joins for a cook who can use households. */
export const SELECTABLE_RECIPE_VISIBILITIES = ["public", "private"] as const satisfies readonly RecipeVisibility[];

const SELECTABLE_WITH_HOUSEHOLD = ["public", "household", "private"] as const satisfies readonly RecipeVisibility[];

/** The levels a cook can choose, most open first: household only when they can use households. */
export function selectableRecipeVisibilities(withHousehold: boolean): readonly RecipeVisibility[] {
  return withHousehold ? SELECTABLE_WITH_HOUSEHOLD : SELECTABLE_RECIPE_VISIBILITIES;
}

function selectable(value: unknown, levels: readonly RecipeVisibility[]): RecipeVisibility | null {
  const level = parseRecipeVisibility(value);
  return level && levels.includes(level) ? level : null;
}

/** A new recipe's visibility: the cook's choice, else their default for new recipes, else public, from the levels they can choose. */
export function newRecipeVisibility(
  requested: unknown,
  cookDefault: unknown,
  levels: readonly RecipeVisibility[] = SELECTABLE_RECIPE_VISIBILITIES,
): RecipeVisibility {
  return selectable(requested, levels) ?? selectable(cookDefault, levels) ?? DEFAULT_RECIPE_VISIBILITY;
}

/**
 * Who can read a fork. A cook's fork of their own recipe keeps its level. A fork of another cook's public recipe is a
 * new recipe of theirs, at their default. Any other level the forking cook could read (a household recipe) keeps the
 * fork to that cook alone: their households need not be the source cook's, so forking never widens who reads it.
 */
export function forkedRecipeVisibility(
  source: { chefId: string; visibility: unknown },
  viewerId: string,
  cookDefault: RecipeVisibility,
): RecipeVisibility {
  if (source.chefId === viewerId) return parseRecipeVisibility(source.visibility) ?? "private";
  return source.visibility === "public" ? cookDefault : "private";
}
