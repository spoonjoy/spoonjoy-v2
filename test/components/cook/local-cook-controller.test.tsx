import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookRecipe } from "~/components/cook/cook-controller";
import { toCookRecipe, type RecipeDetailLoaderData } from "~/hooks/use-route-cook-controller";
import { useLocalCookController } from "~/lib/cook/local-cook-controller";
import loaderFixture from "../../fixtures/cook/recipe-detail-loader.json";
import { describeCookView } from "./recipe-cook-view.contract";

// The same recipe the route controller cooks in the contract, from the same recorded loader data.
const RECIPE: CookRecipe = toCookRecipe((loaderFixture as RecipeDetailLoaderData).recipe);

describeCookView("local controller", () => ({
  useController: () => useLocalCookController(RECIPE),
}));

describe("useLocalCookController", () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    setItem = vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    setItem.mockRestore();
  });

  it("starts with no progress on step 1, cook mode closed, at the recipe's own scale", () => {
    const { result } = renderHook(() => useLocalCookController(RECIPE));

    expect(result.current.recipe).toBe(RECIPE);
    expect(result.current.checkedIngredientIds.size).toBe(0);
    expect(result.current.checkedStepOutputIds.size).toBe(0);
    expect(result.current.activeStepIndex).toBe(0);
    expect(result.current.scaleFactor).toBe(1);
    expect(result.current.cookMode).toBe(false);
    expect(result.current.timers.timers.get(2)?.durationSeconds).toBe(15 * 60);
  });

  it("labels an untitled step's timer with nothing but its number", () => {
    const untitled: CookRecipe = {
      ...RECIPE,
      steps: RECIPE.steps.map((step) => ({ ...step, stepTitle: null })),
    };
    const { result } = renderHook(() => useLocalCookController(untitled));

    expect(result.current.timers.timers.get(2)?.label).toBe("");
  });

  it("keeps the step inside the recipe", () => {
    const { result } = renderHook(() => useLocalCookController(RECIPE));

    act(() => result.current.goToStep(9));
    expect(result.current.activeStepIndex).toBe(2);
    act(() => result.current.goToStep(-4));
    expect(result.current.activeStepIndex).toBe(0);
  });

  it("never opens cook mode for a recipe without steps", () => {
    const empty: CookRecipe = { ...RECIPE, steps: [] };
    const { result } = renderHook(() => useLocalCookController(empty));

    act(() => result.current.enterCookMode());
    expect(result.current.cookMode).toBe(false);
  });

  it("keeps progress, scale and timers in memory only", () => {
    const { result } = renderHook(() => useLocalCookController(RECIPE));
    const [ingredientId] = Array.from(RECIPE.ingredientsByStep.values()).flat().map((ingredient) => ingredient.id);
    const [stepOutputId] = Array.from(RECIPE.stepOutputUsesByStep.values()).flat().map((reference) => reference.id);

    act(() => {
      result.current.enterCookMode();
      result.current.toggleIngredient(ingredientId);
      result.current.toggleStepOutput(stepOutputId);
      result.current.setScale(2);
      result.current.goToStep(1);
    });
    act(() => result.current.timers.start(2));

    expect(result.current.cookMode).toBe(true);
    expect(result.current.checkedIngredientIds.has(ingredientId)).toBe(true);
    expect(result.current.checkedStepOutputIds.has(stepOutputId)).toBe(true);
    expect(result.current.scaleFactor).toBe(2);
    expect(result.current.timers.active.map((entry) => entry.stepNum)).toEqual([2]);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);

    act(() => result.current.timers.clear(2));
    act(() => result.current.exitCookMode());
    expect(result.current.cookMode).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
