import { describe, expect, it } from "vitest";
import {
  buildRecipeJsonLd,
  formatIngredientLine,
  minutesToIsoDuration,
  type RecipeJsonLdInput,
} from "./recipe-structured-data.server";

const baseStep = {
  stepNum: 1,
  stepTitle: "Mix",
  description: "Mix everything together.",
  duration: 10,
  ingredients: [
    { quantity: 2, unit: { name: "cup" }, ingredientRef: { name: "flour" } },
  ],
};

const baseRecipe: RecipeJsonLdInput = {
  title: "Test Loaf",
  description: "A simple loaf.",
  servings: "2 loaves",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  chef: { username: "ari" },
  steps: [baseStep],
};

describe("formatIngredientLine", () => {
  it("joins quantity, unit, and name", () => {
    expect(formatIngredientLine(baseStep.ingredients[0])).toBe("2 cup flour");
  });

  it("omits an empty unit", () => {
    expect(
      formatIngredientLine({
        quantity: 2,
        unit: { name: "" },
        ingredientRef: { name: "eggs" },
      }),
    ).toBe("2 eggs");
  });
});

describe("minutesToIsoDuration", () => {
  it("formats hours and minutes", () => {
    expect(minutesToIsoDuration(90)).toBe("PT1H30M");
    expect(minutesToIsoDuration(45)).toBe("PT45M");
    expect(minutesToIsoDuration(120)).toBe("PT2H");
  });
});

describe("buildRecipeJsonLd", () => {
  it("returns null for a recipe with no steps", () => {
    expect(
      buildRecipeJsonLd(
        { ...baseRecipe, steps: [] },
        { canonicalUrl: "https://spoonjoy.app/recipes/x", imageUrl: null },
      ),
    ).toBeNull();
  });

  it("builds a schema.org Recipe with core fields", () => {
    const jsonLd = buildRecipeJsonLd(baseRecipe, {
      canonicalUrl: "https://spoonjoy.app/recipes/x",
      imageUrl: "https://spoonjoy.app/og/recipes/x.png",
    }) as Record<string, unknown>;

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Loaf",
      description: "A simple loaf.",
      image: "https://spoonjoy.app/og/recipes/x.png",
      author: { "@type": "Person", name: "ari" },
      datePublished: "2026-01-01T00:00:00.000Z",
      recipeYield: "2 loaves",
      totalTime: "PT10M",
      recipeIngredient: ["2 cup flour"],
      url: "https://spoonjoy.app/recipes/x",
    });
    expect((jsonLd.recipeInstructions as unknown[])[0]).toMatchObject({
      "@type": "HowToStep",
      name: "Mix",
      text: "Mix everything together.",
      url: "https://spoonjoy.app/recipes/x#step-1",
    });
  });

  it("omits optional fields when absent", () => {
    const jsonLd = buildRecipeJsonLd(
      {
        ...baseRecipe,
        description: null,
        servings: null,
        steps: [
          { ...baseStep, duration: null, stepTitle: null, ingredients: [] },
        ],
      },
      { canonicalUrl: "https://spoonjoy.app/recipes/y", imageUrl: null },
    ) as Record<string, unknown>;

    expect(jsonLd).not.toHaveProperty("description");
    expect(jsonLd).not.toHaveProperty("recipeYield");
    expect(jsonLd).not.toHaveProperty("totalTime");
    expect(jsonLd).not.toHaveProperty("recipeIngredient");
    expect(jsonLd).not.toHaveProperty("image");
  });
});
