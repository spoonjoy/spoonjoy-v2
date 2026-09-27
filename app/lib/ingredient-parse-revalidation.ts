import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * `shouldRevalidate` for the pages with an AI ingredient box (/recipes/new, Add Step and Edit
 * Step). Parsing ingredients (intent=parseIngredients) changes no data, and a failed parse
 * answers 200, so without this React Router would reload the page's loaders after every parse.
 * Everything else keeps React Router's default.
 */
export function revalidateUnlessIngredientParse({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formData?.get("intent") === "parseIngredients") {
    return false;
  }
  return defaultShouldRevalidate;
}
