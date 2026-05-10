import type { Route } from "./+types/recipes.$id";
import { redirect, useFetcher, useLoaderData, useSubmit } from "react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { usePostHog } from "@posthog/react";
import { ArrowLeft } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { Field, Label } from "~/components/ui/fieldset";
import { Heading } from "~/components/ui/heading";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { RecipeHeader } from "~/components/recipe/RecipeHeader";
import { StepCard } from "~/components/recipe/StepCard";
import type { Ingredient } from "~/components/recipe/IngredientList";
import type { StepReference } from "~/components/recipe/StepOutputUseCallout";
import { shareContent, useRecipeDetailActions } from "~/components/navigation";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  const database = await getRequestDb(context);

  const recipe = await database.recipe.findUnique({
    where: { id },
    include: {
      chef: {
        select: {
          id: true,
          username: true,
          photoUrl: true,
        },
      },
      steps: {
        orderBy: {
          stepNum: "asc",
        },
        include: {
          ingredients: {
            include: {
              unit: true,
              ingredientRef: true,
            },
          },
          usingSteps: {
            include: {
              outputOfStep: {
                select: {
                  stepNum: true,
                  stepTitle: true,
                },
              },
            },
            orderBy: {
              outputStepNum: "asc",
            },
          },
        },
      },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  // Check if user owns this recipe
  const isOwner = recipe.chefId === userId;

  // Fetch user's cookbooks for save functionality
  const userCookbooks = await database.cookbook.findMany({
    where: { authorId: userId },
    select: {
      id: true,
      title: true,
      recipes: {
        where: { recipeId: id },
        select: { id: true },
      },
    },
    orderBy: { title: "asc" },
  });

  // Transform cookbooks and track which already contain this recipe
  const cookbooks = userCookbooks.map((cb) => ({
    id: cb.id,
    title: cb.title,
  }));
  const savedInCookbookIds = userCookbooks
    .filter((cb) => cb.recipes.length > 0)
    .map((cb) => cb.id);

  const recipeIngredientKeys = new Set(
    recipe.steps.flatMap((step) =>
      step.ingredients.map((ingredient) => `${ingredient.ingredientRefId}:${ingredient.unitId}`)
    )
  );
  const recipeIngredientRefIds = Array.from(
    new Set(recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.ingredientRefId)))
  );

  let hasIngredientsInShoppingList = false;
  if (recipeIngredientKeys.size > 0 && recipeIngredientRefIds.length > 0) {
    const shoppingList = await database.shoppingList.findUnique({
      where: { authorId: userId },
      select: {
        items: {
          where: {
            deletedAt: null,
            ingredientRefId: { in: recipeIngredientRefIds },
          },
          select: {
            ingredientRefId: true,
            unitId: true,
          },
        },
      },
    });

    const shoppingListIngredientKeys = new Set(
      (shoppingList?.items ?? []).map(
        (item) => `${item.ingredientRefId}:${item.unitId ?? "null"}`
      )
    );
    hasIngredientsInShoppingList = Array.from(recipeIngredientKeys).every((key) =>
      shoppingListIngredientKeys.has(key)
    );
  }

  return { recipe, isOwner, cookbooks, savedInCookbookIds, hasIngredientsInShoppingList };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const database = await getRequestDb(context);

  // Create cookbook and save recipe to it
  if (intent === "createCookbookAndSave") {
    const title = formData.get("title")?.toString()?.trim();
    if (!title) {
      throw new Response("Title is required", { status: 400 });
    }
    const newCookbook = await database.cookbook.create({
      data: {
        title,
        authorId: userId,
      },
    });
    await database.recipeInCookbook.create({
      data: {
        cookbookId: newCookbook.id,
        recipeId: id,
        addedById: userId,
      },
    });
    return { success: true, newCookbook: { id: newCookbook.id, title: newCookbook.title } };
  }

  // Add/remove cookbook membership doesn't require recipe ownership
  if (intent === "addToCookbook" || intent === "removeFromCookbook") {
    const cookbookId = formData.get("cookbookId")?.toString();
    if (cookbookId) {
      // Verify user owns the cookbook
      const cookbook = await database.cookbook.findUnique({
        where: { id: cookbookId },
        select: { authorId: true },
      });
      if (!cookbook || cookbook.authorId !== userId) {
        throw new Response("Unauthorized", { status: 403 });
      }

      if (intent === "removeFromCookbook") {
        await database.recipeInCookbook.deleteMany({
          where: { cookbookId, recipeId: id },
        });
        return { success: true };
      }

      try {
        await database.recipeInCookbook.create({
          data: {
            cookbookId,
            recipeId: id,
            addedById: userId,
          },
        });
        return { success: true };
      } catch (error: unknown) {
        // Already in cookbook - ignore
        return { success: true };
      }
    }
  }

  // Verify ownership for other actions
  const recipe = await database.recipe.findUnique({
    where: { id },
    select: { chefId: true, deletedAt: true },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  if (intent === "delete") {
    // Soft delete
    await database.recipe.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return redirect("/recipes");
  }

  return null;
}

type CookbookListItem = { id: string; title: string };
const EMPTY_COOKBOOKS: CookbookListItem[] = [];
const EMPTY_SAVED_COOKBOOK_IDS: string[] = [];

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
  const { recipe, isOwner, hasIngredientsInShoppingList = false } = loaderData;
  const cookbooks = loaderData.cookbooks ?? EMPTY_COOKBOOKS;
  const savedInCookbookIds = loaderData.savedInCookbookIds ?? EMPTY_SAVED_COOKBOOK_IDS;
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
        recipe_title: recipe.title,
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
  }, [recipe.id, recipe.title, recipe.chef.id, recipe.steps.length, isOwner, posthog]);

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
        source: "recipe_detail_dock",
        scale_factor: scaleFactor,
      });
    }
  }, [addToListFetcher, recipe.id, scaleFactor, posthog]);

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
        cookbook_title: title,
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-24">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <Button href="/recipes" plain>
            <ArrowLeft data-slot="icon" />
            Back to recipes
          </Button>
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

      {/* Recipe Header with prominent image */}
      <RecipeHeader
        title={recipe.title}
        description={recipe.description ?? undefined}
        chefName={recipe.chef.username}
        chefId={recipe.chef.id}
        chefProfileHref={`/users/${recipe.chef.username}`}
        chefPhotoUrl={recipe.chef.photoUrl ?? undefined}
        imageUrl={recipe.imageUrl ?? undefined}
        servings={recipe.servings ?? undefined}
        scaleFactor={scaleFactor}
        onScaleChange={handleScaleChange}
        onClearProgress={handleClearProgress}
      />

      {/* Save to Cookbook Modal (Bottom Sheet) */}
      <Dialog
        open={isSaveModalOpen}
        onClose={setIsSaveModalOpen}
        initialFocus={saveModalTitleRef}
        autoFocus={false}
        size="md"
        className="mb-24 max-h-[calc(100dvh-7.5rem)] overflow-hidden !rounded-sm !shadow-none pb-[max(0.75rem,env(safe-area-inset-bottom))] data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in data-closed:translate-y-4 data-enter:data-closed:translate-y-4 sm:mb-auto sm:max-h-[calc(100dvh-4rem)] sm:data-closed:translate-y-1"
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
                      className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                        isSaved
                          ? "bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50"
                          : "bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                      data-testid={`cookbook-item-${cookbook.id}`}
                    >
                      <Text className="flex items-center justify-between">
                        <span>{cookbook.title}</span>
                        {isSaved && <span className="text-blue-500">✓</span>}
                      </Text>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Text className="text-center text-zinc-500 dark:text-zinc-400 py-8">
                No cookbooks yet. Create your first one below!
              </Text>
            )}
          </DialogBody>
          <div
            className="sticky bottom-0 mt-3 shrink-0 border-t border-zinc-200 bg-white pt-4 dark:border-zinc-700 dark:bg-zinc-900"
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
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Heading level={2} className="mb-6 font-serif text-2xl font-medium tracking-tight sm:text-3xl">
          Steps
        </Heading>

        {recipe.steps.length === 0 ? (
          <div className="bg-zinc-100 dark:bg-zinc-800 p-8 rounded-xl text-center">
            <Text className="mb-4">No steps added yet</Text>
            {/* istanbul ignore next -- @preserve owner-only UI rendering */}
            {isOwner && (
              <Button href={`/recipes/${recipe.id}/edit`}>
                Add Steps
              </Button>
            )}
          </div>
        ) : (
          <div className="border-y border-zinc-200 dark:border-zinc-700">
            {recipe.steps.map((step) => (
              <div key={step.id} id={`step-${step.stepNum}`} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-700">
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
      </div>
    </div>
  );
}
