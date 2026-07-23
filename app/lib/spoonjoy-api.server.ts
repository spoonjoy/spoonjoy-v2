import type {
  Prisma,
  PrismaClient as PrismaClientType,
} from "@prisma/client";
import {
  ApiAuthError,
  assertCanUseOwnerEmail,
  createApiCredential,
  expandCredentialScopes,
  normalizeCredentialScopes,
  requireApiPrincipal,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import {
  completeIdempotencyKey,
  hashIdempotencyRequest,
  idempotencyClientKey,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import {
  pollAgentConnection,
  startAgentConnection,
} from "~/lib/agent-connection.server";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { applyRecipeScale, parseMcpRecipeScale } from "~/lib/recipe-scale";
import {
  archiveRecipeCover,
  clearActiveRecipeCover,
  createCover,
  getRecipeCoverDisplay,
  getRecipeCoverProvenanceLabel,
  setActiveRecipeCover,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";
import { uploadFoodImage } from "~/lib/image-upload-tools.server";
import { FOOD_IMAGE_TYPES } from "~/lib/recipe-image";
import { validateSpoonPhotoAssignment } from "~/lib/recipe-image-assignment.server";
import { normalizeSearchScope, searchSpoonjoy } from "~/lib/search.server";
import {
  createSpoon as createRecipeSpoon,
  deleteSpoon as deleteRecipeSpoon,
  isOriginCookCandidate,
  listSpoonsByChef,
  listSpoonsForRecipe,
  updateSpoon as updateRecipeSpoon,
  SpoonValidationError,
  SpoonAuthError,
  SpoonNotFoundError,
} from "~/lib/recipe-spoon.server";
import {
  activateRecipeCoverWithBestAvailableVariant,
  sanitizeRecipeCoverPromptAddition,
  scheduleRecipeCoverStylization,
  scheduleRecipePlaceholderGeneration,
  validateRecipeCoverImageSource,
} from "~/lib/recipe-cover-service.server";
import type { ImageGenEnv, ImageGenRunner } from "~/lib/image-gen.server";
import {
  resolvePostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";
import * as recipeImport from "~/lib/recipe-import.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import {
  notifySpoonOnMyRecipe,
  notifyForkOfMyRecipe,
  notifyCookbookSaveOfMine,
} from "~/lib/notification-triggers.server";
import { fanoutFellowChefOriginCook } from "~/lib/notification-fanout.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import {
  asCompatibleD1Database,
  coalesceShoppingRecipeIngredients,
  mutateAtomicShoppingListItem,
  runAtomicShoppingListBatch,
} from "~/lib/shopping-list-mutations.server";

export interface SpoonjoyApiContext {
  db: PrismaClientType;
  principal?: ApiPrincipal | null;
  defaultOwnerEmail?: string;
  allowOwnerEmailFallback?: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
  env?: (ImageGenEnv & { DB?: unknown; SPOONJOY_BASE_URL?: string } & VapidEnv & PostHogServerEnv) | null;
  bucket?: R2Bucket;
  imageGenRunner?: ImageGenRunner;
  allowLocalImageFallback?: boolean;
  logger?: Pick<Console, "error">;
}

export interface SpoonjoyApiOperationInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes?: readonly string[];
}

/**
 * MCP tool annotations (per the MCP `tools/list` spec). Connector directories
 * (Anthropic, OpenAI) require every tool to advertise a human `title` and the
 * applicable behavioral hints; missing/incorrect labels are a top rejection
 * cause. Hints follow the spec's meaning:
 *  - `readOnlyHint`: the tool does not modify any state.
 *  - `destructiveHint`: a write that may remove/overwrite existing data
 *    (only meaningful when `readOnlyHint` is false).
 *  - `idempotentHint`: repeating the call with the same args has no extra effect.
 *  - `openWorldHint`: the tool reaches outside Spoonjoy (e.g. fetches the web).
 */
export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A tool descriptor enriched with MCP annotations, as returned to clients. */
export interface SpoonjoyMcpToolDescriptor extends SpoonjoyApiOperationInfo {
  title: string;
  annotations: McpToolAnnotations;
}

interface SpoonjoyApiOperation extends SpoonjoyApiOperationInfo {
  handle(args: Record<string, unknown>, context: SpoonjoyApiContext): Promise<unknown>;
}

type Database = PrismaClientType | Prisma.TransactionClient;

type RecipeWithDetails = Prisma.RecipeGetPayload<{
  include: {
    chef: { select: { id: true; email: true; username: true } };
    covers: true;
    steps: {
      include: {
        ingredients: { include: { unit: true; ingredientRef: true } };
      };
    };
  };
}>;

type RecipeReadTag = {
  id: string;
  label: string;
  normalizedLabel: string;
};

type RecipeReadWithDetails = RecipeWithDetails & {
  tags: RecipeReadTag[];
};

type ShoppingListWithItems = Prisma.ShoppingListGetPayload<{
  include: {
    items: { include: { unit: true; ingredientRef: true } };
  };
}>;

type ApiCredentialRecord = Prisma.ApiCredentialGetPayload<{}>;

type CookbookWithRecipes = Prisma.CookbookGetPayload<{
  include: {
    author: { select: { id: true; email: true; username: true } };
    recipes: {
      include: {
        recipe: {
          include: {
            chef: { select: { id: true; email: true; username: true } };
            covers: true;
            steps: {
              include: {
                ingredients: { include: { unit: true; ingredientRef: true } };
              };
            };
          };
        };
      };
    };
  };
}>;

type CookbookSummaryBase = Prisma.CookbookGetPayload<{
  include: {
    author: { select: { id: true; email: true; username: true } };
  };
}>;

type CookbookSummaryRecipeRow = Prisma.RecipeInCookbookGetPayload<{
  include: {
    recipe: {
      include: {
        covers: true;
      };
    };
  };
}>;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const cookbookRecipeInclude = {
  author: { select: { id: true, email: true, username: true } },
  recipes: {
    orderBy: { createdAt: "desc" },
    include: {
      recipe: {
        include: {
          chef: { select: { id: true, email: true, username: true } },
          covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
          steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
        },
      },
    },
  },
} satisfies Prisma.CookbookInclude;

const cookbookSummaryInclude = {
  author: { select: { id: true, email: true, username: true } },
} satisfies Prisma.CookbookInclude;

const cookbookSummaryRecipeInclude = {
  recipe: {
    include: {
      covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  },
} satisfies Prisma.RecipeInCookbookInclude;

function json(value: unknown): unknown {
  return value;
}

const LEGACY_IMPORT_PERSISTED_RECIPE_FIELDS = [
  "id",
  "title",
  "description",
  "servings",
  "chefId",
  "deletedAt",
  "activeCoverId",
  "activeCoverVariant",
  "coverMode",
  "sourceRecipeId",
  "sourceUrl",
  "createdAt",
  "updatedAt",
  "chef",
  "covers",
  "steps",
] as const;

const LEGACY_IMPORT_DRAFT_FIELDS = [
  "title",
  "description",
  "servings",
  "ingredients",
  "steps",
  "imageUrl",
  "sourceUrl",
] as const;

const LEGACY_IMPORT_CHEF_FIELDS = ["id", "email", "username"] as const;

const LEGACY_IMPORT_COVER_FIELDS = [
  "id",
  "recipeId",
  "imageUrl",
  "stylizedImageUrl",
  "sourceType",
  "sourceSpoonId",
  "status",
  "createdById",
  "sourceImageUrl",
  "generationStatus",
  "failureReason",
  "promptVersion",
  "styleVersion",
  "promptAddition",
  "parentCoverId",
  "archivedAt",
  "createdAt",
] as const;

const LEGACY_IMPORT_STEP_FIELDS = [
  "id",
  "recipeId",
  "stepNum",
  "stepTitle",
  "description",
  "duration",
  "updatedAt",
  "ingredients",
] as const;

const LEGACY_IMPORT_INGREDIENT_FIELDS = [
  "id",
  "recipeId",
  "stepNum",
  "quantity",
  "unitId",
  "ingredientRefId",
  "updatedAt",
  "unit",
  "ingredientRef",
] as const;

const LEGACY_IMPORT_REFERENCE_FIELDS = ["id", "name", "updatedAt"] as const;

function projectKnownFields(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]]),
  );
}

function projectLegacyImportIngredient(value: unknown): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  const projected = projectKnownFields(value, LEGACY_IMPORT_INGREDIENT_FIELDS);
  projected.unit = projectKnownFields(source.unit, LEGACY_IMPORT_REFERENCE_FIELDS);
  projected.ingredientRef = projectKnownFields(
    source.ingredientRef,
    LEGACY_IMPORT_REFERENCE_FIELDS,
  );
  return projected;
}

function projectLegacyImportStep(value: unknown): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  const projected = projectKnownFields(value, LEGACY_IMPORT_STEP_FIELDS);
  projected.ingredients = (source.ingredients as unknown[]).map(
    projectLegacyImportIngredient,
  );
  return projected;
}

function projectLegacyImportRecipe(
  recipe: unknown,
  dryRun: boolean,
): Record<string, unknown> {
  const source = recipe as Record<string, unknown>;
  const fields = dryRun
    ? LEGACY_IMPORT_DRAFT_FIELDS
    : LEGACY_IMPORT_PERSISTED_RECIPE_FIELDS;
  const projected = projectKnownFields(source, fields);

  if (Object.prototype.hasOwnProperty.call(source, "chef")) {
    projected.chef = projectKnownFields(source.chef, LEGACY_IMPORT_CHEF_FIELDS);
  }
  if (Object.prototype.hasOwnProperty.call(source, "covers")) {
    projected.covers = (source.covers as unknown[]).map((cover) =>
      projectKnownFields(cover, LEGACY_IMPORT_COVER_FIELDS),
    );
  }
  if (Object.prototype.hasOwnProperty.call(source, "steps") && !dryRun) {
    projected.steps = (source.steps as unknown[]).map(projectLegacyImportStep);
  }

  return projected;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasArgument(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key);
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args[key]);
  if (!value) throw new ApiAuthError(`${key} is required`, 400);
  return value;
}

function optionalNullableStringArgument(args: Record<string, unknown>, key: string): string | null | undefined {
  if (!hasArgument(args, key)) return undefined;

  const value = args[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string or null`);

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalStringArgument(args: Record<string, unknown>, key: string): string | undefined {
  if (!hasArgument(args, key)) return undefined;
  const value = args[key];
  if (value === null) return undefined;
  if (typeof value !== "string") throw new ApiAuthError(`${key} must be a string`, 400);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalIsoDateArgument(args: Record<string, unknown>, key: string): Date | undefined {
  const raw = optionalStringArgument(args, key);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== raw) {
    throw new ApiAuthError(`${key} must be a valid ISO date string`, 400);
  }
  return date;
}

function optionalBooleanArgument(args: Record<string, unknown>, key: string, fallback = false): boolean {
  if (!hasArgument(args, key)) return fallback;
  const value = args[key];
  if (typeof value !== "boolean") throw new ApiAuthError(`${key} must be a boolean`, 400);
  return value;
}

function requiredCoverVariant(args: Record<string, unknown>, key: string): RecipeCoverVariant {
  const value = requiredString(args, key);
  if (value !== "image" && value !== "stylized") {
    throw new ApiAuthError(`${key} must be image or stylized`, 400);
  }
  return value;
}

function optionalCoverVariant(args: Record<string, unknown>, key: string): RecipeCoverVariant | null {
  if (!hasArgument(args, key)) return null;
  return requiredCoverVariant(args, key);
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function positiveNumber(value: unknown, key: string): number {
  const parsed = optionalPositiveNumber(value);
  if (parsed === undefined) throw new Error(`${key} must be a positive number`);
  return parsed;
}

function optionalQuantity(value: unknown, key: string): number | null {
  if (value === undefined || value === null) return null;
  const parsed = optionalPositiveNumber(value);
  if (parsed === undefined) throw new Error(`${key} must be a positive number`);
  return parsed;
}

function requiredBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function normalizeOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeBrowseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MAX_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function ownerEmail(args: Record<string, unknown>, context: SpoonjoyApiContext): string | undefined {
  const requestedOwnerEmail = optionalString(args.ownerEmail)?.toLowerCase();

  if (context.principal) {
    const principalEmail = context.principal.email.toLowerCase();
    if (requestedOwnerEmail) {
      assertCanUseOwnerEmail(context.principal, requestedOwnerEmail);
    }
    return principalEmail;
  }

  if (context.allowOwnerEmailFallback === false) {
    return context.defaultOwnerEmail?.toLowerCase();
  }

  return requestedOwnerEmail ?? context.defaultOwnerEmail?.toLowerCase();
}

function requireOwnerEmail(args: Record<string, unknown>, context: SpoonjoyApiContext): string {
  const email = ownerEmail(args, context);
  if (!email) throw new ApiAuthError("ownerEmail is required, or authenticate/set SPOONJOY_MCP_USER_EMAIL", 401);
  return email.toLowerCase();
}

function rejectOwnerEmail(args: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(args, "ownerEmail")) {
    throw new ApiAuthError(
      "ownerEmail is not supported on this op; use API token",
      400,
    );
  }
}

function runOrSchedule(
  context: SpoonjoyApiContext,
  task: Promise<unknown>,
): Promise<unknown> {
  if (context.waitUntil) {
    context.waitUntil(task);
    return Promise.resolve();
  }
  return task;
}

function formatSpoon(spoon: {
  id: string;
  chefId: string;
  recipeId: string;
  cookedAt: Date;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: spoon.id,
    chefId: spoon.chefId,
    recipeId: spoon.recipeId,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    deletedAt: spoon.deletedAt ? spoon.deletedAt.toISOString() : null,
    createdAt: spoon.createdAt.toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
  };
}

function formatCover(cover: {
  id: string;
  recipeId: string;
  imageUrl: string;
  stylizedImageUrl: string | null;
  sourceType: string;
  sourceSpoonId: string | null;
  createdAt: Date;
}) {
  return {
    id: cover.id,
    recipeId: cover.recipeId,
    imageUrl: cover.imageUrl,
    stylizedImageUrl: cover.stylizedImageUrl,
    sourceType: cover.sourceType,
    sourceSpoonId: cover.sourceSpoonId,
    createdAt: cover.createdAt.toISOString(),
  };
}

function nonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function preferredCoverVariant(cover: {
  imageUrl: string | null;
  stylizedImageUrl: string | null;
}): RecipeCoverVariant | null {
  if (nonEmptyString(cover.stylizedImageUrl)) return "stylized";
  if (nonEmptyString(cover.imageUrl)) return "image";
  return null;
}

function coverUrlForVariant(
  cover: { imageUrl: string | null; stylizedImageUrl: string | null },
  variant: RecipeCoverVariant,
): string | null {
  return variant === "stylized" ? cover.stylizedImageUrl : cover.imageUrl;
}

function activeCoverDisplayFields(recipe: RecipeIdentityForCoverPayload, covers: Prisma.RecipeCoverGetPayload<{}>[]) {
  const display = getRecipeCoverDisplay(recipe, covers);
  if (!display) {
    return {
      imageUrl: null,
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
      coverStatus: null,
      coverGenerationStatus: null,
      activeCover: null,
    };
  }

  return {
    imageUrl: display.displayUrl,
    coverImageUrl: display.displayUrl,
    coverProvenanceLabel: display.provenanceLabel,
    coverSourceType: display.sourceType,
    coverVariant: display.activeVariant,
    coverStatus: display.cover.status,
    coverGenerationStatus: display.cover.generationStatus,
    activeCover: publicCoverPayload(display),
  };
}

type RecipeIdentityForCoverPayload = {
  id: string;
  title: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
};

function publicCoverPayload(display: {
  cover: Prisma.RecipeCoverGetPayload<{}>;
  displayUrl: string;
  activeVariant: RecipeCoverVariant;
  sourceType: string;
  provenanceLabel: string;
}) {
  return {
    id: display.cover.id,
    recipeId: display.cover.recipeId,
    imageUrl: display.displayUrl,
    displayUrl: display.displayUrl,
    sourceType: display.sourceType,
    activeVariant: display.activeVariant,
    provenanceLabel: display.provenanceLabel,
    status: display.cover.status,
    generationStatus: display.cover.generationStatus,
  };
}

function fullCoverPayload(
  cover: Prisma.RecipeCoverGetPayload<{}>,
  recipe: { activeCoverId: string | null; activeCoverVariant: string | null },
) {
  const activeVariant = recipe.activeCoverId === cover.id &&
    (recipe.activeCoverVariant === "image" || recipe.activeCoverVariant === "stylized")
    ? recipe.activeCoverVariant
    : null;
  const displayVariant = activeVariant ?? preferredCoverVariant(cover);
  const displayUrl = displayVariant ? coverUrlForVariant(cover, displayVariant) : null;

  return {
    id: cover.id,
    recipeId: cover.recipeId,
    status: cover.status,
    sourceType: cover.sourceType,
    imageUrl: cover.imageUrl,
    stylizedImageUrl: cover.stylizedImageUrl,
    displayUrl,
    activeVariant,
    provenanceLabel: displayVariant
      ? getRecipeCoverProvenanceLabel(cover.sourceType, displayVariant)
      : null,
    sourceSpoonId: cover.sourceSpoonId,
    createdById: cover.createdById,
    archivedAt: cover.archivedAt?.toISOString() ?? null,
    generationStatus: cover.generationStatus,
    failureReason: cover.failureReason,
    sourceImageUrl: cover.sourceImageUrl,
    createdAt: cover.createdAt.toISOString(),
  };
}

function paginationFor(pageSize: number, limit: number, offset: number, hasMore: boolean) {
  return { limit, offset, count: pageSize, hasMore };
}

type CoverMutationRecipe = {
  id: string;
  title: string;
  description: string | null;
  chefId: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
};

type FullCoverPayload = ReturnType<typeof fullCoverPayload>;

type CoverMutationResult = {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  createdCover: FullCoverPayload | null;
  generationStatus: string;
  warnings: string[];
  nextActions: string[];
  mutation: { idempotencyKey: string | null; replayed: boolean };
};

type ActiveCoverMutationResult = {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  archivedCover: FullCoverPayload | null;
  warnings: string[];
  nextActions: string[];
  mutation: { idempotencyKey: string | null; replayed: boolean };
};

async function findOwnedCoverMutationRecipe(
  context: SpoonjoyApiContext,
  principal: ApiPrincipal,
  recipeId: string,
): Promise<CoverMutationRecipe> {
  const recipe = await context.db.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
    },
  });
  if (!recipe) throw new ApiAuthError("Recipe not found", 404);
  if (recipe.chefId !== principal.id) throw new ApiAuthError("Unauthorized", 403);
  return recipe;
}

async function reloadCoverMutationRecipe(
  context: SpoonjoyApiContext,
  recipeId: string,
): Promise<CoverMutationRecipe> {
  return context.db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    select: {
      id: true,
      title: true,
      description: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
    },
  });
}

async function activeFullCoverPayload(
  context: SpoonjoyApiContext,
  recipe: { id: string; activeCoverId: string | null; activeCoverVariant: string | null },
): Promise<FullCoverPayload | null> {
  if (!recipe.activeCoverId) return null;
  const cover = await context.db.recipeCover.findFirstOrThrow({
    where: { id: recipe.activeCoverId, recipeId: recipe.id },
  });
  return fullCoverPayload(cover, recipe);
}

async function reloadFullCoverPayload(
  context: SpoonjoyApiContext,
  recipe: { id: string; activeCoverId: string | null; activeCoverVariant: string | null },
  coverId: string,
): Promise<FullCoverPayload> {
  const cover = await context.db.recipeCover.findFirstOrThrow({
    where: { id: coverId, recipeId: recipe.id },
  });
  return fullCoverPayload(cover, recipe);
}

function coverMutationResponse(input: {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  createdCover: FullCoverPayload | null;
  generationStatus: string;
  warnings?: string[];
  nextActions: string[];
  idempotencyKey?: string | null;
  replayed?: boolean;
}): CoverMutationResult {
  return {
    activeCover: input.activeCover,
    previousActiveCover: input.previousActiveCover,
    createdCover: input.createdCover,
    generationStatus: input.generationStatus,
    warnings: input.warnings ?? [],
    nextActions: input.nextActions,
    mutation: {
      idempotencyKey: input.idempotencyKey ?? null,
      replayed: input.replayed ?? false,
    },
  };
}

function activeCoverMutationResponse(input: {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  archivedCover: FullCoverPayload | null;
  warnings?: string[];
  nextActions: string[];
  idempotencyKey?: string | null;
  replayed?: boolean;
}): ActiveCoverMutationResult {
  return {
    activeCover: input.activeCover,
    previousActiveCover: input.previousActiveCover,
    archivedCover: input.archivedCover,
    warnings: input.warnings ?? [],
    nextActions: input.nextActions,
    mutation: {
      idempotencyKey: input.idempotencyKey ?? null,
      replayed: input.replayed ?? false,
    },
  };
}

function coverLifecycleApiError(error: unknown): never {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof Error) throw new ApiAuthError(error.message, 400);
  throw new ApiAuthError("Cover mutation failed", 400);
}

function normalizedMcpIdempotencyBody(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== "dryRun" && key !== "idempotencyKey"),
  );
}

async function mcpMutationRequestHash(
  operation: string,
  recipeId: string,
  args: Record<string, unknown>,
) {
  return hashIdempotencyRequest({
    method: "MCP",
    path: `/mcp/tools/${operation}/recipes/${recipeId}`,
    body: normalizedMcpIdempotencyBody(args),
  });
}

function internalMcpCoverIdempotencyKey(operation: string, requestHash: string): string {
  return `spoonjoy:mcp-cover:${operation}:${requestHash}`;
}

function markMcpReplay(body: unknown, idempotencyKey: string | null): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as { mutation?: { idempotencyKey?: string | null; replayed?: boolean } };
  record.mutation = { ...(record.mutation ?? {}), idempotencyKey, replayed: true };
  return record;
}

async function runIdempotentMcpCoverMutation<T>(
  context: SpoonjoyApiContext,
  principal: ApiPrincipal,
  input: {
    operation: string;
    recipeId: string;
    args: Record<string, unknown>;
    idempotencyKey?: string;
    dryRun: boolean;
    write: (idempotencyKey: string | null) => Promise<T>;
  },
): Promise<unknown> {
  if (input.dryRun) {
    return input.write(input.idempotencyKey ?? null);
  }

  const requestHash = await mcpMutationRequestHash(input.operation, input.recipeId, input.args);
  const publicIdempotencyKey = input.idempotencyKey ?? null;
  const reservationKey = input.idempotencyKey ?? internalMcpCoverIdempotencyKey(input.operation, requestHash);
  const reservation = await reserveIdempotencyKey(context.db, {
    userId: principal.id,
    credentialId: principal.source === "bearer" ? principal.credentialId : null,
    clientKey: idempotencyClientKey(principal),
    key: reservationKey,
    operation: input.operation,
    requestHash,
  });

  if (reservation.status === "replay") {
    return markMcpReplay(JSON.parse(reservation.record.responseBody as string), publicIdempotencyKey);
  }
  if (reservation.status === "in_flight") {
    throw new ApiAuthError("idempotencyKey is already in progress; retry shortly", 409);
  }
  if (reservation.status === "conflict") {
    throw new ApiAuthError("idempotencyKey was already used for a different request", 409);
  }

  let result: T;
  try {
    result = await input.write(publicIdempotencyKey);
  } catch (error) {
    await context.db.apiIdempotencyKey.deleteMany({ where: { id: reservation.record.id } });
    throw error;
  }

  await completeIdempotencyKey(context.db, reservation.record.id, {
    status: 200,
    body: result,
  });
  return result;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function usernameFromEmail(email: string): string {
  const local = email.split("@")[0]?.toLowerCase() || "agent";
  return local.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

async function uniqueUsername(db: Database, email: string): Promise<string> {
  const base = usernameFromEmail(email);
  let candidate = base;
  let suffix = 2;

  while (await db.user.findUnique({ where: { username: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function getOrCreateOwner(db: Database, email: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;

  return db.user.create({
    data: {
      email,
      username: await uniqueUsername(db, email),
    },
  });
}

async function getOrCreateUnit(db: Database, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.unit.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return db.unit.create({ data: { name: normalized } });
}

async function getOrCreateIngredientRef(db: Database, name: string) {
  const normalized = normalizeName(name);
  const existing = await db.ingredientRef.findUnique({ where: { name: normalized } });
  if (existing) return existing;
  return db.ingredientRef.create({ data: { name: normalized } });
}

function formatRecipe(recipe: RecipeWithDetails) {
  const steps = [...recipe.steps]
    .sort((a, b) => a.stepNum - b.stepNum)
    .map((step) => ({
      id: step.id,
      stepNum: step.stepNum,
      title: step.stepTitle,
      description: step.description,
      duration: step.duration,
      ingredients: [...step.ingredients]
        .sort((a, b) => a.ingredientRef.name.localeCompare(b.ingredientRef.name))
        .map((ingredient) => ({
          id: ingredient.id,
          quantity: ingredient.quantity,
          unit: ingredient.unit.name,
          name: ingredient.ingredientRef.name,
        })),
    }));

  const coverFields = activeCoverDisplayFields(recipe, recipe.covers);
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    sourceUrl: recipe.sourceUrl,
    sourceRecipeId: recipe.sourceRecipeId,
    ...coverFields,
    chef: recipe.chef,
    steps,
    ingredientCount: steps.reduce((sum, step) => sum + step.ingredients.length, 0),
  };
}

function formatRecipeSummary(recipe: RecipeWithDetails) {
  const ingredientNames = new Set<string>();
  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      ingredientNames.add(ingredient.ingredientRef.name);
    }
  }

  const coverFields = activeCoverDisplayFields(recipe, recipe.covers);
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    ...coverFields,
    chef: recipe.chef,
    stepCount: recipe.steps.length,
    ingredientNames: [...ingredientNames].sort(),
  };
}

function formatRecipeReadMetadata(recipe: RecipeReadWithDetails) {
  const tagBySortKey = new Map(recipe.tags.map((tag) => [
    `${tag.normalizedLabel}\u0000${tag.id}`,
    tag,
  ]));
  return {
    course: recipe.course,
    tags: [...tagBySortKey.keys()].sort().map((sortKey) => tagBySortKey.get(sortKey)!.label),
  };
}

function formatRecipeRead(recipe: RecipeReadWithDetails) {
  return {
    ...formatRecipe(recipe),
    ...formatRecipeReadMetadata(recipe),
  };
}

function formatRecipeReadSummary(recipe: RecipeReadWithDetails) {
  return {
    ...formatRecipeSummary(recipe),
    ...formatRecipeReadMetadata(recipe),
  };
}

function formatShoppingList(list: ShoppingListWithItems) {
  return {
    id: list.id,
    ownerId: list.authorId,
    items: [...list.items]
      .filter((item) => !item.deletedAt)
      .sort((a, b) => a.sortIndex - b.sortIndex || a.ingredientRef.name.localeCompare(b.ingredientRef.name))
      .map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unit: item.unit?.name ?? null,
        name: item.ingredientRef.name,
        checked: item.checked,
        categoryKey: item.categoryKey,
        iconKey: item.iconKey,
        sortIndex: item.sortIndex,
      })),
  };
}

function formatApiCredential(credential: ApiCredentialRecord) {
  return {
    id: credential.id,
    userId: credential.userId,
    name: credential.name,
    tokenPrefix: credential.tokenPrefix,
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
  };
}

function activeCookbookRecipes(cookbook: CookbookWithRecipes) {
  return cookbook.recipes.filter((item) => !item.recipe.deletedAt);
}

function formatCookbookSummary(cookbook: CookbookWithRecipes) {
  const recipes = activeCookbookRecipes(cookbook);

  return {
    id: cookbook.id,
    title: cookbook.title,
    ownerId: cookbook.authorId,
    author: cookbook.author,
    recipeCount: recipes.length,
    recipes: recipes.map((item) => {
      const coverFields = activeCoverDisplayFields(item.recipe, item.recipe.covers);
      return {
        id: item.recipe.id,
        title: item.recipe.title,
        imageUrl: coverFields.imageUrl,
        coverImageUrl: coverFields.coverImageUrl,
        coverProvenanceLabel: coverFields.coverProvenanceLabel,
        coverSourceType: coverFields.coverSourceType,
        coverVariant: coverFields.coverVariant,
        coverStatus: coverFields.coverStatus,
        coverGenerationStatus: coverFields.coverGenerationStatus,
      };
    }),
  };
}

function formatLeanCookbookSummary(cookbook: CookbookSummaryBase, recipes: CookbookSummaryRecipeRow[]) {
  return {
    id: cookbook.id,
    title: cookbook.title,
    ownerId: cookbook.authorId,
    author: cookbook.author,
    recipeCount: recipes.length,
    recipes: recipes.map((item) => {
      const coverFields = activeCoverDisplayFields(item.recipe, item.recipe.covers);
      return {
        id: item.recipe.id,
        title: item.recipe.title,
        imageUrl: coverFields.imageUrl,
        coverImageUrl: coverFields.coverImageUrl,
        coverProvenanceLabel: coverFields.coverProvenanceLabel,
        coverSourceType: coverFields.coverSourceType,
        coverVariant: coverFields.coverVariant,
        coverStatus: coverFields.coverStatus,
        coverGenerationStatus: coverFields.coverGenerationStatus,
      };
    }),
  };
}

function formatDeletedRecipe(recipe: { id: string; title: string; deletedAt: Date }) {
  return {
    id: recipe.id,
    title: recipe.title,
    deletedAt: recipe.deletedAt.toISOString(),
  };
}

function formatCookbook(cookbook: CookbookWithRecipes) {
  return {
    ...formatCookbookSummary(cookbook),
    recipes: activeCookbookRecipes(cookbook).map((item) => ({
      relationId: item.id,
      addedById: item.addedById,
      addedAt: item.createdAt.toISOString(),
      recipe: formatRecipeSummary(item.recipe),
    })),
  };
}

function parseIngredient(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`steps.ingredients[${index}] must be an object`);
  }

  const raw = value as Record<string, unknown>;
  return {
    name: requiredString(raw, "name"),
    quantity: positiveNumber(raw.quantity, "quantity"),
    unit: requiredString(raw, "unit"),
  };
}

function parseStep(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`steps[${index}] must be an object`);
  }

  const raw = value as Record<string, unknown>;
  const rawIngredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];

  return {
    title: optionalString(raw.title),
    description: requiredString(raw, "description"),
    duration: optionalPositiveNumber(raw.duration),
    ingredients: rawIngredients.map((ingredient, ingredientIndex) => parseIngredient(ingredient, ingredientIndex)),
  };
}

function parseSteps(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("steps must be an array");
  return value.map((step, index) => parseStep(step, index));
}

async function findRecipeByIdOrTitle(db: PrismaClientType, args: Record<string, unknown>) {
  const id = optionalString(args.id);
  const title = optionalString(args.title);

  if (!id && !title) throw new Error("id or title is required");

  return db.recipe.findFirst({
    where: id ? { id, deletedAt: null } : { title, deletedAt: null },
    include: {
      chef: { select: { id: true, email: true, username: true } },
      covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      tags: { select: { id: true, label: true, normalizedLabel: true } },
      steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
    },
  });
}

async function findOwnerCookbook(db: Database, ownerId: string, args: Record<string, unknown>) {
  const cookbookId = optionalString(args.cookbookId);
  const title = optionalString(args.title) ?? optionalString(args.cookbookTitle);

  if (!cookbookId && !title) throw new Error("cookbookId or title is required");

  return db.cookbook.findFirst({
    where: {
      authorId: ownerId,
      ...(cookbookId ? { id: cookbookId } : { title }),
    },
    include: cookbookRecipeInclude,
  });
}

async function reloadOwnerCookbook(db: Database, ownerId: string, cookbookId: string) {
  return db.cookbook.findFirstOrThrow({
    where: { id: cookbookId, authorId: ownerId },
    include: cookbookRecipeInclude,
  });
}

async function nextSortIndex(db: Database, shoppingListId: string): Promise<number> {
  const maxItem = await db.shoppingListItem.findFirst({
    where: { shoppingListId, deletedAt: null },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });
  return (maxItem?.sortIndex ?? -1) + 1;
}

async function getOrCreateShoppingList(db: Database, ownerId: string) {
  const existing = await db.shoppingList.findUnique({ where: { authorId: ownerId } });
  if (existing) return existing;
  return db.shoppingList.create({ data: { authorId: ownerId } });
}

async function reloadShoppingList(db: Database, shoppingListId: string): Promise<ShoppingListWithItems> {
  return db.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { items: { include: { unit: true, ingredientRef: true } } },
  });
}

async function getCredentialOwner(db: Database, args: Record<string, unknown>, context: SpoonjoyApiContext) {
  const email = requireOwnerEmail(args, context);
  return getOrCreateOwner(db, email);
}

function normalizeCreateApiTokenScopes(value: unknown, principal: ApiPrincipal | null | undefined): string | undefined {
  let storedScopes: string | undefined;

  if (value === undefined) {
    storedScopes = principal?.source === "bearer"
      ? normalizeCredentialScopes(principal.scopes.filter((scope) => scope !== "offline_access"))
      : undefined;
  } else if (typeof value === "string") {
    storedScopes = normalizeCredentialScopes(value);
  } else if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) {
    storedScopes = normalizeCredentialScopes(value);
  } else {
    throw new ApiAuthError("scopes must be a string or string array", 400);
  }

  if (principal?.source === "bearer" && storedScopes !== undefined) {
    const requestedScopes = expandCredentialScopes(storedScopes);
    const callerScopes = new Set(principal.scopes.filter((scope) => scope !== "offline_access"));
    const missing = requestedScopes.filter((scope) => !callerScopes.has(scope));
    if (missing.length > 0) {
      throw new ApiAuthError(`Cannot create a token with scopes outside the caller's scopes: ${missing.join(", ")}`, 403);
    }
  }

  return storedScopes;
}

async function replaceRecipeSteps(db: PrismaClientType, recipeId: string, steps: ReturnType<typeof parseSteps>) {
  // Pre-resolve all unit + ingredientRef ids OUTSIDE the swap. They're
  // idempotent getOrCreates and don't need to be atomic with the recipe's
  // step replacement; they just need their ids ready.
  const unitNames = new Set<string>();
  const ingredientNames = new Set<string>();
  for (const step of steps) {
    for (const ingredient of step.ingredients) {
      unitNames.add(normalizeName(ingredient.unit));
      ingredientNames.add(normalizeName(ingredient.name));
    }
  }
  const unitIds = new Map<string, string>();
  for (const name of unitNames) {
    unitIds.set(name, (await getOrCreateUnit(db, name)).id);
  }
  const ingredientRefIds = new Map<string, string>();
  for (const name of ingredientNames) {
    ingredientRefIds.set(name, (await getOrCreateIngredientRef(db, name)).id);
  }

  // Atomic swap as a single D1 batch: clear-then-rebuild as one transaction so
  // a mid-sequence failure rolls back the deletes instead of permanently
  // gutting the recipe. D1 doesn't support Prisma's interactive
  // `$transaction(async tx => ...)` form, but it does support the batched
  // PrismaPromise[] form, which is what we use here.
  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.stepOutputUse.deleteMany({ where: { recipeId } }),
    db.ingredient.deleteMany({ where: { recipeId } }),
    db.recipeStep.deleteMany({ where: { recipeId } }),
  ];
  for (const [index, step] of steps.entries()) {
    const stepNum = index + 1;
    ops.push(
      db.recipeStep.create({
        data: {
          recipeId,
          stepNum,
          stepTitle: step.title ?? null,
          description: step.description,
          duration: step.duration ?? null,
        },
      }),
    );
    for (const ingredient of step.ingredients) {
      ops.push(
        db.ingredient.create({
          data: {
            recipeId,
            stepNum,
            quantity: ingredient.quantity,
            unitId: unitIds.get(normalizeName(ingredient.unit))!,
            ingredientRefId: ingredientRefIds.get(normalizeName(ingredient.name))!,
          },
        }),
      );
    }
  }
  await db.$transaction(ops);
}

const healthTool: SpoonjoyApiOperation = {
  name: "health",
  description: "Check Spoonjoy API readiness and whether the caller can use owner-scoped write operations.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handle(_args, context) {
    return json({
      ok: true,
      app: "spoonjoy-v2",
      authenticated: Boolean(context.principal),
      authSource: context.principal?.source ?? null,
      defaultOwnerEmail: context.defaultOwnerEmail ?? null,
      writable: Boolean(context.principal ?? context.defaultOwnerEmail),
    });
  },
};

function formatPrincipal(principal: ApiPrincipal | null | undefined) {
  if (!principal) return null;

  return {
    id: principal.id,
    email: principal.email,
    username: principal.username,
    authSource: principal.source,
    credentialId: principal.credentialId ?? null,
  };
}

const authStatusTool: SpoonjoyApiOperation = {
  name: "auth_status",
  description:
    "Report the current Spoonjoy MCP authentication state and how an agent should obtain delegated access without asking for raw user credentials.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handle(_args, context) {
    const defaultOwnerEmail = context.defaultOwnerEmail?.toLowerCase() ?? null;
    const defaultOwner = defaultOwnerEmail
      ? await context.db.user.findUnique({
          where: { email: defaultOwnerEmail },
          select: { id: true, email: true, username: true },
        })
      : null;
    const writable = Boolean(context.principal ?? defaultOwnerEmail);

    return json({
      authenticated: Boolean(context.principal),
      principal: formatPrincipal(context.principal),
      defaultOwnerEmail,
      defaultOwner: defaultOwner
        ? { id: defaultOwner.id, email: defaultOwner.email, username: defaultOwner.username }
        : null,
      writable,
      standards: ["Custom Spoonjoy delegated approval link", "MCP OAuth authorization"],
      guidance: writable
        ? "Use the authenticated principal or configured owner. Never ask for raw Spoonjoy credentials."
        : "Public reads are available. For writes, ask the user to approve a delegated Spoonjoy authorization link or provide a scoped API token; never ask for their password.",
    });
  },
};

const startAgentConnectionTool: SpoonjoyApiOperation = {
  name: "start_agent_connection",
  description:
    "Start a browser-approved delegated Spoonjoy connection for this agent. Send authorizationUrl to the user, then poll with deviceCode.",
  inputSchema: {
    type: "object",
    properties: {
      agentName: { type: "string" },
      baseUrl: { type: "string" },
      scopes: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const started = await startAgentConnection(context.db, {
      agentName: optionalString(args.agentName),
      baseUrl: context.env?.SPOONJOY_BASE_URL ?? optionalString(args.baseUrl),
      scopes: optionalString(args.scopes),
    });

    return json({
      deviceCode: started.deviceCode,
      userCode: started.request.userCode,
      authorizationUrl: started.authorizationUrl,
      verificationUri: started.verificationUri,
      verificationUriComplete: started.verificationUriComplete,
      expiresAt: started.request.expiresAt.toISOString(),
      expiresIn: started.expiresIn,
      interval: started.interval,
      message:
        "Send authorizationUrl to the user, or show verificationUri plus userCode on constrained devices. After approval, call poll_agent_connection with deviceCode. Never ask for their Spoonjoy password.",
    });
  },
};

const pollAgentConnectionTool: SpoonjoyApiOperation = {
  name: "poll_agent_connection",
  description:
    "Poll a pending delegated Spoonjoy connection. When approved, the Spoonjoy MCP bridge activates and caches access; never ask for a Spoonjoy password.",
  inputSchema: {
    type: "object",
    properties: {
      deviceCode: { type: "string" },
      tokenName: { type: "string" },
      baseUrl: { type: "string" },
    },
    required: ["deviceCode"],
    additionalProperties: false,
  },
  async handle(args, context) {
    return json(await pollAgentConnection(context.db, {
      deviceCode: requiredString(args, "deviceCode"),
      tokenName: optionalString(args.tokenName),
      baseUrl: context.env?.SPOONJOY_BASE_URL ?? optionalString(args.baseUrl),
    }));
  },
};

const createApiTokenTool: SpoonjoyApiOperation = {
  name: "create_api_token",
  description: "Create an owner-scoped Spoonjoy API token. The token is returned once and is stored hashed.",
  requiredScopes: ["tokens:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      name: { type: "string" },
      scopes: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const owner = await getCredentialOwner(context.db, args, context);
    const name = optionalString(args.name) ?? "Spoonjoy API token";
    const scopes = normalizeCreateApiTokenScopes(args.scopes, context.principal);
    const created = await createApiCredential(context.db, owner.id, name, { scopes });

    return json({
      token: created.token,
      credential: formatApiCredential(created.credential),
    });
  },
};

const listApiTokensTool: SpoonjoyApiOperation = {
  name: "list_api_tokens",
  description: "List API token metadata for the configured owner. Token secrets are never returned.",
  requiredScopes: ["tokens:read"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const owner = await getCredentialOwner(context.db, args, context);
    const credentials = await context.db.apiCredential.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "desc" },
    });

    return json({ credentials: credentials.map(formatApiCredential) });
  },
};

const revokeApiTokenTool: SpoonjoyApiOperation = {
  name: "revoke_api_token",
  description: "Revoke one API token owned by the configured owner.",
  requiredScopes: ["tokens:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      credentialId: { type: "string" },
    },
    required: ["credentialId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const owner = await getCredentialOwner(context.db, args, context);
    const credentialId = requiredString(args, "credentialId");
    const credential = await context.db.apiCredential.findFirst({
      where: { id: credentialId, userId: owner.id },
    });

    if (!credential) throw new Error("API token not found");

    const updated = credential.revokedAt
      ? credential
      : await context.db.apiCredential.update({
          where: { id: credential.id },
          data: { revokedAt: new Date() },
        });

    return json({
      revoked: !credential.revokedAt,
      credential: formatApiCredential(updated),
    });
  },
};

const searchRecipesTool: SpoonjoyApiOperation = {
  name: "search_recipes",
  description: "Full-text search Spoonjoy recipes by title, description, source URL, steps, ingredients, and optional chef email.",
  requiredScopes: ["recipes:read"],
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      chefEmail: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const query = optionalString(args.query);
    const chefEmail = optionalString(args.chefEmail)?.toLowerCase();
    const limit = normalizeLimit(args.limit);
    const chef = chefEmail
      ? await context.db.user.findUnique({ where: { email: chefEmail }, select: { id: true } })
      : null;

    if (chefEmail && !chef) {
      return json({ recipes: [] });
    }

    const results = await searchSpoonjoy(context.db, {
      query,
      scope: "recipes",
      ownerId: chef?.id,
      limit,
    });
    const resultOrder = new Map(results.map((result, index) => [result.id, index]));

    const recipes = results.length
      ? await context.db.recipe.findMany({
          where: {
            id: { in: results.map((result) => result.id) },
            deletedAt: null,
          },
          include: {
            chef: { select: { id: true, email: true, username: true } },
            covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
            tags: { select: { id: true, label: true, normalizedLabel: true } },
            steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
          },
        })
      : [];

    recipes.sort((a, b) => (resultOrder.get(a.id) as number) - (resultOrder.get(b.id) as number));

    return json({ recipes: recipes.map(formatRecipeReadSummary) });
  },
};

const searchSpoonjoyTool: SpoonjoyApiOperation = {
  name: "search_spoonjoy",
  description: "Full-text search Spoonjoy recipes, cookbooks, chefs, and the configured owner's private shopping list.",
  requiredScopes: ["recipes:read", "cookbooks:read", "shopping_list:read"],
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      scope: {
        type: "string",
        enum: ["all", "recipes", "cookbooks", "chefs", "shopping-list", "shopping"],
      },
      ownerEmail: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const query = optionalString(args.query);
    const scope = normalizeSearchScope(optionalString(args.scope));
    const email = ownerEmail(args, context)?.toLowerCase();
    const owner = email ? await getOrCreateOwner(context.db, email) : null;

    const results = await searchSpoonjoy(context.db, {
      query,
      scope,
      viewerId: owner?.id,
      limit: normalizeLimit(args.limit),
    });

    return json({
      query: query ?? "",
      scope,
      results,
    });
  },
};

const searchShoppingListTool: SpoonjoyApiOperation = {
  name: "search_shopping_list",
  description: "Full-text search the configured owner's private shopping list by ingredient, unit, category, icon, and checked state.",
  requiredScopes: ["shopping_list:read"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      query: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const query = optionalString(args.query);
    const items = await searchSpoonjoy(context.db, {
      query,
      scope: "shopping-list",
      viewerId: owner.id,
      ownerId: owner.id,
      limit: normalizeLimit(args.limit),
    });

    return json({
      query: query ?? "",
      items,
    });
  },
};

const getRecipeTool: SpoonjoyApiOperation = {
  name: "get_recipe",
  description: "Fetch a Spoonjoy recipe by id or exact title with ordered steps and ingredients.",
  requiredScopes: ["recipes:read"],
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      scale: {
        type: "number",
        minimum: 0.1,
        maximum: 100,
        description: "Scale ingredient quantities in this read without changing stored values or servings.",
      },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const scale = parseMcpRecipeScale(args);
    const recipe = await findRecipeByIdOrTitle(context.db, args);
    return json({ recipe: recipe ? applyRecipeScale(formatRecipeRead(recipe), scale) : null });
  },
};

const listRecipeCoversTool: SpoonjoyApiOperation = {
  name: "list_recipe_covers",
  description: "List Recipe Photo Studio cover candidates. Owners with kitchen write access receive full cover history; other readers receive active public cover metadata only.",
  requiredScopes: ["recipes:read"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe whose cover candidates should be listed." },
      includeArchived: { type: "boolean", description: "Include archived cover candidates in the owner-only history." },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT, description: "Maximum number of cover candidates to return." },
      offset: { type: "number", minimum: 0, description: "Zero-based pagination offset." },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const limit = normalizeBrowseLimit(args.limit);
    const offset = normalizeOffset(args.offset);
    const recipe = await context.db.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
      select: {
        id: true,
        title: true,
        chefId: true,
        activeCoverId: true,
        activeCoverVariant: true,
        coverMode: true,
      },
    });
    if (!recipe) throw new ApiAuthError("Recipe not found", 404);

    const canReadFullHistory = recipe.chefId === principal.id && principal.scopes.includes("kitchen:write");
    const activeCover = recipe.activeCoverId
      ? await context.db.recipeCover.findFirst({
          where: { id: recipe.activeCoverId, recipeId: recipe.id },
        })
      : null;

    if (!canReadFullHistory) {
      const publicActiveCover = activeCoverDisplayFields(recipe, activeCover ? [activeCover] : []).activeCover;
      const publicCovers = publicActiveCover && offset === 0 ? [publicActiveCover] : [];
      return json({
        covers: publicCovers,
        activeCover: publicActiveCover,
        pagination: paginationFor(publicCovers.length, limit, offset, false),
      });
    }

    const includeArchived = args.includeArchived === true;
    const covers = await context.db.recipeCover.findMany({
      where: {
        recipeId: recipe.id,
        ...(includeArchived ? {} : { status: { not: "archived" }, archivedAt: null }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      skip: offset,
    });
    const page = covers.slice(0, limit);
    const activePayload = activeCover ? fullCoverPayload(activeCover, recipe) : null;
    return json({
      covers: page.map((cover) => fullCoverPayload(cover, recipe)),
      activeCover: activePayload,
      pagination: paginationFor(page.length, limit, offset, covers.length > limit),
    });
  },
};

const listRecipeSpoonImagesTool: SpoonjoyApiOperation = {
  name: "list_recipe_spoon_images",
  description: "List owner-only Spoon photos that can be used as Recipe Photo Studio cover sources.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe whose Spoon photos should be listed." },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT, description: "Maximum number of Spoon photos to return." },
      offset: { type: "number", minimum: 0, description: "Zero-based pagination offset." },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const recipe = await context.db.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
      select: { id: true, chefId: true },
    });
    if (!recipe) throw new ApiAuthError("Recipe not found", 404);
    if (recipe.chefId !== principal.id) throw new ApiAuthError("Unauthorized", 403);

    const limit = normalizeBrowseLimit(args.limit);
    const offset = normalizeOffset(args.offset);
    const spoons = await context.db.recipeSpoon.findMany({
      where: {
        recipeId,
        deletedAt: null,
        photoUrl: { not: null },
        NOT: { photoUrl: "" },
      },
      select: {
        id: true,
        recipeId: true,
        chefId: true,
        photoUrl: true,
        cookedAt: true,
        createdAt: true,
        updatedAt: true,
        chef: { select: { id: true, username: true, photoUrl: true } },
      },
      orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      skip: offset,
    });
    const page = spoons
      .filter((spoon): spoon is typeof spoon & { photoUrl: string } => nonEmptyString(spoon.photoUrl))
      .slice(0, limit);
    return json({
      spoonImages: page.map((spoon) => ({
        id: spoon.id,
        recipeId: spoon.recipeId,
        chefId: spoon.chefId,
        photoUrl: spoon.photoUrl,
        cookedAt: spoon.cookedAt.toISOString(),
        createdAt: spoon.createdAt.toISOString(),
        updatedAt: spoon.updatedAt.toISOString(),
        chef: spoon.chef,
      })),
      pagination: paginationFor(page.length, limit, offset, spoons.length > limit),
    });
  },
};

const createRecipeCoverFromUploadTool: SpoonjoyApiOperation = {
  name: "create_recipe_cover_from_upload",
  description: "Create a Recipe Photo Studio cover candidate from an uploaded recipe or spoon photo URL.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that will receive the cover candidate." },
      imageUrl: { type: "string", description: "Spoonjoy uploaded recipe or spoon photo URL to use as the original cover source." },
      activateWhenReady: { type: "boolean", description: "Make the cover active when the editorial image is ready." },
      generateEditorial: { type: "boolean", description: "Generate an editorialized cover from the uploaded original photo." },
      promptAddition: { type: "string", maxLength: 240, description: "Optional bounded instruction to guide editorial cover generation." },
      postAsSpoon: { type: "boolean", description: "Also create a Spoon entry to preserve the original photo with optional cook notes." },
      note: { type: "string", description: "Spoon note used when postAsSpoon preserves the original photo." },
      nextTime: { type: "string", description: "Spoon next-time note used when postAsSpoon preserves the original photo." },
      cookedAt: { type: "string", format: "date-time", description: "ISO date-time for the Spoon cook when postAsSpoon preserves the original photo." },
      idempotencyKey: { type: "string", description: "Stable key for replay-safe cover creation." },
      dryRun: { type: "boolean", description: "Validate inputs and return planned next actions without writing a cover." },
    },
    required: ["recipeId", "imageUrl"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const imageUrl = requiredString(args, "imageUrl");
    const activate = optionalBooleanArgument(args, "activateWhenReady", optionalBooleanArgument(args, "activate"));
    const generateEditorial = optionalBooleanArgument(args, "generateEditorial", true);
    const dryRun = optionalBooleanArgument(args, "dryRun");
    const idempotencyKey = optionalString(args.idempotencyKey);
    const promptAddition = sanitizeRecipeCoverPromptAddition(optionalStringArgument(args, "promptAddition"));
    const postAsSpoon = optionalBooleanArgument(args, "postAsSpoon");
    const note = optionalStringArgument(args, "note") ?? null;
    const nextTime = optionalStringArgument(args, "nextTime") ?? null;
    const cookedAt = optionalIsoDateArgument(args, "cookedAt");

    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "create_recipe_cover_from_upload",
      recipeId,
      args,
      idempotencyKey,
      dryRun,
      write: async (mutationKey) => {
        await validateRecipeCoverImageSource({
          imageUrl,
          ownerId: principal.id,
          bucket: context.bucket,
          allowLocalImageFallback: context.allowLocalImageFallback,
        });

        if (dryRun) {
          return coverMutationResponse({
            activeCover: previousActiveCover,
            previousActiveCover,
            createdCover: null,
            generationStatus: "dry_run",
            nextActions: ["create_recipe_cover_from_upload"],
            idempotencyKey: mutationKey,
          });
        }

        const spoon = postAsSpoon
          ? (await createRecipeSpoon(context.db, {
              chefId: principal.id,
              recipeId,
              photoUrl: imageUrl,
              note,
              nextTime,
              cookedAt,
            })).spoon
          : null;

        const cover = await createCover(context.db, {
          recipeId,
          imageUrl,
          sourceType: spoon ? "spoon" : "chef-upload",
          sourceSpoonId: spoon?.id,
          status: generateEditorial ? "processing" : "ready",
          createdById: principal.id,
          sourceImageUrl: imageUrl,
          generationStatus: generateEditorial ? "processing" : "none",
          promptAddition,
        });

        if (generateEditorial) {
          await scheduleRecipeCoverStylization(context, {
            userId: principal.id,
            recipeId,
            coverId: cover.id,
            rawPhotoUrl: imageUrl,
            recipeTitle: recipe.title,
            sourceType: spoon ? "spoon" : "chef-upload",
            promptAddition,
            activateWhenReady: activate,
            suppressAutoActivation: !activate,
            activationGuard: activate
              ? {
                  activeCoverId: recipe.activeCoverId,
                  activeCoverVariant: recipe.activeCoverVariant,
                  coverMode: recipe.coverMode,
                }
              : undefined,
          });
        } else if (activate) {
          await setActiveRecipeCover(context.db, {
            recipeId,
            coverId: cover.id,
            variant: "image",
          });
        }

        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        const createdCover = await reloadFullCoverPayload(context, nextRecipe, cover.id);
        const activeCover = await activeFullCoverPayload(context, nextRecipe);
        return coverMutationResponse({
          activeCover,
          previousActiveCover,
          createdCover,
          generationStatus: createdCover.generationStatus,
          nextActions: activate ? ["get_cover_generation_status"] : ["set_active_recipe_cover", "get_cover_generation_status"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const generateRecipeCoverPlaceholderTool: SpoonjoyApiOperation = {
  name: "generate_recipe_cover_placeholder",
  description: "Generate an AI placeholder cover candidate for a recipe with an optional prompt addition.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that will receive the generated AI placeholder cover." },
      promptAddition: { type: "string", maxLength: 240, description: "Optional bounded instruction to guide AI placeholder generation." },
      activateWhenReady: { type: "boolean", description: "Make the generated cover active when the generated cover is ready." },
      idempotencyKey: { type: "string", description: "Stable key for replay-safe placeholder generation." },
      dryRun: { type: "boolean", description: "Validate inputs and return planned next actions without writing a cover." },
    },
    required: ["recipeId", "idempotencyKey"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const idempotencyKey = requiredString(args, "idempotencyKey");
    const promptAddition = sanitizeRecipeCoverPromptAddition(optionalStringArgument(args, "promptAddition"));
    const activateWhenReady = optionalBooleanArgument(args, "activateWhenReady");
    const dryRun = optionalBooleanArgument(args, "dryRun");
    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "generate_recipe_cover_placeholder",
      recipeId,
      args,
      idempotencyKey,
      dryRun,
      write: async (mutationKey) => {
        if (dryRun) {
          return coverMutationResponse({
            activeCover: previousActiveCover,
            previousActiveCover,
            createdCover: null,
            generationStatus: "dry_run",
            nextActions: ["generate_recipe_cover_placeholder"],
            idempotencyKey: mutationKey,
          });
        }

        const cover = await createCover(context.db, {
          recipeId,
          imageUrl: "",
          sourceType: "ai-placeholder",
          status: "processing",
          createdById: principal.id,
          generationStatus: "processing",
          promptAddition,
        });

        await scheduleRecipePlaceholderGeneration(context, {
          userId: principal.id,
          recipeId,
          coverId: cover.id,
          title: recipe.title,
          description: recipe.description,
          promptAddition,
          activateWhenReady,
          activationGuard: activateWhenReady
            ? {
                activeCoverId: recipe.activeCoverId,
                activeCoverVariant: recipe.activeCoverVariant,
                coverMode: recipe.coverMode,
              }
            : undefined,
        }, {
          scheduling: "waitUntil",
        });

        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        const createdCover = await reloadFullCoverPayload(context, nextRecipe, cover.id);
        const activeCover = await activeFullCoverPayload(context, nextRecipe);
        return coverMutationResponse({
          activeCover,
          previousActiveCover,
          createdCover,
          generationStatus: createdCover.generationStatus,
          nextActions: ["get_cover_generation_status"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const createRecipeCoverFromSpoonTool: SpoonjoyApiOperation = {
  name: "create_recipe_cover_from_spoon",
  description: "Create a recipe cover candidate from an existing spoon photo.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      spoonId: { type: "string" },
      activate: { type: "boolean" },
      generateEditorial: { type: "boolean" },
      idempotencyKey: { type: "string" },
      dryRun: { type: "boolean" },
    },
    required: ["recipeId", "spoonId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const spoonId = requiredString(args, "spoonId");
    const activate = optionalBooleanArgument(args, "activate");
    const generateEditorial = optionalBooleanArgument(args, "generateEditorial", true);
    const dryRun = optionalBooleanArgument(args, "dryRun");
    const idempotencyKey = optionalString(args.idempotencyKey);

    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "create_recipe_cover_from_spoon",
      recipeId,
      args,
      idempotencyKey,
      dryRun,
      write: async (mutationKey) => {
        const spoon = await context.db.recipeSpoon.findFirst({
          where: {
            id: spoonId,
            recipeId,
            deletedAt: null,
            photoUrl: { not: null },
            NOT: { photoUrl: "" },
          },
          select: { id: true, photoUrl: true },
        });
        if (!spoon?.photoUrl) throw new ApiAuthError("Spoon photo not found", 404);

        if (dryRun) {
          return coverMutationResponse({
            activeCover: previousActiveCover,
            previousActiveCover,
            createdCover: null,
            generationStatus: "dry_run",
            nextActions: ["create_recipe_cover_from_spoon"],
            idempotencyKey: mutationKey,
          });
        }

        const cover = await createCover(context.db, {
          recipeId,
          imageUrl: spoon.photoUrl,
          sourceType: "spoon",
          sourceSpoonId: spoon.id,
          status: generateEditorial ? "processing" : "ready",
          createdById: principal.id,
          sourceImageUrl: spoon.photoUrl,
          generationStatus: generateEditorial ? "processing" : "none",
        });

        if (generateEditorial) {
          await scheduleRecipeCoverStylization(context, {
            userId: principal.id,
            recipeId,
            coverId: cover.id,
            rawPhotoUrl: spoon.photoUrl,
            recipeTitle: recipe.title,
            sourceType: "spoon",
            activateWhenReady: activate,
            suppressAutoActivation: !activate,
            activationGuard: activate
              ? {
                  activeCoverId: recipe.activeCoverId,
                  activeCoverVariant: recipe.activeCoverVariant,
                  coverMode: recipe.coverMode,
                }
              : undefined,
          });
        } else if (activate) {
          await setActiveRecipeCover(context.db, {
            recipeId,
            coverId: cover.id,
            variant: "image",
          });
        }

        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        const createdCover = await reloadFullCoverPayload(context, nextRecipe, cover.id);
        const activeCover = await activeFullCoverPayload(context, nextRecipe);
        return coverMutationResponse({
          activeCover,
          previousActiveCover,
          createdCover,
          generationStatus: createdCover.generationStatus,
          nextActions: activate ? ["get_cover_generation_status"] : ["set_active_recipe_cover", "get_cover_generation_status"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const regenerateRecipeCoverTool: SpoonjoyApiOperation = {
  name: "regenerate_recipe_cover",
  description: "Regenerate the editorial image for a recipe cover candidate with an optional prompt addition.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that owns the cover candidate." },
      coverId: { type: "string", description: "Existing cover candidate to regenerate." },
      promptAddition: { type: "string", maxLength: 240, description: "Optional bounded instruction to guide regenerated editorial output." },
      activateWhenReady: { type: "boolean", description: "Make the regenerated cover active when the regenerated cover is ready." },
      idempotencyKey: { type: "string", description: "Stable key for replay-safe regeneration." },
      dryRun: { type: "boolean", description: "Validate inputs and return planned next actions without writing a cover." },
    },
    required: ["recipeId", "coverId", "idempotencyKey"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const coverId = requiredString(args, "coverId");
    const activateWhenReady = optionalBooleanArgument(args, "activateWhenReady");
    const dryRun = optionalBooleanArgument(args, "dryRun");
    const idempotencyKey = optionalString(args.idempotencyKey);
    const promptAddition = sanitizeRecipeCoverPromptAddition(optionalStringArgument(args, "promptAddition"));
    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "regenerate_recipe_cover",
      recipeId,
      args,
      idempotencyKey,
      dryRun,
      write: async (mutationKey) => {
        const cover = await context.db.recipeCover.findFirst({ where: { id: coverId, recipeId } });
        if (!cover) throw new ApiAuthError("Cover not found", 404);
        if (cover.status === "archived" || cover.archivedAt) {
          throw new ApiAuthError("Archived covers cannot be regenerated", 400);
        }
        const rawPhotoUrl = cover.sourceImageUrl || cover.imageUrl;
        if (!rawPhotoUrl.trim()) throw new ApiAuthError("Cover has no source image", 400);

        if (dryRun) {
          return coverMutationResponse({
            activeCover: previousActiveCover,
            previousActiveCover,
            createdCover: fullCoverPayload(cover, recipe),
            generationStatus: "dry_run",
            nextActions: ["regenerate_recipe_cover"],
            idempotencyKey: mutationKey,
          });
        }

        await context.db.recipeCover.update({
          where: { id: cover.id },
          data: {
            status: "processing",
            generationStatus: "processing",
            failureReason: null,
            sourceImageUrl: cover.sourceImageUrl ?? rawPhotoUrl,
            promptAddition,
            parentCoverId: cover.id,
          },
        });
        await scheduleRecipeCoverStylization(context, {
          userId: principal.id,
          recipeId,
          coverId: cover.id,
          parentCoverId: cover.id,
          promptAddition,
          rawPhotoUrl,
          recipeTitle: recipe.title,
          sourceType: cover.sourceType === "spoon" ? "spoon" : "chef-upload",
          activateWhenReady,
          suppressAutoActivation: !activateWhenReady,
          activationGuard: activateWhenReady
            ? {
                activeCoverId: recipe.activeCoverId,
                activeCoverVariant: recipe.activeCoverVariant,
                coverMode: recipe.coverMode,
              }
            : undefined,
        });

        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        const regeneratedCover = await reloadFullCoverPayload(context, nextRecipe, cover.id);
        const activeCover = await activeFullCoverPayload(context, nextRecipe);
        return coverMutationResponse({
          activeCover,
          previousActiveCover,
          createdCover: regeneratedCover,
          generationStatus: regeneratedCover.generationStatus,
          nextActions: ["get_cover_generation_status"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const getCoverGenerationStatusTool: SpoonjoyApiOperation = {
  name: "get_cover_generation_status",
  description: "Fetch Recipe Photo Studio generation status and active-cover context.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that owns the cover candidate." },
      coverId: { type: "string", description: "Recipe cover candidate whose generation status should be fetched." },
    },
    required: ["recipeId", "coverId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const coverId = requiredString(args, "coverId");
    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const cover = await context.db.recipeCover.findFirst({ where: { id: coverId, recipeId } });
    if (!cover) throw new ApiAuthError("Cover not found", 404);
    return json({
      cover: fullCoverPayload(cover, recipe),
      activeCover: await activeFullCoverPayload(context, recipe),
    });
  },
};

const setActiveRecipeCoverTool: SpoonjoyApiOperation = {
  name: "set_active_recipe_cover",
  description: "Set one existing Recipe Photo Studio cover variant as the active recipe cover.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that owns the cover candidate." },
      coverId: { type: "string", description: "Cover candidate to activate." },
      variant: { type: "string", enum: ["image", "stylized"], description: "Cover variant to activate: image or stylized." },
      idempotencyKey: { type: "string", description: "Stable key for replay-safe activation." },
    },
    required: ["recipeId", "coverId", "variant"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const coverId = requiredString(args, "coverId");
    const variant = requiredCoverVariant(args, "variant");
    const idempotencyKey = optionalString(args.idempotencyKey);

    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "set_active_recipe_cover",
      recipeId,
      args,
      idempotencyKey,
      dryRun: false,
      write: async (mutationKey) => {
        try {
          await setActiveRecipeCover(context.db, { recipeId, coverId, variant });
        } catch (error) {
          coverLifecycleApiError(error);
        }
        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        return activeCoverMutationResponse({
          activeCover: await activeFullCoverPayload(context, nextRecipe),
          previousActiveCover,
          archivedCover: null,
          nextActions: ["list_recipe_covers", "get_recipe"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const setRecipeNoCoverTool: SpoonjoyApiOperation = {
  name: "set_recipe_no_cover",
  description: "Set an explicit no-cover state for a recipe after destructive no-cover confirmation.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that should intentionally display no cover." },
      confirmNoCover: { const: true, description: "Required explicit confirmation before entering no-cover mode." },
      idempotencyKey: { type: "string", description: "Stable key for replay-safe no-cover changes." },
    },
    required: ["recipeId", "confirmNoCover", "idempotencyKey"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    if (args.confirmNoCover !== true) {
      throw new ApiAuthError("confirmNoCover must be true", 400);
    }
    const idempotencyKey = requiredString(args, "idempotencyKey");
    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "set_recipe_no_cover",
      recipeId,
      args,
      idempotencyKey,
      dryRun: false,
      write: async (mutationKey) => {
        await clearActiveRecipeCover(context.db, recipeId);
        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        return activeCoverMutationResponse({
          activeCover: await activeFullCoverPayload(context, nextRecipe),
          previousActiveCover,
          archivedCover: null,
          warnings: [],
          nextActions: ["list_recipe_covers", "get_recipe"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const archiveRecipeCoverTool: SpoonjoyApiOperation = {
  name: "archive_recipe_cover",
  description: "Archive a Recipe Photo Studio cover. Archiving the active cover requires a replacement or explicit no-cover confirmation.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string", description: "Recipe that owns the cover candidate." },
      coverId: { type: "string", description: "Cover candidate to archive." },
      replacementCoverId: { type: "string", description: "Replacement cover candidate to activate when archiving the active cover." },
      replacementVariant: { type: "string", enum: ["image", "stylized"], description: "Replacement variant to activate: image or stylized." },
      confirmNoCover: { type: "boolean", description: "Use explicit no-cover mode when archiving the active cover without a replacement." },
      deleteSafeObjects: { type: "boolean", description: "Request deletion of safe owned image objects after archive when supported." },
      idempotencyKey: { type: "string", description: "Stable key for replay-safe archiving." },
    },
    required: ["recipeId", "coverId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const coverId = requiredString(args, "coverId");
    const replacementCoverId = optionalString(args.replacementCoverId) ?? null;
    const replacementVariant = optionalCoverVariant(args, "replacementVariant");
    const confirmNoCover = optionalBooleanArgument(args, "confirmNoCover");
    const deleteSafeObjects = optionalBooleanArgument(args, "deleteSafeObjects");
    const idempotencyKey = optionalString(args.idempotencyKey);

    const recipe = await findOwnedCoverMutationRecipe(context, principal, recipeId);
    const previousActiveCover = await activeFullCoverPayload(context, recipe);

    return runIdempotentMcpCoverMutation(context, principal, {
      operation: "archive_recipe_cover",
      recipeId,
      args,
      idempotencyKey,
      dryRun: false,
      write: async (mutationKey) => {
        let archivedCoverId: string;
        try {
          const result = await archiveRecipeCover(context.db, {
            recipeId,
            coverId,
            replacementCoverId,
            replacementVariant,
            confirmNoCover,
          });
          archivedCoverId = result.archivedCover.id;
        } catch (error) {
          coverLifecycleApiError(error);
        }

        const nextRecipe = await reloadCoverMutationRecipe(context, recipeId);
        const warnings = deleteSafeObjects
          ? ["deleteSafeObjects is not implemented; the cover record was archived without deleting image objects."]
          : [];
        return activeCoverMutationResponse({
          activeCover: await activeFullCoverPayload(context, nextRecipe),
          previousActiveCover,
          archivedCover: await reloadFullCoverPayload(context, nextRecipe, archivedCoverId),
          warnings,
          nextActions: ["list_recipe_covers", "get_recipe"],
          idempotencyKey: mutationKey,
        });
      },
    });
  },
};

const createRecipeTool: SpoonjoyApiOperation = {
  name: "create_recipe",
  description: "Create a Spoonjoy recipe for the configured owner, including steps and ingredients.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      servings: { type: "string" },
      sourceUrl: { type: "string" },
      imageUrl: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            duration: { type: "number" },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  quantity: { type: "number" },
                  unit: { type: "string" },
                },
                required: ["name", "quantity", "unit"],
                additionalProperties: false,
              },
            },
          },
          required: ["description"],
          additionalProperties: false,
        },
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const title = requiredString(args, "title");
    const imageUrl = optionalString(args.imageUrl);
    const steps = parseSteps(args.steps);

    const owner = await getOrCreateOwner(context.db, email);
    const titleUniqueness = await validateActiveRecipeTitleUnique(context.db, {
      chefId: owner.id,
      title,
    });
    if (!titleUniqueness.valid) throw new Error(titleUniqueness.error);
    if (imageUrl) {
      await validateRecipeCoverImageSource({
        imageUrl,
        ownerId: owner.id,
        bucket: context.bucket,
        allowLocalImageFallback: context.allowLocalImageFallback,
      });
    }

    const created = await context.db.recipe.create({
      data: {
        title,
        description: optionalString(args.description) ?? null,
        servings: optionalString(args.servings) ?? null,
        sourceUrl: optionalString(args.sourceUrl) ?? null,
        chefId: owner.id,
      },
    });

    await replaceRecipeSteps(context.db, created.id, steps);
    if (imageUrl) {
      const cover = await createCover(context.db, {
        recipeId: created.id,
        imageUrl,
        sourceType: "chef-upload",
      });
      await scheduleRecipeCoverStylization(context, {
        userId: owner.id,
        recipeId: created.id,
        coverId: cover.id,
        rawPhotoUrl: imageUrl,
        recipeTitle: title,
        sourceType: "chef-upload",
      });
      await activateRecipeCoverWithBestAvailableVariant(context.db, {
        recipeId: created.id,
        coverId: cover.id,
      });
    }

    const recipe = await context.db.recipe.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        chef: { select: { id: true, email: true, username: true } },
        covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
      },
    });

    return json({ recipe: formatRecipe(recipe) });
  },
};

const updateRecipeTool: SpoonjoyApiOperation = {
  name: "update_recipe",
  description: "Update a recipe owned by the configured owner, optionally replacing its steps and ingredients.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      description: { anyOf: [{ type: "string" }, { type: "null" }] },
      servings: { anyOf: [{ type: "string" }, { type: "null" }] },
      sourceUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            duration: { type: "number" },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  quantity: { type: "number" },
                  unit: { type: "string" },
                },
                required: ["name", "quantity", "unit"],
                additionalProperties: false,
              },
            },
          },
          required: ["description"],
          additionalProperties: false,
        },
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const id = requiredString(args, "id");
    const title = hasArgument(args, "title") ? requiredString(args, "title") : undefined;
    const description = optionalNullableStringArgument(args, "description");
    const servings = optionalNullableStringArgument(args, "servings");
    const sourceUrl = optionalNullableStringArgument(args, "sourceUrl");
    const imageUrl = optionalNullableStringArgument(args, "imageUrl");
    const shouldReplaceSteps = hasArgument(args, "steps");
    const steps = shouldReplaceSteps ? parseSteps(args.steps) : undefined;

    const owner = await getOrCreateOwner(context.db, email);
    const existing = await context.db.recipe.findFirst({
      where: { id, chefId: owner.id, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!existing) throw new Error("Recipe not found");

    const data: Prisma.RecipeUpdateInput = {};
    if (title !== undefined) {
      const titleUniqueness = await validateActiveRecipeTitleUnique(context.db, {
        chefId: owner.id,
        title,
        excludeRecipeId: existing.id,
      });
      if (!titleUniqueness.valid) throw new Error(titleUniqueness.error);
      data.title = title;
    }
    if (description !== undefined) data.description = description;
    if (servings !== undefined) data.servings = servings;
    if (sourceUrl !== undefined) data.sourceUrl = sourceUrl;

    if (imageUrl) {
      await validateRecipeCoverImageSource({
        imageUrl,
        ownerId: owner.id,
        bucket: context.bucket,
        allowLocalImageFallback: context.allowLocalImageFallback,
      });
    }

    if (Object.keys(data).length > 0) {
      await context.db.recipe.update({ where: { id: existing.id }, data });
    }

    if (steps) {
      await replaceRecipeSteps(context.db, existing.id, steps);
      await context.db.recipe.update({ where: { id: existing.id }, data: { updatedAt: new Date() } });
    }
    if (imageUrl) {
      const cover = await createCover(context.db, {
        recipeId: existing.id,
        imageUrl,
        sourceType: "chef-upload",
      });
      await scheduleRecipeCoverStylization(context, {
        userId: owner.id,
        recipeId: existing.id,
        coverId: cover.id,
        rawPhotoUrl: imageUrl,
        recipeTitle: title ?? existing.title,
        sourceType: "chef-upload",
      });
      await activateRecipeCoverWithBestAvailableVariant(context.db, {
        recipeId: existing.id,
        coverId: cover.id,
      });
    }

    const recipe = await context.db.recipe.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        chef: { select: { id: true, email: true, username: true } },
        covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        steps: { include: { ingredients: { include: { unit: true, ingredientRef: true } } } },
      },
    });

    return json({ recipe: formatRecipe(recipe) });
  },
};

const deleteRecipeTool: SpoonjoyApiOperation = {
  name: "delete_recipe",
  description: "Soft-delete a recipe owned by the configured owner.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      id: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const id = requiredString(args, "id");
    const owner = await getOrCreateOwner(context.db, email);
    const existing = await context.db.recipe.findFirst({
      where: { id, chefId: owner.id },
      select: { id: true, title: true, deletedAt: true },
    });

    if (!existing) throw new Error("Recipe not found");
    if (existing.deletedAt) {
      return json({
        deleted: false,
        recipe: formatDeletedRecipe({ ...existing, deletedAt: existing.deletedAt }),
      });
    }

    const deletedAt = new Date();
    const recipe = await context.db.recipe.update({
      where: { id: existing.id },
      data: { deletedAt },
      select: { id: true, title: true, deletedAt: true },
    });

    return json({ deleted: true, recipe: formatDeletedRecipe({ ...recipe, deletedAt }) });
  },
};

async function uploadFoodImageForOwner(
  args: Record<string, unknown>,
  context: SpoonjoyApiContext,
  namespace: "recipes" | "spoons",
){
  const email = requireOwnerEmail(args, context);
  const owner = await getOrCreateOwner(context.db, email);
  return uploadFoodImage({
    imageBase64: requiredString(args, "imageBase64"),
    mimeType: requiredString(args, "mimeType"),
    filename: requiredString(args, "filename"),
    ownerId: owner.id,
    namespace,
    bucket: context.bucket,
    allowLocalImageFallback: context.allowLocalImageFallback,
  });
}

const uploadRecipeImageTool: SpoonjoyApiOperation = {
  name: "upload_recipe_image",
  description: "Upload a recipe photo from base64 bytes and return a Spoonjoy image URL for recipe cover assignment.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      imageBase64: { type: "string" },
      mimeType: { type: "string", enum: [...FOOD_IMAGE_TYPES] },
      filename: { type: "string" },
    },
    required: ["imageBase64", "mimeType", "filename"],
    additionalProperties: false,
  },
  async handle(args, context) {
    return json(await uploadFoodImageForOwner(args, context, "recipes"));
  },
};

const uploadSpoonPhotoTool: SpoonjoyApiOperation = {
  name: "upload_spoon_photo",
  description: "Upload a spoon/cook photo from base64 bytes and return a Spoonjoy image URL for spoon assignment.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      imageBase64: { type: "string" },
      mimeType: { type: "string", enum: [...FOOD_IMAGE_TYPES] },
      filename: { type: "string" },
    },
    required: ["imageBase64", "mimeType", "filename"],
    additionalProperties: false,
  },
  async handle(args, context) {
    return json(await uploadFoodImageForOwner(args, context, "spoons"));
  },
};

const addRecipeToShoppingListTool: SpoonjoyApiOperation = {
  name: "add_recipe_to_shopping_list",
  description: "Add all ingredients from a recipe to the configured owner shopping list, merging duplicates.",
  requiredScopes: ["shopping_list:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const recipeId = requiredString(args, "recipeId");

    const owner = await getOrCreateOwner(context.db, email);
    const shoppingList = await getOrCreateShoppingList(context.db, owner.id);
    const recipe = await context.db.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
      select: { id: true },
    });
    if (!recipe) throw new Error("Recipe not found");

    const ingredients = await context.db.ingredient.findMany({
      where: { recipeId },
      orderBy: [{ stepNum: "asc" }, { id: "asc" }],
    });
    const coalesced = coalesceShoppingRecipeIngredients(
      ingredients.map((ingredient) => ({
        stepNum: ingredient.stepNum,
        ingredientId: ingredient.id,
        ingredientRefId: ingredient.ingredientRefId,
        unitId: ingredient.unitId,
        quantity: ingredient.quantity,
        categoryKey: null,
        iconKey: null,
      })),
      1,
    );
    const nativeD1 = asCompatibleD1Database(context.env?.DB);

    const boundNowMs = Date.now();
    const batch = await runAtomicShoppingListBatch({
      database: context.db,
      nativeDatabase: nativeD1,
      mutations: coalesced.map((row) => ({
        id: crypto.randomUUID(),
        shoppingListId: shoppingList.id,
        quantity: row.quantity,
        unitId: row.unitId,
        ingredientRefId: row.ingredientRefId,
        categoryKey: row.categoryKey,
        iconKey: row.iconKey,
        boundNowMs,
      })),
    });

    const result = {
      created: batch.created,
      updated: batch.updated,
      shoppingList: await reloadShoppingList(context.db, shoppingList.id),
    };

    return json({
      created: result.created,
      updated: result.updated,
      shoppingList: formatShoppingList(result.shoppingList),
    });
  },
};

const listCookbooksTool: SpoonjoyApiOperation = {
  name: "list_cookbooks",
  description: "List cookbooks owned by the configured owner, with active recipe counts and covers.",
  requiredScopes: ["cookbooks:read"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      query: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const query = optionalString(args.query);

    const cookbooks = await context.db.cookbook.findMany({
      where: {
        authorId: owner.id,
        ...(query ? { title: { contains: query } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: normalizeLimit(args.limit),
      include: cookbookSummaryInclude,
    });

    // Single batched fetch of every cookbook's recipes instead of one
    // findMany per cookbook (was up to 1 + N round-trips at the audited
    // hot path). Group in memory; per-cookbook ordering is preserved by
    // the shared `orderBy: createdAt desc` + Map insertion order.
    const cookbookIds = cookbooks.map((cookbook) => cookbook.id);
    const allRecipes = cookbookIds.length > 0
      ? await context.db.recipeInCookbook.findMany({
          where: {
            cookbookId: { in: cookbookIds },
            recipe: { deletedAt: null },
          },
          orderBy: { createdAt: "desc" },
          include: cookbookSummaryRecipeInclude,
        })
      : [];
    const byCookbook = new Map<string, typeof allRecipes>();
    for (const row of allRecipes) {
      const list = byCookbook.get(row.cookbookId);
      if (list) {
        list.push(row);
      } else {
        byCookbook.set(row.cookbookId, [row]);
      }
    }

    const summaries = cookbooks.map((cookbook) =>
      formatLeanCookbookSummary(cookbook, byCookbook.get(cookbook.id) ?? []),
    );

    return json({ cookbooks: summaries });
  },
};

const getCookbookTool: SpoonjoyApiOperation = {
  name: "get_cookbook",
  description: "Fetch one cookbook owned by the configured owner by cookbookId or exact title.",
  requiredScopes: ["cookbooks:read"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      cookbookId: { type: "string" },
      title: { type: "string" },
      cookbookTitle: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const cookbook = await findOwnerCookbook(context.db, owner.id, args);

    return json({ cookbook: cookbook ? formatCookbook(cookbook) : null });
  },
};

const createCookbookTool: SpoonjoyApiOperation = {
  name: "create_cookbook",
  description: "Create or return an existing cookbook for the configured owner by exact title.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      title: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const title = requiredString(args, "title");

    const owner = await getOrCreateOwner(context.db, email);
    const existing = await context.db.cookbook.findFirst({
      where: { authorId: owner.id, title },
      include: cookbookRecipeInclude,
    });
    const result = existing
      ? { created: false, cookbook: existing }
      : {
          created: true,
          cookbook: await reloadOwnerCookbook(
            context.db,
            owner.id,
            (await context.db.cookbook.create({ data: { authorId: owner.id, title } })).id,
          ),
        };

    return json({ created: result.created, cookbook: formatCookbook(result.cookbook) });
  },
};

const addRecipeToCookbookTool: SpoonjoyApiOperation = {
  name: "add_recipe_to_cookbook",
  description: "Idempotently add an active recipe to a cookbook owned by the configured owner.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      cookbookId: { type: "string" },
      title: { type: "string" },
      cookbookTitle: { type: "string" },
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const recipeId = requiredString(args, "recipeId");

    // Cloudflare D1 does not support Prisma's interactive
    // `$transaction(async (tx) => ...)` form, so keep this path on top-level
    // sequential writes like recipe creation and forking.
    const owner = await getOrCreateOwner(context.db, email);
    const cookbook = await findOwnerCookbook(context.db, owner.id, args);
    if (!cookbook) throw new Error("Cookbook not found");

    const recipe = await context.db.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
      select: { id: true },
    });
    if (!recipe) throw new Error("Recipe not found");

    const existing = await context.db.recipeInCookbook.findUnique({
      where: {
        cookbookId_recipeId: {
          cookbookId: cookbook.id,
          recipeId,
        },
      },
    });

    const added = !existing;
    if (added) {
      await context.db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId,
          addedById: owner.id,
        },
      });
    }

    const result = {
      added,
      ownerId: owner.id,
      cookbook: await reloadOwnerCookbook(context.db, owner.id, cookbook.id),
    };

    // Fire-and-forget: notify the recipe owner when someone else saved their
    // recipe. Only on first add (idempotent re-adds set `added=false`).
    if (result.added) {
      try {
        const env = context.env ?? {};
        const vapid = getVapidConfig(env as VapidEnv);
        const notifyTask = notifyCookbookSaveOfMine(
          context.db,
          { recipeId, actorId: result.ownerId },
          {
            vapid,
            waitUntil: context.waitUntil,
            postHogConfig: resolvePostHogServerConfig(env),
          },
        );
        await runOrSchedule(context, notifyTask);
      } catch {
        // VAPID not configured — skip silently.
      }
    }

    return json({ added: result.added, cookbook: formatCookbook(result.cookbook) });
  },
};

const removeRecipeFromCookbookTool: SpoonjoyApiOperation = {
  name: "remove_recipe_from_cookbook",
  description: "Idempotently remove a recipe from a cookbook owned by the configured owner.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      cookbookId: { type: "string" },
      title: { type: "string" },
      cookbookTitle: { type: "string" },
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const recipeId = requiredString(args, "recipeId");

    const owner = await getOrCreateOwner(context.db, email);
    const cookbook = await findOwnerCookbook(context.db, owner.id, args);
    if (!cookbook) throw new Error("Cookbook not found");

    const deleted = await context.db.recipeInCookbook.deleteMany({
      where: {
        cookbookId: cookbook.id,
        recipeId,
      },
    });
    const result = {
      removed: deleted.count > 0,
      cookbook: await reloadOwnerCookbook(context.db, owner.id, cookbook.id),
    };

    return json({ removed: result.removed, cookbook: formatCookbook(result.cookbook) });
  },
};

const addShoppingListItemTool: SpoonjoyApiOperation = {
  name: "add_shopping_list_item",
  description: "Add or restore one manual item on the configured owner shopping list, merging matching items.",
  requiredScopes: ["shopping_list:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      name: { type: "string" },
      quantity: { type: "number", exclusiveMinimum: 0 },
      unit: { type: "string" },
      categoryKey: { type: "string" },
      iconKey: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const name = requiredString(args, "name");
    const quantity = optionalQuantity(args.quantity, "quantity");
    const unitName = optionalString(args.unit);
    const categoryKey = optionalString(args.categoryKey) ?? null;
    const iconKey = optionalString(args.iconKey) ?? null;

    const owner = await getOrCreateOwner(context.db, email);
    const shoppingList = await getOrCreateShoppingList(context.db, owner.id);
    const ingredientRef = await getOrCreateIngredientRef(context.db, name);
    const unit = unitName ? await getOrCreateUnit(context.db, unitName) : null;
    const mutation = await mutateAtomicShoppingListItem({
      database: context.db,
      nativeDatabase: asCompatibleD1Database(context.env?.DB),
      mutation: {
        id: crypto.randomUUID(),
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        unitId: unit?.id ?? null,
        quantity,
        categoryKey,
        iconKey,
        boundNowMs: Date.now(),
      },
    });
    const result = {
      created: mutation.created ? 1 : 0,
      updated: mutation.created ? 0 : 1,
      shoppingList: await reloadShoppingList(context.db, shoppingList.id),
    };

    return json({
      created: result.created,
      updated: result.updated,
      shoppingList: formatShoppingList(result.shoppingList),
    });
  },
};

const setShoppingListItemCheckedTool: SpoonjoyApiOperation = {
  name: "set_shopping_list_item_checked",
  description: "Set checked state for one active item on the configured owner shopping list.",
  requiredScopes: ["shopping_list:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      itemId: { type: "string" },
      checked: { type: "boolean" },
    },
    required: ["itemId", "checked"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const itemId = requiredString(args, "itemId");
    const checked = requiredBoolean(args, "checked");

    const owner = await getOrCreateOwner(context.db, email);
    const shoppingList = await getOrCreateShoppingList(context.db, owner.id);
    const item = await context.db.shoppingListItem.findFirst({
      where: { id: itemId, shoppingListId: shoppingList.id, deletedAt: null },
    });
    if (!item) throw new Error("Shopping list item not found");

    await context.db.shoppingListItem.update({
      where: { id: item.id },
      data: {
        checked,
        checkedAt: checked ? new Date() : null,
        sortIndex: checked ? await nextSortIndex(context.db, shoppingList.id) : item.sortIndex,
      },
    });

    const result = await reloadShoppingList(context.db, shoppingList.id);

    return json({ shoppingList: formatShoppingList(result) });
  },
};

const removeShoppingListItemTool: SpoonjoyApiOperation = {
  name: "remove_shopping_list_item",
  description: "Soft-remove one item from the configured owner shopping list.",
  requiredScopes: ["shopping_list:write"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
      itemId: { type: "string" },
    },
    required: ["itemId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const itemId = requiredString(args, "itemId");

    const owner = await getOrCreateOwner(context.db, email);
    const shoppingList = await getOrCreateShoppingList(context.db, owner.id);
    const item = await context.db.shoppingListItem.findFirst({
      where: { id: itemId, shoppingListId: shoppingList.id },
    });
    if (!item) throw new Error("Shopping list item not found");

    if (!item.deletedAt) {
      await context.db.shoppingListItem.update({
        where: { id: item.id },
        data: { deletedAt: new Date() },
      });
    }

    const result = await reloadShoppingList(context.db, shoppingList.id);

    return json({ shoppingList: formatShoppingList(result) });
  },
};

const getShoppingListTool: SpoonjoyApiOperation = {
  name: "get_shopping_list",
  description: "Fetch the configured owner shopping list.",
  requiredScopes: ["shopping_list:read"],
  inputSchema: {
    type: "object",
    properties: {
      ownerEmail: { type: "string" },
    },
    additionalProperties: false,
  },
  async handle(args, context) {
    const email = requireOwnerEmail(args, context);
    const owner = await getOrCreateOwner(context.db, email);
    const shoppingList = await getOrCreateShoppingList(context.db, owner.id);
    const reloaded = await reloadShoppingList(context.db, shoppingList.id);

    return json({ shoppingList: formatShoppingList(reloaded) });
  },
};

const createSpoonTool: SpoonjoyApiOperation = {
  name: "create_spoon",
  description: "Create a RecipeSpoon (cook event) authored by the authenticated principal.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      photoUrl: { type: "string" },
      note: { type: "string" },
      nextTime: { type: "string" },
      cookedAt: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const photoUrl = optionalString(args.photoUrl) ?? null;
    const photoAssignment = photoUrl
      ? await validateSpoonPhotoAssignment({
          photoUrl,
          ownerId: principal.id,
          bucket: context.bucket,
          allowLocalImageFallback: context.allowLocalImageFallback,
        })
      : { stylizable: false };
    const cookedAtRaw = optionalString(args.cookedAt);
    const cookedAt = cookedAtRaw ? new Date(cookedAtRaw) : undefined;
    if (cookedAt && Number.isNaN(cookedAt.getTime())) {
      throw new Error("cookedAt must be a valid ISO date string");
    }

    const result = await createRecipeSpoon(context.db, {
      chefId: principal.id,
      recipeId,
      photoUrl,
      note: optionalString(args.note) ?? null,
      nextTime: optionalString(args.nextTime) ?? null,
      cookedAt,
    });

    // Notify the recipe owner when someone else cooks their recipe.
    try {
      const env = context.env ?? {};
      const vapid = getVapidConfig(env as VapidEnv);
      const notifyTask = notifySpoonOnMyRecipe(
        context.db,
        { recipeId, spoonerId: principal.id },
        {
          vapid,
          waitUntil: context.waitUntil,
          postHogConfig: resolvePostHogServerConfig(env),
        },
      );
      await runOrSchedule(context, notifyTask);
    } catch {
      // VAPID not configured — skip silently.
    }

    let coverPayload: ReturnType<typeof formatCover> | null = null;
    if (result.isOriginCook && result.spoon.photoUrl) {
      const recipe = await context.db.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { id: true, title: true },
      });
      const cover = await createCover(context.db, {
        recipeId,
        imageUrl: result.spoon.photoUrl,
        sourceType: "spoon",
        sourceSpoonId: result.spoon.id,
      });
      if (photoAssignment.stylizable) {
        await scheduleRecipeCoverStylization(context, {
          userId: principal.id,
          recipeId,
          coverId: cover.id,
          rawPhotoUrl: result.spoon.photoUrl,
          recipeTitle: recipe.title,
          sourceType: "spoon",
        });
      }
      coverPayload = formatCover(
        await context.db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } }),
      );
    }

    // Fan-out fellow_chef_origin_cook to every chef the spooner has previously
    // engaged with — runs only when the spoon was an origin cook.
    if (result.isOriginCook) {
      try {
        const env = context.env ?? {};
        const vapid = getVapidConfig(env as VapidEnv);
        const recipeMeta = await context.db.recipe.findUniqueOrThrow({
          where: { id: recipeId },
          select: { id: true, title: true },
        });
        const fanoutTask = fanoutFellowChefOriginCook(
          context.db,
          {
            spoonerId: principal.id,
            recipeId: recipeMeta.id,
            recipeTitle: recipeMeta.title,
            spoonerUsername: principal.username,
          },
          {
            vapid,
            waitUntil: context.waitUntil,
            postHogConfig: resolvePostHogServerConfig(env),
          },
        );
        await runOrSchedule(context, fanoutTask);
      } catch {
        // VAPID not configured — skip silently.
      }
    }

    return json({
      spoon: formatSpoon(result.spoon),
      isOriginCook: result.isOriginCook,
      cover: coverPayload,
    });
  },
};

const updateSpoonTool: SpoonjoyApiOperation = {
  name: "update_spoon",
  description: "Update note, nextTime, photoUrl, or cookedAt on a spoon owned by the authenticated principal.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      spoonId: { type: "string" },
      note: { type: "string" },
      nextTime: { type: "string" },
      photoUrl: { type: ["string", "null"] },
      cookedAt: { type: "string" },
    },
    required: ["spoonId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const spoonId = requiredString(args, "spoonId");
    const patch: {
      note?: string | null;
      nextTime?: string | null;
      photoUrl?: string | null;
      cookedAt?: Date;
    } = {};
    if (Object.prototype.hasOwnProperty.call(args, "note")) {
      patch.note = typeof args.note === "string" ? args.note : null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "nextTime")) {
      patch.nextTime = typeof args.nextTime === "string" ? args.nextTime : null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "photoUrl")) {
      patch.photoUrl = typeof args.photoUrl === "string" ? args.photoUrl : null;
    }
    if (Object.prototype.hasOwnProperty.call(args, "cookedAt")) {
      const cookedAtRaw = optionalString(args.cookedAt);
      const cookedAt = cookedAtRaw ? new Date(cookedAtRaw) : undefined;
      if (!cookedAt || Number.isNaN(cookedAt.getTime())) {
        throw new Error("cookedAt must be a valid ISO date string");
      }
      patch.cookedAt = cookedAt;
    }

    const photoAssignment = typeof patch.photoUrl === "string" && patch.photoUrl
      ? await validateSpoonPhotoAssignment({
          photoUrl: patch.photoUrl,
          ownerId: principal.id,
          bucket: context.bucket,
          allowLocalImageFallback: context.allowLocalImageFallback,
        })
      : { stylizable: false };

    const spoon = await updateRecipeSpoon(context.db, spoonId, principal.id, patch);
    let coverPayload: ReturnType<typeof formatCover> | null = null;
    if (patch.photoUrl !== undefined && spoon.photoUrl) {
      const recipe = await context.db.recipe.findUniqueOrThrow({
        where: { id: spoon.recipeId },
        select: { id: true, title: true, chefId: true },
      });
      const existingOriginCover = recipe.chefId === principal.id
        ? await context.db.recipeCover.findFirst({
            where: {
              recipeId: spoon.recipeId,
              sourceSpoonId: spoon.id,
            },
            select: { id: true },
          })
        : null;
      if (existingOriginCover) {
        const cover = await createCover(context.db, {
          recipeId: spoon.recipeId,
          imageUrl: spoon.photoUrl,
          sourceType: "spoon",
          sourceSpoonId: spoon.id,
        });
        if (photoAssignment.stylizable) {
          await scheduleRecipeCoverStylization(context, {
            userId: principal.id,
            recipeId: spoon.recipeId,
            coverId: cover.id,
            rawPhotoUrl: spoon.photoUrl,
            recipeTitle: recipe.title,
            sourceType: "spoon",
          });
        }
        coverPayload = formatCover(
          await context.db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } }),
        );
      }
    }
    return json({ spoon: formatSpoon(spoon), cover: coverPayload });
  },
};

function formatSpoonWithChef(spoon: {
  id: string;
  chefId: string;
  recipeId: string;
  cookedAt: Date;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  chef: { id: string; username: string; photoUrl: string | null };
}) {
  return {
    ...formatSpoon(spoon),
    chef: spoon.chef,
  };
}

const listSpoonsForRecipeTool: SpoonjoyApiOperation = {
  name: "list_spoons_for_recipe",
  description: "List the most-recent non-deleted spoons for a recipe.",
  requiredScopes: ["recipes:read"],
  inputSchema: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    requireApiPrincipal(context.principal);
    const recipeId = requiredString(args, "recipeId");
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const spoons = await listSpoonsForRecipe(context.db, recipeId, {
      limit,
      offset,
    });
    const recipe = await context.db.recipe.findUnique({
      where: { id: recipeId },
      include: {
        covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      },
    });
    const coverFields = recipe ? activeCoverDisplayFields(recipe, recipe.covers) : null;
    return json({
      spoons: spoons.map((spoon) => ({
        ...formatSpoonWithChef(spoon),
        coverImageUrl: coverFields?.coverImageUrl ?? null,
        coverProvenanceLabel: coverFields?.coverProvenanceLabel ?? null,
        coverSourceType: coverFields?.coverSourceType ?? null,
        coverVariant: coverFields?.coverVariant ?? null,
        coverStatus: coverFields?.coverStatus ?? null,
        coverGenerationStatus: coverFields?.coverGenerationStatus ?? null,
      })),
    });
  },
};

const listSpoonsByChefTool: SpoonjoyApiOperation = {
  name: "list_spoons_by_chef",
  description: "List the chef's most-recent non-deleted spoons across all recipes.",
  requiredScopes: ["recipes:read"],
  inputSchema: {
    type: "object",
    properties: {
      chefIdOrUsername: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" },
    },
    required: ["chefIdOrUsername"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    requireApiPrincipal(context.principal);
    const chefIdOrUsername = requiredString(args, "chefIdOrUsername");
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const spoons = await listSpoonsByChef(context.db, chefIdOrUsername, {
      limit,
      offset,
    });
    return json({
      spoons: spoons.map((spoon) => {
        const coverFields = activeCoverDisplayFields(spoon.recipe, spoon.recipe.covers);
        return {
          ...formatSpoonWithChef(spoon),
          recipe: {
            id: spoon.recipe.id,
            title: spoon.recipe.title,
            chefId: spoon.recipe.chefId,
          },
          coverImageUrl: coverFields.coverImageUrl,
          coverProvenanceLabel: coverFields.coverProvenanceLabel,
          coverSourceType: coverFields.coverSourceType,
          coverVariant: coverFields.coverVariant,
          coverStatus: coverFields.coverStatus,
          coverGenerationStatus: coverFields.coverGenerationStatus,
        };
      }),
    });
  },
};

const deleteSpoonTool: SpoonjoyApiOperation = {
  name: "delete_spoon",
  description: "Soft-delete a spoon owned by the authenticated principal.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: { spoonId: { type: "string" } },
    required: ["spoonId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const spoonId = requiredString(args, "spoonId");
    const spoon = await deleteRecipeSpoon(context.db, spoonId, principal.id);
    return json({ spoon: formatSpoon(spoon) });
  },
};

const importRecipeFromUrlTool: SpoonjoyApiOperation = {
  name: "import_recipe_from_url",
  description:
    "Import a recipe from a public web URL into the authenticated principal's library.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      dryRun: { type: "boolean", default: false },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const url = requiredString(args, "url");
    const dryRun = args.dryRun === true;
    const chefId = await resolveImportChefId(context);
    const result = await recipeImport.importRecipeFromUrl(
      { url, chefId, dryRun },
      {
        db: context.db,
        env: context.env ?? undefined,
        bucket: context.bucket,
        waitUntil: context.waitUntil,
        imageGenRunner: context.imageGenRunner,
        logger: context.logger,
      },
    );
    return json({
      recipe: projectLegacyImportRecipe(result.recipe, dryRun),
      recipeId: result.recipeId,
      confidence: result.confidence,
      source: result.source,
      existingRecipeId: result.existingRecipeId,
      coverPending: result.coverPending,
    });
  },
};

async function resolveImportChefId(context: SpoonjoyApiContext): Promise<string> {
  if (context.principal) return context.principal.id;
  const email = context.defaultOwnerEmail?.toLowerCase();
  if (!email) {
    throw new ApiAuthError("Authentication required for import_recipe_from_url", 401);
  }
  const user = await context.db.user.findUnique({ where: { email } });
  if (!user) {
    throw new ApiAuthError(
      "Authentication required: defaultOwnerEmail does not match any user",
      401,
    );
  }
  return user.id;
}

const forkRecipeTool: SpoonjoyApiOperation = {
  name: "fork_recipe",
  description:
    "Fork an existing Spoonjoy recipe into the authenticated principal's kitchen. Clones title, description, servings, steps, ingredients, and step-output uses; snapshots the source's latest cover; sets sourceRecipeId on the new recipe.",
  requiredScopes: ["kitchen:write"],
  inputSchema: {
    type: "object",
    properties: {
      sourceRecipeId: { type: "string" },
      title: {
        type: "string",
        description:
          "Optional title override. Subject to the same `(chefId, title)` collision suffixing as the default title.",
      },
    },
    required: ["sourceRecipeId"],
    additionalProperties: false,
  },
  async handle(args, context) {
    rejectOwnerEmail(args);
    const principal = requireApiPrincipal(context.principal);
    const sourceRecipeId = requiredString(args, "sourceRecipeId");
    const titleOverride = optionalString(args.title) ?? null;

    try {
      const result = await forkRecipe(context.db, {
        sourceRecipeId,
        viewerId: principal.id,
        titleOverride,
      });

      // Fire-and-forget: notify the source chef when someone else forked.
      try {
        const env = context.env ?? {};
        const vapid = getVapidConfig(env as VapidEnv);
        const notifyTask = notifyForkOfMyRecipe(
          context.db,
          {
            forkedRecipeId: result.recipe.id,
            sourceRecipeId: result.attribution.sourceRecipeId,
            forkerId: principal.id,
            sourceChefId: result.attribution.sourceChef.id,
            appliedTitle: result.appliedTitle,
          },
          {
            vapid,
            waitUntil: context.waitUntil,
            postHogConfig: resolvePostHogServerConfig(env),
          },
        );
        await runOrSchedule(context, notifyTask);
      } catch {
        // VAPID not configured — skip silently.
      }

      return json({
        recipeId: result.recipe.id,
        recipe: formatRecipe(result.recipe),
        attribution: result.attribution,
        appliedTitle: result.appliedTitle,
        titleWasSuffixed: result.titleWasSuffixed,
      });
    } catch (err) {
      if (err instanceof ForkSourceNotFoundError) {
        throw new ApiAuthError("Source recipe not found", 404);
      }
      if (err instanceof ForkTitleExhaustedError) {
        throw new ApiAuthError(
          "Could not resolve a unique title for the fork",
          409,
        );
      }
      throw err;
    }
  },
};

const tools: SpoonjoyApiOperation[] = [
  healthTool,
  authStatusTool,
  startAgentConnectionTool,
  pollAgentConnectionTool,
  createApiTokenTool,
  listApiTokensTool,
  revokeApiTokenTool,
  searchSpoonjoyTool,
  searchRecipesTool,
  searchShoppingListTool,
  getRecipeTool,
  listRecipeCoversTool,
  listRecipeSpoonImagesTool,
  createRecipeCoverFromUploadTool,
  generateRecipeCoverPlaceholderTool,
  createRecipeCoverFromSpoonTool,
  regenerateRecipeCoverTool,
  getCoverGenerationStatusTool,
  setActiveRecipeCoverTool,
  setRecipeNoCoverTool,
  archiveRecipeCoverTool,
  createRecipeTool,
  updateRecipeTool,
  deleteRecipeTool,
  uploadRecipeImageTool,
  uploadSpoonPhotoTool,
  importRecipeFromUrlTool,
  forkRecipeTool,
  addRecipeToShoppingListTool,
  listCookbooksTool,
  getCookbookTool,
  createCookbookTool,
  addRecipeToCookbookTool,
  removeRecipeFromCookbookTool,
  addShoppingListItemTool,
  setShoppingListItemCheckedTool,
  removeShoppingListItemTool,
  getShoppingListTool,
  createSpoonTool,
  updateSpoonTool,
  deleteSpoonTool,
  listSpoonsForRecipeTool,
  listSpoonsByChefTool,
];

/**
 * MCP annotations for every operation, keyed by tool name. Kept here (next to
 * the registry) so reviewers can see the read/write classification at a glance.
 * Completeness is enforced by a test that asserts every operation in `tools`
 * has an entry and that there are no orphans.
 */
const TOOL_ANNOTATIONS = {
  health: { title: "Health check", readOnlyHint: true },
  auth_status: { title: "Authentication status", readOnlyHint: true },
  start_agent_connection: { title: "Start delegated connection", readOnlyHint: false, destructiveHint: false },
  poll_agent_connection: { title: "Poll delegated connection", readOnlyHint: false, destructiveHint: false },
  create_api_token: { title: "Create API token", readOnlyHint: false, destructiveHint: false },
  list_api_tokens: { title: "List API tokens", readOnlyHint: true },
  revoke_api_token: { title: "Revoke API token", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  search_spoonjoy: { title: "Search Spoonjoy", readOnlyHint: true },
  search_recipes: { title: "Search recipes", readOnlyHint: true },
  search_shopping_list: { title: "Search shopping list", readOnlyHint: true },
  get_recipe: { title: "Get recipe", readOnlyHint: true },
  list_recipe_covers: { title: "List recipe covers", readOnlyHint: true },
  list_recipe_spoon_images: { title: "List recipe spoon images", readOnlyHint: true },
  create_recipe_cover_from_upload: { title: "Create recipe cover from upload", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  generate_recipe_cover_placeholder: { title: "Generate recipe cover placeholder", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  create_recipe_cover_from_spoon: { title: "Create recipe cover from spoon", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  regenerate_recipe_cover: { title: "Regenerate recipe cover", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  get_cover_generation_status: { title: "Get cover generation status", readOnlyHint: true },
  set_active_recipe_cover: { title: "Set active recipe cover", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  set_recipe_no_cover: { title: "Set recipe no cover", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  archive_recipe_cover: { title: "Archive recipe cover", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  create_recipe: { title: "Create recipe", readOnlyHint: false, destructiveHint: false },
  update_recipe: { title: "Update recipe", readOnlyHint: false, destructiveHint: true },
  delete_recipe: { title: "Delete recipe", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  upload_recipe_image: { title: "Upload recipe image", readOnlyHint: false, destructiveHint: false },
  upload_spoon_photo: { title: "Upload spoon photo", readOnlyHint: false, destructiveHint: false },
  import_recipe_from_url: { title: "Import recipe from URL", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  fork_recipe: { title: "Fork recipe", readOnlyHint: false, destructiveHint: false },
  add_recipe_to_shopping_list: { title: "Add recipe to shopping list", readOnlyHint: false, destructiveHint: false },
  list_cookbooks: { title: "List cookbooks", readOnlyHint: true },
  get_cookbook: { title: "Get cookbook", readOnlyHint: true },
  create_cookbook: { title: "Create cookbook", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  add_recipe_to_cookbook: { title: "Add recipe to cookbook", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  remove_recipe_from_cookbook: { title: "Remove recipe from cookbook", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  add_shopping_list_item: { title: "Add shopping-list item", readOnlyHint: false, destructiveHint: false },
  set_shopping_list_item_checked: { title: "Check shopping-list item", readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  remove_shopping_list_item: { title: "Remove shopping-list item", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  get_shopping_list: { title: "Get shopping list", readOnlyHint: true },
  create_spoon: { title: "Log a cook", readOnlyHint: false, destructiveHint: false },
  update_spoon: { title: "Update a cook", readOnlyHint: false, destructiveHint: false },
  delete_spoon: { title: "Delete a cook", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  list_spoons_for_recipe: { title: "List cooks for recipe", readOnlyHint: true },
  list_spoons_by_chef: { title: "List cooks by chef", readOnlyHint: true },
} satisfies Record<string, McpToolAnnotations>;

export function listSpoonjoyApiOperations(): SpoonjoyMcpToolDescriptor[] {
  return tools.map(({ name, description, inputSchema, requiredScopes }) => {
    const annotations = TOOL_ANNOTATIONS[name as keyof typeof TOOL_ANNOTATIONS];
    return { name, title: annotations.title, description, inputSchema, requiredScopes, annotations };
  });
}

function assertToolScopes(tool: SpoonjoyApiOperation, context: SpoonjoyApiContext) {
  if (!context.principal || !tool.requiredScopes?.length) return;
  const principalScopes = new Set(context.principal.scopes);
  const missing = tool.requiredScopes.find((scope) => !principalScopes.has(scope));
  if (missing) {
    throw new ApiAuthError(`Missing required scope: ${missing}`, 403);
  }
}

function schemaObject(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function schemaHasType(schema: Record<string, unknown>, type: string): boolean {
  const schemaType = schema.type;
  return schemaType === type || (Array.isArray(schemaType) && schemaType.includes(type));
}

function assertNoUnknownArguments(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
): void {
  const objectSchema = schemaHasType(schema, "object") || schemaObject(schema.properties) !== null;
  if (objectSchema) {
    const objectValue = schemaObject(value);
    if (!objectValue) return;
    const properties = schemaObject(schema.properties) ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(objectValue)) {
        const topLevelOwnerEmail = path === "create_spoon" || path === "update_spoon" ||
          path === "list_spoons_for_recipe" || path === "list_spoons_by_chef" ||
          path === "delete_spoon" || path === "import_recipe_from_url" ||
          path === "fork_recipe";
        if (!(key in properties) && !(topLevelOwnerEmail && key === "ownerEmail")) {
          throw new ApiAuthError(`${path}.${key} is not allowed`, 400);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      const childSchema = schemaObject(propertySchema);
      if (childSchema && Object.prototype.hasOwnProperty.call(objectValue, key)) {
        assertNoUnknownArguments(childSchema, objectValue[key], `${path}.${key}`);
      }
    }
    return;
  }

  if (schemaHasType(schema, "array") && Array.isArray(value)) {
    const itemSchema = schemaObject(schema.items);
    if (!itemSchema) return;
    value.forEach((item, index) => {
      assertNoUnknownArguments(itemSchema, item, `${path}[${index}]`);
    });
  }
}

export const __internal__ = {
  assertNoUnknownArguments,
};

export async function callSpoonjoyApiOperation(
  name: string,
  args: Record<string, unknown>,
  context: SpoonjoyApiContext
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown Spoonjoy operation: ${name}`);
  assertToolScopes(tool, context);
  assertNoUnknownArguments(tool.inputSchema, args, name);
  return tool.handle(args, context);
}
