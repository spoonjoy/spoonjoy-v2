import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookRecipe } from "~/components/cook/cook-controller";
import { toCookRecipe, type RecipeDetailLoaderData } from "~/hooks/use-route-cook-controller";
import { useLocalCookController, type CookProgress, type CookProgressStorage } from "~/lib/cook/local-cook-controller";
import loaderFixture from "../../fixtures/cook/recipe-detail-loader.json";
import { describeCookView } from "./recipe-cook-view.contract";

// The same recipe the route controller cooks in the contract, from the same recorded loader data.
const RECIPE: CookRecipe = toCookRecipe((loaderFixture as RecipeDetailLoaderData).recipe);

describeCookView("local controller", () => ({
  useController: () => useLocalCookController(RECIPE),
}));

/** Storage in a Map, recording every read and write, as a page's storage adapter would see them. */
function memoryStorage(saved: Record<string, CookProgress> = {}) {
  const entries = new Map(Object.entries(saved));
  const writes: Array<[string, CookProgress]> = [];
  const storage: CookProgressStorage = {
    read: vi.fn((recipeId: string) => entries.get(recipeId) ?? null),
    write: vi.fn((recipeId: string, progress: CookProgress) => {
      writes.push([recipeId, progress]);
      entries.set(recipeId, progress);
    }),
  };
  return { storage, entries, writes };
}

describeCookView("local controller with storage", () => {
  const { storage } = memoryStorage();
  return { useController: () => useLocalCookController(RECIPE, storage) };
});

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
    expect(result.current.timers.find((timer) => timer.stepNum === 2)?.duration).toBe(15 * 60);
  });

  it("labels an untitled step's timer with nothing but its number", () => {
    const untitled: CookRecipe = {
      ...RECIPE,
      steps: RECIPE.steps.map((step) => ({ ...step, stepTitle: null })),
    };
    const { result } = renderHook(() => useLocalCookController(untitled));

    expect(result.current.timers.find((timer) => timer.stepNum === 2)?.label).toBe("Step 2");
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

  it("keeps progress and scale in memory only, and scopes its timers to this controller", () => {
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

    expect(result.current.cookMode).toBe(true);
    expect(result.current.checkedIngredientIds.has(ingredientId)).toBe(true);
    expect(result.current.checkedStepOutputIds.has(stepOutputId)).toBe(true);
    expect(result.current.scaleFactor).toBe(2);
    expect(result.current.timers.map((timer) => timer.timerId)).toEqual([`spoonjoy-cook-timer:local:${RECIPE.id}:2`]);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);

    act(() => result.current.exitCookMode());
    expect(result.current.cookMode).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  describe("with storage", () => {
    const ingredientIds = () => Array.from(RECIPE.ingredientsByStep.values()).flat().map((ingredient) => ingredient.id);
    const stepOutputIds = () => Array.from(RECIPE.stepOutputUsesByStep.values()).flat().map((reference) => reference.id);

    it("restores saved progress once mounted, then saves each change", () => {
      const [first, second] = ingredientIds();
      const [output] = stepOutputIds();
      const { storage, writes } = memoryStorage({
        [RECIPE.id]: { checkedIngredientIds: [first!], checkedStepOutputIds: [output!], activeStepIndex: 1, scaleFactor: 1.5 },
      });
      const { result } = renderHook(() => useLocalCookController(RECIPE, storage));

      expect(storage.read).toHaveBeenCalledWith(RECIPE.id);
      expect([...result.current.checkedIngredientIds]).toEqual([first]);
      expect([...result.current.checkedStepOutputIds]).toEqual([output]);
      expect(result.current.activeStepIndex).toBe(1);
      expect(result.current.scaleFactor).toBe(1.5);

      act(() => result.current.toggleIngredient(second!));
      expect(writes.at(-1)).toEqual([
        RECIPE.id,
        { checkedIngredientIds: [first, second], checkedStepOutputIds: [output], activeStepIndex: 1, scaleFactor: 1.5 },
      ]);
      act(() => result.current.clearProgress());
      expect(writes.at(-1)![1]).toEqual({ checkedIngredientIds: [], checkedStepOutputIds: [], activeStepIndex: 1, scaleFactor: 1.5 });
      // Progress lives in the adapter, never in the browser's storage directly.
      expect(setItem).not.toHaveBeenCalled();
    });

    it("renders its first pass with no progress, so the server and the first client render agree", () => {
      const [first] = ingredientIds();
      const { storage } = memoryStorage({
        [RECIPE.id]: { checkedIngredientIds: [first!], checkedStepOutputIds: [], activeStepIndex: 2, scaleFactor: 3 },
      });
      const firstRenders: Array<{ checked: number; step: number; scale: number }> = [];
      renderHook(() => {
        const controller = useLocalCookController(RECIPE, storage);
        firstRenders.push({ checked: controller.checkedIngredientIds.size, step: controller.activeStepIndex, scale: controller.scaleFactor });
        return controller;
      });

      expect(firstRenders[0]).toEqual({ checked: 0, step: 0, scale: 1 });
      expect(firstRenders.at(-1)).toEqual({ checked: 1, step: 2, scale: 3 });
    });

    it("starts fresh, and saves that fresh start, when nothing is saved", () => {
      const { storage, writes } = memoryStorage();
      const { result } = renderHook(() => useLocalCookController(RECIPE, storage));

      expect(result.current.checkedIngredientIds.size).toBe(0);
      expect(writes).toEqual([[RECIPE.id, { checkedIngredientIds: [], checkedStepOutputIds: [], activeStepIndex: 0, scaleFactor: 1 }]]);
    });

    it("keeps a step saved against a longer copy of the recipe inside the recipe", () => {
      const { storage } = memoryStorage({
        [RECIPE.id]: { checkedIngredientIds: [], checkedStepOutputIds: [], activeStepIndex: 9, scaleFactor: 1 },
      });
      const { result } = renderHook(() => useLocalCookController(RECIPE, storage));

      expect(result.current.activeStepIndex).toBe(RECIPE.steps.length - 1);
    });
  });
});
