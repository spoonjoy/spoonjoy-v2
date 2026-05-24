import type { Route } from "./+types/recipes.$id";
import { useFetcher, useLoaderData, useSubmit } from "react-router";
import { useState, useEffect, useRef, useCallback } from "react";
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
import { RecipeProvenance } from "~/components/recipe/RecipeProvenance";
import { ForkRecipeButton } from "~/components/recipe/ForkRecipeButton";
import { SpoonDialog } from "~/components/recipe/SpoonDialog";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import { StepCard } from "~/components/recipe/StepCard";
import type { Ingredient } from "~/components/recipe/IngredientList";
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

export function findRecipeStepsScrollTarget(doc: Document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>("#steps"));
  return candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) ?? candidates[0] ?? null;
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
  const ingredientCount = recipe.steps.reduce((count, step) => count + step.ingredients.length, 0);

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

  const handleEnterCookMode = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const stepsTarget = findRecipeStepsScrollTarget(document);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#steps`
    );
    stepsTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const headerMasthead = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <Link href="/recipes" className={recipeMastheadLinkClass}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recipes
      </Link>
      <div
        className="grid grid-cols-3 border-y border-[var(--sj-border)] sm:flex sm:items-center sm:gap-6 sm:border-y-0"
        data-testid="recipe-header-actions"
      >
        <Link
          href="#steps"
          onClick={handleEnterCookMode}
          className={`${recipeMastheadActionClass} ${recipeMastheadPrimaryActionClass} border-r border-[var(--sj-border)] sm:border-r-0`}
          data-testid="recipe-header-cook-action"
        >
          Cook mode
        </Link>
        <button
          type="button"
          onClick={handleAddToList}
          aria-pressed={isAlreadyInList}
          className={`${recipeMastheadActionClass} border-r border-[var(--sj-border)] bg-transparent sm:border-r-0`}
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

      {/* Secondary recipe actions */}
      <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap gap-3">
          <ForkRecipeButton
            recipeId={recipe.id}
            recipeTitle={recipe.title}
            sourceChefUsername={recipe.chef.username}
            isOwner={isOwner}
          />
          {/* istanbul ignore next -- @preserve owner-only UI rendering */}
          {isOwner && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              Delete Recipe
            </Button>
          )}
        </div>
      </div>

      <SpoonDialog
        isOpen={isSpoonDialogOpen}
        onClose={() => setIsSpoonDialogOpen(false)}
        actionUrl={`/recipes/${recipe.id}`}
        isOriginCookCandidate={isOriginCookCandidate}
      />

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
            <Heading level={2} className="mt-3 text-3xl/9 font-semibold tracking-[-0.03em] sm:text-4xl/11">
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
          <Heading level={2} className="text-2xl font-semibold tracking-[-0.02em]">
            Cooks
          </Heading>
          <SpoonsStrip spoons={spoons} />
        </div>
      </div>
    </div>
  );
}
