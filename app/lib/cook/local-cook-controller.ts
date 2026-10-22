import { useEffect, useMemo, useState } from "react";
import type { CookController, CookRecipe } from "~/components/cook/cook-controller";
import { clampStepIndex, toggledId } from "~/components/cook/cook-controller";
import { useCookTimers } from "~/hooks/use-cook-timers";

/** A cook's progress through one recipe, as a page without an account keeps it. */
export interface CookProgress {
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
  activeStepIndex: number;
  scaleFactor: number;
}

/** Where a local controller keeps progress between visits, such as the browser's storage. */
export interface CookProgressStorage {
  /** The saved progress for a recipe, or null when there is none. Never throws. */
  read(recipeId: string): CookProgress | null;
  /** Saves a recipe's progress. Never throws. */
  write(recipeId: string, progress: CookProgress): void;
}

/**
 * A cook controller held in React state, for pages without a signed-in cook. With no `storage`
 * nothing is kept and closing the page forgets it. With `storage`, saved progress is read once
 * the page has hydrated (so the server render and the first client render agree), and every
 * change after that is written back.
 */
export function useLocalCookController(recipe: CookRecipe, storage?: CookProgressStorage): CookController {
  const [checkedIngredientIds, setCheckedIngredientIds] = useState<ReadonlySet<string>>(() => new Set());
  const [checkedStepOutputIds, setCheckedStepOutputIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [cookModeOpen, setCookModeOpen] = useState(false);
  // Set in the same update as the restored progress, so the first write saves what was read.
  const [restored, setRestored] = useState(false);
  const stepCount = recipe.steps.length;

  useEffect(() => {
    if (!storage) return;
    const saved = storage.read(recipe.id);
    if (saved) {
      setCheckedIngredientIds(new Set(saved.checkedIngredientIds));
      setCheckedStepOutputIds(new Set(saved.checkedStepOutputIds));
      // Saved against an older copy of the recipe, the step may no longer exist.
      setActiveStepIndex(clampStepIndex(saved.activeStepIndex, recipe.steps.length));
      setScaleFactor(saved.scaleFactor);
    }
    setRestored(true);
  }, [storage, recipe.id, recipe.steps.length]);

  useEffect(() => {
    // Before the restore, the state is still the empty server render's: never save that over it.
    if (!storage || !restored) return;
    storage.write(recipe.id, {
      checkedIngredientIds: [...checkedIngredientIds],
      checkedStepOutputIds: [...checkedStepOutputIds],
      activeStepIndex,
      scaleFactor,
    });
  }, [storage, restored, recipe.id, checkedIngredientIds, checkedStepOutputIds, activeStepIndex, scaleFactor]);

  const timerSteps = useMemo(
    () => recipe.steps.map((step) => ({ stepNum: step.stepNum, label: step.stepTitle ?? "", durationMinutes: step.duration })),
    [recipe.steps],
  );
  const timers = useCookTimers(recipe.id, timerSteps, { persist: false });

  return {
    recipe,
    checkedIngredientIds,
    checkedStepOutputIds,
    activeStepIndex: clampStepIndex(activeStepIndex, stepCount),
    scaleFactor,
    cookMode: cookModeOpen && stepCount > 0,
    timers,
    toggleIngredient: (id) => setCheckedIngredientIds((current) => toggledId(current, id)),
    toggleStepOutput: (id) => setCheckedStepOutputIds((current) => toggledId(current, id)),
    setScale: setScaleFactor,
    goToStep: (index) => setActiveStepIndex(clampStepIndex(index, stepCount)),
    enterCookMode: () => setCookModeOpen(true),
    exitCookMode: () => setCookModeOpen(false),
    clearProgress: () => {
      setCheckedIngredientIds(new Set());
      setCheckedStepOutputIds(new Set());
    },
  };
}
