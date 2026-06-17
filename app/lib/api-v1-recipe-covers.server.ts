import type { ApiIdempotencyKey, Prisma, PrismaClient as PrismaClientType, RecipeCover } from "@prisma/client";
import { ApiAuthError } from "~/lib/api-auth.server";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import {
  hasUploadedImageFile,
  deleteStoredImage,
  getImageExtension,
  storeImage,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import { RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE, FOOD_IMAGE_TYPES } from "~/lib/recipe-image";
import { validateRecipeImageAssignment } from "~/lib/recipe-image-assignment.server";
import {
  getRecipeCoverProvenanceLabel,
  setActiveRecipeCover,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";

type Database = PrismaClientType;
type NativeCoverRecipe = {
  id: string;
  title: string;
  chefId: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
};

export type ApiV1RecipeCoverResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export interface NativeRecipeCoverUploadInput {
  clientMutationId: string;
  file: File;
  fileHash: string;
  activate: boolean;
  generateEditorial: boolean;
}

export interface NativeRecipeCoverCreateInput {
  clientMutationId: string;
  imageUrl: string;
  activate: boolean;
  generateEditorial: boolean;
}

export interface NativeRecipeCoverActivateInput {
  clientMutationId: string;
  variant: RecipeCoverVariant;
}

export interface NativeRecipeCoverArchiveInput {
  clientMutationId: string;
  replacementCoverId: string | null;
  replacementVariant: RecipeCoverVariant | null;
  confirmNoCover: boolean;
  deleteSafeObjects: boolean;
}

export interface NativeRecipeCoverRegenerateInput {
  clientMutationId: string;
  coverId: string;
  activateWhenReady: boolean;
}

export interface NativeRecipeCoverFromSpoonInput {
  clientMutationId: string;
  activate: boolean;
  generateEditorial: boolean;
}

type FullCoverPayload = {
  id: string;
  recipeId: string;
  status: string;
  sourceType: string;
  imageUrl: string;
  stylizedImageUrl: string | null;
  displayUrl: string | null;
  activeVariant: RecipeCoverVariant | null;
  provenanceLabel: string | null;
  sourceSpoonId: string | null;
  createdById: string | null;
  archivedAt: string | null;
  generationStatus: string;
  failureReason: string | null;
  sourceImageUrl: string | null;
  createdAt: string;
};

type ProviderSecretBlocker = {
  blocked: true;
  capability: "ProviderSecret";
  command: string;
  domain: "recipe-covers";
  outputPath: string;
  ownerAction: string;
  reason: string;
};

export type CoverMutationPayload = {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  createdCover: FullCoverPayload | null;
  generationStatus: string;
  warnings: string[];
  blockers: ProviderSecretBlocker[];
  nextActions: string[];
  mutation: { clientMutationId: string; replayed: boolean };
};

export type ActiveCoverMutationPayload = {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  archivedCover: FullCoverPayload | null;
  warnings: string[];
  blockers: ProviderSecretBlocker[];
  nextActions: string[];
  mutation: { clientMutationId: string; replayed: boolean };
};

type NativeCoverMutationResult = {
  status: number;
  data: CoverMutationPayload | ActiveCoverMutationPayload;
};

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const DELETE_SAFE_OBJECTS_WARNING = "deleteSafeObjects is not implemented; the cover record was archived without deleting image objects.";

function success<T>(data: T, status = 200): ApiV1RecipeCoverResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1RecipeCoverResult<T> {
  return { ok: false, code, message, details };
}

function fieldFailure<T>(field: string, message: string): ApiV1RecipeCoverResult<T> {
  return failure("validation_error", "Invalid recipe cover fields", { fieldErrors: { [field]: message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function assertKnownFields<T>(
  body: Record<string, unknown>,
  allowed: readonly string[],
): ApiV1RecipeCoverResult<T> | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((field) => !allowedSet.has(field));
  return unknown.length > 0
    ? failure("validation_error", "Unknown request body fields", { fields: unknown })
    : null;
}

function hasOwn(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function nonblankString(value: unknown, field: string): ApiV1RecipeCoverResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return fieldFailure(field, `${field} must be a nonblank string`);
  }
  return success(value.trim());
}

function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  fallback = false,
): ApiV1RecipeCoverResult<boolean> {
  if (!hasOwn(body, field)) return success(fallback);
  if (typeof body[field] !== "boolean") return fieldFailure(field, `${field} must be a boolean`);
  return success(body[field]);
}

function optionalFormBoolean(
  value: FormDataEntryValue | null,
  field: string,
  fallback = false,
): ApiV1RecipeCoverResult<boolean> {
  if (value === null) return success(fallback);
  if (typeof value !== "string" || (value !== "true" && value !== "false")) {
    return fieldFailure(field, `${field} must be true or false`);
  }
  return success(value === "true");
}

function optionalString(value: unknown, field: string): ApiV1RecipeCoverResult<string | null> {
  if (value === undefined || value === null) return success(null);
  if (typeof value !== "string") return fieldFailure(field, `${field} must be a string`);
  const trimmed = value.trim();
  return success(trimmed ? trimmed : null);
}

function requiredCoverVariant(value: unknown, field: string): ApiV1RecipeCoverResult<RecipeCoverVariant> {
  const parsed = nonblankString(value, field);
  if (!parsed.ok) return parsed;
  if (parsed.data !== "image" && parsed.data !== "stylized") {
    return failure("validation_error", `${field} must be image or stylized`);
  }
  return success(parsed.data);
}

function optionalCoverVariant(value: unknown, field: string): ApiV1RecipeCoverResult<RecipeCoverVariant | null> {
  if (value === undefined || value === null) return success(null);
  return requiredCoverVariant(value, field);
}

function requestClientMutationId(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1RecipeCoverResult<string> {
  return nonblankString(body.clientMutationId ?? fallbackClientMutationId, "clientMutationId");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return bytesToHex(new Uint8Array(digest));
}

export async function parseNativeRecipeCoverUploadRequest(
  request: Request,
): Promise<ApiV1RecipeCoverResult<NativeRecipeCoverUploadInput>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return failure("validation_error", "Recipe image upload must be multipart/form-data", {
      reason: "invalid_content_type",
      fieldErrors: { image: "Please upload an image file" },
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("validation_error", "Recipe image upload must be valid multipart form data", {
      reason: "invalid_form_data",
      fieldErrors: { image: "Please upload an image file" },
    });
  }

  const file = formData.get("image");
  if (!hasUploadedImageFile(file)) {
    return failure("validation_error", "Please select a recipe image to upload", {
      reason: "no_file",
      fieldErrors: { image: "Please select a recipe image to upload" },
    });
  }

  const validationError = await validateImageFileForStorage(file, {
    allowedTypes: FOOD_IMAGE_TYPES,
    messages: {
      invalidType: RECIPE_IMAGE_TYPE_MESSAGE,
      fileTooLarge: RECIPE_IMAGE_SIZE_MESSAGE,
    },
  });
  if (validationError) {
    return failure("validation_error", validationError, {
      reason: validationError === RECIPE_IMAGE_SIZE_MESSAGE ? "file_too_large" : "invalid_file_type",
      fieldErrors: { image: validationError },
    });
  }

  const clientMutationId = nonblankString(
    formData.get("clientMutationId") ?? request.headers.get("X-Client-Mutation-Id"),
    "clientMutationId",
  );
  if (!clientMutationId.ok) return clientMutationId;

  const activate = optionalFormBoolean(formData.get("activate"), "activate");
  if (!activate.ok) return activate;

  const generateEditorial = optionalFormBoolean(formData.get("generateEditorial"), "generateEditorial", true);
  if (!generateEditorial.ok) return generateEditorial;

  return success({
    clientMutationId: clientMutationId.data,
    file,
    fileHash: await hashFile(file),
    activate: activate.data,
    generateEditorial: generateEditorial.data,
  });
}

export function nativeRecipeCoverUploadIdempotencyBody(input: NativeRecipeCoverUploadInput) {
  return {
    clientMutationId: input.clientMutationId,
    activate: input.activate,
    generateEditorial: input.generateEditorial,
    image: {
      name: input.file.name,
      type: input.file.type,
      size: input.file.size,
      sha256: input.fileHash,
    },
  };
}

export function parseNativeRecipeCoverCreateBody(
  body: Record<string, unknown>,
): ApiV1RecipeCoverResult<NativeRecipeCoverCreateInput> {
  const unknown = assertKnownFields<NativeRecipeCoverCreateInput>(body, [
    "clientMutationId",
    "imageUrl",
    "activate",
    "generateEditorial",
  ]);
  if (unknown) return unknown;

  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  const imageUrl = nonblankString(body.imageUrl, "imageUrl");
  if (!imageUrl.ok) return imageUrl;
  const activate = optionalBoolean(body, "activate");
  if (!activate.ok) return activate;
  const generateEditorial = optionalBoolean(body, "generateEditorial", true);
  if (!generateEditorial.ok) return generateEditorial;

  return success({
    clientMutationId: clientMutationId.data,
    imageUrl: imageUrl.data,
    activate: activate.data,
    generateEditorial: generateEditorial.data,
  });
}

export function parseNativeRecipeCoverActivateBody(
  body: Record<string, unknown>,
): ApiV1RecipeCoverResult<NativeRecipeCoverActivateInput> {
  const unknown = assertKnownFields<NativeRecipeCoverActivateInput>(body, ["clientMutationId", "variant"]);
  if (unknown) return unknown;
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  const variant = requiredCoverVariant(body.variant, "variant");
  if (!variant.ok) return variant;
  return success({ clientMutationId: clientMutationId.data, variant: variant.data });
}

export function parseNativeRecipeCoverArchiveBody(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1RecipeCoverResult<NativeRecipeCoverArchiveInput> {
  const unknown = assertKnownFields<NativeRecipeCoverArchiveInput>(body, [
    "clientMutationId",
    "replacementCoverId",
    "replacementVariant",
    "confirmNoCover",
    "deleteSafeObjects",
  ]);
  if (unknown) return unknown;
  const clientMutationId = requestClientMutationId(body, fallbackClientMutationId);
  if (!clientMutationId.ok) return clientMutationId;
  const replacementCoverId = optionalString(body.replacementCoverId, "replacementCoverId");
  if (!replacementCoverId.ok) return replacementCoverId;
  const replacementVariant = optionalCoverVariant(body.replacementVariant, "replacementVariant");
  if (!replacementVariant.ok) return replacementVariant;
  const confirmNoCover = optionalBoolean(body, "confirmNoCover");
  if (!confirmNoCover.ok) return confirmNoCover;
  const deleteSafeObjects = optionalBoolean(body, "deleteSafeObjects");
  if (!deleteSafeObjects.ok) return deleteSafeObjects;
  return success({
    clientMutationId: clientMutationId.data,
    replacementCoverId: replacementCoverId.data,
    replacementVariant: replacementVariant.data,
    confirmNoCover: confirmNoCover.data,
    deleteSafeObjects: deleteSafeObjects.data,
  });
}

export function parseNativeRecipeCoverRegenerateBody(
  body: Record<string, unknown>,
): ApiV1RecipeCoverResult<NativeRecipeCoverRegenerateInput> {
  const unknown = assertKnownFields<NativeRecipeCoverRegenerateInput>(body, [
    "clientMutationId",
    "coverId",
    "activateWhenReady",
  ]);
  if (unknown) return unknown;
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  const coverId = nonblankString(body.coverId, "coverId");
  if (!coverId.ok) return coverId;
  const activateWhenReady = optionalBoolean(body, "activateWhenReady");
  if (!activateWhenReady.ok) return activateWhenReady;
  return success({ clientMutationId: clientMutationId.data, coverId: coverId.data, activateWhenReady: activateWhenReady.data });
}

export function parseNativeRecipeCoverFromSpoonBody(
  body: Record<string, unknown>,
): ApiV1RecipeCoverResult<NativeRecipeCoverFromSpoonInput> {
  const unknown = assertKnownFields<NativeRecipeCoverFromSpoonInput>(body, [
    "clientMutationId",
    "activate",
    "generateEditorial",
  ]);
  if (unknown) return unknown;
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  const activate = optionalBoolean(body, "activate");
  if (!activate.ok) return activate;
  const generateEditorial = optionalBoolean(body, "generateEditorial", true);
  if (!generateEditorial.ok) return generateEditorial;
  return success({ clientMutationId: clientMutationId.data, activate: activate.data, generateEditorial: generateEditorial.data });
}

export function parseNativeRecipeCoverListUrl(url: URL): ApiV1RecipeCoverResult<{
  includeArchived: boolean;
  limit: number;
  offset: number;
}> {
  const includeArchivedRaw = url.searchParams.get("includeArchived");
  const includeArchived = includeArchivedRaw === "true";
  if (includeArchivedRaw !== null && includeArchivedRaw !== "true" && includeArchivedRaw !== "false") {
    return fieldFailure("includeArchived", "includeArchived must be true or false");
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null || limitRaw.trim() === "" ? DEFAULT_LIST_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return fieldFailure("limit", "limit must be an integer between 1 and 50");
  }

  const offsetRaw = url.searchParams.get("offset");
  const offset = offsetRaw === null || offsetRaw.trim() === "" ? 0 : Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0) {
    return fieldFailure("offset", "offset must be a nonnegative integer");
  }

  return success({ includeArchived, limit, offset });
}

function preferredCoverVariant(cover: Pick<RecipeCover, "imageUrl" | "stylizedImageUrl">): RecipeCoverVariant | null {
  if (cover.stylizedImageUrl?.trim()) return "stylized";
  if (cover.imageUrl.trim()) return "image";
  return null;
}

function coverUrlForVariant(
  cover: Pick<RecipeCover, "imageUrl" | "stylizedImageUrl">,
  variant: RecipeCoverVariant,
): string | null {
  return variant === "stylized" ? cover.stylizedImageUrl : cover.imageUrl;
}

function fullCoverPayload(
  cover: RecipeCover,
  recipe: { activeCoverId: string | null; activeCoverVariant: string | null },
): FullCoverPayload {
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
    provenanceLabel: displayVariant ? getRecipeCoverProvenanceLabel(cover.sourceType, displayVariant) : null,
    sourceSpoonId: cover.sourceSpoonId,
    createdById: cover.createdById,
    archivedAt: cover.archivedAt?.toISOString() ?? null,
    generationStatus: cover.generationStatus,
    failureReason: cover.failureReason,
    sourceImageUrl: cover.sourceImageUrl,
    createdAt: cover.createdAt.toISOString(),
  };
}

async function activeFullCoverPayload(
  db: Database,
  recipe: { id: string; activeCoverId: string | null; activeCoverVariant: string | null },
): Promise<FullCoverPayload | null> {
  if (!recipe.activeCoverId) return null;
  const cover = await db.recipeCover.findFirst({ where: { id: recipe.activeCoverId, recipeId: recipe.id } });
  return cover ? fullCoverPayload(cover, recipe) : null;
}

async function reloadCoverMutationRecipe(db: Database, recipeId: string): Promise<NativeCoverRecipe> {
  return await db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    select: {
      id: true,
      title: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
    },
  });
}

async function reloadFullCoverPayload(
  db: Database,
  recipe: { id: string; activeCoverId: string | null; activeCoverVariant: string | null },
  coverId: string,
): Promise<FullCoverPayload> {
  const cover = await db.recipeCover.findFirstOrThrow({ where: { id: coverId, recipeId: recipe.id } });
  return fullCoverPayload(cover, recipe);
}

export async function loadOwnedNativeRecipeCoverRecipe(
  db: Database,
  chefId: string,
  recipeId: string,
): Promise<ApiV1RecipeCoverResult<NativeCoverRecipe>> {
  const recipe = await db.recipe.findFirst({
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
  if (!recipe) return failure("not_found", "Recipe not found");
  if (recipe.chefId !== chefId) {
    return failure("insufficient_scope", "Recipe does not belong to the authenticated chef");
  }
  return success(recipe);
}

function paginationFor(pageSize: number, limit: number, offset: number, hasMore: boolean) {
  return { limit, offset, count: pageSize, hasMore };
}

export async function listNativeRecipeCovers(
  db: Database,
  recipe: NativeCoverRecipe,
  input: { includeArchived: boolean; limit: number; offset: number },
) {
  const covers = await db.recipeCover.findMany({
    where: {
      recipeId: recipe.id,
      ...(input.includeArchived ? {} : { status: { not: "archived" }, archivedAt: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    skip: input.offset,
  });
  const page = covers.slice(0, input.limit);
  const activeCover = recipe.activeCoverId
    ? await db.recipeCover.findFirst({ where: { id: recipe.activeCoverId, recipeId: recipe.id } })
    : null;
  const spoonImages = await db.recipeSpoon.findMany({
    where: {
      recipeId: recipe.id,
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
    take: MAX_LIST_LIMIT,
  });

  return success({
    covers: page.map((cover) => fullCoverPayload(cover, recipe)),
    activeCover: activeCover ? fullCoverPayload(activeCover, recipe) : null,
    pagination: paginationFor(page.length, input.limit, input.offset, covers.length > input.limit),
    spoonImages: spoonImages
      .filter((spoon): spoon is typeof spoon & { photoUrl: string } => typeof spoon.photoUrl === "string" && spoon.photoUrl.trim() !== "")
      .map((spoon) => ({
        id: spoon.id,
        recipeId: spoon.recipeId,
        chefId: spoon.chefId,
        photoUrl: spoon.photoUrl,
        cookedAt: spoon.cookedAt.toISOString(),
        createdAt: spoon.createdAt.toISOString(),
        updatedAt: spoon.updatedAt.toISOString(),
        chef: spoon.chef,
      })),
  });
}

function coverMutationResponse(input: {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  createdCover: FullCoverPayload | null;
  generationStatus: string;
  clientMutationId: string;
  warnings?: string[];
  blockers?: ProviderSecretBlocker[];
  nextActions: string[];
}): CoverMutationPayload {
  return {
    activeCover: input.activeCover,
    previousActiveCover: input.previousActiveCover,
    createdCover: input.createdCover,
    generationStatus: input.generationStatus,
    warnings: input.warnings ?? [],
    blockers: input.blockers ?? [],
    nextActions: input.nextActions,
    mutation: { clientMutationId: input.clientMutationId, replayed: false },
  };
}

function activeCoverMutationResponse(input: {
  activeCover: FullCoverPayload | null;
  previousActiveCover: FullCoverPayload | null;
  archivedCover: FullCoverPayload | null;
  clientMutationId: string;
  warnings?: string[];
  blockers?: ProviderSecretBlocker[];
  nextActions: string[];
}): ActiveCoverMutationPayload {
  return {
    activeCover: input.activeCover,
    previousActiveCover: input.previousActiveCover,
    archivedCover: input.archivedCover,
    warnings: input.warnings ?? [],
    blockers: input.blockers ?? [],
    nextActions: input.nextActions,
    mutation: { clientMutationId: input.clientMutationId, replayed: false },
  };
}

function envString(env: Env | null | undefined, key: keyof Env): string {
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function missingProviderConfig(env: Env | null | undefined) {
  return !envString(env, "OPENAI_API_KEY") && !envString(env, "GEMINI_API_KEY") && !envString(env, "GOOGLE_API_KEY");
}

function providerSecretBlocker(env: Env | null | undefined): ProviderSecretBlocker {
  const artifactRoot = envString(env, "ARTIFACT_ROOT");
  const outputPath = artifactRoot
    ? `${artifactRoot.replace(/\/+$/, "")}/web/provider-secret-blocker-recipe-covers.json`
    : "web/provider-secret-blocker-recipe-covers.json";
  return {
    blocked: true,
    capability: "ProviderSecret",
    command: "Set OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY and rerun the recipe cover mutation.",
    domain: "recipe-covers",
    outputPath,
    ownerAction: "Provide OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY for local recipe cover editorial generation.",
    reason: "Recipe cover editorial image generation requires an image provider secret.",
  };
}

type FsPromisesModule = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, data: string, encoding: string): Promise<unknown>;
};

async function writeProviderSecretBlocker(blocker: ProviderSecretBlocker, env: Env | null | undefined): Promise<void> {
  if (!envString(env, "ARTIFACT_ROOT")) return;
  const slashIndex = blocker.outputPath.lastIndexOf("/");
  const directory = slashIndex >= 0 ? blocker.outputPath.slice(0, slashIndex) : ".";
  try {
    const fsModule = await import("node:fs/promises") as Partial<FsPromisesModule>;
    if (typeof fsModule.mkdir !== "function" || typeof fsModule.writeFile !== "function") return;
    await fsModule.mkdir(directory, { recursive: true });
    await fsModule.writeFile(blocker.outputPath, `${JSON.stringify(blocker, null, 2)}\n`, "utf8");
  } catch {
    // File-system blocker artifacts are a local validation convenience; the JSON response remains authoritative in Workers.
  }
}

async function providerBlockersForCover(
  env: Env | null | undefined,
  cover: Pick<RecipeCover, "generationStatus" | "failureReason">,
): Promise<ProviderSecretBlocker[]> {
  if (cover.generationStatus !== "failed" || cover.failureReason !== "missing_image_provider_config") return [];
  const blocker = providerSecretBlocker(env);
  await writeProviderSecretBlocker(blocker, env);
  return [blocker];
}

function imageGenerationStatusCode(blockers: ProviderSecretBlocker[], fallback = 201) {
  return blockers.length > 0 ? 202 : fallback;
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function createCoverOp(
  db: Database,
  input: {
    id: string;
    recipeId: string;
    imageUrl: string;
    sourceType: "chef-upload" | "spoon";
    sourceSpoonId?: string | null;
    sourceImageUrl: string;
    createdById: string;
    generateEditorial: boolean;
  },
): Prisma.PrismaPromise<RecipeCover> {
  return db.recipeCover.create({
    data: {
      id: input.id,
      recipeId: input.recipeId,
      imageUrl: input.imageUrl,
      sourceType: input.sourceType,
      sourceSpoonId: input.sourceSpoonId ?? null,
      status: input.generateEditorial ? "processing" : "ready",
      createdById: input.createdById,
      sourceImageUrl: input.sourceImageUrl,
      generationStatus: input.generateEditorial ? "processing" : "none",
    },
  });
}

function coverTombstoneOp(
  db: Database,
  input: {
    reservation: ApiIdempotencyKey;
    operation: string;
    coverId: string;
    recipeId: string;
    payload: unknown;
  },
): Prisma.PrismaPromise<unknown> {
  return db.apiMutationTombstone.upsert({
    where: {
      idempotencyKeyId_resourceType_resourceId: {
        idempotencyKeyId: input.reservation.id,
        resourceType: "recipe_cover",
        resourceId: input.coverId,
      },
    },
    update: {
      operation: input.operation,
      parentResourceId: input.recipeId,
      payload: JSON.stringify(input.payload),
    },
    create: {
      idempotencyKeyId: input.reservation.id,
      operation: input.operation,
      resourceType: "recipe_cover",
      resourceId: input.coverId,
      parentResourceId: input.recipeId,
      payload: JSON.stringify(input.payload),
    },
  });
}

async function scheduleEditorialGeneration(
  db: Database,
  env: Env | null | undefined,
  input: {
    userId: string;
    recipe: NativeCoverRecipe;
    coverId: string;
    rawPhotoUrl: string;
    sourceType: "chef-upload" | "spoon";
    activateWhenReady: boolean;
  },
): Promise<void> {
  await scheduleSpoonCoverStylization({
    db,
    userId: input.userId,
    recipeId: input.recipe.id,
    coverId: input.coverId,
    rawPhotoUrl: input.rawPhotoUrl,
    recipeTitle: input.recipe.title,
    sourceType: input.sourceType,
    env,
    bucket: env?.PHOTOS,
    activateWhenReady: input.activateWhenReady,
    suppressAutoActivation: !input.activateWhenReady,
    activationGuard: input.activateWhenReady
      ? {
          activeCoverId: input.recipe.activeCoverId,
          activeCoverVariant: input.recipe.activeCoverVariant,
          coverMode: input.recipe.coverMode,
        }
      : undefined,
  });
}

async function activateRawCoverAfterProviderBlock(
  db: Database,
  recipeId: string,
  coverId: string,
  activate: boolean,
  blockers: ProviderSecretBlocker[],
): Promise<void> {
  if (!activate || blockers.length === 0) return;
  await setActiveRecipeCover(db, { recipeId, coverId, variant: "image" });
}

async function createNativeCoverFromImageUrl(
  db: Database,
  env: Env | null | undefined,
  principalId: string,
  recipe: NativeCoverRecipe,
  input: NativeRecipeCoverCreateInput | (NativeRecipeCoverUploadInput & { imageUrl: string }),
  reservation: ApiIdempotencyKey,
  source: { operation: string; sourceType: "chef-upload" | "spoon"; sourceSpoonId?: string | null },
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  const previousActiveCover = await activeFullCoverPayload(db, recipe);
  const coverId = reservation.id;
  const createdCoverOp = createCoverOp(db, {
    id: coverId,
    recipeId: recipe.id,
    imageUrl: input.imageUrl,
    sourceType: source.sourceType,
    sourceSpoonId: source.sourceSpoonId ?? null,
    sourceImageUrl: input.imageUrl,
    createdById: principalId,
    generateEditorial: input.generateEditorial,
  });

  const transactionOps: Prisma.PrismaPromise<unknown>[] = [createdCoverOp];
  if (input.activate && !input.generateEditorial) {
    transactionOps.push(db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: coverId, activeCoverVariant: "image", coverMode: "manual" },
    }));
  }
  transactionOps.push(coverTombstoneOp(db, {
    reservation,
    operation: source.operation,
    coverId,
    recipeId: recipe.id,
    payload: { previousActiveCover, source },
  }));

  await db.$transaction(transactionOps);

  if (input.generateEditorial) {
    await scheduleEditorialGeneration(db, env, {
      userId: principalId,
      recipe,
      coverId,
      rawPhotoUrl: input.imageUrl,
      sourceType: source.sourceType,
      activateWhenReady: input.activate,
    });
  }

  let nextRecipe = await reloadCoverMutationRecipe(db, recipe.id);
  let createdCover = await db.recipeCover.findFirstOrThrow({ where: { id: coverId, recipeId: recipe.id } });
  const blockers = await providerBlockersForCover(env, createdCover);
  await activateRawCoverAfterProviderBlock(db, recipe.id, coverId, input.activate, blockers);
  if (blockers.length > 0 && input.activate) {
    nextRecipe = await reloadCoverMutationRecipe(db, recipe.id);
    createdCover = await db.recipeCover.findFirstOrThrow({ where: { id: coverId, recipeId: recipe.id } });
  }

  const createdPayload = fullCoverPayload(createdCover, nextRecipe);
  return success({
    status: imageGenerationStatusCode(blockers),
    data: coverMutationResponse({
      activeCover: await activeFullCoverPayload(db, nextRecipe),
      previousActiveCover,
      createdCover: createdPayload,
      generationStatus: createdPayload.generationStatus,
      clientMutationId: input.clientMutationId,
      blockers,
      nextActions: input.activate || blockers.length > 0
        ? ["list_recipe_covers", "get_recipe"]
        : ["set_active_recipe_cover", "get_cover_generation_status"],
    }),
  });
}

export async function uploadNativeRecipeImageCover(
  db: Database,
  env: Env | null | undefined,
  principalId: string,
  recipe: NativeCoverRecipe,
  input: NativeRecipeCoverUploadInput,
  reservation: ApiIdempotencyKey,
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  const idempotencyDigest = await hashText(input.clientMutationId);
  const storageKey = `recipes/${principalId}/${recipe.id}/idempotent-${idempotencyDigest.slice(0, 24)}-${input.fileHash.slice(0, 16)}.${getImageExtension(input.file.name)}`;
  const imageUrl = await storeImage({
    bucket: env?.PHOTOS,
    file: input.file,
    namespace: `recipes/${principalId}/${recipe.id}`,
    key: storageKey,
  });
  try {
    return await createNativeCoverFromImageUrl(
      db,
      env,
      principalId,
      recipe,
      { ...input, imageUrl },
      reservation,
      { operation: "recipes.image.upload", sourceType: "chef-upload" },
    );
  } catch (error) {
    await cleanupUncommittedUpload(db, env, reservation, recipe.id, imageUrl);
    throw error;
  }
}

async function cleanupUncommittedUpload(
  db: Database,
  env: Env | null | undefined,
  reservation: ApiIdempotencyKey,
  recipeId: string,
  imageUrl: string,
): Promise<void> {
  try {
    const [cover, tombstone] = await Promise.all([
      db.recipeCover.findFirst({ where: { id: reservation.id, recipeId }, select: { id: true } }),
      db.apiMutationTombstone.findFirst({
        where: { idempotencyKeyId: reservation.id, resourceType: "recipe_cover", resourceId: reservation.id, parentResourceId: recipeId },
        select: { id: true },
      }),
    ]);
    if (cover || tombstone) return;
    await deleteStoredImage({ bucket: env?.PHOTOS, imageUrl });
  } catch {
    // If cleanup state checks fail, keep the uploaded object rather than risking deletion of a committed cover image.
  }
}

function apiAuthErrorToFailure<T>(error: unknown): ApiV1RecipeCoverResult<T> {
  if (error instanceof ApiAuthError) {
    if (error.status === 404) return failure("not_found", error.message);
    if (error.status === 403) return failure("insufficient_scope", error.message);
    return failure("validation_error", error.message);
  }
  if (error instanceof Error) return failure("validation_error", error.message);
  return failure("validation_error", "Recipe cover mutation failed");
}

export async function createNativeRecipeCoverFromUrl(
  db: Database,
  env: Env | null | undefined,
  principalId: string,
  recipe: NativeCoverRecipe,
  input: NativeRecipeCoverCreateInput,
  reservation: ApiIdempotencyKey,
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  try {
    await validateRecipeImageAssignment({
      imageUrl: input.imageUrl,
      ownerId: principalId,
      bucket: env?.PHOTOS,
      allowLocalImageFallback: !env?.PHOTOS,
    });
  } catch (error) {
    return apiAuthErrorToFailure(error);
  }
  return createNativeCoverFromImageUrl(db, env, principalId, recipe, input, reservation, {
    operation: "recipes.covers.create",
    sourceType: "chef-upload",
  });
}

export async function createNativeRecipeCoverFromSpoon(
  db: Database,
  env: Env | null | undefined,
  principalId: string,
  recipe: NativeCoverRecipe,
  spoonId: string,
  input: NativeRecipeCoverFromSpoonInput,
  reservation: ApiIdempotencyKey,
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  const spoon = await db.recipeSpoon.findFirst({
    where: {
      id: spoonId,
      recipeId: recipe.id,
      deletedAt: null,
      photoUrl: { not: null },
      NOT: { photoUrl: "" },
    },
    select: { id: true, photoUrl: true },
  });
  if (!spoon?.photoUrl) {
    return failure("not_found", "Spoon photo not found");
  }
  return createNativeCoverFromImageUrl(db, env, principalId, recipe, { ...input, imageUrl: spoon.photoUrl }, reservation, {
    operation: "recipes.covers.from-spoon",
    sourceType: "spoon",
    sourceSpoonId: spoon.id,
  });
}

export async function activateNativeRecipeCover(
  db: Database,
  recipe: NativeCoverRecipe,
  coverId: string,
  input: NativeRecipeCoverActivateInput,
  reservation: ApiIdempotencyKey,
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  const previousActiveCover = await activeFullCoverPayload(db, recipe);
  const cover = await db.recipeCover.findFirst({ where: { id: coverId, recipeId: recipe.id } });
  if (!cover) return failure("not_found", "Cover not found", { resource: "recipe_cover", coverId });
  if (cover.status === "archived" || cover.archivedAt) {
    return failure("validation_error", "Cannot activate an archived cover");
  }
  if (cover.status === "failed") {
    return failure("validation_error", "Cannot activate a failed cover");
  }
  const variantUrl = input.variant === "stylized" ? cover.stylizedImageUrl : cover.imageUrl;
  if (!variantUrl?.trim()) {
    return failure("validation_error", "Selected cover variant is unavailable");
  }
  try {
    await db.$transaction([
      db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: coverId, activeCoverVariant: input.variant, coverMode: "manual" },
      }),
      coverTombstoneOp(db, {
        reservation,
        operation: "recipes.covers.activate",
        coverId,
        recipeId: recipe.id,
        payload: { previousActiveCover, variant: input.variant },
      }),
    ]);
  } catch (error) {
    return apiAuthErrorToFailure(error);
  }
  const nextRecipe = await reloadCoverMutationRecipe(db, recipe.id);
  return success({
    status: 200,
    data: activeCoverMutationResponse({
      activeCover: await activeFullCoverPayload(db, nextRecipe),
      previousActiveCover,
      archivedCover: null,
      clientMutationId: input.clientMutationId,
      nextActions: ["list_recipe_covers", "get_recipe"],
    }),
  });
}

function archivedCoverCanBeReplaced(input: NativeRecipeCoverArchiveInput) {
  return input.replacementCoverId !== null && input.replacementVariant !== null;
}

export async function archiveNativeRecipeCover(
  db: Database,
  recipe: NativeCoverRecipe,
  coverId: string,
  input: NativeRecipeCoverArchiveInput,
  reservation: ApiIdempotencyKey,
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  const cover = await db.recipeCover.findFirst({ where: { id: coverId, recipeId: recipe.id } });
  if (!cover) return failure("not_found", "Cover not found", { resource: "recipe_cover", coverId });
  const previousActiveCover = await activeFullCoverPayload(db, recipe);
  const isActiveCover = recipe.activeCoverId === cover.id;
  if (isActiveCover && !input.confirmNoCover && !input.replacementCoverId) {
    return failure("validation_error", "Archiving the active cover requires a replacement or confirmNoCover");
  }
  if (isActiveCover && input.replacementCoverId === cover.id) {
    return failure("validation_error", "Replacement cover must be different from the archived cover");
  }
  if (input.replacementCoverId && !input.replacementVariant) {
    return failure("validation_error", "Replacement variant is required");
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (isActiveCover && input.confirmNoCover) {
    ops.push(db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    }));
  } else if (isActiveCover && archivedCoverCanBeReplaced(input)) {
    const replacement = await db.recipeCover.findFirst({
      where: { id: input.replacementCoverId!, recipeId: recipe.id },
    });
    if (!replacement || replacement.archivedAt || replacement.status === "archived") {
      return failure("validation_error", "Replacement cover was not found or is archived");
    }
    const variantUrl = input.replacementVariant === "stylized" ? replacement.stylizedImageUrl : replacement.imageUrl;
    if (!variantUrl?.trim()) {
      return failure("validation_error", "Replacement variant is unavailable");
    }
    ops.push(db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: replacement.id, activeCoverVariant: input.replacementVariant, coverMode: "manual" },
    }));
  }
  ops.push(
    db.recipeCover.update({
      where: { id: cover.id },
      data: { status: "archived", archivedAt: new Date() },
    }),
    coverTombstoneOp(db, {
      reservation,
      operation: "recipes.covers.archive",
      coverId,
      recipeId: recipe.id,
      payload: { previousActiveCover },
    }),
  );
  await db.$transaction(ops);

  const nextRecipe = await reloadCoverMutationRecipe(db, recipe.id);
  return success({
    status: 200,
    data: activeCoverMutationResponse({
      activeCover: await activeFullCoverPayload(db, nextRecipe),
      previousActiveCover,
      archivedCover: await reloadFullCoverPayload(db, nextRecipe, coverId),
      clientMutationId: input.clientMutationId,
      warnings: input.deleteSafeObjects ? [DELETE_SAFE_OBJECTS_WARNING] : [],
      nextActions: ["list_recipe_covers", "get_recipe"],
    }),
  });
}

export async function regenerateNativeRecipeCover(
  db: Database,
  env: Env | null | undefined,
  principalId: string,
  recipe: NativeCoverRecipe,
  input: NativeRecipeCoverRegenerateInput,
  reservation: ApiIdempotencyKey,
): Promise<ApiV1RecipeCoverResult<NativeCoverMutationResult>> {
  const previousActiveCover = await activeFullCoverPayload(db, recipe);
  const cover = await db.recipeCover.findFirst({ where: { id: input.coverId, recipeId: recipe.id } });
  if (!cover) return failure("not_found", "Cover not found", { resource: "recipe_cover", coverId: input.coverId });
  if (cover.status === "archived" || cover.archivedAt) {
    return failure("validation_error", "Archived covers cannot be regenerated");
  }
  const rawPhotoUrl = cover.sourceImageUrl || cover.imageUrl;
  if (!rawPhotoUrl.trim()) return failure("validation_error", "Cover has no source image");

  await db.$transaction([
    db.recipeCover.update({
      where: { id: cover.id },
      data: {
        status: "processing",
        generationStatus: "processing",
        failureReason: null,
        sourceImageUrl: cover.sourceImageUrl ?? rawPhotoUrl,
      },
    }),
    coverTombstoneOp(db, {
      reservation,
      operation: "recipes.covers.regenerate",
      coverId: cover.id,
      recipeId: recipe.id,
      payload: { previousActiveCover },
    }),
  ]);

  await scheduleEditorialGeneration(db, env, {
    userId: principalId,
    recipe,
    coverId: cover.id,
    rawPhotoUrl,
    sourceType: cover.sourceType === "spoon" ? "spoon" : "chef-upload",
    activateWhenReady: input.activateWhenReady,
  });

  const nextRecipe = await reloadCoverMutationRecipe(db, recipe.id);
  const regeneratedCover = await db.recipeCover.findFirstOrThrow({ where: { id: cover.id, recipeId: recipe.id } });
  const blockers = await providerBlockersForCover(env, regeneratedCover);
  const regeneratedPayload = fullCoverPayload(regeneratedCover, nextRecipe);
  return success({
    status: imageGenerationStatusCode(blockers, 200),
    data: coverMutationResponse({
      activeCover: await activeFullCoverPayload(db, nextRecipe),
      previousActiveCover,
      createdCover: regeneratedPayload,
      generationStatus: regeneratedPayload.generationStatus,
      clientMutationId: input.clientMutationId,
      blockers,
      nextActions: blockers.length > 0 ? ["list_recipe_covers", "get_recipe"] : ["get_cover_generation_status"],
    }),
  });
}

export async function recoverNativeRecipeCoverMutation(
  db: Database,
  env: Env | null | undefined,
  reservation: ApiIdempotencyKey,
  input: {
    clientMutationId: string;
    principalId: string;
    recipeId: string;
    coverId: string;
    operation: string;
    mutationKind: "cover" | "active";
    expectedStatus?: number;
  },
): Promise<NativeCoverMutationResult | null> {
  const tombstone = await db.apiMutationTombstone.findUnique({
    where: {
      idempotencyKeyId_resourceType_resourceId: {
        idempotencyKeyId: reservation.id,
        resourceType: "recipe_cover",
        resourceId: input.coverId,
      },
    },
  });
  if (!tombstone || tombstone.operation !== input.operation || tombstone.parentResourceId !== input.recipeId) return null;
  const recipeResult = await loadOwnedNativeRecipeCoverRecipe(db, input.principalId, input.recipeId);
  if (!recipeResult.ok) return null;
  const recipe = recipeResult.data;
  const previousActiveCover = isRecordPayload(tombstone.payload)?.previousActiveCover ?? null;
  const cover = await db.recipeCover.findFirst({ where: { id: input.coverId, recipeId: input.recipeId } });
  if (!cover) return null;
  const blockers = await providerBlockersForCover(env, cover);

  if (input.mutationKind === "active") {
    return {
      status: input.expectedStatus ?? 200,
      data: activeCoverMutationResponse({
        activeCover: await activeFullCoverPayload(db, recipe),
        previousActiveCover: isFullCoverPayload(previousActiveCover) ? previousActiveCover : null,
        archivedCover: cover.status === "archived" || cover.archivedAt ? fullCoverPayload(cover, recipe) : null,
        clientMutationId: input.clientMutationId,
        blockers,
        nextActions: ["list_recipe_covers", "get_recipe"],
      }),
    };
  }

  const createdCover = fullCoverPayload(cover, recipe);
  return {
    status: imageGenerationStatusCode(blockers, input.expectedStatus ?? 201),
    data: coverMutationResponse({
      activeCover: await activeFullCoverPayload(db, recipe),
      previousActiveCover: isFullCoverPayload(previousActiveCover) ? previousActiveCover : null,
      createdCover,
      generationStatus: createdCover.generationStatus,
      clientMutationId: input.clientMutationId,
      blockers,
      nextActions: blockers.length > 0 ? ["list_recipe_covers", "get_recipe"] : ["get_cover_generation_status"],
    }),
  };
}

function isRecordPayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFullCoverPayload(value: unknown): value is FullCoverPayload {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.recipeId === "string" &&
    typeof value.imageUrl === "string" &&
    typeof value.status === "string";
}
