import { describe, expect, it } from "vitest";

import { coalesceShoppingRecipeIngredients } from "~/lib/shopping-list-mutations.server";

describe("shopping-list compatibility mutations", () => {
  it("takes category and icon from the first non-null value in deterministic identity order", () => {
    const rows = [
      {
        stepNum: 2,
        ingredientId: "ingredient-z",
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 3,
        categoryKey: "later-category",
        iconKey: "first-icon",
      },
      {
        stepNum: 1,
        ingredientId: "ingredient-a",
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 1,
        categoryKey: "first-category",
        iconKey: null,
      },
      {
        stepNum: 1,
        ingredientId: "ingredient-A",
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 2,
        categoryKey: null,
        iconKey: null,
      },
    ];

    expect(coalesceShoppingRecipeIngredients(rows, 1)).toEqual([
      {
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 6,
        categoryKey: "first-category",
        iconKey: "first-icon",
      },
    ]);
  });
});
