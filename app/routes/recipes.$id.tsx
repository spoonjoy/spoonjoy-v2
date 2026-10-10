import type { Route } from "./+types/recipes.$id";
import {
  useActionData,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRevalidator,
  useSubmit,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import { usePostHog } from "~/lib/use-posthog";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
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
import { ValidationError } from "~/components/ui/validation-error";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { RecipeHeader } from "~/components/recipe/RecipeHeader";
import { CookStepTimer, CookTimerTray } from "~/components/recipe/CookTimers";
import { ScaleSelector } from "~/components/recipe/ScaleSelector";
import { RecipeProvenance } from "~/components/recipe/RecipeProvenance";
import { ForkRecipeButton } from "~/components/recipe/ForkRecipeButton";
import { RecipeCoverHistory } from "~/components/recipe/RecipeCoverHistory";
import { RecipePhotoStudio } from "~/components/recipe/RecipePhotoStudio";
import { SpoonDialog } from "~/components/recipe/SpoonDialog";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import { StepCard } from "~/components/recipe/StepCard";
import { IngredientList, type Ingredient } from "~/components/recipe/IngredientList";
import type { StepReference } from "~/components/recipe/StepOutputUseCallout";
import { shareContent, useDockSuppressed } from "~/components/navigation";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { useBackNavigation } from "~/hooks/use-back-navigation";
import { useCookSessionSync } from "~/hooks/use-cook-session-sync";
import { useCookTimers, type CookTimersController } from "~/hooks/use-cook-timers";
import { useScreenWakeLock } from "~/hooks/use-screen-wake-lock";
import {
  normalizeScaleFactor,
  normalizeStepIndex,
  readSyncedCookCache,
  type CookProgressBounds,
  type CookProgressValue,
} from "~/lib/cook-session-sync";
import { revalidateUnlessHashOnly } from "~/lib/hash-only-revalidation";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadRecipeDetail({ request, params, context });
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [
      { title: "Recipe - Spoonjoy" },
      { name: "description", content: "Open this Spoonjoy recipe." },
    ];
  }

  const description = data.recipe.description?.trim()
    || `A Spoonjoy recipe by ${data.recipe.chef.username}.`;

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
};

const recipeMastheadLinkClass =
  "inline-flex min-h-11 items-center gap-2 font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] no-underline transition hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]";

const recipeMastheadActionClass =
  "inline-flex min-h-12 min-w-11 items-center justify-center px-2 font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] transition hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] sm:min-h-11 sm:px-2";

const recipeMastheadPrimaryActionClass =
  "text-[var(--sj-action)] hover:text-[var(--sj-tomato)]";

const COOK_PROGRESS_STORAGE_VERSION = 1;
const COVER_PROCESSING_POLL_INTERVAL_MS = 3000;

interface CookProgressSnapshot {
  version: typeof COOK_PROGRESS_STORAGE_VERSION;
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
  updatedAt: string;
}

interface CookProgressState {
  activeStepIndex: number;
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

    return {
      activeStepIndex: normalizeStepIndex(parsed.activeStepIndex, bounds.stepCount),
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
    scaleFactor: cached.progress.scaleFactor,
    checkedIngredientIds: new Set(cached.progress.checkedIngredientIds),
    checkedStepOutputIds: new Set(cached.progress.checkedStepOutputIds),
  };
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
  const renderedAt = loaderData.renderedAt;
  const coverHistory = loaderData.coverHistory ?? [];
  const spoonImages = loaderData.spoonImages ?? [];
  const isOriginCookCandidate = loaderData.isOriginCookCandidate ?? false;
  const coverPromptMode = loaderData.coverPromptMode ?? "none";
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const addToListFetcher = useFetcher();
  const createCookbookFetcher = useFetcher<typeof action>();
  const posthog = usePostHog();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

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
  const loginRedirect = `/login?redirectTo=${encodeURIComponent(`/recipes/${recipe.id}`)}`;

  // Track view start time for engagement metrics
  const viewStartTime = useRef<number>(Date.now());
  const lastHandledCreatedCookbookId = useRef<string | null>(null);
  const addToListSubmissionCount = useRef(0);
  const lastHandledAddToListSubmissionCount = useRef(0);
  const pendingCookModeScroll = useRef(false);
  const lastHandledLoggedSpoonId = useRef<string | null>(null);
  const ingredientCount = recipe.steps.reduce((count, step) => count + step.ingredients.length, 0);
  const stepOutputUseCount = recipe.steps.reduce((count, step) => count + (step.usingSteps?.length ?? 0), 0);
  const cookProgressTotal = ingredientCount + stepOutputUseCount;
  const cookProgressChecked = checkedIngredients.size + checkedStepOutputs.size;
  const cookProgressBounds = useMemo<CookProgressBounds>(() => ({
    stepCount: recipe.steps.length,
    ingredientIds: new Set(recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.id))),
    stepOutputIds: new Set(recipe.steps.flatMap((step) => (step.usingSteps ?? []).map((use) => use.id))),
  }), [recipe.steps]);

  const cookProgress = useMemo<CookProgressValue>(() => ({
    activeStepIndex: activeCookStepIndex,
    scaleFactor,
    checkedIngredientIds: Array.from(checkedIngredients),
    checkedStepOutputIds: Array.from(checkedStepOutputs),
  }), [activeCookStepIndex, scaleFactor, checkedIngredients, checkedStepOutputs]);
  const applyRemoteCookProgress = useCallback((progress: CookProgressValue) => {
    setScaleFactor(progress.scaleFactor);
    setCheckedIngredients(new Set(progress.checkedIngredientIds));
    setCheckedStepOutputs(new Set(progress.checkedStepOutputIds));
    setActiveCookStepIndex(progress.activeStepIndex);
  }, []);
  const cookSyncStatus = useCookSessionSync({
    recipeId: recipe.id,
    userId: cookSessionUserId,
    ready: loadedCookProgressRecipeId === recipe.id,
    bounds: cookProgressBounds,
    progress: cookProgress,
    onRemoteProgress: applyRemoteCookProgress,
  });

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
      scaleFactor,
      checkedIngredientIds: checkedIngredients,
      checkedStepOutputIds: checkedStepOutputs,
    });
  }, [
    recipe.id,
    loadedCookProgressRecipeId,
    cookSessionUserId,
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

  // Cook mode is the recipe's `#cook` history entry. Reading the router's location (in an effect,
  // so the server-rendered page hydrates first) opens it for a `#cook` link and closes it when
  // Back or Exit leaves that entry. It re-runs for every new entry (`location.key`), not only a
  // new hash: Exit hides the panel at once, and a "Cook mode" tap that lands before Exit's pop
  // pushes a new `#cook` entry without the hash ever changing.
  useEffect(() => {
    const shouldShowCookMode = location.hash === "#cook" && recipe.steps.length > 0;
    setIsCookMode(shouldShowCookMode);

    if (shouldShowCookMode) {
      pendingCookModeScroll.current = true;
    }
  }, [location.key, location.hash, recipe.steps.length]);

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
  const [showOwnerTools, setShowOwnerTools] = useState(false);
  const [newCookbookTitle, setNewCookbookTitle] = useState("");
  const [createCookbookError, setCreateCookbookError] = useState<string | null>(null);
  const saveModalTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const loggedSpoonId = actionData?.success && actionData.intent === "createSpoon"
      ? actionData.spoon?.id
      : null;

    if (!loggedSpoonId || lastHandledLoggedSpoonId.current === loggedSpoonId) {
      return;
    }

    lastHandledLoggedSpoonId.current = loggedSpoonId;
    setIsSpoonDialogOpen(false);
    showToast({ message: "Cook logged." });
  }, [actionData, showToast]);

  const handleOpenSaveModal = useCallback(() => {
    if (!isAuthenticated) {
      window.location.assign(loginRedirect);
      return;
    }

    setCreateCookbookError(null);
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
  }, [addToListFetcher, recipe.id, scaleFactor, posthog, isAuthenticated, loginRedirect]);

  // Entering cook mode pushes one `#cook` entry through the router, so the entry carries the
  // router's history index (the recipe's Back reads it) and Back closes cook mode.
  const enterCookMode = useCallback(() => {
    if (recipe.steps.length === 0) {
      scrollCookModeIntoView();
      return;
    }

    void navigate(
      { pathname: location.pathname, search: location.search, hash: "#cook" },
      { state: { [COOK_MODE_ENTRY_STATE]: true }, preventScrollReset: true },
    );
  }, [navigate, location.pathname, location.search, recipe.steps.length, scrollCookModeIntoView]);

  const handleEnterCookMode = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    enterCookMode();
  }, [enterCookMode]);

  // Back means back: the "Recipes" link returns to the previous in-app page when there is
  // one, and only goes to /recipes when the recipe was opened directly.
  const handleBackToRecipes = useBackNavigation();

  // Exit removes the `#cook` entry: it pops the entry cook mode pushed, so history never holds
  // two entries for this recipe. A `#cook` page opened from a link was not pushed here, so its
  // entry is replaced with the plain recipe instead of going back to whatever came before.
  const handleExitCookMode = useCallback(() => {
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
      <Link href="/recipes" onClick={handleBackToRecipes} className={recipeMastheadLinkClass}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recipes
      </Link>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--sj-border)] py-1 sm:border-t-0 sm:py-0"
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
          onClick={handleOpenSaveModal}
          className={`${recipeMastheadActionClass} bg-transparent`}
          data-testid="recipe-header-save-action"
        >
          Save
        </button>
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
          onClick={handleShare}
          className={`${recipeMastheadActionClass} bg-transparent`}
          data-testid="recipe-header-share-action"
        >
          Share
        </button>
        {isOwner ? (
          <Link
            href={`/recipes/${recipe.id}/edit`}
            className={recipeMastheadActionClass}
            data-testid="recipe-header-edit-action"
          >
            Edit
          </Link>
        ) : null}
        {isAuthenticated ? (
          <button
            type="button"
            onClick={() => setIsSpoonDialogOpen(true)}
            className={`${recipeMastheadActionClass} bg-transparent`}
            data-testid="recipe-header-log-cook-action"
          >
            Log cook
          </button>
        ) : (
          <Link
            href={loginRedirect}
            className={recipeMastheadActionClass}
            data-testid="recipe-header-log-cook-action"
          >
            Log cook
          </Link>
        )}
        {!isOwner && (
          isAuthenticated ? (
            <ForkRecipeButton
              recipeId={recipe.id}
              recipeTitle={recipe.title}
              sourceChefUsername={recipe.chef.username}
              isOwner={false}
              triggerClassName={recipeMastheadActionClass}
              triggerStyle="text"
              triggerTestId="recipe-header-fork-action"
            />
          ) : (
            <Link
              href={loginRedirect}
              className={recipeMastheadActionClass}
              data-testid="recipe-header-fork-action"
            >
              Fork
            </Link>
          )
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

  // The tab bar is hidden in cook mode so it never covers the step controls.
  useDockSuppressed(showOwnerTools || (isCookMode && recipe.steps.length > 0));

  // Timers live here, above cook mode's step view, so changing step or leaving cook mode keeps them.
  const cookTimerSteps = useMemo(
    () => recipe.steps.map((step) => ({ stepNum: step.stepNum, label: step.stepTitle ?? "", durationMinutes: step.duration })),
    [recipe.steps],
  );
  const cookTimers = useCookTimers(recipe.id, cookTimerSteps);
  useScreenWakeLock(isCookMode && recipe.steps.length > 0);

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

  // A refused "Create & Save" (a title the user already has) shows its error under the field.
  useEffect(() => {
    const result = createCookbookFetcher.data as { intent?: unknown; error?: unknown } | undefined;
    if (result?.intent === "createCookbookAndSave" && typeof result.error === "string") {
      setCreateCookbookError(result.error);
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

  if (isCookMode && recipe.steps.length > 0) {
    return (
      <CookModePanel
        recipeTitle={recipe.title}
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
        onStepSelect={(index) => setActiveCookStepIndex(index)}
        onExit={handleExitCookMode}
        timers={cookTimers}
        onGoToStepNum={(stepNum) => {
          // The tray only lists this recipe's steps, so the step is always found.
          setActiveCookStepIndex(Math.max(0, recipe.steps.findIndex((candidate) => candidate.stepNum === stepNum)));
        }}
      />
    );
  }

  return (
    <div className="sj-page pb-24">
      {cookTimers.active.length > 0 ? (
        <div className="sticky top-0 z-20 bg-[var(--sj-page)]">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <CookTimerTray controller={cookTimers} />
          </div>
        </div>
      ) : (
        <CookTimerTray controller={cookTimers} />
      )}
      {/* Recipe Header with prominent image */}
      <RecipeHeader
        title={recipe.title}
        description={recipe.description ?? undefined}
        chefName={recipe.chef.username}
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
        // Only offered when there is something to clear (product audit 2026-10-09, finding 15).
        onClearProgress={cookProgressChecked > 0 ? handleClearProgress : undefined}
        progressSyncStatus={cookSyncStatus}
        masthead={headerMasthead}
        provenance={headerProvenance}
      />

      {/* Owner recipe management */}
      {isOwner && (
        <div className="print:hidden" data-testid="recipe-owner-tools">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 border-b border-[var(--sj-border)] bg-transparent py-3 text-left font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
              aria-expanded={showOwnerTools}
              aria-controls="recipe-owner-maintenance"
              onClick={() => setShowOwnerTools((visible) => !visible)}
            >
              <span>Manage recipe</span>
              <span className="text-[var(--sj-ink)]">{showOwnerTools ? "Close" : "Open +"}</span>
            </button>

            {showOwnerTools ? (
              <div id="recipe-owner-maintenance" className="border-b border-[var(--sj-border)] py-5">
                <div className="flex flex-wrap gap-3">
                  <Button href={`/recipes/${recipe.id}/edit`} plain>
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
                    plain
                    className="text-[var(--sj-tomato)] hover:text-[var(--sj-tomato)]"
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
            ) : null}
          </div>
        </div>
      )}

      <SpoonDialog
        isOpen={isSpoonDialogOpen}
        onClose={() => setIsSpoonDialogOpen(false)}
        actionUrl={`/recipes/${recipe.id}`}
        isOriginCookCandidate={isOriginCookCandidate}
        coverPromptMode={coverPromptMode}
      />

      {/* Save to Cookbook Modal (Bottom Sheet) */}
      <Dialog
        open={isSaveModalOpen}
        onClose={setIsSaveModalOpen}
        initialFocus={saveModalTitleRef}
        autoFocus={false}
        size="md"
        className="mb-24 max-h-[calc(100dvh-7.5rem)] overflow-hidden !rounded-[var(--sj-radius-surface)] !shadow-[var(--sj-shadow)] pb-[max(0.75rem,env(safe-area-inset-bottom))] data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in data-leave:data-closed:translate-y-4 sm:mb-auto sm:max-h-[calc(100dvh-4rem)] sm:data-leave:data-closed:translate-y-1"
      >
        <div className="flex max-h-full flex-col" data-testid="save-modal">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle ref={saveModalTitleRef} tabIndex={-1}>Save to Cookbook</DialogTitle>
            {/* Escape and a tap outside also close it; this is the visible, touch-sized way. */}
            <button
              type="button"
              aria-label="Close"
              onClick={() => setIsSaveModalOpen(false)}
              className="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
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
                  onChange={(event) => {
                    setNewCookbookTitle(event.target.value);
                    setCreateCookbookError(null);
                  }}
                  invalid={createCookbookError ? true : undefined}
                  data-testid="new-cookbook-input"
                />
              </Field>
              <ValidationError error={createCookbookError} />
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
        <DialogTitle>{`Delete "${recipe.title}"?`}</DialogTitle>
        <DialogDescription>
          It will be removed from your kitchen and your cookbooks, and links to it will stop working. You can't undo this.
        </DialogDescription>
        <DialogActions>
          <Button plain onClick={() => setIsDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete}>
            Delete
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
          <div className="mt-6 border-y border-[var(--sj-border)] sm:mt-0">
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
          <SpoonsStrip
            spoons={spoons}
            now={renderedAt}
            emptyAction={
              isAuthenticated ? (
                <Button type="button" plain onClick={() => setIsSpoonDialogOpen(true)}>
                  Log the first cook
                </Button>
              ) : (
                <Button href={loginRedirect} plain>
                  Log the first cook
                </Button>
              )
            }
          />
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
  recipeTitle,
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
  onStepSelect,
  onExit,
  timers,
  onGoToStepNum,
}: {
  recipeTitle: string;
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
  onStepSelect: (index: number) => void;
  onExit: () => void;
  timers: CookTimersController;
  onGoToStepNum: (stepNum: number) => void;
}) {
  const stepTitle = step.stepTitle ?? `Step ${step.stepNum}`;
  const recipeProgressLabel = progressTotal > 0
    ? `${progressChecked} of ${progressTotal} checked`
    : "No checklist items";
  const pageProgressTotal = ingredients.length + stepOutputUses.length;
  const pageProgressChecked =
    ingredients.filter((ingredient) => checkedIngredientIds.has(ingredient.id)).length +
    stepOutputUses.filter((reference) => checkedStepOutputIds.has(reference.id)).length;
  const pageProgressLabel = pageProgressTotal > 0
    ? `${pageProgressChecked} of ${pageProgressTotal} checked`
    : "No checklist items";
  const isFirstStep = activeStepIndex === 0;
  const isLastStep = activeStepIndex >= stepCount - 1;
  const pageLabel = `Step ${activeStepIndex + 1} of ${stepCount}`;

  return (
    <section
      id="cook"
      data-testid="cook-mode-panel"
      className="h-[100svh] overflow-hidden bg-[var(--sj-page)] text-[var(--sj-ink)]"
      aria-labelledby="cook-mode-heading"
    >
      <div className="mx-auto flex h-[100svh] w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b border-[var(--sj-border)] py-4">
          <div className="min-w-0">
            <p className="sj-eyebrow">Now cooking</p>
            {/* Cook mode replaces the whole page (see the early return above), so this
                promotes the recipe title to the page's `h1` instead of adding a second,
                visually redundant one. */}
            <h1 className="font-sj-ui mt-1 truncate text-sm font-semibold text-[var(--sj-ink-soft)]">
              {recipeTitle}
            </h1>
            <p className="font-sj-ui mt-1 text-xs uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              {recipeProgressLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className={recipeMastheadActionClass}
          >
            Exit cook mode
          </button>
        </header>

        <CookTimerTray controller={timers} currentStepNum={step.stepNum} onGoToStep={onGoToStepNum} />

        <div
          data-testid="cook-mode-pager"
          className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto py-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-stretch lg:gap-12 lg:py-10"
        >
          <article
            key={step.stepNum}
            className="flex shrink-0 flex-col border-y border-[var(--sj-border-strong)] py-8 sm:py-10 lg:min-h-0 lg:shrink lg:justify-center lg:py-12"
          >
            <p className="font-sj-ui m-0 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">
              {pageLabel}
            </p>
            <Heading
              id="cook-mode-heading"
              level={2}
              className="font-sj-display mt-5 max-w-4xl text-4xl/10 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-6xl/15 lg:text-7xl/18"
            >
              {stepTitle}
            </Heading>
            <Text className="mt-7 max-w-3xl whitespace-pre-wrap text-xl/9 text-[var(--sj-ink)] sm:text-2xl/10">
              {step.description}
            </Text>
            <CookStepTimer stepNum={step.stepNum} controller={timers} />
          </article>

          {/* A <div>, not <aside>: this ingredient checklist and scale selector are core
              cook-mode controls for the current step, not tangential "complementary"
              content, and root.tsx always wraps route content in a <main> landmark, so an
              <aside> here would violate landmark-complementary-is-top-level. */}
          <div className="mx-auto flex w-full max-w-[38rem] shrink-0 flex-col justify-between gap-8 border-y border-[var(--sj-border)] py-6 lg:min-h-0 lg:shrink lg:py-8">
            <div>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                    On this page
                  </p>
                  <p className="font-sj-ui mt-2 text-xs uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                    {pageProgressLabel}
                  </p>
                </div>
                <p className="font-sj-display text-3xl/8 font-semibold tabular-nums text-[var(--sj-ink)]">
                  {activeStepIndex + 1}/{stepCount}
                </p>
              </div>

              {(ingredients.length > 0 || stepOutputUses.length > 0) ? (
                <div className="mt-6">
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
              ) : (
                <p className="font-sj-body mt-6 text-base text-[var(--sj-ink-soft)]">
                  No ingredients to check on this step.
                </p>
              )}
            </div>

            <div className="mx-auto w-full max-w-[24rem]">
              <ScaleSelector value={scaleFactor} onChange={onScaleChange} />
            </div>
          </div>
        </div>

        <footer className="z-10 shrink-0 border-t border-[var(--sj-border)] bg-[var(--sj-page)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <Button
              type="button"
              plain
              aria-label="Previous step"
              disabled={isFirstStep}
              onClick={onPrevious}
              className="justify-self-start"
            >
              <ChevronLeft data-slot="icon" aria-hidden="true" />
              <span className="hidden sm:inline">Previous step</span>
              <span className="sm:hidden">Prev</span>
            </Button>
            <nav
              aria-label="Cook steps"
              className="hidden items-center gap-2 sm:flex"
            >
              {Array.from({ length: stepCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => onStepSelect(index)}
                  aria-label={`Step ${index + 1}${index === activeStepIndex ? " current" : ""}`}
                  aria-current={index === activeStepIndex ? "step" : undefined}
                  className="group grid size-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
                >
                  <span
                    aria-hidden="true"
                    className={`size-2.5 rounded-full transition ${
                      index === activeStepIndex
                        ? "bg-[var(--sj-ink)]"
                        : "bg-[var(--sj-border-strong)] group-hover:bg-[var(--sj-ink-soft)]"
                    }`}
                  />
                </button>
              ))}
            </nav>
            <Button
              type="button"
              aria-label="Next step"
              disabled={isLastStep}
              onClick={onNext}
              className="justify-self-end"
            >
              <span className="hidden sm:inline">Next step</span>
              <span className="sm:hidden">Next</span>
              <ChevronRight data-slot="icon" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
