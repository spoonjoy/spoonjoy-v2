import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigation } from "react-router";
import type { CookController, CookRecipe } from "~/components/cook/cook-controller";
import { clampStepIndex, stepIngredients, stepOutputUses, toggledId } from "~/components/cook/cook-controller";
import { useCookSessionSync } from "~/hooks/use-cook-session-sync";
import { useCookTimers } from "~/hooks/use-cook-timers";
import { useScreenWakeLock } from "~/hooks/use-screen-wake-lock";
import {
  DEFAULT_COOK_PROGRESS,
  normalizeCookProgress,
  normalizeScaleFactor,
  normalizeStepIndex,
  readSyncedCookCache,
  type CookProgressBounds,
  type CookProgressValue,
  type CookSyncStatus,
} from "~/lib/cook-session-sync";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { usePostHog } from "~/lib/use-posthog";

/** The parts of the recipe page's loader data cook mode reads. */
export interface RecipeDetailLoaderData {
  recipe: {
    id: string;
    title: string;
    steps: Array<{
      id: string;
      stepNum: number;
      stepTitle: string | null;
      description: string;
      duration?: number | null;
      ingredients: Array<{
        id: string;
        quantity: number | null;
        unit: { name: string };
        ingredientRef: { name: string };
      }>;
      usingSteps?: Array<{
        id: string;
        outputOfStep: { stepNum: number; stepTitle: string | null };
      }>;
    }>;
  };
  /** The signed-in cook when cook-session sync is enabled; otherwise progress stays in this browser. */
  cookSessionUserId?: string | null;
}

/** The recipe page's controller, plus what only the page shows: the cook-session sync status. */
export interface RouteCookController extends CookController {
  syncStatus: CookSyncStatus | null;
}

const COOK_PROGRESS_STORAGE_VERSION = 1;

interface CookProgressSnapshot {
  version: typeof COOK_PROGRESS_STORAGE_VERSION;
  activeStepIndex: number;
  /** Added later in the same version: older snapshots have only the index. */
  activeStepId: string | null;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
  updatedAt: string;
}

interface CookProgressState {
  activeStepIndex: number;
  activeStepId: string | null;
  scaleFactor: number;
  checkedIngredientIds: Set<string>;
  checkedStepOutputIds: Set<string>;
}

// History state marking the `#cook` entry cook mode pushed (so Exit can pop it).
const COOK_MODE_ENTRY_STATE = "spoonjoyCookModeEntry";

function isCookModeEntryState(state: unknown): boolean {
  return isRecord(state) && state[COOK_MODE_ENTRY_STATE] === true;
}

export function getCookProgressStorageKey(recipeId: string) {
  return `spoonjoy-cook-progress:${recipeId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseCookProgressSnapshot(
  value: string | null,
  bounds: CookProgressBounds
): CookProgressState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== COOK_PROGRESS_STORAGE_VERSION) {
      return null;
    }

    // The step is found by its id, so it survives the steps being reordered; the index is the
    // fallback for older snapshots and for a step the recipe no longer has.
    const { activeStepIndex, activeStepId } = normalizeCookProgress({
      ...DEFAULT_COOK_PROGRESS,
      activeStepIndex: normalizeStepIndex(parsed.activeStepIndex, bounds.stepIds.length),
      activeStepId: typeof parsed.activeStepId === "string" ? parsed.activeStepId : null,
    }, bounds);
    return {
      activeStepIndex,
      activeStepId,
      scaleFactor: normalizeScaleFactor(parsed.scaleFactor),
      checkedIngredientIds: new Set(
        stringArray(parsed.checkedIngredientIds).filter((id) => bounds.ingredientIds.has(id))
      ),
      checkedStepOutputIds: new Set(
        stringArray(parsed.checkedStepOutputIds).filter((id) => bounds.stepOutputIds.has(id))
      ),
    };
  } catch {
    return null;
  }
}

export function readCookProgress(recipeId: string, bounds: CookProgressBounds): CookProgressState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseCookProgressSnapshot(
      window.localStorage.getItem(getCookProgressStorageKey(recipeId)),
      bounds
    );
  } catch {
    return null;
  }
}

// Signed-in progress when cook-session sync is on: this browser's cache of the cook's session.
export function readSyncedCookProgress(
  userId: string,
  recipeId: string,
  bounds: CookProgressBounds
): CookProgressState | null {
  const cached = readSyncedCookCache(userId, recipeId, bounds);
  if (!cached) {
    return null;
  }

  return {
    activeStepIndex: cached.progress.activeStepIndex,
    activeStepId: cached.progress.activeStepId,
    scaleFactor: cached.progress.scaleFactor,
    checkedIngredientIds: new Set(cached.progress.checkedIngredientIds),
    checkedStepOutputIds: new Set(cached.progress.checkedStepOutputIds),
  };
}

export function writeCookProgress(
  recipeId: string,
  {
    activeStepIndex,
    activeStepId,
    scaleFactor,
    checkedIngredientIds,
    checkedStepOutputIds,
  }: CookProgressState
) {
  if (typeof window === "undefined") {
    return;
  }

  const snapshot: CookProgressSnapshot = {
    version: COOK_PROGRESS_STORAGE_VERSION,
    activeStepIndex,
    activeStepId,
    scaleFactor,
    checkedIngredientIds: Array.from(checkedIngredientIds),
    checkedStepOutputIds: Array.from(checkedStepOutputIds),
    updatedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(getCookProgressStorageKey(recipeId), JSON.stringify(snapshot));
  } catch {
    // Ignore unavailable storage. Cook mode remains fully usable for the current session.
  }
}

export function findRecipeStepsScrollTarget(doc: Document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>("#steps"));
  return candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) ?? candidates[0] ?? null;
}

export function findCookModeScrollTarget(doc: Document): HTMLElement | null {
  return doc.getElementById("cook") ?? findRecipeStepsScrollTarget(doc);
}

/** The loader's recipe as cook mode reads it: its steps, and each step's checklist by step id. */
export function toCookRecipe(recipe: RecipeDetailLoaderData["recipe"]): CookRecipe {
  return {
    id: recipe.id,
    title: recipe.title,
    steps: recipe.steps.map((step) => ({
      id: step.id,
      stepNum: step.stepNum,
      stepTitle: step.stepTitle,
      description: step.description,
      duration: step.duration,
    })),
    ingredientsByStep: new Map(recipe.steps.map((step) => [
      step.id,
      step.ingredients.map((ing) => {
        const affordance = resolveIngredientAffordance(ing.ingredientRef.name, null, null);
        return {
          id: ing.id,
          quantity: ing.quantity,
          unit: ing.unit.name,
          name: ing.ingredientRef.name,
          categoryLabel: affordance.categoryLabel,
          iconKey: affordance.iconKey,
        };
      }),
    ])),
    stepOutputUsesByStep: new Map(recipe.steps.map((step) => [
      step.id,
      (step.usingSteps ?? []).map((use) => ({
        id: use.id,
        stepNumber: use.outputOfStep.stepNum,
        stepTitle: use.outputOfStep.stepTitle,
      })),
    ])),
  };
}

/**
 * Cook mode on the recipe page. Progress (checked ingredients and step outputs, scale and step)
 * lives in this browser, or in the signed-in cook's account where cook-session sync is on; cook
 * mode is the recipe's `#cook` history entry; timers live here, above cook mode's step view, so
 * changing step or leaving cook mode keeps them.
 */
export function useRouteCookController(loaderData: RecipeDetailLoaderData): RouteCookController {
  const { recipe: loadedRecipe } = loaderData;
  const cookSessionUserId = loaderData.cookSessionUserId ?? null;
  const posthog = usePostHog();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  // From the delete's submit until the page leaves (or the delete fails and the page stays).
  const isDeletingRecipe = navigation.state !== "idle" && navigation.formData?.get("intent") === "delete";
  const recipe = useMemo(() => toCookRecipe(loadedRecipe), [loadedRecipe]);
  const { steps } = recipe;

  // Scale state for recipe scaling
  const [scaleFactor, setScaleFactor] = useState(1);

  // Track which ingredients have been checked off
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set());

  // Track which step outputs have been checked off
  const [checkedStepOutputs, setCheckedStepOutputs] = useState<Set<string>>(new Set());
  const [isCookMode, setIsCookMode] = useState(false);
  const [activeCookStepIndex, setActiveCookStepIndex] = useState(0);
  const [loadedCookProgressRecipeId, setLoadedCookProgressRecipeId] = useState<string | null>(null);
  const pendingCookModeScroll = useRef(false);

  const cookProgressBounds = useMemo<CookProgressBounds>(() => ({
    stepIds: steps.map((step) => step.id),
    ingredientIds: new Set(steps.flatMap((step) => stepIngredients(recipe, step.id).map((ingredient) => ingredient.id))),
    stepOutputIds: new Set(steps.flatMap((step) => stepOutputUses(recipe, step.id).map((use) => use.id))),
  }), [recipe, steps]);

  const cookProgress = useMemo<CookProgressValue>(() => ({
    activeStepIndex: activeCookStepIndex,
    activeStepId: steps[activeCookStepIndex]?.id ?? null,
    scaleFactor,
    checkedIngredientIds: Array.from(checkedIngredients),
    checkedStepOutputIds: Array.from(checkedStepOutputs),
  }), [activeCookStepIndex, steps, scaleFactor, checkedIngredients, checkedStepOutputs]);
  const applyRemoteCookProgress = useCallback((progress: CookProgressValue) => {
    setScaleFactor(progress.scaleFactor);
    setCheckedIngredients(new Set(progress.checkedIngredientIds));
    setCheckedStepOutputs(new Set(progress.checkedStepOutputIds));
    setActiveCookStepIndex(progress.activeStepIndex);
  }, []);
  const syncStatus = useCookSessionSync({
    recipeId: recipe.id,
    userId: cookSessionUserId,
    ready: loadedCookProgressRecipeId === recipe.id,
    bounds: cookProgressBounds,
    progress: cookProgress,
    onRemoteProgress: applyRemoteCookProgress,
    deleting: isDeletingRecipe,
  });

  // PostHog: Track scale changes
  const setScale = (newScale: number) => {
    setScaleFactor(newScale);
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("recipe_scaled", {
        recipe_id: recipe.id,
        scale_factor: newScale,
        previous_scale: scaleFactor,
      });
    }
  };

  const toggleIngredient = (id: string) => {
    const newChecked = toggledId(checkedIngredients, id);
    setCheckedIngredients(newChecked);

    // PostHog: Track ingredient check/uncheck
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("ingredient_toggled", {
        recipe_id: recipe.id,
        ingredient_id: id,
        is_checked: newChecked.has(id),
        total_checked: newChecked.size,
      });
    }
  };

  const toggleStepOutput = (id: string) => {
    const newChecked = toggledId(checkedStepOutputs, id);
    setCheckedStepOutputs(newChecked);

    // PostHog: Track step output check/uncheck
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("step_output_toggled", {
        recipe_id: recipe.id,
        step_output_id: id,
        is_checked: newChecked.has(id),
        total_checked: newChecked.size,
      });
    }
  };

  const clearProgress = () => {
    setCheckedIngredients(new Set());
    setCheckedStepOutputs(new Set());
  };

  useEffect(() => {
    setScaleFactor(1);
    setCheckedIngredients(new Set());
    setCheckedStepOutputs(new Set());
    setActiveCookStepIndex(0);

    const storedProgress = cookSessionUserId
      ? readSyncedCookProgress(cookSessionUserId, recipe.id, cookProgressBounds)
      : readCookProgress(recipe.id, cookProgressBounds);
    if (storedProgress) {
      setScaleFactor(storedProgress.scaleFactor);
      setCheckedIngredients(storedProgress.checkedIngredientIds);
      setCheckedStepOutputs(storedProgress.checkedStepOutputIds);
      setActiveCookStepIndex(storedProgress.activeStepIndex);
    }

    setLoadedCookProgressRecipeId(recipe.id);
  }, [recipe.id, cookProgressBounds, cookSessionUserId]);

  useEffect(() => {
    // With cook-session sync on, useCookSessionSync keeps the signed-in cache instead.
    if (loadedCookProgressRecipeId !== recipe.id || cookSessionUserId) {
      return;
    }

    writeCookProgress(recipe.id, {
      activeStepIndex: activeCookStepIndex,
      activeStepId: steps[activeCookStepIndex]?.id ?? null,
      scaleFactor,
      checkedIngredientIds: checkedIngredients,
      checkedStepOutputIds: checkedStepOutputs,
    });
  }, [
    recipe.id,
    loadedCookProgressRecipeId,
    cookSessionUserId,
    activeCookStepIndex,
    steps,
    scaleFactor,
    checkedIngredients,
    checkedStepOutputs,
  ]);

  useEffect(() => {
    setActiveCookStepIndex((current) => {
      if (steps.length === 0) {
        return 0;
      }

      return Math.min(current, steps.length - 1);
    });
  }, [steps.length]);

  const scrollCookModeIntoView = useCallback(() => {
    window.setTimeout(() => {
      const target = findCookModeScrollTarget(document);
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  // Cook mode is the recipe's `#cook` history entry. Reading the router's location (in an effect,
  // so the server-rendered page hydrates first) opens it for a `#cook` link and closes it when
  // Back or Exit leaves that entry. It re-runs for every new entry (`location.key`), not only a
  // new hash: Exit hides the panel at once, and a "Cook mode" tap that lands before Exit's pop
  // pushes a new `#cook` entry without the hash ever changing.
  useEffect(() => {
    const shouldShowCookMode = location.hash === "#cook" && steps.length > 0;
    setIsCookMode(shouldShowCookMode);

    if (shouldShowCookMode) {
      pendingCookModeScroll.current = true;
    }
  }, [location.key, location.hash, steps.length]);

  useEffect(() => {
    if (!isCookMode || !pendingCookModeScroll.current) {
      return;
    }

    pendingCookModeScroll.current = false;
    scrollCookModeIntoView();
  }, [isCookMode, scrollCookModeIntoView]);

  // Entering cook mode pushes one `#cook` entry through the router, so the entry carries the
  // router's history index (the recipe's Back reads it) and Back closes cook mode.
  const enterCookMode = useCallback(() => {
    if (steps.length === 0) {
      scrollCookModeIntoView();
      return;
    }

    void navigate(
      { pathname: location.pathname, search: location.search, hash: "#cook" },
      { state: { [COOK_MODE_ENTRY_STATE]: true }, preventScrollReset: true },
    );
  }, [navigate, location.pathname, location.search, steps.length, scrollCookModeIntoView]);

  // Exit removes the `#cook` entry: it pops the entry cook mode pushed, so history never holds
  // two entries for this recipe. A `#cook` page opened from a link was not pushed here, so its
  // entry is replaced with the plain recipe instead of going back to whatever came before.
  const exitCookMode = useCallback(() => {
    pendingCookModeScroll.current = false;
    setIsCookMode(false);

    if (isCookModeEntryState(location.state)) {
      void navigate(-1);
      return;
    }

    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, preventScrollReset: true },
    );
  }, [navigate, location.pathname, location.search, location.state]);

  const cookMode = isCookMode && steps.length > 0;

  const cookTimerSteps = useMemo(
    () => steps.map((step) => ({ stepNum: step.stepNum, label: step.stepTitle ?? "", durationMinutes: step.duration })),
    [steps],
  );
  const timers = useCookTimers(recipe.id, cookTimerSteps);
  useScreenWakeLock(cookMode);

  return {
    recipe,
    checkedIngredientIds: checkedIngredients,
    checkedStepOutputIds: checkedStepOutputs,
    activeStepIndex: activeCookStepIndex,
    scaleFactor,
    cookMode,
    timers,
    syncStatus,
    toggleIngredient,
    toggleStepOutput,
    setScale,
    goToStep: (index) => setActiveCookStepIndex(clampStepIndex(index, steps.length)),
    enterCookMode,
    exitCookMode,
    clearProgress,
  };
}
