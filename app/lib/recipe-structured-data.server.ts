import { formatQuantity } from "~/lib/quantity";

export type RecipeJsonLdIngredient = {
  quantity: number;
  unit: { name: string } | null;
  ingredientRef: { name: string } | null;
};

export type RecipeJsonLdStep = {
  stepNum: number;
  stepTitle: string | null;
  description: string;
  duration: number | null;
  ingredients: RecipeJsonLdIngredient[];
};

export type RecipeJsonLdInput = {
  title: string;
  description: string | null;
  servings: string | null;
  createdAt: Date | string;
  chef: { username: string };
  steps: RecipeJsonLdStep[];
};

/** Render a single ingredient as a plain `"<qty> <unit> <name>"` line. */
export function formatIngredientLine(ingredient: RecipeJsonLdIngredient): string {
  return [
    formatQuantity(ingredient.quantity),
    ingredient.unit?.name ?? "",
    ingredient.ingredientRef?.name ?? "",
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Convert a minute count to an ISO-8601 duration, e.g. 90 -> "PT1H30M". */
export function minutesToIsoDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  let out = "PT";
  if (hours > 0) out += `${hours}H`;
  if (minutes > 0 || hours === 0) out += `${minutes}M`;
  return out;
}

/**
 * Build a schema.org/Recipe JSON-LD object for a public recipe page.
 *
 * Returns `null` for "thin" recipes (no steps) so we never emit structured
 * data that Google would classify as low quality — the page stays indexable,
 * it just opts out of the recipe rich result until it has real content.
 */
export function buildRecipeJsonLd(
  recipe: RecipeJsonLdInput,
  options: { canonicalUrl: string; imageUrl: string | null },
): Record<string, unknown> | null {
  if (!recipe.steps || recipe.steps.length === 0) {
    return null;
  }

  const recipeIngredient = recipe.steps
    .flatMap((step) => step.ingredients.map(formatIngredientLine))
    .filter(Boolean);

  const recipeInstructions = recipe.steps.map((step) => {
    const instruction: Record<string, unknown> = {
      "@type": "HowToStep",
      text: step.description,
      url: `${options.canonicalUrl}#step-${step.stepNum}`,
    };
    const name = step.stepTitle?.trim();
    if (name) {
      instruction.name = name;
    }
    return instruction;
  });

  const totalMinutes = recipe.steps.reduce(
    (sum, step) => sum + (step.duration ?? 0),
    0,
  );

  const datePublished =
    typeof recipe.createdAt === "string"
      ? recipe.createdAt
      : recipe.createdAt.toISOString();

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    author: { "@type": "Person", name: recipe.chef.username },
    datePublished,
    url: options.canonicalUrl,
    recipeInstructions,
  };

  if (options.imageUrl) {
    jsonLd.image = options.imageUrl;
  }
  const description = recipe.description?.trim();
  if (description) {
    jsonLd.description = description;
  }
  if (recipeIngredient.length > 0) {
    jsonLd.recipeIngredient = recipeIngredient;
  }
  const recipeYield = recipe.servings?.trim();
  if (recipeYield) {
    jsonLd.recipeYield = recipeYield;
  }
  if (totalMinutes > 0) {
    jsonLd.totalTime = minutesToIsoDuration(totalMinutes);
  }

  return jsonLd;
}
