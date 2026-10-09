import type { ApiV1RecipeStepResult } from "~/lib/api-v1-recipe-steps.server";

export const REPEATED_INGREDIENT_ERROR = "This ingredient is already in the recipe";

export interface NewStepFormErrors {
  ingredientName?: string;
  usesSteps?: string;
  general?: string;
}

/** The add-step form's errors for a step create the shared recipe-step write refused. */
export function newStepFormErrors(result: Extract<ApiV1RecipeStepResult<unknown>, { ok: false }>): NewStepFormErrors {
  const fieldErrors = (result.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
  // An ingredient already in the recipe, or the same ingredient twice in this step.
  if (fieldErrors?.ingredientName || fieldErrors?.ingredients) {
    return { ingredientName: REPEATED_INGREDIENT_ERROR };
  }
  if (fieldErrors?.outputStepNums) {
    return { usesSteps: fieldErrors.outputStepNums };
  }
  return { general: result.message };
}
