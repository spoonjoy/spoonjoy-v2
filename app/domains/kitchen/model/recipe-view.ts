// How a cook browses recipes: with their pictures, or as a compact list, one line each.

export type RecipeView = "pictures" | "list";

/** The views a cook can pick, in the order the switch shows them. */
export const RECIPE_VIEWS: readonly { value: RecipeView; label: string }[] = [
  { value: "pictures", label: "Pictures" },
  { value: "list", label: "List" },
];

/** A stored or submitted view, or `pictures` for anything else. */
export function parseRecipeView(value: unknown): RecipeView {
  return value === "list" ? "list" : "pictures";
}

/** The cookie that keeps a cook's view in this browser, so the first render already uses it. */
export const RECIPE_VIEW_COOKIE = "sj_recipe_view";

/** The view in a request's `Cookie` header, or `pictures`. */
export function recipeViewFromCookie(header: string | null | undefined): RecipeView {
  const pair = (header ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${RECIPE_VIEW_COOKIE}=`));
  return parseRecipeView(pair?.slice(RECIPE_VIEW_COOKIE.length + 1));
}

/** The `document.cookie` assignment that keeps `view` for a year, across the whole site. */
export function recipeViewCookie(view: RecipeView): string {
  return `${RECIPE_VIEW_COOKIE}=${view}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
