import type { Route } from "./+types/recipes.$id";
import { useFetcher, useLoaderData, useSubmit } from "react-router";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import { usePostHog } from "@posthog/react";
import { ArrowLeft } from "lucide-react";
import {
  handleRecipeDetailAction,
  loadRecipeDetail,
} from "~/lib/recipe-detail.server";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { Field, Label } from "~/components/ui/fieldset";
import { Heading } from "~/components/ui/heading";
import { Input } from "~/components/ui/input";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { RecipeHeader } from "~/components/recipe/RecipeHeader";
import { ScaleSelector } from "~/components/recipe/ScaleSelector";
import { RecipeProvenance } from "~/components/recipe/RecipeProvenance";
import { ForkRecipeButton } from "~/components/recipe/ForkRecipeButton";
import { SpoonDialog } from "~/components/recipe/SpoonDialog";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import { StepCard } from "~/components/recipe/StepCard";
import { IngredientList, type Ingredient } from "~/components/recipe/IngredientList";
import type { StepReference } from "~/components/recipe/StepOutputUseCallout";
import { shareContent, useRecipeDetailActions } from "~/components/navigation";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadRecipeDetail({ request, params, context });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleRecipeDetailAction({ request, params, context });
}

type CookbookListItem = { id: string; title: string };
const EMPTY_COOKBOOKS: CookbookListItem[] = [];
const EMPTY_SAVED_COOKBOOK_IDS: string[] = [];

type SpoonListItem = {
  id: string;
  cookedAt: string;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  chef: { id: string; username: string; photoUrl: string | null };
};
const EMPTY_SPOONS: SpoonListItem[] = [];

const recipeMastheadLinkClass =
  "inline-flex min-h-11 items-center gap-2 font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] no-underline transition hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]";

const recipeMastheadActionClass =
  "inline-flex min-h-12 items-center justify-center px-2 font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] transition hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] sm:min-h-11 sm:px-0";

const recipeMastheadPrimaryActionClass =
  "text-[var(--sj-action)] hover:text-[var(--sj-tomato)]";

const COOK_PROGRESS_STORAGE_VERSION = 1;

interface CookProgressSnapshot {
  version: typeof COOK_PROGRESS_STORAGE_VERSION;
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
  updatedAt: string;
}

interface CookProgressBounds {
  stepCount: number;
  ingredientIds: ReadonlySet<string>;
  stepOutputIds: ReadonlySet<string>;
}

interface CookProgressState {
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: Set<string>;
  checkedStepOutputIds: Set<string>;
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

function normalizedScaleFactor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(50, Math.max(0.25, Math.round(value * 100) / 100));
}

function normalizedStepIndex(value: unknown, stepCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || stepCount <= 0) {
    return 0;
  }

  return Math.min(stepCount - 1, Math.max(0, Math.trunc(value)));
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

    return {
      activeStepIndex: normalizedStepIndex(parsed.activeStepIndex, bounds.stepCount),
      scaleFactor: normalizedScaleFactor(parsed.scaleFactor),
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

export function writeCookProgress(
  recipeId: string,
  {
    activeStepIndex,
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

export function applyCreatedCookbookState(
  currentCookbooks: CookbookListItem[],
  currentSavedCookbookIds: Set<string>,
  newCookbook: CookbookListItem
) {
  const hasCookbook = currentCookbooks.some((cookbook) => cookbook.id === newCookbook.id);
  const nextCookbooks = hasCookbook
    ? currentCookbooks
    : [...currentCookbooks, newCookbook].sort((a, b) => a.title.localeCompare(b.title));

  const nextSavedCookbookIds = new Set(currentSavedCookbookIds);
  nextSavedCookbookIds.add(newCookbook.id);

  return {
    cookbooks: nextCookbooks,
    savedCookbookIds: nextSavedCookbookIds,
  };
}

export default function RecipeDetail() {
  const loaderData = useLoaderData<typeof loader>();
  const { recipe, coverImageUrl, isOwner, hasIngredientsInShoppingList = false } = loaderData;
  const cookbooks = loaderData.cookbooks ?? EMPTY_COOKBOOKS;
  const savedInCookbookIds = loaderData.savedInCookbookIds ?? EMPTY_SAVED_COOKBOOK_IDS;
  const spoons = loaderData.spoons ?? EMPTY_SPOONS;
  const isOriginCookCandidate = loaderData.isOriginCookCandidate ?? false;
  const submit = useSubmit();
  const addToListFetcher = useFetcher();
  const createCookbookFetcher = useFetcher<typeof action>();
  const posthog = usePostHog();
  const { showToast } = useToast();

  // Scale state for recipe scaling
  const [scaleFactor, setScaleFactor] = useState(1);

  // Track which ingredients have been checked off
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set());

  // Track which step outputs have been checked off
  const [checkedStepOutputs, setCheckedStepOutputs] = useState<Set<string>>(new Set());
  const [isCookMode, setIsCookMode] = useState(false);
  const [activeCookStepIndex, setActiveCookStepIndex] = useState(0);
  const [loadedCookProgressRecipeId, setLoadedCookProgressRecipeId] = useState<string | null>(null);

  const [availableCookbooks, setAvailableCookbooks] = useState(() => cookbooks);

  // Track which cookbooks this recipe is saved in (optimistic UI)
  const [savedCookbookIds, setSavedCookbookIds] = useState<Set<string>>(
    () => new Set(savedInCookbookIds)
  );
  const [isAlreadyInList, setIsAlreadyInList] = useState(() => hasIngredientsInShoppingList);

  // Track view start time for engagement metrics
  const viewStartTime = useRef<number>(Date.now());
  const lastHandledCreatedCookbookId = useRef<string | null>(null);
  const addToListSubmissionCount = useRef(0);
  const lastHandledAddToListSubmissionCount = useRef(0);
  const pendingCookModeScroll = useRef(false);
  const ingredientCount = recipe.steps.reduce((count, step) => count + step.ingredients.length, 0);
  const stepOutputUseCount = recipe.steps.reduce((count, step) => count + (step.usingSteps?.length ?? 0), 0);
  const cookProgressTotal = ingredientCount + stepOutputUseCount;
  const cookProgressChecked = checkedIngredients.size + checkedStepOutputs.size;
  const cookProgressBounds = useMemo<CookProgressBounds>(() => ({
    stepCount: recipe.steps.length,
    ingredientIds: new Set(recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.id))),
    stepOutputIds: new Set(recipe.steps.flatMap((step) => (step.usingSteps ?? []).map((use) => use.id))),
  }), [recipe.steps]);

  // PostHog: Track recipe view on mount
  useEffect(() => {
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("recipe_viewed", {
        recipe_id: recipe.id,
        chef_id: recipe.chef.id,
        step_count: recipe.steps.length,
        is_owner: isOwner,
      });
    }

    // Track time on recipe when leaving
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    return () => {
      if (posthog) {
        const timeOnRecipe = Math.round((Date.now() - viewStartTime.current) / 1000);
        posthog.capture("recipe_view_ended", {
          recipe_id: recipe.id,
          time_on_recipe_seconds: timeOnRecipe,
        });
      }
    };
  }, [recipe.id, recipe.chef.id, recipe.steps.length, isOwner, posthog]);

  // PostHog: Track scale changes
  const handleScaleChange = (newScale: number) => {
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

  const handleIngredientToggle = (id: string) => {
    const newChecked = new Set(checkedIngredients);
    const wasChecked = newChecked.has(id);
    if (wasChecked) {
      newChecked.delete(id);
    } else {
      newChecked.add(id);
    }
    setCheckedIngredients(newChecked);

    // PostHog: Track ingredient check/uncheck
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("ingredient_toggled", {
        recipe_id: recipe.id,
        ingredient_id: id,
        is_checked: !wasChecked,
        total_checked: newChecked.size,
      });
    }
  };

  const handleStepOutputToggle = (id: string) => {
    const newChecked = new Set(checkedStepOutputs);
    const wasChecked = newChecked.has(id);
    if (wasChecked) {
      newChecked.delete(id);
    } else {
      newChecked.add(id);
    }
    setCheckedStepOutputs(newChecked);

    // PostHog: Track step output check/uncheck
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("step_output_toggled", {
        recipe_id: recipe.id,
        step_output_id: id,
        is_checked: !wasChecked,
        total_checked: newChecked.size,
      });
    }
  };

  const handleClearProgress = () => {
    setCheckedIngredients(new Set());
    setCheckedStepOutputs(new Set());
  };

  useEffect(() => {
    setScaleFactor(1);
    setCheckedIngredients(new Set());
    setCheckedStepOutputs(new Set());
    setActiveCookStepIndex(0);

    const storedProgress = readCookProgress(recipe.id, cookProgressBounds);
    if (storedProgress) {
      setScaleFactor(storedProgress.scaleFactor);
      setCheckedIngredients(storedProgress.checkedIngredientIds);
      setCheckedStepOutputs(storedProgress.checkedStepOutputIds);
      setActiveCookStepIndex(storedProgress.activeStepIndex);
    }

    setLoadedCookProgressRecipeId(recipe.id);
  }, [recipe.id, cookProgressBounds]);

  useEffect(() => {
    if (loadedCookProgressRecipeId !== recipe.id) {
      return;
    }

    writeCookProgress(recipe.id, {
      activeStepIndex: activeCookStepIndex,
      scaleFactor,
      checkedIngredientIds: checkedIngredients,
      checkedStepOutputIds: checkedStepOutputs,
    });
  }, [
    recipe.id,
    loadedCookProgressRecipeId,
    activeCookStepIndex,
    scaleFactor,
    checkedIngredients,
    checkedStepOutputs,
  ]);

  useEffect(() => {
    setActiveCookStepIndex((current) => {
      if (recipe.steps.length === 0) {
        return 0;
      }

      return Math.min(current, recipe.steps.length - 1);
    });
  }, [recipe.steps.length]);

  const scrollCookModeIntoView = useCallback(() => {
    window.setTimeout(() => {
      const target = findCookModeScrollTarget(document);
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  useEffect(() => {
    const syncCookModeHash = () => {
      const shouldShowCookMode = window.location.hash === "#cook" && recipe.steps.length > 0;
      setIsCookMode(shouldShowCookMode);

      if (shouldShowCookMode) {
        pendingCookModeScroll.current = true;
      }
    };

    syncCookModeHash();
    window.addEventListener("hashchange", syncCookModeHash);
    window.addEventListener("popstate", syncCookModeHash);

    return () => {
      window.removeEventListener("hashchange", syncCookModeHash);
      window.removeEventListener("popstate", syncCookModeHash);
    };
  }, [recipe.steps.length]);

  useEffect(() => {
    if (!isCookMode || !pendingCookModeScroll.current) {
      return;
    }

    pendingCookModeScroll.current = false;
    scrollCookModeIntoView();
  }, [isCookMode, scrollCookModeIntoView]);

  const handleShare = useCallback(async () => {
    /* istanbul ignore next -- @preserve browser share API */
    const result = await shareContent({
      title: recipe.title,
      text: recipe.description ?? `Check out this recipe: ${recipe.title}`,
      url: typeof window !== "undefined" ? window.location.href : `/recipes/${recipe.id}`,
    });

    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("recipe_shared", {
        recipe_id: recipe.id,
        share_method: result.method,
        share_success: result.success,
      });
    }
  }, [recipe.id, recipe.title, recipe.description, posthog]);

  // State for Save modal (bottom sheet)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSpoonDialogOpen, setIsSpoonDialogOpen] = useState(false);
  const [newCookbookTitle, setNewCookbookTitle] = useState("");
  const saveModalTitleRef = useRef<HTMLHeadingElement>(null);

  const handleAddToList = useCallback(() => {
    addToListSubmissionCount.current += 1;
    addToListFetcher.submit(
      {
        intent: "addFromRecipe",
        recipeId: recipe.id,
        scaleFactor: String(scaleFactor),
      },
      { method: "post", action: "/shopping-list" }
    );

    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("recipe_added_to_shopping_list", {
        recipe_id: recipe.id,
        source: "recipe_detail_header",
        scale_factor: scaleFactor,
      });
    }
  }, [addToListFetcher, recipe.id, scaleFactor, posthog]);

  const enterCookMode = useCallback(() => {
    pendingCookModeScroll.current = true;
    setIsCookMode(true);
    const nextUrl = `${window.location.pathname}${window.location.search}#cook`;
    window.history.pushState(null, "", nextUrl);
  }, []);

  const handleEnterCookMode = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    enterCookMode();
  }, [enterCookMode]);

  const handleExitCookMode = useCallback(() => {
    pendingCookModeScroll.current = false;
    setIsCookMode(false);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  const addToListLabel = addToListFetcher.state !== "idle"
    ? "Adding"
    : isAlreadyInList
      ? "In list"
      : "Add to list";

  const headerProvenance = recipe.sourceUrl || recipe.sourceRecipe ? (
    <RecipeProvenance
      sourceUrl={recipe.sourceUrl ?? undefined}
      sourceRecipe={recipe.sourceRecipe ?? undefined}
    />
  ) : null;

  const recipeHeaderActionCount = isOwner ? 3 : 4;

  const headerMasthead = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <Link href="/recipes" className={recipeMastheadLinkClass}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recipes
      </Link>
      <div
        className={`${recipeHeaderActionCount === 4 ? "grid-cols-4" : "grid-cols-3"} grid divide-x divide-[var(--sj-border)] border-y border-[var(--sj-border)] sm:flex sm:items-center sm:gap-6 sm:divide-x-0 sm:border-y-0`}
        data-testid="recipe-header-actions"
      >
        <Link
          href="#cook"
          onClick={handleEnterCookMode}
          className={`${recipeMastheadActionClass} ${recipeMastheadPrimaryActionClass}`}
          data-testid="recipe-header-cook-action"
        >
          Cook mode
        </Link>
        <button
          type="button"
          onClick={handleAddToList}
          aria-pressed={isAlreadyInList}
          className={`${recipeMastheadActionClass} bg-transparent`}
          data-testid="recipe-header-list-action"
        >
          {addToListLabel}
        </button>
        <button
          type="button"
          onClick={() => setIsSpoonDialogOpen(true)}
          className={`${recipeMastheadActionClass} bg-transparent`}
          data-testid="recipe-header-log-cook-action"
        >
          Log cook
        </button>
        {!isOwner && (
          <ForkRecipeButton
            recipeId={recipe.id}
            recipeTitle={recipe.title}
            sourceChefUsername={recipe.chef.username}
            isOwner={false}
            triggerClassName={recipeMastheadActionClass}
            triggerStyle="text"
            triggerTestId="recipe-header-fork-action"
          />
        )}
      </div>
    </div>
  );

  useEffect(() => {
    const wasSuccessful =
      addToListFetcher.state === "idle" &&
      Boolean(addToListFetcher.data) &&
      typeof addToListFetcher.data === "object" &&
      "success" in addToListFetcher.data &&
      addToListFetcher.data.success === true;

    if (
      !wasSuccessful ||
      addToListSubmissionCount.current === lastHandledAddToListSubmissionCount.current
    ) {
      return;
    }

    lastHandledAddToListSubmissionCount.current = addToListSubmissionCount.current;
    setIsAlreadyInList(true);
    showToast({
      message: `${ingredientCount} items added at ${scaleFactor}x`,
    });
  }, [addToListFetcher.state, addToListFetcher.data, ingredientCount, scaleFactor, showToast]);

  // Register dock actions for this recipe detail page
  const handleOpenSaveModal = useCallback(() => {
    setIsSaveModalOpen(true);
  }, []);

  useRecipeDetailActions({
    recipeId: recipe.id,
    chefId: recipe.chef.id,
    chefProfileHref: `/users/${recipe.chef.username}`,
    isOwner,
    isInShoppingList: isAlreadyInList,
    onSave: handleOpenSaveModal,
    onAddToList: handleAddToList,
    onShare: handleShare,
    onCook: enterCookMode,
  });

  useEffect(() => {
    setAvailableCookbooks(cookbooks);
  }, [cookbooks]);

  useEffect(() => {
    setIsAlreadyInList(hasIngredientsInShoppingList);
  }, [hasIngredientsInShoppingList]);

  useEffect(() => {
    if (
      createCookbookFetcher.data &&
      "success" in createCookbookFetcher.data &&
      createCookbookFetcher.data.success &&
      "newCookbook" in createCookbookFetcher.data &&
      createCookbookFetcher.data.newCookbook &&
      lastHandledCreatedCookbookId.current !== createCookbookFetcher.data.newCookbook.id
    ) {
      const nextState = applyCreatedCookbookState(
        availableCookbooks,
        savedCookbookIds,
        createCookbookFetcher.data.newCookbook
      );
      setAvailableCookbooks(nextState.cookbooks);
      setSavedCookbookIds(nextState.savedCookbookIds);
      setNewCookbookTitle("");
      lastHandledCreatedCookbookId.current = createCookbookFetcher.data.newCookbook.id;
    }
  }, [createCookbookFetcher.data, availableCookbooks, savedCookbookIds]);

  const handleToggleCookbookSave = (cookbookId: string) => {
    const isCurrentlySaved = savedCookbookIds.has(cookbookId);

    // Optimistic UI update
    setSavedCookbookIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlySaved) {
        next.delete(cookbookId);
      } else {
        next.add(cookbookId);
      }
      return next;
    });

    submit(
      { intent: isCurrentlySaved ? "removeFromCookbook" : "addToCookbook", cookbookId },
      { method: "post" }
    );

    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture(isCurrentlySaved ? "recipe_removed_from_cookbook" : "recipe_saved_to_cookbook", {
        recipe_id: recipe.id,
        cookbook_id: cookbookId,
      });
    }
  };

  const handleCreateAndSave = (title: string) => {
    createCookbookFetcher.submit(
      { intent: "createCookbookAndSave", title },
      { method: "post" }
    );

    // PostHog: Track cookbook creation from recipe detail
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("cookbook_created_from_recipe", {
        recipe_id: recipe.id,
      });
    }
  };

  const handleConfirmDelete = () => {
    setIsDeleteDialogOpen(false);
    submit({ intent: "delete" }, { method: "post" });
  };

  /* istanbul ignore next -- @preserve browser scroll navigation */
  const handleStepReferenceClick = (stepNumber: number) => {
    // Scroll to the referenced step
    const stepElement = document.getElementById(`step-${stepNumber}`);
    if (stepElement) {
      stepElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Transform step data to component format
  const transformIngredients = (
    ingredients: Array<{
      id: string;
      quantity: number | null;
      unit: { name: string };
      ingredientRef: { name: string };
    }>
  ): Ingredient[] => {
    return ingredients.map((ing) => {
      const affordance = resolveIngredientAffordance(ing.ingredientRef.name, null, null);
      return {
        id: ing.id,
        quantity: ing.quantity,
        unit: ing.unit.name,
        name: ing.ingredientRef.name,
        categoryLabel: affordance.categoryLabel,
        iconKey: affordance.iconKey,
      };
    });
  };

  const transformStepOutputUses = (
    usingSteps: Array<{
      id: string;
      outputStepNum: number;
      outputOfStep: { stepNum: number; stepTitle: string | null };
    }>
  ): StepReference[] => {
    return usingSteps.map((use) => ({
      id: use.id,
      stepNumber: use.outputOfStep.stepNum,
      stepTitle: use.outputOfStep.stepTitle,
    }));
  };

  return (
    <div className="sj-page pb-24">
      {/* Recipe Header with prominent image */}
      <RecipeHeader
        title={recipe.title}
        description={recipe.description ?? undefined}
        chefName={recipe.chef.username}
        chefId={recipe.chef.id}
        chefProfileHref={`/users/${recipe.chef.username}`}
        chefPhotoUrl={recipe.chef.photoUrl ?? undefined}
        coverImageUrl={coverImageUrl}
        servings={recipe.servings ?? undefined}
        scaleFactor={scaleFactor}
        onScaleChange={handleScaleChange}
        onClearProgress={handleClearProgress}
        masthead={headerMasthead}
        provenance={headerProvenance}
      />

      {/* Owner recipe management */}
      {isOwner && (
        <div className="border-b border-[var(--sj-border)]" data-testid="recipe-owner-tools">
          <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p className="sj-eyebrow">Recipe tools</p>
            <div className="flex flex-wrap gap-3">
              <ForkRecipeButton
                recipeId={recipe.id}
                recipeTitle={recipe.title}
                sourceChefUsername={recipe.chef.username}
                isOwner={isOwner}
              />
              <Button
                type="button"
                variant="destructive"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                Delete Recipe
              </Button>
            </div>
          </div>
        </div>
      )}

      <SpoonDialog
        isOpen={isSpoonDialogOpen}
        onClose={() => setIsSpoonDialogOpen(false)}
        actionUrl={`/recipes/${recipe.id}`}
        isOriginCookCandidate={isOriginCookCandidate}
      />

      {isCookMode && recipe.steps.length > 0 && (
        <CookModePanel
          step={recipe.steps[activeCookStepIndex]}
          stepCount={recipe.steps.length}
          activeStepIndex={activeCookStepIndex}
          progressChecked={cookProgressChecked}
          progressTotal={cookProgressTotal}
          ingredients={transformIngredients(recipe.steps[activeCookStepIndex].ingredients)}
          stepOutputUses={transformStepOutputUses(recipe.steps[activeCookStepIndex].usingSteps ?? [])}
          scaleFactor={scaleFactor}
          checkedIngredientIds={checkedIngredients}
          checkedStepOutputIds={checkedStepOutputs}
          onIngredientToggle={handleIngredientToggle}
          onStepOutputToggle={handleStepOutputToggle}
          onScaleChange={handleScaleChange}
          onPrevious={() => setActiveCookStepIndex((current) => Math.max(0, current - 1))}
          onNext={() => setActiveCookStepIndex((current) => Math.min(recipe.steps.length - 1, current + 1))}
          onExit={handleExitCookMode}
        />
      )}

      {/* Save to Cookbook Modal (Bottom Sheet) */}
      <Dialog
        open={isSaveModalOpen}
        onClose={setIsSaveModalOpen}
        initialFocus={saveModalTitleRef}
        autoFocus={false}
        size="md"
        className="mb-24 max-h-[calc(100dvh-7.5rem)] overflow-hidden !rounded-[var(--sj-radius-surface)] !shadow-[var(--sj-shadow)] pb-[max(0.75rem,env(safe-area-inset-bottom))] data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in data-closed:translate-y-4 data-enter:data-closed:translate-y-4 sm:mb-auto sm:max-h-[calc(100dvh-4rem)] sm:data-closed:translate-y-1"
      >
        <div className="flex max-h-full flex-col" data-testid="save-modal">
          <DialogTitle ref={saveModalTitleRef} tabIndex={-1}>Save to Cookbook</DialogTitle>
          <DialogBody
            className="mt-4 min-h-0 flex-1 overflow-y-auto pb-3"
            data-testid="save-modal-body"
          >
            {availableCookbooks.length > 0 ? (
              <div className="space-y-2">
                {availableCookbooks.map((cookbook) => {
                  const isSaved = savedCookbookIds.has(cookbook.id);
                  return (
                    <button
                      key={cookbook.id}
                      onClick={() => handleToggleCookbookSave(cookbook.id)}
                      aria-pressed={isSaved}
                      className={`w-full border-y px-4 py-3 text-left transition-colors ${
                        isSaved
                          ? "border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_14%,var(--sj-panel-solid))] hover:bg-[color-mix(in_srgb,var(--sj-brass)_20%,var(--sj-panel-solid))]"
                          : "border-[var(--sj-border)] bg-transparent hover:bg-[var(--sj-flour)]"
                      }`}
                      data-testid={`cookbook-item-${cookbook.id}`}
                    >
                      <Text className="flex items-center justify-between">
                        <span>{cookbook.title}</span>
                        {isSaved && <span className="text-[var(--sj-brass)]" aria-hidden="true">✓</span>}
                      </Text>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Text className="py-8 text-center">
                No cookbooks yet. Create your first one below!
              </Text>
            )}
          </DialogBody>
          <div
            className="sticky bottom-0 mt-3 shrink-0 border-t border-[var(--sj-border)] bg-[var(--sj-panel-solid)] pt-4"
            data-testid="save-modal-footer"
          >
            <createCookbookFetcher.Form
              method="post"
              className="space-y-3"
              onSubmit={(event) => {
                const title = newCookbookTitle.trim();
                if (!title) {
                  event.preventDefault();
                  return;
                }
                handleCreateAndSave(title);
                event.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="createCookbookAndSave" />
              <Field>
                <Label htmlFor="new-cookbook-input">Create new cookbook</Label>
                <Input
                  id="new-cookbook-input"
                  name="title"
                  type="text"
                  placeholder="Cookbook name"
                  value={newCookbookTitle}
                  onChange={(event) => setNewCookbookTitle(event.target.value)}
                  data-testid="new-cookbook-input"
                />
              </Field>
              <Button
                type="submit"
                disabled={newCookbookTitle.trim().length === 0 || createCookbookFetcher.state !== "idle"}
                data-testid="create-cookbook-button"
              >
                Create & Save
              </Button>
            </createCookbookFetcher.Form>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={isDeleteDialogOpen}
        onClose={setIsDeleteDialogOpen}
        size="sm"
        role="alertdialog"
      >
        <DialogTitle>Delete Recipe</DialogTitle>
        <DialogDescription>
          Delete this recipe? This cannot be undone.
        </DialogDescription>
        <DialogActions>
          <Button plain onClick={() => setIsDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete}>
            Delete Recipe
          </Button>
        </DialogActions>
      </Dialog>

      {/* Steps Section */}
      <div id="steps" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 border-t border-[var(--sj-border-strong)] pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="sj-eyebrow">Cook mode</p>
            <Heading level={2} className="mt-3 text-3xl/9 font-semibold tracking-normal sm:text-4xl/11">
              Steps
            </Heading>
          </div>
          <Text className="font-sj-ui text-xs uppercase tracking-[0.18em]">Tap ingredients as you go</Text>
        </div>

        {recipe.steps.length === 0 ? (
          <div className="border-y border-dashed border-[var(--sj-border-strong)] py-8 text-center">
            <Text className="mb-4">No steps added yet</Text>
            {/* istanbul ignore next -- @preserve owner-only UI rendering */}
            {isOwner && (
              <Button href={`/recipes/${recipe.id}/edit`}>
                Add Steps
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-24 border-y border-[var(--sj-border)] sm:mt-0">
            {recipe.steps.map((step) => (
              <div key={step.id} id={`step-${step.stepNum}`} className="border-b border-[var(--sj-border)] last:border-b-0">
                <StepCard
                  stepNumber={step.stepNum}
                  title={step.stepTitle ?? undefined}
                  description={step.description}
                  ingredients={transformIngredients(step.ingredients)}
                  stepOutputUses={transformStepOutputUses(step.usingSteps ?? [])}
                  scaleFactor={scaleFactor}
                  checkedIngredientIds={checkedIngredients}
                  onIngredientToggle={handleIngredientToggle}
                  checkedStepOutputIds={checkedStepOutputs}
                  onStepOutputToggle={handleStepOutputToggle}
                  onStepReferenceClick={handleStepReferenceClick}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 space-y-4">
          <Heading level={2} className="text-2xl font-semibold tracking-normal">
            Cooks
          </Heading>
          <SpoonsStrip spoons={spoons} />
        </div>
      </div>
    </div>
  );
}

type CookModeStep = {
  stepNum: number;
  stepTitle: string | null;
  description: string;
  duration?: number | null;
};

function CookModePanel({
  step,
  stepCount,
  activeStepIndex,
  progressChecked,
  progressTotal,
  ingredients,
  stepOutputUses,
  scaleFactor,
  checkedIngredientIds,
  checkedStepOutputIds,
  onIngredientToggle,
  onStepOutputToggle,
  onScaleChange,
  onPrevious,
  onNext,
  onExit,
}: {
  step: CookModeStep;
  stepCount: number;
  activeStepIndex: number;
  progressChecked: number;
  progressTotal: number;
  ingredients: Ingredient[];
  stepOutputUses: StepReference[];
  scaleFactor: number;
  checkedIngredientIds: Set<string>;
  checkedStepOutputIds: Set<string>;
  onIngredientToggle: (id: string) => void;
  onStepOutputToggle: (id: string) => void;
  onScaleChange: (value: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const stepTitle = step.stepTitle ?? `Step ${step.stepNum}`;
  const progressLabel = progressTotal > 0
    ? `${progressChecked} of ${progressTotal} checked`
    : "No checklist items";

  return (
    <section
      id="cook"
      data-testid="cook-mode-panel"
      className="scroll-mt-16 border-b border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-flour)_58%,var(--sj-page))]"
      aria-labelledby="cook-mode-heading"
    >
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--sj-border)] pb-5">
          <div>
            <p className="sj-eyebrow">Now cooking</p>
            <p className="font-sj-ui mt-2 text-sm font-semibold text-[var(--sj-ink-soft)]">
              Step {activeStepIndex + 1} of {stepCount}
            </p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className={recipeMastheadActionClass}
          >
            Exit cook mode
          </button>
        </div>

        <div className="pt-8">
          <Heading
            id="cook-mode-heading"
            level={2}
            className="font-sj-display text-4xl/10 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-5xl/12"
          >
            {stepTitle}
          </Heading>
          <Text className="mt-3 font-sj-ui text-xs uppercase tracking-[0.18em]">
            {progressLabel}
          </Text>

          <div className="mt-6 max-w-[26rem]">
            <ScaleSelector value={scaleFactor} onChange={onScaleChange} />
          </div>

          {step.duration ? <CookModeTimer durationMinutes={step.duration} /> : null}

          {(ingredients.length > 0 || stepOutputUses.length > 0) && (
            <div className="mt-8 lg:max-w-[40rem]">
              <div className="font-sj-ui mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                On this step
              </div>
              <IngredientList
                ingredients={ingredients}
                stepOutputUses={stepOutputUses}
                scaleFactor={scaleFactor}
                checkedIds={checkedIngredientIds}
                checkedStepOutputIds={checkedStepOutputIds}
                onToggle={onIngredientToggle}
                onStepOutputToggle={onStepOutputToggle}
              />
            </div>
          )}

          <Text className="mt-8 max-w-3xl whitespace-pre-wrap text-lg leading-loose text-[var(--sj-ink)]">
            {step.description}
          </Text>

          <div className="mt-8 grid grid-cols-2 gap-3 border-t border-[var(--sj-border)] pt-5 sm:flex sm:items-center sm:justify-between">
            <Button
              type="button"
              plain
              disabled={activeStepIndex === 0}
              onClick={onPrevious}
            >
              Previous step
            </Button>
            <Button
              type="button"
              disabled={activeStepIndex >= stepCount - 1}
              onClick={onNext}
            >
              Next step
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function formatTimerSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function CookModeTimer({ durationMinutes }: { durationMinutes: number }) {
  const totalSeconds = Math.max(0, Math.round(durationMinutes * 60));
  const [remainingSeconds, setRemainingSeconds] = useState(totalSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const durationLabel = `${durationMinutes} min timer`;

  useEffect(() => {
    setRemainingSeconds(totalSeconds);
    setIsRunning(false);
  }, [totalSeconds]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  useEffect(() => {
    if (remainingSeconds === 0) {
      setIsRunning(false);
    }
  }, [remainingSeconds]);

  if (totalSeconds <= 0) {
    return null;
  }

  return (
    <div
      data-testid="cook-mode-timer"
      className="mt-6 flex flex-col gap-4 border-y border-[var(--sj-border)] py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.18em] text-[var(--sj-brass)]">
          {durationLabel}
        </p>
        <p className="font-sj-display mt-2 text-4xl/10 font-semibold tabular-nums text-[var(--sj-ink)]">
          {formatTimerSeconds(remainingSeconds)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Button
          type="button"
          onClick={() => {
            if (isRunning) {
              setIsRunning(false);
              return;
            }

            if (remainingSeconds === 0) {
              setRemainingSeconds(totalSeconds);
            }
            setIsRunning(true);
          }}
        >
          {isRunning ? "Pause timer" : remainingSeconds === 0 ? "Restart timer" : "Start timer"}
        </Button>
        <Button
          type="button"
          plain
          onClick={() => {
            setRemainingSeconds(totalSeconds);
            setIsRunning(false);
          }}
        >
          Reset timer
        </Button>
      </div>
    </div>
  );
}
