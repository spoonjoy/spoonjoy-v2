import { describe, expect, it } from "vitest";

import { REPEATED_INGREDIENT_ERROR, newStepFormErrors } from "~/lib/new-step-form-errors";

function refused(message: string, details?: unknown) {
  return { ok: false as const, code: "validation_error" as const, message, details };
}

describe("newStepFormErrors", () => {
  it("shows an ingredient already in the recipe under the ingredient field", () => {
    expect(newStepFormErrors(refused("Invalid recipe step fields", {
      fieldErrors: { ingredientName: "Ingredient flour is already in the recipe" },
    }))).toEqual({ ingredientName: REPEATED_INGREDIENT_ERROR });
  });

  it("shows the same ingredient twice in one step under the ingredient field", () => {
    expect(newStepFormErrors(refused("Invalid recipe step fields", {
      fieldErrors: { ingredients: "Duplicate ingredients are not allowed in the same request" },
    }))).toEqual({ ingredientName: REPEATED_INGREDIENT_ERROR });
  });

  it("shows a missing output step under the step-uses field", () => {
    expect(newStepFormErrors(refused("Invalid recipe step fields", {
      fieldErrors: { outputStepNums: "Referenced output steps do not exist: 2" },
    }))).toEqual({ usesSteps: "Referenced output steps do not exist: 2" });
  });

  it("shows any other refusal, such as a concurrent change, as a general error", () => {
    expect(newStepFormErrors(refused("This recipe changed while you were editing it; reload and try again.", {
      reason: "concurrent_change",
    }))).toEqual({ general: "This recipe changed while you were editing it; reload and try again." });
    expect(newStepFormErrors(refused("Recipe not found"))).toEqual({ general: "Recipe not found" });
  });
});
