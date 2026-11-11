import { describe, expect, it } from "vitest";
import { buildRecipeJsonLd, type RecipeJsonLdInput } from "~/lib/recipe-structured-data.server";

const recipe: RecipeJsonLdInput = {
  title: "Charred Tomato Toast",
  description: "A fast lunch with real crunch.",
  servings: "2",
  createdAt: "2026-11-01T00:00:00.000Z",
  chef: { username: "ari" },
  steps: [
    {
      stepNum: 1,
      stepTitle: "Char",
      description: "Char the tomatoes.",
      duration: 10,
      ingredients: [{ quantity: 2, unit: null, ingredientRef: { name: "tomatoes" } }],
    },
  ],
};

describe("Recipe structured data", () => {
  it("credits the chef with a link to their kitchen", () => {
    const jsonLd = buildRecipeJsonLd(recipe, {
      canonicalUrl: "https://spoonjoy.app/recipes/r1",
      imageUrl: "https://spoonjoy.app/photos/toast.jpg",
      authorUrl: "https://spoonjoy.app/users/ari",
    });
    expect(jsonLd).toMatchObject({
      "@type": "Recipe",
      author: { "@type": "Person", name: "ari", url: "https://spoonjoy.app/users/ari" },
      image: "https://spoonjoy.app/photos/toast.jpg",
      recipeIngredient: ["2 tomatoes"],
      totalTime: "PT10M",
    });
  });

  it("leaves the image out rather than naming a picture that isn't the dish", () => {
    const jsonLd = buildRecipeJsonLd(recipe, { canonicalUrl: "https://spoonjoy.app/recipes/r1", imageUrl: null });
    expect(jsonLd).not.toHaveProperty("image");
    expect(jsonLd?.author).toEqual({ "@type": "Person", name: "ari" });
  });

  it("emits nothing for a recipe with no steps", () => {
    expect(buildRecipeJsonLd({ ...recipe, steps: [] }, { canonicalUrl: "x", imageUrl: null })).toBeNull();
  });
});
