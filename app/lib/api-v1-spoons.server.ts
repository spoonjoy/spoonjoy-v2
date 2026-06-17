import type { ApiIdempotencyKey, Prisma, PrismaClient as PrismaClientType, RecipeCover, RecipeSpoon } from "@prisma/client";
import { ApiAuthError, type ApiPrincipal } from "~/lib/api-auth.server";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import { getVapidConfig, type VapidConfig, type VapidEnv } from "~/lib/env.server";
import { hasUploadedImageFile, RECIPE_IMAGE_TYPES, validateImageFileForStorage } from "~/lib/image-storage.server";
import { FOOD_IMAGE_SIZE_MESSAGE, FOOD_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { validateSpoonPhotoAssignment } from "~/lib/recipe-image-assignment.server";
import {
  createSpoon,
  deleteSpoon,
  SpoonAuthError,
  SpoonNotFoundError,
  SpoonValidationError,
  updateSpoon,
} from "~/lib/recipe-spoon.server";
import { getRecipeCoverProvenanceLabel, type RecipeCoverVariant } from "~/lib/recipe-cover.server";
import { notifySpoonOnMyRecipe } from "~/lib/notification-triggers.server";
import { fanoutFellowChefOriginCook } from "~/lib/notification-fanout.server";
import { decideSpoonCoverCreation } from "~/lib/spoon-cover-decision.server";
import { activateSpoonCoverForDecision } from "~/lib/spoon-cover-activation.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";

type Database = PrismaClientType;
type WaitUntil = (promise: Promise<unknown>) => void;

export type ApiV1SpoonResult<T> =
  | { ok: true; status: number; data: T; private?: boolean }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };
type ApiV1SpoonFailure = Extract<ApiV1SpoonResult<never>, { ok: false }>;

export interface NativeSpoonCreateInput {
  clientMutationId: string;
  note?: string | null;
  nextTime?: string | null;
  cookedAt?: Date;
  photoUrl?: string | null;
  photoFile?: File;
  photoHash?: string;
  useAsRecipeCover: boolean;
}

export interface NativeSpoonUpdateInput {
  clientMutationId: string;
  note?: string | null;
  nextTime?: string | null;
  cookedAt?: Date;
  photoUrl?: string | null;
}

export interface NativeSpoonDeleteInput {
  clientMutationId: string;
}

export interface NativeSpoonListInput {
  limit: number;
  cursor: SpoonListCursor | null;
}

type SpoonListCursor = { cookedAt: Date; id: string; raw: string };

type NativeSpoonPayload = {
  id: string;
  chefId: string;
  recipeId: string;
  cookedAt: string;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NativeListedSpoonPayload = NativeSpoonPayload & {
  chef: { id: string; username: string; photoUrl: string | null };
  coverImageUrl: string | null;
  coverProvenanceLabel: string | null;
  coverSourceType: string | null;
  coverVariant: RecipeCoverVariant | null;
  coverStatus: string | null;
  coverGenerationStatus: string | null;
};

type NativeFullCoverPayload = {
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

type NativeSpoonNotificationStatus = "queued" | "skipped" | "unavailable";

type NativeSpoonNotificationsPayload = {
  spoonOnMyRecipe: NativeSpoonNotificationStatus;
  fellowChefOriginCook: NativeSpoonNotificationStatus;
};

type NativeSpoonCreatePayload = {
  spoon: NativeSpoonPayload;
  isOriginCook: boolean;
  cover: NativeFullCoverPayload | null;
  notifications: NativeSpoonNotificationsPayload;
  mutation: { clientMutationId: string; replayed: boolean };
};

type NativeSpoonUpdatePayload = {
  spoon: NativeSpoonPayload;
  cover: NativeFullCoverPayload | null;
  mutation: { clientMutationId: string; replayed: boolean };
};

type NativeSpoonDeletePayload = {
  deleted: true;
  spoon: NativeSpoonPayload;
  mutation: { clientMutationId: string; replayed: boolean };
};

type NativeSpoonRecipe = {
  id: string;
  title: string;
  chefId: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
  activeCover: {
    id: string;
    recipeId: string;
    sourceType: string;
    status: string;
    generationStatus: string;
    archivedAt: Date | null;
    imageUrl: string | null;
    stylizedImageUrl: string | null;
  } | null;
};

type NativeSpoonIdempotentMutationResult = {
  status: number;
  data: NativeSpoonCreatePayload | NativeSpoonUpdatePayload | NativeSpoonDeletePayload;
};

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const MAX_SHORT_TEXT_LENGTH = 160;

function success<T>(data: T, status = 200, isPrivate = true): ApiV1SpoonResult<T> {
  return { ok: true, status, data, private: isPrivate };
}

function failure(code: ApiV1ErrorCode, message: string, details?: unknown): ApiV1SpoonFailure {
  return { ok: false, code, message, details };
}

function fieldFailure(field: string, message: string): ApiV1SpoonFailure {
  return failure("validation_error", "Invalid spoon fields", { fieldErrors: { [field]: message } });
}

function assertKnownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): ApiV1SpoonFailure | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((field) => !allowedSet.has(field));
  return unknown.length > 0
    ? failure("validation_error", "Unknown request body fields", { fields: unknown })
    : null;
}

function hasOwn(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function nonblankString(value: unknown, field: string): ApiV1SpoonResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return fieldFailure(field, `${field} must be a nonblank string`);
  }
  return success(value.trim());
}

function optionalNullableText(
  body: Record<string, unknown>,
  field: "note" | "nextTime",
): ApiV1SpoonResult<string | null | undefined> {
  if (!hasOwn(body, field)) return success(undefined);
  const value = body[field];
  if (value === null) return success(null);
  if (typeof value !== "string") return fieldFailure(field, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_SHORT_TEXT_LENGTH) {
    return fieldFailure(field, `${field} must be at most ${MAX_SHORT_TEXT_LENGTH} characters`);
  }
  return success(trimmed.length > 0 ? trimmed : null);
}

function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  fallback = false,
): ApiV1SpoonResult<boolean> {
  if (!hasOwn(body, field)) return success(fallback);
  if (typeof body[field] !== "boolean") return fieldFailure(field, `${field} must be a boolean`);
  return success(body[field]);
}

function optionalFormBoolean(
  value: FormDataEntryValue | null,
  field: string,
  fallback = false,
): ApiV1SpoonResult<boolean> {
  if (value === null) return success(fallback);
  if (typeof value !== "string" || (value !== "true" && value !== "false")) {
    return fieldFailure(field, `${field} must be true or false`);
  }
  return success(value === "true");
}

function optionalStringValue(value: FormDataEntryValue | null, field: "note" | "nextTime"): ApiV1SpoonResult<string | null | undefined> {
  if (value === null) return success(undefined);
  if (typeof value !== "string") return fieldFailure(field, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_SHORT_TEXT_LENGTH) {
    return fieldFailure(field, `${field} must be at most ${MAX_SHORT_TEXT_LENGTH} characters`);
  }
  return success(trimmed.length > 0 ? trimmed : null);
}

function optionalPhotoUrl(body: Record<string, unknown>): ApiV1SpoonResult<string | null | undefined> {
  if (!hasOwn(body, "photoUrl")) return success(undefined);
  const value = body.photoUrl;
  if (value === null) return success(null);
  if (typeof value !== "string") return fieldFailure("photoUrl", "photoUrl must be a string");
  const trimmed = value.trim();
  return success(trimmed ? trimmed : null);
}

function parseCookedAtValue(value: unknown): ApiV1SpoonResult<Date | undefined> {
  if (value === undefined || value === null) return success(undefined);
  if (typeof value !== "string" || value.trim() === "") {
    return fieldFailure("cookedAt", "cookedAt must be an ISO date string");
  }
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    return fieldFailure("cookedAt", "cookedAt must be an ISO date string");
  }
  const yearRaw = match[1]!;
  const monthRaw = match[2]!;
  const dayRaw = match[3]!;
  const hourRaw = match[4]!;
  const minuteRaw = match[5]!;
  const secondRaw = match[6]!;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const daysInMonth = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  const validParts = [
    month >= 1,
    month <= 12,
    day >= 1,
    day <= daysInMonth,
    hour <= 23,
    minute <= 59,
    second <= 59,
  ];
  if (!validParts.every(Boolean)) {
    return fieldFailure("cookedAt", "cookedAt must be an ISO date string");
  }
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    return fieldFailure("cookedAt", "cookedAt must be an ISO date string");
  }
  return success(date);
}

function parseFormCookedAt(value: FormDataEntryValue | null): ApiV1SpoonResult<Date | undefined> {
  if (value === null) return success(undefined);
  return parseCookedAtValue(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return bytesToHex(new Uint8Array(digest));
}

function base64UrlEncodeText(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeText(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function parseListLimit(url: URL): ApiV1SpoonResult<number> {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return success(DEFAULT_LIST_LIMIT);
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return fieldFailure("limit", "limit must be an integer between 1 and 50");
  }
  return success(limit);
}

function spoonListCursorFor(row: Pick<RecipeSpoon, "cookedAt" | "id">): string {
  return `v1.${base64UrlEncodeText(JSON.stringify({ cookedAt: row.cookedAt.toISOString(), id: row.id }))}`;
}

function parseSpoonListCursor(url: URL): ApiV1SpoonResult<SpoonListCursor | null> {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return success(null);
  const trimmed = raw.trim();
  if (!trimmed.startsWith("v1.")) {
    return failure("invalid_cursor", "cursor must be a Spoonjoy spoon list cursor");
  }
  try {
    const parsed = JSON.parse(base64UrlDecodeText(trimmed.slice(3))) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { cookedAt?: unknown }).cookedAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      const cookedAt = new Date((parsed as { cookedAt: string }).cookedAt);
      if (!Number.isNaN(cookedAt.getTime())) {
        return success({ cookedAt, id: (parsed as { id: string }).id, raw: trimmed });
      }
    }
  } catch {
    return failure("invalid_cursor", "cursor must be a Spoonjoy spoon list cursor");
  }
  return failure("invalid_cursor", "cursor must be a Spoonjoy spoon list cursor");
}

function spoonListCursorWhere(cursor: SpoonListCursor | null): Prisma.RecipeSpoonWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { cookedAt: { lt: cursor.cookedAt } },
      { cookedAt: cursor.cookedAt, id: { lt: cursor.id } },
    ],
  };
}

export function parseNativeSpoonListUrl(url: URL): ApiV1SpoonResult<NativeSpoonListInput> {
  const limit = parseListLimit(url);
  if (!limit.ok) return limit;
  const cursor = parseSpoonListCursor(url);
  if (!cursor.ok) return cursor;
  return success({ limit: limit.data, cursor: cursor.data }, 200, false);
}

export function parseNativeSpoonCreateBody(body: Record<string, unknown>): ApiV1SpoonResult<NativeSpoonCreateInput> {
  const unknown = assertKnownFields(body, [
    "clientMutationId",
    "note",
    "nextTime",
    "cookedAt",
    "photoUrl",
    "useAsRecipeCover",
  ]);
  if (unknown) return unknown;
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  const note = optionalNullableText(body, "note");
  if (!note.ok) return note;
  const nextTime = optionalNullableText(body, "nextTime");
  if (!nextTime.ok) return nextTime;
  const cookedAt = parseCookedAtValue(body.cookedAt);
  if (!cookedAt.ok) return cookedAt;
  const photoUrl = optionalPhotoUrl(body);
  if (!photoUrl.ok) return photoUrl;
  const useAsRecipeCover = optionalBoolean(body, "useAsRecipeCover");
  if (!useAsRecipeCover.ok) return useAsRecipeCover;

  return success({
    clientMutationId: clientMutationId.data,
    note: note.data,
    nextTime: nextTime.data,
    cookedAt: cookedAt.data,
    photoUrl: photoUrl.data,
    useAsRecipeCover: useAsRecipeCover.data,
  });
}

export function parseNativeSpoonUpdateBody(body: Record<string, unknown>): ApiV1SpoonResult<NativeSpoonUpdateInput> {
  const unknown = assertKnownFields(body, [
    "clientMutationId",
    "note",
    "nextTime",
    "cookedAt",
    "photoUrl",
  ]);
  if (unknown) return unknown;
  const clientMutationId = nonblankString(body.clientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  const note = optionalNullableText(body, "note");
  if (!note.ok) return note;
  const nextTime = optionalNullableText(body, "nextTime");
  if (!nextTime.ok) return nextTime;
  const cookedAt = parseCookedAtValue(body.cookedAt);
  if (!cookedAt.ok) return cookedAt;
  const photoUrl = optionalPhotoUrl(body);
  if (!photoUrl.ok) return photoUrl;

  return success({
    clientMutationId: clientMutationId.data,
    note: note.data,
    nextTime: nextTime.data,
    cookedAt: cookedAt.data,
    photoUrl: photoUrl.data,
  });
}

export function parseNativeSpoonDeleteBody(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1SpoonResult<NativeSpoonDeleteInput> {
  const unknown = assertKnownFields(body, ["clientMutationId"]);
  if (unknown) return unknown;
  const clientMutationId = nonblankString(body.clientMutationId ?? fallbackClientMutationId, "clientMutationId");
  if (!clientMutationId.ok) return clientMutationId;
  return success({ clientMutationId: clientMutationId.data });
}

export async function parseNativeSpoonCreateRequest(request: Request): Promise<ApiV1SpoonResult<NativeSpoonCreateInput>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return parseNativeSpoonCreateBody(await request.json().catch(() => ({})));
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure("validation_error", "Spoon upload must be valid multipart form data", {
      reason: "invalid_form_data",
      fieldErrors: { photo: "Please upload an image file" },
    });
  }

  const file = formData.get("photo");
  if (!hasUploadedImageFile(file)) {
    return failure("validation_error", "Please select a spoon photo to upload", {
      reason: "no_file",
      fieldErrors: { photo: "Please select a spoon photo to upload" },
    });
  }

  const validationError = await validateImageFileForStorage(file, {
    allowedTypes: RECIPE_IMAGE_TYPES,
    messages: {
      invalidType: FOOD_IMAGE_TYPE_MESSAGE,
      fileTooLarge: FOOD_IMAGE_SIZE_MESSAGE,
    },
  });
  if (validationError) {
    return failure("validation_error", validationError, {
      reason: validationError === FOOD_IMAGE_SIZE_MESSAGE ? "file_too_large" : "invalid_file_type",
      fieldErrors: { photo: validationError },
    });
  }

  const clientMutationId = nonblankString(
    formData.get("clientMutationId") ?? request.headers.get("X-Client-Mutation-Id"),
    "clientMutationId",
  );
  if (!clientMutationId.ok) return clientMutationId;
  const note = optionalStringValue(formData.get("note"), "note");
  if (!note.ok) return note;
  const nextTime = optionalStringValue(formData.get("nextTime"), "nextTime");
  if (!nextTime.ok) return nextTime;
  const cookedAt = parseFormCookedAt(formData.get("cookedAt"));
  if (!cookedAt.ok) return cookedAt;
  const useAsRecipeCover = optionalFormBoolean(formData.get("useAsRecipeCover"), "useAsRecipeCover");
  if (!useAsRecipeCover.ok) return useAsRecipeCover;

  return success({
    clientMutationId: clientMutationId.data,
    note: note.data,
    nextTime: nextTime.data,
    cookedAt: cookedAt.data,
    photoFile: file,
    photoHash: await hashFile(file),
    useAsRecipeCover: useAsRecipeCover.data,
  });
}

export function nativeSpoonCreateIdempotencyBody(input: NativeSpoonCreateInput): Record<string, unknown> {
  return {
    clientMutationId: input.clientMutationId,
    note: input.note ?? null,
    nextTime: input.nextTime ?? null,
    cookedAt: input.cookedAt?.toISOString() ?? null,
    photoUrl: input.photoUrl ?? null,
    useAsRecipeCover: input.useAsRecipeCover,
    photo: input.photoFile
      ? {
          name: input.photoFile.name,
          type: input.photoFile.type,
          size: input.photoFile.size,
          sha256: input.photoHash ?? null,
        }
      : null,
  };
}

export function nativeSpoonUpdateIdempotencyBody(input: NativeSpoonUpdateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    clientMutationId: input.clientMutationId,
  };
  if (input.note !== undefined) body.note = input.note;
  if (input.nextTime !== undefined) body.nextTime = input.nextTime;
  if (input.cookedAt !== undefined) body.cookedAt = input.cookedAt.toISOString();
  if (input.photoUrl !== undefined) body.photoUrl = input.photoUrl;
  return body;
}

function spoonPayload(spoon: RecipeSpoon): NativeSpoonPayload {
  return {
    id: spoon.id,
    chefId: spoon.chefId,
    recipeId: spoon.recipeId,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    deletedAt: spoon.deletedAt?.toISOString() ?? null,
    createdAt: spoon.createdAt.toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalDateMatches(actual: Date, expected: Date | undefined) {
  return expected === undefined || actual.toISOString() === expected.toISOString();
}

function optionalFieldMatches<T>(actual: T, expected: T | undefined) {
  return expected === undefined || actual === expected;
}

function createInputMatchesSpoon(spoon: RecipeSpoon, input: NativeSpoonCreateInput) {
  if (spoon.deletedAt) return false;
  if (spoon.note !== trimOrNull(input.note)) return false;
  if (spoon.nextTime !== trimOrNull(input.nextTime)) return false;
  if (!optionalDateMatches(spoon.cookedAt, input.cookedAt)) return false;
  if (input.photoFile) return Boolean(spoon.photoUrl);
  return spoon.photoUrl === (input.photoUrl ?? null);
}

function updateInputMatchesSpoon(spoon: RecipeSpoon, input: NativeSpoonUpdateInput) {
  if (spoon.deletedAt) return false;
  if (!optionalFieldMatches(spoon.note, input.note === undefined ? undefined : trimOrNull(input.note))) return false;
  if (!optionalFieldMatches(spoon.nextTime, input.nextTime === undefined ? undefined : trimOrNull(input.nextTime))) return false;
  if (!optionalFieldMatches(spoon.photoUrl, input.photoUrl)) return false;
  if (!optionalDateMatches(spoon.cookedAt, input.cookedAt)) return false;
  return true;
}

function preferredCoverVariant(cover: Pick<RecipeCover, "imageUrl" | "stylizedImageUrl">): RecipeCoverVariant | null {
  if (cover.stylizedImageUrl?.trim()) return "stylized";
  if (cover.imageUrl.trim()) return "image";
  return null;
}

function coverUrlForVariant(cover: Pick<RecipeCover, "imageUrl" | "stylizedImageUrl">, variant: RecipeCoverVariant): string | null {
  return variant === "stylized" ? cover.stylizedImageUrl : cover.imageUrl;
}

function fullCoverPayload(
  cover: RecipeCover,
  recipe: { activeCoverId: string | null; activeCoverVariant: string | null },
): NativeFullCoverPayload {
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

function activeCoverContext(recipe: NativeSpoonRecipe) {
  const cover = recipe.activeCover;
  if (!recipe.activeCoverId || !cover || cover.id !== recipe.activeCoverId || cover.archivedAt || cover.status === "archived") {
    return {
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
      coverStatus: null,
      coverGenerationStatus: null,
    };
  }
  const variant = recipe.activeCoverVariant === "stylized" || recipe.activeCoverVariant === "image"
    ? recipe.activeCoverVariant
    : preferredCoverVariant({ imageUrl: cover.imageUrl ?? "", stylizedImageUrl: cover.stylizedImageUrl });
  const coverImageUrl = variant ? coverUrlForVariant({ imageUrl: cover.imageUrl ?? "", stylizedImageUrl: cover.stylizedImageUrl }, variant) : null;
  return {
    coverImageUrl,
    coverProvenanceLabel: variant ? getRecipeCoverProvenanceLabel(cover.sourceType, variant) : null,
    coverSourceType: cover.sourceType,
    coverVariant: variant,
    coverStatus: cover.status,
    coverGenerationStatus: cover.generationStatus,
  };
}

async function loadSpoonRecipe(db: Database, recipeId: string): Promise<NativeSpoonRecipe | null> {
  return await db.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: {
      id: true,
      title: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      activeCover: {
        select: {
          id: true,
          recipeId: true,
          sourceType: true,
          status: true,
          generationStatus: true,
          archivedAt: true,
          imageUrl: true,
          stylizedImageUrl: true,
        },
      },
    },
  });
}

async function loadSpoonRecipeCoverContext(db: Database, recipeId: string): Promise<NativeSpoonRecipe | null> {
  return await loadSpoonRecipe(db, recipeId);
}

export async function listNativeRecipeSpoons(
  db: Database,
  recipeId: string,
  input: NativeSpoonListInput,
): Promise<ApiV1SpoonResult<{
  recipeId: string;
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  spoons: NativeListedSpoonPayload[];
}>> {
  const recipe = await loadSpoonRecipeCoverContext(db, recipeId);
  if (!recipe) return failure("not_found", "Recipe not found");
  const rows = await db.recipeSpoon.findMany({
    where: {
      recipeId,
      deletedAt: null,
      ...spoonListCursorWhere(input.cursor),
    },
    orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: { chef: { select: { id: true, username: true, photoUrl: true } } },
  });
  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  const nextCursor = hasMore && page.length > 0 ? spoonListCursorFor(page[page.length - 1]!) : null;
  const cover = activeCoverContext(recipe);

  return success({
    recipeId,
    limit: input.limit,
    cursor: input.cursor?.raw ?? null,
    nextCursor,
    hasMore,
    spoons: page.map((spoon) => ({
      ...spoonPayload(spoon),
      chef: spoon.chef,
      ...cover,
    })),
  }, 200, false);
}

async function validatePhotoUrlAssignment(input: {
  env: Env | null | undefined;
  principalId: string;
  photoUrl: string | null | undefined;
}): Promise<ApiV1SpoonFailure | null> {
  if (!input.photoUrl) return null;
  try {
    await validateSpoonPhotoAssignment({
      photoUrl: input.photoUrl,
      ownerId: input.principalId,
      bucket: input.env?.PHOTOS,
      allowLocalImageFallback: !input.env?.PHOTOS,
    });
    return null;
  } catch (error) {
    return apiAuthErrorToFailure(error);
  }
}

function apiAuthErrorToFailure(error: unknown): ApiV1SpoonFailure {
  if (error instanceof ApiAuthError) {
    if (error.status === 404) return failure("not_found", error.message);
    if (error.status === 403) return failure("insufficient_scope", error.message);
    return failure("validation_error", error.message);
  }
  if (error instanceof SpoonNotFoundError) return failure("not_found", error.message);
  if (error instanceof SpoonAuthError) return failure("insufficient_scope", error.message);
  if (error instanceof SpoonValidationError) return failure("validation_error", error.message);
  if (error instanceof Error) return failure("validation_error", error.message);
  return failure("validation_error", "Spoon mutation failed");
}

function vapidFor(env: Env | null | undefined): VapidConfig | null {
  try {
    return getVapidConfig((env ?? {}) as VapidEnv);
  } catch {
    return null;
  }
}

async function notifyForCreatedSpoon(
  db: Database,
  env: Env | null | undefined,
  waitUntil: WaitUntil | undefined,
  input: {
    principal: ApiPrincipal;
    recipe: NativeSpoonRecipe;
    spoon: RecipeSpoon;
    isOriginCook: boolean;
  },
): Promise<NativeSpoonNotificationsPayload> {
  const vapid = vapidFor(env);
  let spoonOnMyRecipe: NativeSpoonNotificationStatus = "skipped";
  let fellowChefOriginCook: NativeSpoonNotificationStatus = "skipped";

  if (input.recipe.chefId !== input.principal.id) {
    if (vapid) {
      const result = await notifySpoonOnMyRecipe(db, {
        recipeId: input.recipe.id,
        spoonerId: input.principal.id,
      }, { vapid, waitUntil });
      spoonOnMyRecipe = result.queuedSends > 0 ? "queued" : "skipped";
    } else {
      spoonOnMyRecipe = "unavailable";
    }
  }

  if (input.isOriginCook) {
    if (vapid) {
      const result = await fanoutFellowChefOriginCook(db, {
        spoonerId: input.principal.id,
        recipeId: input.recipe.id,
        recipeTitle: input.recipe.title,
        spoonerUsername: input.principal.username,
      }, { vapid, waitUntil });
      fellowChefOriginCook = result.queuedSends > 0 ? "queued" : "skipped";
    } else {
      fellowChefOriginCook = "unavailable";
    }
  }

  return { spoonOnMyRecipe, fellowChefOriginCook };
}

async function createCoverForSpoonIfNeeded(
  db: Database,
  env: Env | null | undefined,
  waitUntil: WaitUntil | undefined,
  input: {
    principalId: string;
    recipe: NativeSpoonRecipe;
    spoon: RecipeSpoon;
    isOriginCook: boolean;
    useAsRecipeCover: boolean;
  },
): Promise<NativeFullCoverPayload | null> {
  const decision = decideSpoonCoverCreation({
    recipe: input.recipe,
    userId: input.principalId,
    isOriginCook: input.isOriginCook,
    hasPhoto: Boolean(input.spoon.photoUrl),
    useAsRecipeCover: input.useAsRecipeCover,
  });
  if (!decision.shouldCreateCover || !input.spoon.photoUrl) return null;

  const cover = await db.recipeCover.create({
    data: {
      recipeId: input.recipe.id,
      imageUrl: input.spoon.photoUrl,
      sourceType: "spoon",
      sourceSpoonId: input.spoon.id,
      status: "processing",
      createdById: input.principalId,
      sourceImageUrl: input.spoon.photoUrl,
      generationStatus: "processing",
    },
  });
  await activateSpoonCoverForDecision(db, {
    recipeId: input.recipe.id,
    coverId: cover.id,
    decision,
    previousActiveCoverId: input.recipe.activeCoverId,
  });

  if (waitUntil) {
    waitUntil(scheduleSpoonCoverStylization({
      db,
      userId: input.principalId,
      recipeId: input.recipe.id,
      coverId: cover.id,
      rawPhotoUrl: input.spoon.photoUrl,
      recipeTitle: input.recipe.title,
      sourceType: "spoon",
      env,
      bucket: env?.PHOTOS,
      activateWhenReady: false,
      suppressAutoActivation: true,
    }).catch(() => undefined));
  }

  const nextRecipe = await db.recipe.findUniqueOrThrow({
    where: { id: input.recipe.id },
    select: { activeCoverId: true, activeCoverVariant: true },
  });
  const nextCover = await db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } });
  return fullCoverPayload(nextCover, nextRecipe);
}

async function findCoverForRecoveredSpoon(
  db: Database,
  recipe: NativeSpoonRecipe,
  spoonId: string,
): Promise<NativeFullCoverPayload | null> {
  const cover = await db.recipeCover.findFirst({
    where: { recipeId: recipe.id, sourceSpoonId: spoonId },
    orderBy: { createdAt: "asc" },
  });
  return cover ? fullCoverPayload(cover, recipe) : null;
}

async function recoveredOriginCook(
  db: Database,
  recipe: NativeSpoonRecipe,
  spoon: RecipeSpoon,
  principalId: string,
) {
  if (recipe.chefId !== principalId) return false;
  const prior = await db.recipeSpoon.findFirst({
    where: {
      id: { not: spoon.id },
      chefId: principalId,
      recipeId: recipe.id,
      deletedAt: null,
      createdAt: { lt: spoon.createdAt },
    },
    select: { id: true },
  });
  return prior === null;
}

function recoveredNotifications(): NativeSpoonNotificationsPayload {
  // Recovery must not duplicate push work, and NotificationEvent rows do not
  // persist the original queued send count. Report no new sends instead of
  // inferring a false queued state from an in-app event row.
  return {
    spoonOnMyRecipe: "skipped",
    fellowChefOriginCook: "skipped",
  };
}

export async function createNativeRecipeSpoon(
  db: Database,
  env: Env | null | undefined,
  principal: ApiPrincipal,
  recipeId: string,
  input: NativeSpoonCreateInput,
  _reservation: ApiIdempotencyKey,
  waitUntil?: WaitUntil,
): Promise<ApiV1SpoonResult<{ status: number; data: NativeSpoonCreatePayload }>> {
  const recipe = await loadSpoonRecipe(db, recipeId);
  if (!recipe) return failure("not_found", "Recipe not found");
  const photoValidation = await validatePhotoUrlAssignment({ env, principalId: principal.id, photoUrl: input.photoUrl });
  if (photoValidation) return photoValidation;

  try {
    const created = await createSpoon(db, {
      id: _reservation.id,
      chefId: principal.id,
      recipeId,
      note: input.note,
      nextTime: input.nextTime,
      cookedAt: input.cookedAt,
      photoUrl: input.photoUrl,
      photoFile: input.photoFile,
    }, { bucket: env?.PHOTOS });
    const [cover, notifications] = await Promise.all([
      createCoverForSpoonIfNeeded(db, env, waitUntil, {
        principalId: principal.id,
        recipe,
        spoon: created.spoon,
        isOriginCook: created.isOriginCook,
        useAsRecipeCover: input.useAsRecipeCover,
      }).catch(() => null),
      notifyForCreatedSpoon(db, env, waitUntil, {
        principal,
        recipe,
        spoon: created.spoon,
        isOriginCook: created.isOriginCook,
      }),
    ]);

    return success({
      status: 201,
      data: {
        spoon: spoonPayload(created.spoon),
        isOriginCook: created.isOriginCook,
        cover,
        notifications,
        mutation: { clientMutationId: input.clientMutationId, replayed: false },
      },
    }, 201);
  } catch (error) {
    return apiAuthErrorToFailure(error);
  }
}

export async function recoverNativeRecipeSpoonCreate(
  db: Database,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; principalId: string; recipeId: string; createInput: NativeSpoonCreateInput },
): Promise<NativeSpoonIdempotentMutationResult | null> {
  const [recipe, spoon] = await Promise.all([
    loadSpoonRecipe(db, input.recipeId),
    db.recipeSpoon.findUnique({ where: { id: reservation.id } }),
  ]);
  if (!recipe || !spoon || spoon.chefId !== input.principalId || spoon.recipeId !== input.recipeId) return null;
  if (!createInputMatchesSpoon(spoon, input.createInput)) return null;

  const isOriginCook = await recoveredOriginCook(db, recipe, spoon, input.principalId);
  const [cover, notifications] = await Promise.all([
    findCoverForRecoveredSpoon(db, recipe, spoon.id),
    Promise.resolve(recoveredNotifications()),
  ]);

  return {
    status: 201,
    data: {
      spoon: spoonPayload(spoon),
      isOriginCook,
      cover,
      notifications,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

async function loadActiveSpoonForWrite(
  db: Database,
  recipeId: string,
  spoonId: string,
  principalId: string,
): Promise<ApiV1SpoonResult<RecipeSpoon>> {
  const spoon = await db.recipeSpoon.findUnique({ where: { id: spoonId } });
  if (!spoon || spoon.deletedAt || spoon.recipeId !== recipeId) {
    return failure("not_found", "Spoon not found");
  }
  if (spoon.chefId !== principalId) {
    return failure("insufficient_scope", "Spoon does not belong to the authenticated chef");
  }
  return success(spoon);
}

export async function updateNativeRecipeSpoon(
  db: Database,
  env: Env | null | undefined,
  principal: ApiPrincipal,
  recipeId: string,
  spoonId: string,
  input: NativeSpoonUpdateInput,
  _reservation: ApiIdempotencyKey,
): Promise<ApiV1SpoonResult<{ status: number; data: NativeSpoonUpdatePayload }>> {
  const existing = await loadActiveSpoonForWrite(db, recipeId, spoonId, principal.id);
  if (!existing.ok) return existing;
  const photoValidation = await validatePhotoUrlAssignment({ env, principalId: principal.id, photoUrl: input.photoUrl });
  if (photoValidation) return photoValidation;

  try {
    const spoon = await updateSpoon(db, spoonId, principal.id, {
      note: input.note,
      nextTime: input.nextTime,
      cookedAt: input.cookedAt,
      photoUrl: input.photoUrl,
    });
    return success({
      status: 200,
      data: {
        spoon: spoonPayload(spoon),
        cover: null,
        mutation: { clientMutationId: input.clientMutationId, replayed: false },
      },
    });
  } catch (error) {
    return apiAuthErrorToFailure(error);
  }
}

export async function recoverNativeRecipeSpoonUpdate(
  db: Database,
  _reservation: ApiIdempotencyKey,
  input: {
    clientMutationId: string;
    principalId: string;
    recipeId: string;
    spoonId: string;
    updateInput: NativeSpoonUpdateInput;
  },
): Promise<NativeSpoonIdempotentMutationResult | null> {
  const spoon = await db.recipeSpoon.findUnique({ where: { id: input.spoonId } });
  if (!spoon || spoon.chefId !== input.principalId || spoon.recipeId !== input.recipeId) return null;
  if (!updateInputMatchesSpoon(spoon, input.updateInput)) return null;
  return {
    status: 200,
    data: {
      spoon: spoonPayload(spoon),
      cover: null,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

export async function deleteNativeRecipeSpoon(
  db: Database,
  principal: ApiPrincipal,
  recipeId: string,
  spoonId: string,
  input: NativeSpoonDeleteInput,
  _reservation: ApiIdempotencyKey,
): Promise<ApiV1SpoonResult<{ status: number; data: NativeSpoonDeletePayload }>> {
  const existing = await loadActiveSpoonForWrite(db, recipeId, spoonId, principal.id);
  if (!existing.ok) return existing;

  try {
    const spoon = await deleteSpoon(db, spoonId, principal.id);
    return success({
      status: 200,
      data: {
        deleted: true,
        spoon: spoonPayload(spoon),
        mutation: { clientMutationId: input.clientMutationId, replayed: false },
      },
    });
  } catch (error) {
    return apiAuthErrorToFailure(error);
  }
}

export async function recoverNativeRecipeSpoonDelete(
  db: Database,
  reservation: ApiIdempotencyKey,
  input: { clientMutationId: string; principalId: string; recipeId: string; spoonId: string },
): Promise<NativeSpoonIdempotentMutationResult | null> {
  const spoon = await db.recipeSpoon.findUnique({ where: { id: input.spoonId } });
  if (!spoon || spoon.chefId !== input.principalId || spoon.recipeId !== input.recipeId || !spoon.deletedAt) return null;
  if (spoon.deletedAt.getTime() < reservation.createdAt.getTime()) return null;
  return {
    status: 200,
    data: {
      deleted: true,
      spoon: spoonPayload(spoon),
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}
