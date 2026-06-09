export type CoverPromptMode = "none" | "first-photo" | "optional-update";

export interface ActiveCoverForSpoonDecision {
  id: string;
  recipeId: string;
  sourceType: string;
  status: string;
  archivedAt: Date | null;
  imageUrl: string | null;
  stylizedImageUrl: string | null;
}

export interface RecipeForSpoonCoverDecision {
  id: string;
  chefId: string;
  coverMode: string | null;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  activeCover: ActiveCoverForSpoonDecision | null;
}

export type SpoonCoverCreationDecision =
  | {
      shouldCreateCover: true;
      reason: "auto-seed";
      coverMode: "auto";
      activeCoverVariant: null;
    }
  | {
      shouldCreateCover: true;
      reason: "manual-opt-in";
      coverMode: "manual";
      activeCoverVariant: "image";
    }
  | {
      shouldCreateCover: false;
      reason: "no-photo" | "not-owner" | "not-requested";
    };

function hasNonEmptyUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function activeCoverHasDisplayUrl(recipe: {
  activeCoverVariant: string | null;
  activeCover: {
    imageUrl: string | null;
    stylizedImageUrl: string | null;
  };
}): boolean {
  const cover = recipe.activeCover;
  if (recipe.activeCoverVariant === "image") return hasNonEmptyUrl(cover.imageUrl);
  if (recipe.activeCoverVariant === "stylized") return hasNonEmptyUrl(cover.stylizedImageUrl);
  return hasNonEmptyUrl(cover.imageUrl) || hasNonEmptyUrl(cover.stylizedImageUrl);
}

export function hasActiveRealRecipeCover(recipe: {
  id: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  activeCover: ActiveCoverForSpoonDecision | null;
}): boolean {
  const cover = recipe.activeCover;
  if (!recipe.activeCoverId || !cover || cover.id !== recipe.activeCoverId) return false;
  if (cover.recipeId !== recipe.id || cover.status !== "ready" || cover.archivedAt) return false;
  if (cover.sourceType === "ai-placeholder") return false;
  return activeCoverHasDisplayUrl({
    activeCoverVariant: recipe.activeCoverVariant,
    activeCover: cover,
  });
}

export function getSpoonCoverPromptMode(input: {
  isOwner: boolean;
  isOriginCookCandidate: boolean;
  coverMode: string | null;
  hasActiveRealCover: boolean;
}): CoverPromptMode {
  if (!input.isOwner) return "none";
  if (input.isOriginCookCandidate && input.coverMode === "auto" && !input.hasActiveRealCover) {
    return "first-photo";
  }
  return "optional-update";
}

export function decideSpoonCoverCreation(input: {
  recipe: RecipeForSpoonCoverDecision;
  userId: string;
  isOriginCook: boolean;
  hasPhoto: boolean;
  useAsRecipeCover: boolean;
}): SpoonCoverCreationDecision {
  if (!input.hasPhoto) return { shouldCreateCover: false, reason: "no-photo" };
  if (input.recipe.chefId !== input.userId) {
    return { shouldCreateCover: false, reason: "not-owner" };
  }
  if (
    input.isOriginCook &&
    input.recipe.coverMode === "auto" &&
    !hasActiveRealRecipeCover(input.recipe)
  ) {
    return {
      shouldCreateCover: true,
      reason: "auto-seed",
      coverMode: "auto",
      activeCoverVariant: null,
    };
  }
  if (input.useAsRecipeCover) {
    return {
      shouldCreateCover: true,
      reason: "manual-opt-in",
      coverMode: "manual",
      activeCoverVariant: "image",
    };
  }
  return { shouldCreateCover: false, reason: "not-requested" };
}
