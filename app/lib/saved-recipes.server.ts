import type { PrismaClient } from "@prisma/client";

export const SAVED_RECIPE_DEFAULT_LIMIT = 24;
export const SAVED_RECIPE_MAX_LIMIT = 24;

const MAX_QUERY_CODE_POINTS = 200;
const MAX_CURSOR_CHARACTERS = 1443;
const MAX_CURSOR_BYTES = 1082;
const MAX_CURSOR_RECIPE_ID_CODE_POINTS = 256;
const MIN_CANONICAL_TIME_MS = -62_167_219_200_000;
const MAX_CANONICAL_TIME_MS = 253_402_300_799_999;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;
const CATEGORY_C = /\p{C}/u;
const UNICODE_WHITESPACE = /\p{White_Space}+/gu;

type SavedRecipesDatabase = Pick<PrismaClient, "$queryRawUnsafe" | "savedRecipe">;

export type SavedRecipeCursor = {
  savedAt: string;
  recipeId: string;
};

export type SavedRecipeListItem = SavedRecipeCursor;

export class SavedRecipeValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "SavedRecipeValidationError";
    this.field = field;
  }
}

export class SavedRecipeNotFoundError extends Error {
  readonly recipeId: string;

  constructor(recipeId: string) {
    super("Recipe not found");
    this.name = "SavedRecipeNotFoundError";
    this.recipeId = recipeId;
  }
}

function validationError(field: string, message: string): never {
  throw new SavedRecipeValidationError(field, message);
}

function collapseUnicodeWhitespace(value: string) {
  return value.replace(UNICODE_WHITESPACE, " ").replace(/^ | $/g, "");
}

export function escapeSavedRecipeLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function normalizeSavedRecipeQuery(value: string | null | undefined) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    validationError("q", "q must be a string");
  }

  const displayQuery = collapseUnicodeWhitespace(value ?? "");
  if (CATEGORY_C.test(displayQuery)) {
    validationError("q", "q contains unsupported control characters");
  }
  if (Array.from(displayQuery).length > MAX_QUERY_CODE_POINTS) {
    validationError("q", "q must contain at most 200 code points");
  }

  const normalizedTag = displayQuery.normalize("NFKC");
  if (CATEGORY_C.test(normalizedTag)) {
    validationError("q", "q contains unsupported control characters");
  }
  const tagQuery = collapseUnicodeWhitespace(normalizedTag).toLowerCase();
  const displayEscaped = escapeSavedRecipeLike(displayQuery);
  const tagEscaped = escapeSavedRecipeLike(tagQuery);

  return {
    displayQuery,
    tagQuery,
    displayPattern: displayQuery ? `%${displayEscaped}%` : "",
    tagPattern: tagQuery ? `%${tagEscaped}%` : "",
  };
}

function validateCanonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP.test(value)) {
    validationError(field, `${field} must be a canonical UTC timestamp`);
  }
  try {
    if (new Date(value).toISOString() !== value) {
      validationError(field, `${field} must be a canonical UTC timestamp`);
    }
  } catch {
    validationError(field, `${field} must be a canonical UTC timestamp`);
  }
  return value;
}

function validateCursorRecipeId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    validationError("cursor", "cursor recipeId must be a non-empty string");
  }
  if (CATEGORY_C.test(value) || Array.from(value).length > MAX_CURSOR_RECIPE_ID_CODE_POINTS) {
    validationError("cursor", "cursor recipeId is invalid");
  }
  return value;
}

function bytesToBase64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeSavedRecipesCursor(value: SavedRecipeCursor) {
  const savedAt = validateCanonicalTimestamp(value?.savedAt, "cursor");
  const recipeId = validateCursorRecipeId(value?.recipeId);
  const json = JSON.stringify({ v: 1, savedAt, recipeId });
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_CURSOR_BYTES) {
    validationError("cursor", "cursor payload is too large");
  }
  const encoded = bytesToBase64url(bytes);
  if (encoded.length === 0 || encoded.length > MAX_CURSOR_CHARACTERS) {
    validationError("cursor", "cursor is too large");
  }
  return encoded;
}

export function decodeSavedRecipesCursor(value: string): SavedRecipeCursor {
  if (typeof value !== "string" || value.length === 0 ||
    value.length > MAX_CURSOR_CHARACTERS || !CURSOR_ALPHABET.test(value)) {
    validationError("cursor", "cursor must be unpadded base64url");
  }

  try {
    const bytes = base64urlToBytes(value);
    if (bytes.length === 0 || bytes.length > MAX_CURSOR_BYTES || bytesToBase64url(bytes) !== value) {
      validationError("cursor", "cursor encoding is not canonical");
    }
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      validationError("cursor", "cursor payload is invalid");
    }
    const record = parsed as Record<string, unknown>;
    const savedAt = validateCanonicalTimestamp(record.savedAt, "cursor");
    const recipeId = validateCursorRecipeId(record.recipeId);
    if (json !== JSON.stringify({ v: 1, savedAt, recipeId })) {
      validationError("cursor", "cursor payload is not canonical");
    }
    return { savedAt, recipeId };
  } catch (error) {
    if (error instanceof SavedRecipeValidationError) throw error;
    validationError("cursor", "cursor is invalid");
  }
}

function parseLimit(value: number | undefined) {
  const limit = value === undefined ? SAVED_RECIPE_DEFAULT_LIMIT : value;
  if (!Number.isInteger(limit) || limit < 1 || limit > SAVED_RECIPE_MAX_LIMIT) {
    validationError("limit", "limit must be an integer between 1 and 24");
  }
  return limit;
}

function validateStoredRows(rows: SavedRecipeListItem[]) {
  return rows.map((row) => {
    if (!row || typeof row.recipeId !== "string") {
      validationError("recipeId", "Saved recipe row has an invalid recipeId");
    }
    return {
      recipeId: row.recipeId,
      savedAt: validateCanonicalTimestamp(row.savedAt, "savedAt"),
    };
  });
}

export async function listSavedRecipes(
  database: Pick<SavedRecipesDatabase, "$queryRawUnsafe">,
  input: {
    userId: string;
    query?: string | null;
    limit?: number;
    cursor?: string | null;
  },
) {
  const query = normalizeSavedRecipeQuery(input.query);
  const limit = parseLimit(input.limit);
  const cursor = input.cursor === null || input.cursor === undefined
    ? null
    : decodeSavedRecipesCursor(input.cursor);
  const values: unknown[] = [input.userId];

  const searchSql = query.displayQuery ? `
    AND (
      recipe."title" LIKE ? ESCAPE '\\'
      OR COALESCE(recipe."description", '') LIKE ? ESCAPE '\\'
      OR chef."username" LIKE ? ESCAPE '\\'
      OR COALESCE(recipe."course", '') LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM "RecipeTag" AS tag
        WHERE tag."recipeId" = recipe."id"
          AND tag."normalizedLabel" LIKE ? ESCAPE '\\'
      )
    )` : "";
  if (query.displayQuery) {
    values.push(
      query.displayPattern,
      query.displayPattern,
      query.displayPattern,
      query.displayPattern,
      query.tagPattern,
    );
  }

  const cursorSql = cursor ? `
    AND (
      saved."savedAt" COLLATE BINARY < ? COLLATE BINARY
      OR (
        saved."savedAt" COLLATE BINARY = ? COLLATE BINARY
        AND saved."recipeId" COLLATE BINARY < ? COLLATE BINARY
      )
    )` : "";
  if (cursor) values.push(cursor.savedAt, cursor.savedAt, cursor.recipeId);

  const rows = await database.$queryRawUnsafe<SavedRecipeListItem[]>(`
    SELECT
      saved."recipeId" AS "recipeId",
      saved."savedAt" AS "savedAt"
    FROM "SavedRecipe" AS saved
    INNER JOIN "Recipe" AS recipe ON recipe."id" = saved."recipeId"
    INNER JOIN "User" AS chef ON chef."id" = recipe."chefId"
    WHERE saved."userId" = ?
      AND recipe."deletedAt" IS NULL${searchSql}${cursorSql}
    ORDER BY saved."savedAt" COLLATE BINARY DESC, saved."recipeId" COLLATE BINARY DESC
    LIMIT ${limit + 1}
  `, ...values);
  const validatedRows = validateStoredRows(rows);
  const items = validatedRows.slice(0, limit);
  const nextCursor = validatedRows.length > limit
    ? encodeSavedRecipesCursor(items[items.length - 1]!)
    : null;

  return {
    query: query.displayQuery,
    items,
    nextCursor,
  };
}

function canonicalSavedAt(nowMs: number) {
  if (!Number.isInteger(nowMs) || nowMs < MIN_CANONICAL_TIME_MS || nowMs > MAX_CANONICAL_TIME_MS) {
    validationError("nowMs", "nowMs must be an integer within four-digit UTC years");
  }
  return new Date(nowMs).toISOString();
}

export async function saveRecipe(
  database: Pick<SavedRecipesDatabase, "$queryRawUnsafe">,
  input: { userId: string; recipeId: string; nowMs: number },
  hooks: { beforePersist?: () => Promise<void> } = {},
) {
  const savedAt = canonicalSavedAt(input.nowMs);
  await hooks.beforePersist?.();
  const [saved] = await database.$queryRawUnsafe<SavedRecipeListItem[]>(`
    INSERT INTO "SavedRecipe" ("userId", "recipeId", "savedAt")
    SELECT ?, recipe."id", ?
    FROM "Recipe" AS recipe
    WHERE recipe."id" = ?
      AND recipe."deletedAt" IS NULL
    ON CONFLICT ("userId", "recipeId") DO UPDATE
      SET "savedAt" = "SavedRecipe"."savedAt"
    RETURNING "recipeId", "savedAt"
  `, input.userId, savedAt, input.recipeId);
  if (!saved) throw new SavedRecipeNotFoundError(input.recipeId);

  return {
    recipeId: saved.recipeId,
    savedAt: validateCanonicalTimestamp(saved.savedAt, "savedAt"),
  };
}

export async function unsaveRecipe(
  database: Pick<SavedRecipesDatabase, "savedRecipe">,
  input: { userId: string; recipeId: string },
) {
  await database.savedRecipe.deleteMany({
    where: { userId: input.userId, recipeId: input.recipeId },
  });
  return { recipeId: input.recipeId };
}
