import { describe, expect, it, vi } from "vitest";
import {
  RecipeScaleError,
  applyRecipeScale,
  parseMcpRecipeScale,
  parseRestRecipeScale,
} from "~/lib/recipe-scale";

function recipeWithQuantities(...quantities: number[]) {
  return {
    id: "recipe_1",
    servings: "4",
    steps: [{
      id: "step_1",
      ingredients: quantities.map((quantity, index) => ({
        id: `ingredient_${index + 1}`,
        name: `ingredient ${index + 1}`,
        quantity,
        unit: "cup",
      })),
    }],
  };
}

describe("recipe read scaling", () => {
  it.each([
    ["0.1", 0.1],
    ["100", 100],
    ["1.25", 1.25],
    ["1e2", 100],
    ["1E-1", 0.1],
    ["1e+1", 10],
  ])("accepts REST JSON-number scale %s", (raw, expected) => {
    expect(parseRestRecipeScale(new URLSearchParams(`scale=${encodeURIComponent(raw)}`))).toBe(expected);
  });

  it.each([
    "",
    "+1",
    "0x1",
    " 1 ",
    "01",
    ".5",
    "1.",
    "NaN",
    "Infinity",
    "null",
    "-0.1",
    "0.099999",
    "100.000001",
  ])("rejects invalid REST scale %j", (raw) => {
    const params = new URLSearchParams();
    params.append("scale", raw);
    expect(() => parseRestRecipeScale(params)).toThrow(RecipeScaleError);
  });

  it("distinguishes an absent REST scale from empty and repeated values", () => {
    expect(parseRestRecipeScale(new URLSearchParams())).toBeUndefined();
    expect(() => parseRestRecipeScale(new URLSearchParams("scale="))).toThrow(RecipeScaleError);
    expect(() => parseRestRecipeScale(new URLSearchParams("scale=1&scale=2"))).toThrow(RecipeScaleError);
  });

  it.each([0.1, 1, 100])("accepts MCP JSON number scale %s", (scale) => {
    expect(parseMcpRecipeScale({ scale })).toBe(scale);
  });

  it.each([null, "2", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.09, 101])(
    "rejects invalid MCP scale %j",
    (scale) => {
      expect(() => parseMcpRecipeScale({ scale })).toThrow(RecipeScaleError);
    },
  );

  it("omits scale and preserves the exact object when the argument is absent", () => {
    const recipe = recipeWithQuantities(1);
    expect(parseMcpRecipeScale({})).toBeUndefined();
    expect(applyRecipeScale(recipe, undefined)).toBe(recipe);
    expect(recipe).not.toHaveProperty("scale");
  });

  it("scales only ingredient quantities with exact metadata and six-decimal rounding", () => {
    const recipe = recipeWithQuantities(1.23456789, 0.0000004, -0);
    const scaled = applyRecipeScale(recipe, 2.5);

    expect(scaled).not.toBe(recipe);
    expect(scaled).toMatchObject({
      id: "recipe_1",
      servings: "4",
      scale: {
        factor: 2.5,
        appliedTo: "ingredient_quantities",
        decimalPlaces: 6,
      },
    });
    expect(scaled.steps[0]?.ingredients.map((ingredient) => ingredient.quantity)).toEqual([
      3.08642,
      0.000001,
      0,
    ]);
    expect(Object.is(scaled.steps[0]?.ingredients[2]?.quantity, -0)).toBe(false);
    expect(recipe.steps[0]?.ingredients.map((ingredient) => ingredient.quantity)).toEqual([
      1.23456789,
      0.0000004,
      -0,
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite ingredient quantity %j without mutating any ingredient",
    (quantity) => {
      const recipe = recipeWithQuantities(1, quantity, 3);
      const before = recipe.steps[0]!.ingredients.map((ingredient) => ingredient.quantity);

      expect(() => applyRecipeScale(recipe, 2)).toThrow(RecipeScaleError);
      expect(recipe.steps[0]!.ingredients.map((ingredient) => ingredient.quantity)).toEqual(before);
      expect(recipe).not.toHaveProperty("scale");
    },
  );

  it("rejects multiplication overflow atomically", () => {
    const recipe = recipeWithQuantities(1, Number.MAX_VALUE, 3);
    expect(() => applyRecipeScale(recipe, 100)).toThrow(RecipeScaleError);
    expect(recipe.steps[0]!.ingredients.map((ingredient) => ingredient.quantity)).toEqual([
      1,
      Number.MAX_VALUE,
      3,
    ]);
  });

  it("rejects a non-finite rounded result atomically", () => {
    const recipe = recipeWithQuantities(1, 2);
    const toFixed = vi.spyOn(Number.prototype, "toFixed")
      .mockReturnValueOnce("1.000000")
      .mockReturnValueOnce("Infinity");

    try {
      expect(() => applyRecipeScale(recipe, 1)).toThrow(RecipeScaleError);
      expect(recipe.steps[0]!.ingredients.map((ingredient) => ingredient.quantity)).toEqual([1, 2]);
    } finally {
      toFixed.mockRestore();
    }
  });
});
