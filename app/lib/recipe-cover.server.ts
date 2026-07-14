import type { PrismaClient, RecipeCover } from "@prisma/client";
import {
  touchNativeSyncCookbooksForRecipe,
  touchNativeSyncCookbooksForRecipeOperation,
} from "~/lib/native-sync-invalidation.server";

export type RecipeCoverSourceType = "ai-placeholder" | "import" | "chef-upload" | "spoon";
export type RecipeCoverVariant = "image" | "stylized";
export type RecipeCoverMode = "auto" | "manual" | "none";
export type RecipeCoverStatus = "processing" | "ready" | "failed" | "archived";
export type RecipeCoverGenerationStatus = "none" | "processing" | "succeeded" | "failed";

const COVER_SOURCE_TYPES = ["ai-placeholder", "import", "chef-upload", "spoon"] as const;
const COVER_VARIANTS = ["image", "stylized"] as const;
const COVER_MODES = ["auto", "manual", "none"] as const;
const COVER_STATUSES = ["processing", "ready", "failed", "archived"] as const;
const COVER_GENERATION_STATUSES = ["none", "processing", "succeeded", "failed"] as const;

export const RECIPE_COVER_DISPLAY_SELECT = {
  id: true,
  recipeId: true,
  imageUrl: true,
  stylizedImageUrl: true,
  sourceType: true,
  sourceSpoonId: true,
  status: true,
  createdById: true,
  sourceImageUrl: true,
  generationStatus: true,
  failureReason: true,
  promptVersion: true,
  styleVersion: true,
  promptAddition: true,
  parentCoverId: true,
  archivedAt: true,
  createdAt: true,
} satisfies Record<keyof RecipeCover, true>;

export interface CreateCoverInput {
  recipeId: string;
  imageUrl: string;
  stylizedImageUrl?: string | null;
  sourceType: RecipeCoverSourceType;
  sourceSpoonId?: string | null;
  status?: RecipeCoverStatus;
  createdById?: string | null;
  sourceImageUrl?: string | null;
  generationStatus?: RecipeCoverGenerationStatus;
  failureReason?: string | null;
  promptVersion?: string | null;
  styleVersion?: string | null;
  promptAddition?: string | null;
  parentCoverId?: string | null;
  archivedAt?: Date | null;
}

export interface RecipeIdentity {
  id: string;
  title: string;
  activeCoverId?: string | null;
  activeCoverVariant?: RecipeCoverVariant | string | null;
  coverMode?: RecipeCoverMode | string | null;
}

export interface ActiveCoverInput {
  recipeId: string;
  coverId: string;
  variant: RecipeCoverVariant;
}

export interface ArchiveCoverInput {
  recipeId: string;
  coverId: string;
  replacementCoverId?: string | null;
  replacementVariant?: RecipeCoverVariant | null;
  confirmNoCover?: boolean;
}

export interface RecipeCoverDisplay {
  coverId: string;
  imageUrl: string;
  displayUrl: string;
  activeVariant: RecipeCoverVariant;
  sourceType: string;
  provenanceLabel: string;
  status: string;
  generationStatus: string;
  cover: RecipeCover;
}

export async function createCover(
  db: PrismaClient,
  input: CreateCoverInput,
): Promise<RecipeCover> {
  assertSourceType(input.sourceType);
  const status = input.status ?? "ready";
  assertCoverStatus(status);
  const generationStatus = input.generationStatus ?? "none";
  assertGenerationStatus(generationStatus);

  return db.recipeCover.create({
    data: {
      recipeId: input.recipeId,
      imageUrl: input.imageUrl,
      stylizedImageUrl: input.stylizedImageUrl ?? null,
      sourceType: input.sourceType,
      sourceSpoonId: input.sourceSpoonId ?? null,
      status,
      createdById: input.createdById ?? null,
      sourceImageUrl: input.sourceImageUrl ?? null,
      generationStatus,
      failureReason: input.failureReason ?? null,
      promptVersion: input.promptVersion ?? null,
      styleVersion: input.styleVersion ?? null,
      promptAddition: input.promptAddition ?? null,
      parentCoverId: input.parentCoverId ?? null,
      archivedAt: input.archivedAt ?? null,
    },
  });
}

export async function listCoversForRecipe(
  db: PrismaClient,
  recipeId: string,
): Promise<RecipeCover[]> {
  return db.recipeCover.findMany({
    where: { recipeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getCurrentCover(
  db: PrismaClient,
  recipeId: string,
): Promise<RecipeCover | null> {
  return getActiveRecipeCover(db, recipeId);
}

export async function getActiveRecipeCover(
  db: PrismaClient,
  recipeId: string,
): Promise<RecipeCover | null> {
  const recipe = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { activeCoverId: true },
  });
  if (!recipe?.activeCoverId) return null;
  return db.recipeCover.findFirst({
    where: {
      id: recipe.activeCoverId,
      recipeId,
      status: { not: "archived" },
      archivedAt: null,
    },
  });
}

export function getRecipeCoverImageUrl(
  recipe: RecipeIdentity,
  covers: RecipeCover[],
  overrideVariant?: RecipeCoverVariant,
): string | null {
  return getRecipeCoverDisplay(recipe, covers, overrideVariant)?.displayUrl ?? null;
}

export function getScopedActiveCover(recipe: { id: string; activeCover?: RecipeCover | null }): RecipeCover | null {
  return recipe.activeCover?.recipeId === recipe.id ? recipe.activeCover : null;
}

export function recipeCoverCacheSnapshot(cover: RecipeCover | null) {
  if (!cover) return null;
  return {
    id: cover.id,
    recipeId: cover.recipeId,
    imageUrl: cover.imageUrl,
    stylizedImageUrl: cover.stylizedImageUrl,
    sourceType: cover.sourceType,
    sourceSpoonId: cover.sourceSpoonId,
    status: cover.status,
    createdById: cover.createdById,
    sourceImageUrl: cover.sourceImageUrl,
    generationStatus: cover.generationStatus,
    failureReason: cover.failureReason,
    promptVersion: cover.promptVersion,
    styleVersion: cover.styleVersion,
    promptAddition: cover.promptAddition,
    parentCoverId: cover.parentCoverId,
    archivedAt: cover.archivedAt?.toISOString() ?? null,
    createdAt: cover.createdAt.toISOString(),
  };
}

export function getRecipeCoverDisplay(
  recipe: RecipeIdentity,
  covers: RecipeCover[],
  overrideVariant?: RecipeCoverVariant,
): RecipeCoverDisplay | null {
  const coverMode = normalizeCoverMode(recipe.coverMode);
  if ((recipe.coverMode != null && !coverMode) || coverMode === "none" || !recipe.activeCoverId) {
    return null;
  }
  const cover = covers.find((item) => item.id === recipe.activeCoverId);
  if (!cover || cover.archivedAt) return null;
  const status = normalizeCoverStatus(cover.status);
  if (!status || status === "archived" || status === "failed") return null;

  if (overrideVariant != null && !normalizeVariant(overrideVariant)) return null;
  if (overrideVariant == null && recipe.activeCoverVariant != null && !normalizeVariant(recipe.activeCoverVariant)) {
    return null;
  }

  const selectedVariant = normalizeVariant(overrideVariant ?? recipe.activeCoverVariant);
  if (selectedVariant) {
    return displayForVariant(cover, selectedVariant);
  }
  if (cover.status === "processing" && hasNonEmptyUrl(cover.imageUrl)) {
    return buildDisplay(cover, "image", cover.imageUrl);
  }
  const fallbackVariant = preferredVariant(cover);
  return fallbackVariant ? displayForVariant(cover, fallbackVariant) : null;
}

export async function setActiveRecipeCover(
  db: PrismaClient,
  input: ActiveCoverInput,
) {
  assertCoverVariant(input.variant);
  const cover = await db.recipeCover.findFirst({
    where: { id: input.coverId, recipeId: input.recipeId },
  });
  if (!cover) throw new Error("Selected cover was not found");
  assertActivatableCover(cover);
  assertVariantAvailable(cover, input.variant);

  const updatedAt = new Date();
  const [recipe] = await db.$transaction([
    db.recipe.update({
      where: { id: input.recipeId },
      data: {
        activeCoverId: cover.id,
        activeCoverVariant: input.variant,
        coverMode: "manual",
        updatedAt,
      },
    }),
    touchNativeSyncCookbooksForRecipeOperation(db, input.recipeId, updatedAt),
  ]);
  return recipe;
}

export async function clearActiveRecipeCover(
  db: PrismaClient,
  recipeId: string,
) {
  const updatedAt = new Date();
  const [recipe] = await db.$transaction([
    db.recipe.update({
      where: { id: recipeId },
      data: {
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "none",
        updatedAt,
      },
    }),
    touchNativeSyncCookbooksForRecipeOperation(db, recipeId, updatedAt),
  ]);
  return recipe;
}

export async function archiveRecipeCover(
  db: PrismaClient,
  input: ArchiveCoverInput,
) {
  const [recipe, cover] = await Promise.all([
    db.recipe.findUniqueOrThrow({ where: { id: input.recipeId } }),
    db.recipeCover.findFirst({
      where: { id: input.coverId, recipeId: input.recipeId },
    }),
  ]);
  if (!cover) throw new Error("Cover was not found");

  const isActiveCover = recipe.activeCoverId === cover.id;
  if (isActiveCover && !input.confirmNoCover && !input.replacementCoverId) {
    throw new Error("Archiving the active cover requires a replacement or confirmNoCover");
  }
  if (isActiveCover && input.replacementCoverId === cover.id) {
    throw new Error("Replacement cover must be different from the archived cover");
  }

  let nextRecipe = recipe;
  if (isActiveCover && input.confirmNoCover) {
    nextRecipe = await clearActiveRecipeCover(db, input.recipeId);
  } else if (isActiveCover && input.replacementCoverId) {
    if (!input.replacementVariant) {
      throw new Error("Replacement variant is required");
    }
    nextRecipe = await setActiveRecipeCover(db, {
      recipeId: input.recipeId,
      coverId: input.replacementCoverId,
      variant: input.replacementVariant,
    });
  }

  const archivedCover = await db.recipeCover.update({
    where: { id: cover.id },
    data: { status: "archived", archivedAt: new Date() },
  });
  if (isActiveCover) {
    await touchNativeSyncCookbooksForRecipe(db, input.recipeId);
  }
  return { archivedCover, recipe: nextRecipe };
}

export async function backfillActiveCoverForRecipe(
  db: PrismaClient,
  recipeId: string,
) {
  const covers = await db.recipeCover.findMany({
    where: { recipeId, status: "ready", archivedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const winner = covers.find((cover) => preferredVariant(cover) !== null);
  if (!winner) {
    return db.recipe.update({
      where: { id: recipeId },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "auto" },
    });
  }
  return db.recipe.update({
    where: { id: recipeId },
    data: {
      activeCoverId: winner.id,
      activeCoverVariant: preferredVariant(winner),
      coverMode: "auto",
    },
  });
}

function normalizeVariant(value: string | null | undefined): RecipeCoverVariant | null {
  return isOneOf(value, COVER_VARIANTS) ? value : null;
}

function normalizeCoverMode(value: string | null | undefined): RecipeCoverMode | null {
  if (value == null) return "auto";
  return isOneOf(value, COVER_MODES) ? value : null;
}

function normalizeCoverStatus(value: string | null | undefined): RecipeCoverStatus | null {
  return isOneOf(value, COVER_STATUSES) ? value : null;
}

function isOneOf<T extends string>(
  value: string | null | undefined,
  options: readonly T[],
): value is T {
  return options.includes(value as T);
}

function hasNonEmptyUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function preferredVariant(cover: RecipeCover): RecipeCoverVariant | null {
  if (hasNonEmptyUrl(cover.stylizedImageUrl)) return "stylized";
  if (hasNonEmptyUrl(cover.imageUrl)) return "image";
  return null;
}

function displayForVariant(
  cover: RecipeCover,
  variant: RecipeCoverVariant,
): RecipeCoverDisplay | null {
  const imageUrl = variant === "stylized" ? cover.stylizedImageUrl : cover.imageUrl;
  if (!hasNonEmptyUrl(imageUrl)) return null;
  return buildDisplay(cover, variant, imageUrl);
}

function buildDisplay(
  cover: RecipeCover,
  variant: RecipeCoverVariant,
  imageUrl: string,
): RecipeCoverDisplay {
  return {
    coverId: cover.id,
    imageUrl,
    displayUrl: imageUrl,
    activeVariant: variant,
    sourceType: cover.sourceType,
    provenanceLabel: provenanceLabel(cover.sourceType, variant),
    status: cover.status,
    generationStatus: cover.generationStatus,
    cover,
  };
}

export function getRecipeCoverProvenanceLabel(
  sourceType: string,
  variant: RecipeCoverVariant,
): string {
  return provenanceLabel(sourceType, variant);
}

function provenanceLabel(sourceType: string, variant: RecipeCoverVariant): string {
  if ((sourceType === "chef-upload" || sourceType === "spoon") && variant === "stylized") {
    return "Editorialized chef photo";
  }
  if (sourceType === "chef-upload" || sourceType === "spoon") return "Chef photo";
  if (sourceType === "import") return "Imported photo";
  if (sourceType === "ai-placeholder") return "AI generated";
  return "Unknown source";
}

function assertActivatableCover(cover: RecipeCover): void {
  const status = normalizeCoverStatus(cover.status);
  if (!status) {
    throw new Error("Cannot activate a cover with invalid status");
  }
  if (cover.status === "archived" || cover.archivedAt) {
    throw new Error("Cannot activate an archived cover");
  }
  if (cover.status === "failed") {
    throw new Error("Cannot activate a failed cover");
  }
}

function assertVariantAvailable(cover: RecipeCover, variant: RecipeCoverVariant): void {
  if (!displayForVariant(cover, variant)) {
    throw new Error("Selected cover variant is unavailable");
  }
}

function assertSourceType(sourceType: string): asserts sourceType is RecipeCoverSourceType {
  if (!isOneOf(sourceType, COVER_SOURCE_TYPES)) {
    throw new Error("Invalid cover source type");
  }
}

function assertCoverStatus(status: string): asserts status is RecipeCoverStatus {
  if (!isOneOf(status, COVER_STATUSES)) {
    throw new Error("Invalid cover status");
  }
}

function assertGenerationStatus(status: string): asserts status is RecipeCoverGenerationStatus {
  if (!isOneOf(status, COVER_GENERATION_STATUSES)) {
    throw new Error("Invalid cover generation status");
  }
}

function assertCoverVariant(variant: string): asserts variant is RecipeCoverVariant {
  if (!isOneOf(variant, COVER_VARIANTS)) {
    throw new Error("Invalid cover variant");
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function makeFallbackPlaceholderSvg(title: string): {
  url: string;
  bytes: Uint8Array;
} {
  const safeTitle = xmlEscape(title);
  const accessibleTitle = safeTitle || "Recipe placeholder";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid slice">` +
    `<title>${accessibleTitle}</title>` +
    `<rect width="1024" height="1024" fill="#fbfaf4"/>` +
    `<circle cx="512" cy="512" r="238" fill="#4b91dc"/>` +
    `<path d="M342 492c10-91 80-156 170-156s160 65 170 156v67c0 96-77 173-170 173s-170-77-170-173v-67z" fill="#ffd94f"/>` +
    `<path d="M333 383c-42-6-75-42-75-86 0-48 39-87 87-87 12 0 24 3 35 7 22-56 77-96 141-96 75 0 137 54 149 125 11-5 23-8 36-8 48 0 87 39 87 87s-39 87-87 87H333z" fill="#fffefa"/>` +
    `<circle cx="426" cy="492" r="34" fill="#28231d"/>` +
    `<circle cx="598" cy="492" r="34" fill="#28231d"/>` +
    `<circle cx="416" cy="481" r="9" fill="#fffefa"/>` +
    `<circle cx="588" cy="481" r="9" fill="#fffefa"/>` +
    `<path d="M316 642c42 54 103 82 196 82s154-28 196-82c-52 28-112 33-196 33s-144-5-196-33z" fill="#28231d"/>` +
    `<path d="M392 620c34-72 88-66 120-18 32-48 86-54 120 18-54 24-89 10-120-20-31 30-66 44-120 20z" fill="#28231d"/>` +
    `<circle cx="512" cy="512" r="248" fill="none" stroke="#28231d" stroke-opacity=".18" stroke-width="12"/>` +
    `</svg>`;
  const bytes = new TextEncoder().encode(svg);
  const base64 = Buffer.from(bytes).toString("base64");
  return { url: `data:image/svg+xml;base64,${base64}`, bytes };
}
