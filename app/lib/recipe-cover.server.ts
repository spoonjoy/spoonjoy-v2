import type { PrismaClient, RecipeCover } from "@prisma/client";
import { d1DateTime, d1NullableDateTime, d1ReadBatch, type D1Query, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, retryOnD1GuardFailure } from "~/lib/d1-write.server";
import { cookbooksForRecipeTouchStatement, recipeUpdateStatement } from "~/lib/recipe-d1-writes.server";
import {
  touchNativeSyncCookbooksForRecipe,
  touchNativeSyncCookbooksForRecipeOperation,
} from "~/lib/native-sync-invalidation.server";
import {
  assertRecipeCoverGenerationStatus as assertGenerationStatus,
  assertRecipeCoverSourceType as assertSourceType,
  assertRecipeCoverStatus as assertCoverStatus,
  assertRecipeCoverVariant as assertCoverVariant,
  normalizeRecipeCoverMode as normalizeCoverMode,
  normalizeRecipeCoverStatus as normalizeCoverStatus,
  normalizeRecipeCoverVariant as normalizeVariant,
  type RecipeCoverGenerationStatus,
  type RecipeCoverMode,
  type RecipeCoverSourceType,
  type RecipeCoverStatus,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover-schema.server";

export type {
  RecipeCoverGenerationStatus,
  RecipeCoverMode,
  RecipeCoverSourceType,
  RecipeCoverStatus,
  RecipeCoverVariant,
} from "~/lib/recipe-cover-schema.server";

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
  generationStartedAt: true,
  failureReason: true,
  promptVersion: true,
  styleVersion: true,
  promptAddition: true,
  parentCoverId: true,
  archivedAt: true,
  createdAt: true,
} satisfies Record<keyof RecipeCover, true>;

export interface CreateCoverInput {
  id?: string;
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

function coverCreateData(input: CreateCoverInput) {
  assertSourceType(input.sourceType);
  const status = input.status ?? "ready";
  assertCoverStatus(status);
  const generationStatus = input.generationStatus ?? "none";
  assertGenerationStatus(generationStatus);

  return {
    id: input.id,
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
  };
}

export async function createCover(
  db: PrismaClient,
  input: CreateCoverInput,
): Promise<RecipeCover> {
  return db.recipeCover.create({ data: coverCreateData(input) });
}

/** `createCover` as a D1 statement for a write batch, with the same checks. */
export function coverInsertStatement(input: CreateCoverInput & { id: string }, now: Date): D1Query {
  const data = coverCreateData(input);
  return [
    `INSERT INTO "RecipeCover" (
       "id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "sourceSpoonId", "status", "createdById",
       "sourceImageUrl", "generationStatus", "failureReason", "promptVersion", "styleVersion", "promptAddition",
       "parentCoverId", "archivedAt", "createdAt"
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    data.recipeId,
    data.imageUrl,
    data.stylizedImageUrl,
    data.sourceType,
    data.sourceSpoonId,
    data.status,
    data.createdById,
    data.sourceImageUrl,
    data.generationStatus,
    data.failureReason,
    data.promptVersion,
    data.styleVersion,
    data.promptAddition,
    data.parentCoverId,
    data.archivedAt && d1Timestamp(data.archivedAt),
    d1Timestamp(now),
  ];
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

/** Finds one of the recipe's covers, by Prisma or on D1. */
type CoverLookup = (recipeId: string, coverId: string) => Promise<RecipeCover | null>;

function prismaCoverLookup(db: PrismaClient): CoverLookup {
  return (recipeId, coverId) => db.recipeCover.findFirst({ where: { id: coverId, recipeId } });
}

const RECIPE_COVER_COLUMNS = [
  "id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "sourceSpoonId", "status", "createdById",
  "sourceImageUrl", "generationStatus", "generationStartedAt", "failureReason", "promptVersion", "styleVersion",
  "promptAddition", "parentCoverId", "archivedAt", "createdAt",
].map((column) => `"${column}"`).join(", ");

function recipeCoverFromD1Row(row: D1Row): RecipeCover {
  return {
    ...(row as unknown as RecipeCover),
    generationStartedAt: d1NullableDateTime(row.generationStartedAt, "generationStartedAt"),
    archivedAt: d1NullableDateTime(row.archivedAt, "archivedAt"),
    createdAt: d1DateTime(row.createdAt, "createdAt"),
  };
}

function recipeCoverQuery(recipeId: string, coverId: string): D1Query {
  return [`SELECT ${RECIPE_COVER_COLUMNS} FROM "RecipeCover" WHERE "id" = ? AND "recipeId" = ?`, coverId, recipeId];
}

function d1CoverLookup(d1: D1ReadDatabase): CoverLookup {
  return async (recipeId, coverId) => {
    const [rows] = await d1ReadBatch(d1, [recipeCoverQuery(recipeId, coverId)]);
    return rows[0] ? recipeCoverFromD1Row(rows[0]) : null;
  };
}

async function loadActivatableCover(findCover: CoverLookup, input: ActiveCoverInput): Promise<RecipeCover> {
  assertCoverVariant(input.variant);
  const cover = await findCover(input.recipeId, input.coverId);
  if (!cover) throw new Error("Selected cover was not found");
  assertActivatableCover(cover);
  assertVariantAvailable(cover, input.variant);
  return cover;
}

/**
 * Fails the batch unless the cover still has the state the activation checks read: same
 * status and URLs, not archived.
 */
function coverUnchangedGuard(cover: RecipeCover): D1Query {
  return d1Guard(
    `EXISTS (SELECT 1 FROM "RecipeCover" WHERE "id" = ? AND "recipeId" = ? AND "status" = ? AND "archivedAt" IS NULL
       AND "imageUrl" = ? AND "stylizedImageUrl" IS ?)`,
    cover.id,
    cover.recipeId,
    cover.status,
    cover.imageUrl,
    cover.stylizedImageUrl,
  );
}

/**
 * Runs a cover write whose D1 batch re-checks what it read. When another request changed
 * the cover or the recipe's active cover in between, nothing applied and the write runs
 * again, so it throws the error its checks now give (for example "Cannot activate an
 * archived cover") or writes against the current rows.
 */
function withCoverRaceRetry<T>(attempt: () => Promise<T>): Promise<T> {
  return retryOnD1GuardFailure(attempt, () => {
    throw new Error("The recipe's covers changed while this request ran. Please try again.");
  });
}

/**
 * Makes a cover the recipe's active one and touches the cookbooks holding the recipe, reading
 * and writing only on D1: one atomic batch that re-checks the cover is still activatable.
 */
export function activateRecipeCoverOnD1(d1: D1ReadDatabase, input: ActiveCoverInput): Promise<void> {
  return withCoverRaceRetry(async () => {
    const cover = await loadActivatableCover(d1CoverLookup(d1), input);
    const updatedAt = new Date();
    await d1WriteBatch(d1, [
      coverUnchangedGuard(cover),
      recipeUpdateStatement(input.recipeId, {
        activeCoverId: cover.id,
        activeCoverVariant: input.variant,
        coverMode: "manual",
      }, updatedAt),
      cookbooksForRecipeTouchStatement(input.recipeId, updatedAt),
    ]);
  });
}

/**
 * Makes a cover the recipe's active one and touches the cookbooks holding the recipe. With a
 * D1 binding the two are one atomic batch that re-checks the cover is still activatable.
 */
export async function setActiveRecipeCover(
  db: PrismaClient,
  input: ActiveCoverInput,
  d1: D1ReadDatabase | null = null,
) {
  if (d1) {
    await activateRecipeCoverOnD1(d1, input);
    return db.recipe.findUniqueOrThrow({ where: { id: input.recipeId } });
  }

  const cover = await loadActivatableCover(prismaCoverLookup(db), input);
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

/** Clears the recipe's cover (no cover) and touches its cookbooks; one batch on D1. */
export async function clearActiveRecipeCover(
  db: PrismaClient,
  recipeId: string,
  d1: D1ReadDatabase | null = null,
) {
  const updatedAt = new Date();
  if (d1) {
    await d1WriteBatch(d1, [
      recipeUpdateStatement(recipeId, { activeCoverId: null, activeCoverVariant: null, coverMode: "none" }, updatedAt),
      cookbooksForRecipeTouchStatement(recipeId, updatedAt),
    ]);
    return db.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  }
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

async function loadArchive(db: PrismaClient, input: ArchiveCoverInput) {
  const [recipe, cover] = await Promise.all([
    db.recipe.findUniqueOrThrow({ where: { id: input.recipeId } }),
    db.recipeCover.findFirst({
      where: { id: input.coverId, recipeId: input.recipeId },
    }),
  ]);
  return { recipe, ...archiveDecision(input, recipe.activeCoverId, cover) };
}

/** Checks an archive request against the recipe's active cover and decides what it changes. */
function archiveDecision(input: ArchiveCoverInput, activeCoverId: string | null, cover: RecipeCover | null) {
  if (!cover) throw new Error("Cover was not found");

  const isActiveCover = activeCoverId === cover.id;
  if (isActiveCover && !input.confirmNoCover && !input.replacementCoverId) {
    throw new Error("Archiving the active cover requires a replacement or confirmNoCover");
  }
  if (isActiveCover && input.replacementCoverId === cover.id) {
    throw new Error("Replacement cover must be different from the archived cover");
  }
  if (isActiveCover && !input.confirmNoCover && !input.replacementVariant) {
    throw new Error("Replacement variant is required");
  }
  return { cover, isActiveCover };
}

/**
 * Archives a cover. Archiving the active cover first clears it (`confirmNoCover`) or makes
 * the replacement active. With a D1 binding the activation, the archive and the cookbook
 * touch are one atomic batch that re-checks the recipe's active cover and the replacement.
 */
export async function archiveRecipeCover(
  db: PrismaClient,
  input: ArchiveCoverInput,
  d1: D1ReadDatabase | null = null,
) {
  if (d1) {
    await archiveRecipeCoverOnD1(d1, input);
    const [archivedCover, recipe] = await Promise.all([
      db.recipeCover.findUniqueOrThrow({ where: { id: input.coverId } }),
      db.recipe.findUniqueOrThrow({ where: { id: input.recipeId } }),
    ]);
    return { archivedCover, recipe };
  }

  const { recipe, cover, isActiveCover } = await loadArchive(db, input);
  let nextRecipe = recipe;
  if (isActiveCover && input.confirmNoCover) {
    nextRecipe = await clearActiveRecipeCover(db, input.recipeId);
  } else if (isActiveCover) {
    nextRecipe = await setActiveRecipeCover(db, {
      recipeId: input.recipeId,
      coverId: input.replacementCoverId!,
      variant: input.replacementVariant!,
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

/**
 * Archives a cover as `archiveRecipeCover` does, reading and writing only on D1: the
 * activation, the archive and the cookbook touch are one atomic batch that re-checks the
 * recipe's active cover and the replacement.
 */
export function archiveRecipeCoverOnD1(d1: D1ReadDatabase, input: ArchiveCoverInput): Promise<void> {
  return withCoverRaceRetry(() => archiveRecipeCoverOnD1Attempt(d1, input));
}

async function archiveRecipeCoverOnD1Attempt(d1: D1ReadDatabase, input: ArchiveCoverInput): Promise<void> {
  // One read for the recipe, the cover and any replacement.
  const [recipeRows, coverRows, replacementRows = []] = await d1ReadBatch(d1, [
    [`SELECT "activeCoverId" FROM "Recipe" WHERE "id" = ?`, input.recipeId],
    recipeCoverQuery(input.recipeId, input.coverId),
    ...(input.replacementCoverId ? [recipeCoverQuery(input.recipeId, input.replacementCoverId)] : []),
  ]);
  const recipe = recipeRows[0];
  if (!recipe) throw new Error("Recipe was not found");
  const activeCoverId = recipe.activeCoverId as string | null;
  const { cover, isActiveCover } = archiveDecision(
    input,
    activeCoverId,
    coverRows[0] ? recipeCoverFromD1Row(coverRows[0]) : null,
  );
  const replacement = isActiveCover && !input.confirmNoCover
    ? await loadActivatableCover(async () => (replacementRows[0] ? recipeCoverFromD1Row(replacementRows[0]) : null), {
      recipeId: input.recipeId,
      coverId: input.replacementCoverId!,
      variant: input.replacementVariant!,
    })
    : null;
  const now = new Date();
  let activation: D1Query[] = [];
  if (replacement) {
    activation = [
      coverUnchangedGuard(replacement),
      recipeUpdateStatement(input.recipeId, {
        activeCoverId: replacement.id,
        activeCoverVariant: input.replacementVariant!,
        coverMode: "manual",
      }, now),
    ];
  } else if (isActiveCover) {
    activation = [
      recipeUpdateStatement(input.recipeId, { activeCoverId: null, activeCoverVariant: null, coverMode: "none" }, now),
    ];
  }
  await d1WriteBatch(d1, [
    // Whether the cover is the active one decided what to do; it must still be so.
    d1Guard(
      `EXISTS (SELECT 1 FROM "Recipe" WHERE "id" = ? AND "activeCoverId" IS ?)
       AND EXISTS (SELECT 1 FROM "RecipeCover" WHERE "id" = ?)`,
      input.recipeId,
      activeCoverId,
      cover.id,
    ),
    ...activation,
    [`UPDATE "RecipeCover" SET "status" = 'archived', "archivedAt" = ? WHERE "id" = ?`, d1Timestamp(now), cover.id],
    ...(isActiveCover ? [cookbooksForRecipeTouchStatement(input.recipeId, now)] : []),
  ]);
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
    return "Editorial photo";
  }
  if (sourceType === "chef-upload" || sourceType === "spoon") return "Original photo";
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
