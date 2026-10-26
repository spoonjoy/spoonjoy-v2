import type { Route } from "./+types/recipes.$id";
import { chefDisplayName } from "~/lib/username";
import {
  isRouteErrorResponse,
  useActionData,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
  useSubmit,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { RecipeNotFound } from "~/components/recipe/RecipeNotFound";
import { RouteErrorContent } from "~/components/errors/route-error";
import { useState, useEffect, useRef, useCallback } from "react";
import type { MouseEvent } from "react";
import { usePostHog } from "~/lib/use-posthog";
import { ArrowLeft } from "lucide-react";
import {
  handleRecipeDetailAction,
  loadRecipeDetail,
} from "~/lib/recipe-detail.server";
import { Button } from "~/components/ouro/button/button";
import { toast } from "~/lib/ouro/toast";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Dialog as OuroDialog } from "~/components/ouro/dialog/dialog";
import { Form } from "~/components/ouro/form/form";
import { useFormErrors, useFormMessage } from "~/hooks/use-form-errors";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Heading } from "~/components/ouro/text/heading";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { Toggle } from "~/components/ouro/toggle/toggle";
import { RecipeHeader } from "~/components/recipe/RecipeHeader";
import { CookTimerTray } from "~/components/recipe/CookTimers";
import { RecipeProvenance } from "~/components/recipe/RecipeProvenance";
import { ForkRecipeButton } from "~/components/recipe/ForkRecipeButton";
import { ReportOrBlockButton } from "~/components/moderation/ReportOrBlockButton";
import { RecipeCoverHistory } from "~/components/recipe/RecipeCoverHistory";
import { RecipePhotoStudio } from "~/components/recipe/RecipePhotoStudio";
import { SpoonDialog } from "~/components/recipe/SpoonDialog";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import { RecipeCookView } from "~/components/cook/RecipeCookView";
import { useDockSuppressed } from "~/components/navigation";
import { ShareButton } from "~/components/ouro/share-button/share-button";
import type { ShareResult } from "~/lib/ouro/share";
import { useBackNavigation } from "~/hooks/use-back-navigation";
import { confirmCookSessionRecipeDeletion } from "~/hooks/use-cook-session-sync";
import { getCookProgressStorageKey, useRouteCookController } from "~/hooks/use-route-cook-controller";
import { useResumeStepScroll } from "~/hooks/use-resume-step-scroll";
import { useWriteToken } from "~/hooks/use-write-token";
import { revalidateUnlessHashOnly } from "~/lib/hash-only-revalidation";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadRecipeDetail({ request, params, context });
}

export function meta({ data, error }: Route.MetaArgs) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return [
      { title: "Recipe not found - Spoonjoy" },
      { name: "robots", content: "noindex" },
    ];
  }
  if (!data) {
    return [
      { title: "Recipe - Spoonjoy" },
      { name: "description", content: "Open this Spoonjoy recipe." },
    ];
  }

  const description = data.recipe.description?.trim()
    || `A Spoonjoy recipe by ${chefDisplayName(data.recipe.chef.username)}.`;

  return [
    { title: `${data.recipe.title} - Spoonjoy` },
    { name: "description", content: description },
    { property: "og:site_name", content: "Spoonjoy" },
    { property: "og:type", content: "article" },
    { property: "og:title", content: data.recipe.title },
    { property: "og:description", content: description },
    { property: "og:url", content: data.canonicalUrl },
    { property: "og:image", content: data.ogImageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:type", content: "image/svg+xml" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: data.recipe.title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: data.ogImageUrl },
    { tagName: "link", rel: "canonical", href: data.canonicalUrl },
    ...(data.recipeJsonLd
      ? [{ "script:ld+json": data.recipeJsonLd }]
      : []),
  ];
}

// Entering and leaving cook mode (`#cook`) changes only the hash: keep the loaded recipe, so
// closing cook mode never waits on (or, offline, fails on) a data fetch.
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateUnlessHashOnly(args);
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleRecipeDetailAction({ request, params, context });
}

export async function clientAction({ request, params, serverAction }: Route.ClientActionArgs) {
  const formData = await request.clone().formData();
  const confirmDeletion = (result: unknown) => {
    // Both delete implementations redirect here only after the delete/tombstone commit. A
    // single-fetch redirect is thrown, not returned; neither a 404 nor a login redirect proves it.
    if (formData.get("intent") !== "delete" || !params.id || !(result instanceof Response)
      || result.status !== 302 || result.headers.get("Location") !== "/recipes") return;
    const userId = formData.get("cookSessionUserId");
    if (typeof userId === "string" && userId) confirmCookSessionRecipeDeletion(userId, params.id);
    try {
      window.localStorage.removeItem(getCookProgressStorageKey(params.id));
    } catch {
      // Storage can be unavailable; that must not replace the successful server redirect.
    }
  };
  try {
    const result = await serverAction();
    confirmDeletion(result);
    return result;
  } catch (error) {
    confirmDeletion(error);
    throw error;
  }
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

type RecipeDetailActionData = {
  success?: boolean;
  intent?: string;
  spoon?: { id?: string };
  /** Why the action failed, such as the database being briefly unavailable (a 503). */
  error?: unknown;
};

const COVER_PROCESSING_POLL_INTERVAL_MS = 3000;

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

function recipeNotFoundDetails(error: unknown): { deleted: boolean; hidden: boolean } | null {
  if (!isRouteErrorResponse(error) || error.status !== 404) return null;
  const body = (error.data && typeof error.data === "object" ? error.data : {}) as { deleted?: unknown; hidden?: unknown };
  return { deleted: body.deleted === true, hidden: body.hidden === true };
}

// A missing or deleted recipe gets a recipe-specific page; any other error (including one from a
// page under this recipe) gets the app's usual error screen, inside the app's own layout.
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = recipeNotFoundDetails(error);
  return notFound ? <RecipeNotFound {...notFound} /> : <RouteErrorContent error={error} />;
}

export default function RecipeDetail() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData() as RecipeDetailActionData | undefined;
  const {
    recipe,
    coverImageUrl,
    coverProvenanceLabel,
    activeCoverProcessing = null,
    isOwner,
    hasIngredientsInShoppingList = false,
  } = loaderData;
  const recipeCoverFields = recipe as unknown as {
    coverImageUrl?: unknown;
    coverProvenanceLabel?: unknown;
  };
  const recipeCoverImageUrl = typeof recipeCoverFields.coverImageUrl === "string"
    ? recipeCoverFields.coverImageUrl
    : null;
  const recipeCoverProvenanceLabel = typeof recipeCoverFields.coverProvenanceLabel === "string"
    ? recipeCoverFields.coverProvenanceLabel
    : null;
  const isAuthenticated = loaderData.isAuthenticated ?? true;
  const cookSessionUserId = loaderData.cookSessionUserId ?? null;
  const cookbooks = loaderData.cookbooks ?? EMPTY_COOKBOOKS;
  const savedInCookbookIds = loaderData.savedInCookbookIds ?? EMPTY_SAVED_COOKBOOK_IDS;
  const spoons = loaderData.spoons ?? EMPTY_SPOONS;
  const coverHistory = loaderData.coverHistory ?? [];
  const spoonImages = loaderData.spoonImages ?? [];
  const isOriginCookCandidate = loaderData.isOriginCookCandidate ?? false;
  const coverPromptMode = loaderData.coverPromptMode ?? "none";
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const addToListFetcher = useFetcher();
  const createCookbookFetcher = useFetcher<typeof action>();
  const posthog = usePostHog();
  // Cook progress, cook mode and timers: the view below draws them, the controller owns them.
  const cookController = useRouteCookController(loaderData, { coverImageUrl: coverImageUrl ?? recipeCoverImageUrl });
  const { scaleFactor, setScale: handleScaleChange, enterCookMode, resumeStepNum } = cookController;
  const isCookMode = cookController.cookMode;
  useResumeStepScroll(resumeStepNum, isCookMode);

  const [availableCookbooks, setAvailableCookbooks] = useState(() => cookbooks);

  // Track which cookbooks this recipe is saved in (optimistic UI)
  const [savedCookbookIds, setSavedCookbookIds] = useState<Set<string>>(
    () => new Set(savedInCookbookIds)
  );
  const [isAlreadyInList, setIsAlreadyInList] = useState(() => hasIngredientsInShoppingList);
  const loginRedirect = `/login?redirectTo=${encodeURIComponent(`/recipes/${recipe.id}`)}`;

  // Track view start time for engagement metrics
  const viewStartTime = useRef<number>(Date.now());
  const lastHandledCreatedCookbookId = useRef<string | null>(null);
  // "Create & Save" disables itself while it submits and stays disabled once the title clears, so
  // focus would fall to the page behind the dialog. The new cookbook's toggle takes it instead.
  const [cookbookToFocus, setCookbookToFocus] = useState<string | null>(null);
  const focusCreatedCookbook = useCallback((toggle: HTMLButtonElement | null) => {
    if (!toggle) return;
    toggle.focus();
    setCookbookToFocus(null);
  }, []);
  const addToListSubmissionCount = useRef(0);
  const lastHandledAddToListSubmissionCount = useRef(0);
  // One add per tap that succeeds: a tap after a 503, or a double tap, carries the same token and
  // adds the ingredients once; a success makes a fresh token for the next add.
  const [addToListToken, renewAddToListToken] = useWriteToken();
  const lastHandledLoggedSpoonId = useRef<string | null>(null);
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

  useEffect(() => {
    if (!activeCoverProcessing?.coverId) {
      return;
    }

    const revalidateIfVisible = () => {
      if (document.visibilityState !== "hidden") {
        revalidator.revalidate();
      }
    };

    const intervalId = globalThis.setInterval(revalidateIfVisible, COVER_PROCESSING_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", revalidateIfVisible);

    return () => {
      globalThis.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", revalidateIfVisible);
    };
  }, [activeCoverProcessing?.coverId, revalidator]);

  const handleShared = useCallback((result: ShareResult) => {
    /* istanbul ignore next -- @preserve PostHog client-only analytics */
    if (posthog) {
      posthog.capture("recipe_shared", {
        recipe_id: recipe.id,
        share_method: result === "shared" ? "native" : "clipboard",
        share_success: result === "shared" || result === "copied",
      });
    }
  }, [recipe.id, posthog]);

  // State for Save modal (bottom sheet)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSpoonDialogOpen, setIsSpoonDialogOpen] = useState(false);
  // A cook the server could not save shows its message in the open dialog, which keeps the input.
  // Keep the response itself: a display projection must never manufacture acceptance.
  const [spoonAnswer, setSpoonAnswer] = useState<{ error?: unknown }>();
  const spoonErrors = useFormMessage(typeof spoonAnswer?.error === "string" ? spoonAnswer.error : undefined, spoonAnswer);
  const openSpoonDialog = useCallback(() => {
    setSpoonAnswer(undefined);
    setIsSpoonDialogOpen(true);
  }, []);
  const [showOwnerTools, setShowOwnerTools] = useState(false);
  const [newCookbookTitle, setNewCookbookTitle] = useState("");
  // The create's error belongs on the cookbook name field.
  const [createCookbookAnswer, setCreateCookbookAnswer] = useState<{ error?: unknown }>();
  const createCookbookErrors = useFormErrors(
    typeof createCookbookAnswer?.error === "string" ? { title: createCookbookAnswer.error } : undefined,
    undefined,
    createCookbookAnswer,
  );

  useEffect(() => {
    const loggedSpoonId = actionData?.success && actionData.intent === "createSpoon"
      ? actionData.spoon?.id
      : null;

    if (!loggedSpoonId || lastHandledLoggedSpoonId.current === loggedSpoonId) {
      return;
    }

    lastHandledLoggedSpoonId.current = loggedSpoonId;
    setIsSpoonDialogOpen(false);
    toast("Cook logged.", { tone: "success" });
  }, [actionData]);

  useEffect(() => {
    if (actionData?.intent === "createSpoon" && typeof actionData.error === "string") {
      setSpoonAnswer(actionData);
    }
  }, [actionData]);

  const handleOpenSaveModal = useCallback(() => {
    if (!isAuthenticated) {
      window.location.assign(loginRedirect);
      return;
    }

    setCreateCookbookAnswer(undefined);
    // A Create & Save that answered after the dialog closed leaves its toggle to focus; opening the
    // dialog again starts from the dialog's own first focus instead.
    setCookbookToFocus(null);
    setIsSaveModalOpen(true);
  }, [isAuthenticated, loginRedirect]);

  const handleAddToList = useCallback(() => {
    if (!isAuthenticated) {
      window.location.assign(loginRedirect);
      return;
    }

    addToListSubmissionCount.current += 1;
    addToListFetcher.submit(
      {
        intent: "addFromRecipe",
        recipeId: recipe.id,
        scaleFactor: String(scaleFactor),
        writeToken: addToListToken,
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
  }, [addToListFetcher, recipe.id, scaleFactor, addToListToken, posthog, isAuthenticated, loginRedirect]);

  const handleEnterCookMode = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    enterCookMode();
  }, [enterCookMode]);

  // Back means back: the "Recipes" link returns to the previous in-app page when there is
  // one, and only goes to /recipes when the recipe was opened directly.
  const handleBackToRecipes = useBackNavigation();

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
      <Link href="/recipes" onClick={handleBackToRecipes} tone="secondary">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recipes
      </Link>
      <div className="flex flex-wrap items-center gap-2" data-testid="recipe-header-actions">
        <Button href="#cook" onClick={handleEnterCookMode} data-testid="recipe-header-cook-action">
          Cook mode
        </Button>
        <Button variant="outline" tone="secondary" onClick={handleOpenSaveModal} data-testid="recipe-header-save-action">
          Save
        </Button>
        <Button variant="outline" tone="secondary" onClick={handleAddToList} aria-pressed={isAlreadyInList} data-testid="recipe-header-list-action">
          {addToListLabel}
        </Button>
        <ShareButton
          variant="plain"
          data-testid="recipe-header-share-action"
          title={recipe.title}
          text={recipe.description ?? `Check out this recipe: ${recipe.title}`}
          onShare={handleShared}
        />
        {isOwner ? (
          <Button href={`/recipes/${recipe.id}/edit`} variant="outline" tone="secondary" data-testid="recipe-header-edit-action">
            Edit
          </Button>
        ) : null}
        {isAuthenticated ? (
          <Button variant="outline" tone="secondary" onClick={openSpoonDialog} data-testid="recipe-header-log-cook-action">
            Log cook
          </Button>
        ) : (
          <Button href={loginRedirect} variant="outline" tone="secondary" data-testid="recipe-header-log-cook-action">
            Log cook
          </Button>
        )}
        {!isOwner && (
          isAuthenticated ? (
            <ForkRecipeButton
              recipeId={recipe.id}
              recipeTitle={recipe.title}
              sourceChefUsername={recipe.chef.username}
              isOwner={false}
              triggerTestId="recipe-header-fork-action"
            />
          ) : (
            <Button href={loginRedirect} variant="outline" tone="secondary" data-testid="recipe-header-fork-action">
              Fork
            </Button>
          )
        )}
        {!isOwner && isAuthenticated ? (
          <ReportOrBlockButton
            targetType="recipe"
            targetId={recipe.id}
            chefId={recipe.chef.id}
            chefUsername={recipe.chef.username}
            targetLabel="this recipe"
            triggerTestId="recipe-header-report-action"
          />
        ) : null}
      </div>
    </div>
  );

  useEffect(() => {
    const answer = addToListFetcher.state === "idle" && addToListFetcher.data && typeof addToListFetcher.data === "object"
      ? addToListFetcher.data as { success?: unknown; retryable?: unknown; error?: unknown }
      : null;
    const wasSuccessful = answer?.success === true;
    // The database was briefly unavailable: say so, and keep the token, so tapping again adds once.
    const unavailable = answer?.retryable === true && typeof answer.error === "string" ? answer.error : null;

    if (
      (!wasSuccessful && !unavailable) ||
      addToListSubmissionCount.current === lastHandledAddToListSubmissionCount.current
    ) {
      return;
    }

    lastHandledAddToListSubmissionCount.current = addToListSubmissionCount.current;
    if (unavailable) {
      toast(unavailable, { tone: "destructive" });
      return;
    }
    renewAddToListToken();
    setIsAlreadyInList(true);
    toast(`${ingredientCount} items added at ${scaleFactor}x`, { tone: "success" });
  }, [addToListFetcher.state, addToListFetcher.data, ingredientCount, scaleFactor, renewAddToListToken]);

  // The tab bar is hidden in cook mode so it never covers the step controls.
  useDockSuppressed(showOwnerTools || isCookMode);

  useEffect(() => {
    setAvailableCookbooks(cookbooks);
  }, [cookbooks]);

  useEffect(() => {
    setIsAlreadyInList(hasIngredientsInShoppingList);
  }, [hasIngredientsInShoppingList]);

  useEffect(() => {
    const result = createCookbookFetcher.data as { success?: unknown; newCookbook?: CookbookListItem } | undefined;
    if (
      result?.success === true &&
      result.newCookbook &&
      lastHandledCreatedCookbookId.current !== result.newCookbook.id
    ) {
      const nextState = applyCreatedCookbookState(
        availableCookbooks,
        savedCookbookIds,
        result.newCookbook
      );
      setAvailableCookbooks(nextState.cookbooks);
      setSavedCookbookIds(nextState.savedCookbookIds);
      setNewCookbookTitle("");
      setCookbookToFocus(result.newCookbook.id);
      lastHandledCreatedCookbookId.current = result.newCookbook.id;
    }
  }, [createCookbookFetcher.data, availableCookbooks, savedCookbookIds]);

  // A refused "Create & Save" (a title the user already has) shows its error under the field.
  useEffect(() => {
    const result = createCookbookFetcher.data as { intent?: unknown; error?: unknown } | undefined;
    if (result?.intent === "createCookbookAndSave" && typeof result.error === "string") {
      setCreateCookbookAnswer(result);
    }
  }, [createCookbookFetcher.data]);

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
    submit({ intent: "delete", cookSessionUserId: cookSessionUserId ?? "" }, { method: "post" });
  };

  // Cook mode replaces the whole page.
  if (isCookMode) {
    return <RecipeCookView controller={cookController} />;
  }

  return (
    <div className="sj-page pb-24">
      <div className="sticky top-0 z-20 bg-[var(--sj-page)]">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <CookTimerTray timers={cookController.timers} />
        </div>
      </div>
      {/* Recipe Header with prominent image */}
      <RecipeHeader
        title={recipe.title}
        description={recipe.description ?? undefined}
        chefName={chefDisplayName(recipe.chef.username)}
        chefId={recipe.chef.id}
        chefProfileHref={`/users/${recipe.chef.username}`}
        chefPhotoUrl={recipe.chef.photoUrl ?? undefined}
        coverImageUrl={coverImageUrl ?? recipeCoverImageUrl}
        coverProvenanceLabel={coverProvenanceLabel ?? recipeCoverProvenanceLabel}
        coverPlaceholderLabel={isOwner ? "Awaiting first photo" : "Cover coming soon"}
        activeCoverProcessing={activeCoverProcessing}
        servings={recipe.servings ?? undefined}
        scaleFactor={scaleFactor}
        onScaleChange={handleScaleChange}
        progressSyncStatus={cookController.syncStatus}
        masthead={headerMasthead}
        provenance={headerProvenance}
      />

      {/* Owner recipe management */}
      {isOwner && (
        <div className="print:hidden" data-testid="recipe-owner-tools">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <Collapsible title="Manage recipe" open={showOwnerTools} onOpenChange={setShowOwnerTools}>
              <div id="recipe-owner-maintenance" className="py-5">
                <div className="flex flex-wrap gap-3">
                  <Button href={`/recipes/${recipe.id}/edit`} variant="outline" tone="secondary">
                    Edit recipe
                  </Button>
                  <ForkRecipeButton
                    recipeId={recipe.id}
                    recipeTitle={recipe.title}
                    sourceChefUsername={recipe.chef.username}
                    isOwner={isOwner}
                  />
                  <Button
                    type="button"
                    variant="soft" tone="destructive"
                    onClick={() => setIsDeleteDialogOpen(true)}
                  >
                    Delete
                  </Button>
                </div>
                <div className="mt-6 space-y-6">
                  <RecipePhotoStudio
                    recipeTitle={recipe.title}
                    hasActiveCover={Boolean(coverImageUrl ?? recipeCoverImageUrl)}
                    activeCoverProcessing={activeCoverProcessing}
                  />
                  <RecipeCoverHistory covers={coverHistory} spoonImages={spoonImages} />
                </div>
              </div>
            </Collapsible>
          </div>
        </div>
      )}

      <SpoonDialog
        isOpen={isSpoonDialogOpen}
        onClose={() => setIsSpoonDialogOpen(false)}
        actionUrl={`/recipes/${recipe.id}`}
        isOriginCookCandidate={isOriginCookCandidate}
        coverPromptMode={coverPromptMode}
        errors={spoonErrors}
      />

      {/* Save to Cookbook: Ouro UI's Dialog, a bottom sheet on phones and centred from 640px up. It
          brings its own title, Close button, focus handling and scrolling body; tapping a cookbook
          toggles it and leaves the dialog open. */}
      <OuroDialog
        title="Save to cookbook"
        open={isSaveModalOpen}
        onOpenChange={setIsSaveModalOpen}
        footer={
          <div className="w-full" data-testid="save-modal-footer">
            <Form
              method="post"
              errors={createCookbookErrors}
              render={<createCookbookFetcher.Form />}
              className="gap-3"
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
              <TextField
                label="Create new cookbook"
                name="title"
                placeholder="Cookbook name"
                value={newCookbookTitle}
                onChange={(event) => {
                  setNewCookbookTitle(event.target.value);
                  setCreateCookbookAnswer(undefined);
                }}
                data-testid="new-cookbook-input"
              />
              <Button
                type="submit"
                disabled={newCookbookTitle.trim().length === 0 || createCookbookFetcher.state !== "idle"}
                data-testid="create-cookbook-button"
              >
                Create & Save
              </Button>
            </Form>
          </div>
        }
      >
        <div data-testid="save-modal">
          <div data-testid="save-modal-body">
            {availableCookbooks.length > 0 ? (
              <div className="space-y-2">
                {availableCookbooks.map((cookbook) => {
                  const isSaved = savedCookbookIds.has(cookbook.id);
                  return (
                    <Toggle
                      key={cookbook.id}
                      ref={cookbook.id === cookbookToFocus ? focusCreatedCookbook : undefined}
                      label={cookbook.title}
                      variant="outline"
                      pressed={isSaved}
                      onPressedChange={() => handleToggleCookbookSave(cookbook.id)}
                      className="w-full justify-start"
                      data-testid={`cookbook-item-${cookbook.id}`}
                    />
                  );
                })}
              </div>
            ) : (
              <Text tone="muted" align="center" className="py-8">
                No cookbooks yet. Create your first one below!
              </Text>
            )}
          </div>
        </div>
      </OuroDialog>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={`Delete "${recipe.title}"?`}
        description="It will be removed from your kitchen and your cookbooks, and links to it will stop working. You can't undo this."
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={handleConfirmDelete}
      />

      {/* Steps Section */}
      <RecipeCookView
        controller={cookController}
        emptyStepsAction={isOwner ? (
          <Button href={`/recipes/${recipe.id}/edit`}>
            Add steps
          </Button>
        ) : null}
      >
        {loaderData.canonicalUrl ? (
          <p className="hidden font-sj-ui text-sm text-[var(--sj-ink-soft)] print:mt-6 print:block" data-testid="recipe-print-source">
            From Spoonjoy: {loaderData.canonicalUrl}
          </p>
        ) : null}

        <div className="mt-10 space-y-4 print:hidden" data-testid="recipe-cooks">
          <Heading level={2} size="xl">
            Cooks
          </Heading>
          <SpoonsStrip
            spoons={spoons}
            emptyAction={
              isAuthenticated ? (
                <Button type="button" variant="outline" tone="secondary" onClick={openSpoonDialog}>
                  Log the first cook
                </Button>
              ) : (
                <Button href={loginRedirect} variant="outline" tone="secondary">
                  Log the first cook
                </Button>
              )
            }
          />
        </div>
      </RecipeCookView>
    </div>
  );
}
