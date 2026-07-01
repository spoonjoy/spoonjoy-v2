import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";

type NativeSyncInvalidationDb = PrismaClientType | Prisma.TransactionClient;

export type NativeSyncDeletedResourceKind = "recipe" | "cookbook";

export interface NativeSyncTombstoneInput {
  accountId: string;
  resourceType: NativeSyncDeletedResourceKind;
  resourceId: string;
  parentResourceId?: string | null;
  title?: string | null;
  deletedAt: Date;
  updatedAt: Date;
}

export function nativeSyncDeletedKind(resourceType: string): NativeSyncDeletedResourceKind | null {
  if (resourceType === "recipe" || resourceType === "cookbook") return resourceType;
  return null;
}

export function nativeSyncTombstoneUpsertOperation(
  db: NativeSyncInvalidationDb,
  input: NativeSyncTombstoneInput,
): Prisma.PrismaPromise<unknown> {
  return db.nativeSyncTombstone.upsert({
    where: {
      accountId_resourceType_resourceId: {
        accountId: input.accountId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    },
    update: {
      parentResourceId: input.parentResourceId ?? null,
      title: input.title ?? null,
      deletedAt: input.deletedAt,
      updatedAt: input.updatedAt,
    },
    create: {
      accountId: input.accountId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      parentResourceId: input.parentResourceId ?? null,
      title: input.title ?? null,
      deletedAt: input.deletedAt,
      updatedAt: input.updatedAt,
    },
  });
}

export async function recordNativeSyncTombstone(
  db: NativeSyncInvalidationDb,
  input: NativeSyncTombstoneInput,
): Promise<void> {
  await nativeSyncTombstoneUpsertOperation(db, input);
}

export function touchNativeSyncRecipeOperation(
  db: NativeSyncInvalidationDb,
  recipeId: string,
  updatedAt = new Date(),
): Prisma.PrismaPromise<unknown> {
  return db.recipe.update({
    where: { id: recipeId },
    data: { updatedAt },
  });
}

export async function touchNativeSyncRecipe(
  db: NativeSyncInvalidationDb,
  recipeId: string,
  updatedAt = new Date(),
): Promise<void> {
  await touchNativeSyncRecipeOperation(db, recipeId, updatedAt);
}

export function touchNativeSyncCookbooksForRecipeOperation(
  db: NativeSyncInvalidationDb,
  recipeId: string,
  updatedAt = new Date(),
): Prisma.PrismaPromise<unknown> {
  return db.cookbook.updateMany({
    where: { recipes: { some: { recipeId } } },
    data: { updatedAt },
  });
}

export async function touchNativeSyncCookbooksForRecipe(
  db: NativeSyncInvalidationDb,
  recipeId: string,
  updatedAt = new Date(),
): Promise<void> {
  await touchNativeSyncCookbooksForRecipeOperation(db, recipeId, updatedAt);
}

export async function touchNativeSyncRecipeAndContainingCookbooks(
  db: NativeSyncInvalidationDb,
  recipeId: string,
  updatedAt = new Date(),
): Promise<void> {
  await touchNativeSyncRecipeOperation(db, recipeId, updatedAt);
  await touchNativeSyncCookbooksForRecipeOperation(db, recipeId, updatedAt);
}

export function touchNativeSyncCookbookOperation(
  db: NativeSyncInvalidationDb,
  cookbookId: string,
  updatedAt = new Date(),
): Prisma.PrismaPromise<unknown> {
  return db.cookbook.update({
    where: { id: cookbookId },
    data: { updatedAt },
  });
}
