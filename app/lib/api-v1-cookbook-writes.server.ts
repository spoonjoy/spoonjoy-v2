import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import { validateTitle } from "~/lib/validation";

type Database = PrismaClientType;
const CLIENT_MUTATION_ID_MAX_LENGTH = 160;

export type ApiV1CookbookWriteResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export interface NativeCookbookTitleInput {
  clientMutationId: string;
  title: string;
}

export interface NativeCookbookDeleteInput {
  clientMutationId: string;
}

export interface NativeCookbookRecipeInput {
  clientMutationId: string;
}

function success<T>(data: T, status = 200): ApiV1CookbookWriteResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1CookbookWriteResult<T> {
  return { ok: false, code, message, details };
}

function fieldFailure<T>(field: string, message: string): ApiV1CookbookWriteResult<T> {
  return failure("validation_error", "Invalid cookbook fields", { fieldErrors: { [field]: message } });
}

function assertKnownFields<T>(
  body: Record<string, unknown>,
  allowed: readonly string[],
): ApiV1CookbookWriteResult<T> | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((field) => !allowedSet.has(field));
  return unknown.length > 0
    ? failure("validation_error", "Unknown request body fields", { fields: unknown })
    : null;
}

function requiredText(
  value: unknown,
  field: string,
  validate: (value: string) => { valid: true } | { valid: false; error: string },
): ApiV1CookbookWriteResult<string> {
  if (typeof value !== "string") {
    return fieldFailure(field, `${field} must be a string`);
  }
  const validation = validate(value);
  if (!validation.valid) return fieldFailure(field, validation.error);
  return success(value.trim());
}

function clientMutationIdFrom(value: unknown): ApiV1CookbookWriteResult<string> {
  return requiredText(value, "clientMutationId", (candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return { valid: false, error: "clientMutationId must be a nonblank string" };
    if (trimmed.length > CLIENT_MUTATION_ID_MAX_LENGTH) {
      return { valid: false, error: `clientMutationId must be ${CLIENT_MUTATION_ID_MAX_LENGTH} characters or less` };
    }
    return { valid: true };
  });
}

export function parseNativeCookbookCreateBody(body: Record<string, unknown>): ApiV1CookbookWriteResult<NativeCookbookTitleInput> {
  const unknown = assertKnownFields<NativeCookbookTitleInput>(body, ["clientMutationId", "title"]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  const title = requiredText(body.title, "title", validateTitle);
  if (!title.ok) return title;

  return success({ clientMutationId: clientMutationId.data, title: title.data });
}

export function parseNativeCookbookPatchBody(body: Record<string, unknown>): ApiV1CookbookWriteResult<NativeCookbookTitleInput> {
  return parseNativeCookbookCreateBody(body);
}

export function parseNativeCookbookDeleteBody(
  body: Record<string, unknown>,
  fallbackClientMutationId: unknown,
): ApiV1CookbookWriteResult<NativeCookbookDeleteInput> {
  const unknown = assertKnownFields<NativeCookbookDeleteInput>(body, ["clientMutationId"]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId ?? fallbackClientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  return success({ clientMutationId: clientMutationId.data });
}

export function parseNativeCookbookRecipeBody(
  body: Record<string, unknown>,
  fallbackClientMutationId?: unknown,
): ApiV1CookbookWriteResult<NativeCookbookRecipeInput> {
  const unknown = assertKnownFields<NativeCookbookRecipeInput>(body, ["clientMutationId"]);
  if (unknown) return unknown;

  const clientMutationId = clientMutationIdFrom(body.clientMutationId ?? fallbackClientMutationId);
  if (!clientMutationId.ok) return clientMutationId;

  return success({ clientMutationId: clientMutationId.data });
}

async function duplicateCookbookTitle(db: Database, authorId: string, title: string, excludeCookbookId?: string) {
  return await db.cookbook.findFirst({
    where: {
      authorId,
      title,
      ...(excludeCookbookId ? { id: { not: excludeCookbookId } } : {}),
    },
    select: { id: true },
  });
}

export async function createNativeCookbook(
  db: Database,
  authorId: string,
  input: NativeCookbookTitleInput,
  options: { cookbookId?: string } = {},
): Promise<ApiV1CookbookWriteResult<{ cookbookId: string; created: boolean }>> {
  const existing = await duplicateCookbookTitle(db, authorId, input.title);
  if (existing) {
    return fieldFailure("title", "You already have a cookbook with this title");
  }

  const cookbook = await db.cookbook.create({
    data: {
      id: options.cookbookId,
      title: input.title,
      authorId,
    },
    select: { id: true },
  });

  return success({ cookbookId: cookbook.id, created: true }, 201);
}

export async function updateNativeCookbook(
  db: Database,
  authorId: string,
  cookbookId: string,
  input: NativeCookbookTitleInput,
): Promise<ApiV1CookbookWriteResult<{ cookbookId: string; updated: boolean }>> {
  const cookbook = await db.cookbook.findUnique({
    where: { id: cookbookId },
    select: { id: true, authorId: true, title: true },
  });
  if (!cookbook) return failure("not_found", "Cookbook not found");
  if (cookbook.authorId !== authorId) {
    return failure("insufficient_scope", "Cookbook does not belong to the authenticated chef");
  }

  const duplicate = await duplicateCookbookTitle(db, authorId, input.title, cookbookId);
  if (duplicate) {
    return fieldFailure("title", "You already have a cookbook with this title");
  }

  if (cookbook.title !== input.title) {
    await db.cookbook.update({
      where: { id: cookbookId },
      data: { title: input.title },
    });
  }

  return success({ cookbookId, updated: true });
}

export async function deleteNativeCookbook(
  db: Database,
  authorId: string,
  cookbookId: string,
  options: { idempotencyKeyId: string; operation: string },
): Promise<ApiV1CookbookWriteResult<{ cookbook: { id: string; title: string; deletedAt: Date }; deleted: boolean }>> {
  const cookbook = await db.cookbook.findUnique({
    where: { id: cookbookId },
    select: { id: true, authorId: true, title: true },
  });
  if (!cookbook) return failure("not_found", "Cookbook not found");
  if (cookbook.authorId !== authorId) {
    return failure("insufficient_scope", "Cookbook does not belong to the authenticated chef");
  }
  const deletedAt = new Date();

  await db.$transaction([
    db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: options.idempotencyKeyId,
        operation: options.operation,
        resourceType: "cookbook",
        resourceId: cookbookId,
        payload: JSON.stringify({ title: cookbook.title, deletedAt: deletedAt.toISOString() }),
      },
    }),
    db.cookbook.delete({ where: { id: cookbookId } }),
  ]);

  return success({ cookbook: { id: cookbook.id, title: cookbook.title, deletedAt }, deleted: true });
}

async function loadOwnedCookbook<T>(db: Database, authorId: string, cookbookId: string): Promise<
  | { ok: true; cookbook: { id: string; authorId: string } }
  | { ok: false; result: ApiV1CookbookWriteResult<T> }
> {
  const cookbook = await db.cookbook.findUnique({
    where: { id: cookbookId },
    select: { id: true, authorId: true },
  });
  if (!cookbook) return { ok: false as const, result: failure<T>("not_found", "Cookbook not found") };
  if (cookbook.authorId !== authorId) {
    return { ok: false as const, result: failure<T>("insufficient_scope", "Cookbook does not belong to the authenticated chef") };
  }
  return { ok: true as const, cookbook };
}

export async function addNativeRecipeToCookbook(
  db: Database,
  authorId: string,
  cookbookId: string,
  recipeId: string,
  options: { relationId?: string } = {},
): Promise<ApiV1CookbookWriteResult<{ cookbookId: string; recipeId: string; added: boolean }>> {
  const cookbook = await loadOwnedCookbook<{ cookbookId: string; recipeId: string; added: boolean }>(db, authorId, cookbookId);
  if (!cookbook.ok) return cookbook.result;

  const recipe = await db.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: { id: true },
  });
  if (!recipe) return failure("not_found", "Recipe not found");

  const existing = await db.recipeInCookbook.findUnique({
    where: { cookbookId_recipeId: { cookbookId, recipeId } },
    select: { id: true },
  });
  if (existing) {
    return success({ cookbookId, recipeId, added: false });
  }

  await db.recipeInCookbook.create({
    data: { id: options.relationId, cookbookId, recipeId, addedById: authorId },
  });

  return success({ cookbookId, recipeId, added: true }, 201);
}

export async function removeNativeRecipeFromCookbook(
  db: Database,
  authorId: string,
  cookbookId: string,
  recipeId: string,
  options: { idempotencyKeyId: string; operation: string },
): Promise<ApiV1CookbookWriteResult<{ cookbookId: string; recipeId: string; removed: boolean }>> {
  const cookbook = await loadOwnedCookbook<{ cookbookId: string; recipeId: string; removed: boolean }>(db, authorId, cookbookId);
  if (!cookbook.ok) return cookbook.result;

  const existing = await db.recipeInCookbook.findUnique({
    where: { cookbookId_recipeId: { cookbookId, recipeId } },
    select: { id: true },
  });
  if (!existing) {
    return success({ cookbookId, recipeId, removed: false });
  }

  await db.$transaction([
    db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: options.idempotencyKeyId,
        operation: options.operation,
        resourceType: "recipe_in_cookbook",
        resourceId: recipeId,
        parentResourceId: cookbookId,
      },
    }),
    db.recipeInCookbook.delete({
      where: { id: existing.id },
    }),
  ]);

  return success({ cookbookId, recipeId, removed: true });
}
