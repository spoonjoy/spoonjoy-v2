import { useMemo, useState } from "react";
import type { CookController, CookRecipe } from "~/components/cook/cook-controller";
import { clampStepIndex, toggledId } from "~/components/cook/cook-controller";
import { useCookTimers } from "~/hooks/use-cook-timers";

/**
 * A cook controller held entirely in React state: nothing is read from or written to storage, an
 * account or the URL, and closing the page forgets it. For pages without a signed-in cook.
 */
export function useLocalCookController(recipe: CookRecipe): CookController {
  const [checkedIngredientIds, setCheckedIngredientIds] = useState<ReadonlySet<string>>(() => new Set());
  const [checkedStepOutputIds, setCheckedStepOutputIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [cookModeOpen, setCookModeOpen] = useState(false);
  const stepCount = recipe.steps.length;

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
