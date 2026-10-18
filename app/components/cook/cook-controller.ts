import type { Ingredient } from "~/components/recipe/IngredientList";
import type { StepReference } from "~/components/recipe/StepOutputUseCallout";
import type { CookTimersController } from "~/hooks/use-cook-timers";

export type { Ingredient, StepReference, CookTimersController };

/** One step as cook mode shows it. */
export interface CookModeStep {
  id: string;
  stepNum: number;
  stepTitle: string | null;
  description: string;
  duration?: number | null;
}

/** The recipe a cook works through: its steps, and each step's checklist keyed by step id. */
export interface CookRecipe {
  id: string;
  title: string;
  steps: CookModeStep[];
  ingredientsByStep: Map<string, Ingredient[]>;
  stepOutputUsesByStep: Map<string, StepReference[]>;
}

/**
 * Everything `RecipeCookView` shows and every action a cook can take. The recipe page supplies one
 * backed by its URL, this browser and the cook's account (`useRouteCookController`); a page with no
 * account supplies one held in React state (`useLocalCookController`).
 */
export interface CookController {
  recipe: CookRecipe;
  checkedIngredientIds: ReadonlySet<string>;
  checkedStepOutputIds: ReadonlySet<string>;
  /** The step cook mode shows, always a valid index while the recipe has steps. */
  activeStepIndex: number;
  scaleFactor: number;
  /** Cook mode is open; never true for a recipe without steps. */
  cookMode: boolean;
  timers: CookTimersController;
  toggleIngredient(id: string): void;
  toggleStepOutput(id: string): void;
  setScale(value: number): void;
  goToStep(index: number): void;
  enterCookMode(): void;
  exitCookMode(): void;
  clearProgress(): void;
}

const NO_INGREDIENTS: Ingredient[] = [];
const NO_STEP_OUTPUT_USES: StepReference[] = [];

export function stepIngredients(recipe: CookRecipe, stepId: string): Ingredient[] {
  return recipe.ingredientsByStep.get(stepId) ?? NO_INGREDIENTS;
}

export function stepOutputUses(recipe: CookRecipe, stepId: string): StepReference[] {
  return recipe.stepOutputUsesByStep.get(stepId) ?? NO_STEP_OUTPUT_USES;
}

/** Keeps a step index inside the recipe's steps (0 for a recipe without steps). */
export function clampStepIndex(index: number, stepCount: number): number {
  return Math.max(0, Math.min(stepCount - 1, index));
}

/** A copy of `ids` with `id` added, or removed when it was already there. */
export function toggledId(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}
