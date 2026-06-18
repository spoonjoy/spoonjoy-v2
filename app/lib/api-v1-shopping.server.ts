import type { ApiIdempotencyKey, Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";

type Database = PrismaClientType;

export type ApiV1ShoppingResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export interface NativeShoppingAddFromRecipeInput {
  clientMutationId: string;
  recipeId: string;
  scaleFactor: number;
}

export interface NativeShoppingClearInput {
  clientMutationId: string;
}

export interface NativeShoppingItemRow {
  id: string;
  quantity: number | null;
  checked: boolean;
  checkedAt: Date | null;
  deletedAt: Date | null;
  sortIndex: number;
  categoryKey: string | null;
  iconKey: string | null;
  updatedAt: Date;
  unit: { name: string } | null;
  ingredientRef: { name: string };
}

type NativeShoppingItemRecoveryRow = NativeShoppingItemRow & {
  unitId: string | null;
  ingredientRefId: string;
};

type NativeShoppingRecipeGroup = {
  unitId: string;
  ingredientRefId: string;
  quantity: number;
  unit: { name: string };
  ingredientRef: { name: string };
};

type NativeShoppingRecipeForAdd = {
  id: string;
  title: string;
  groups: NativeShoppingRecipeGroup[];
};

type NativeShoppingIdempotencyOptions = {
  idempotencyKeyId: string;
  operation: string;
};

function success<T>(data: T, status = 200): ApiV1ShoppingResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1ShoppingResult<T> {
  return { ok: false, code, message, details };
}

async function loadNativeShoppingList(db: Database, userId: string) {
  return await db.shoppingList.findUnique({
    where: { authorId: userId },
    select: { id: true },
  });
}

async function loadOrCreateNativeShoppingList(db: Database, userId: string) {
  const existing = await loadNativeShoppingList(db, userId);
  if (existing) return existing;
  return await db.shoppingList.create({
    data: { authorId: userId },
    select: { id: true },
  });
}

async function loadNativeShoppingRecipeForAdd(
  db: Database,
  recipeId: string,
): Promise<NativeShoppingRecipeForAdd | null> {
  const recipe = await db.recipe.findFirst({
    where: { id: recipeId, deletedAt: null },
    select: {
      id: true,
      title: true,
      steps: {
        orderBy: { stepNum: "asc" },
        select: {
          ingredients: {
            orderBy: { id: "asc" },
            select: {
              quantity: true,
              unitId: true,
              ingredientRefId: true,
              unit: { select: { name: true } },
              ingredientRef: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!recipe) return null;

  const groupsByKey = new Map<string, NativeShoppingRecipeGroup>();
  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      const key = `${ingredient.unitId}\u0000${ingredient.ingredientRefId}`;
      const current = groupsByKey.get(key);
      if (current) {
        current.quantity += ingredient.quantity;
      } else {
        groupsByKey.set(key, {
          unitId: ingredient.unitId,
          ingredientRefId: ingredient.ingredientRefId,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          ingredientRef: ingredient.ingredientRef,
        });
      }
    }
  }

  return {
    id: recipe.id,
    title: recipe.title,
    groups: Array.from(groupsByKey.values()),
  };
}

async function nextNativeShoppingSortIndex(db: Database, shoppingListId: string) {
  const maxItem = await db.shoppingListItem.findFirst({
    where: { shoppingListId, deletedAt: null },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });

  return (maxItem?.sortIndex ?? -1) + 1;
}

async function normalizeNativeShoppingListOrdering(db: Database, shoppingListId: string) {
  const activeItems = await db.shoppingListItem.findMany({
    where: { shoppingListId, deletedAt: null },
    select: { id: true, checkedAt: true },
    orderBy: [{ sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
  });

  await Promise.all(
    activeItems.map((item, index) =>
      db.shoppingListItem.update({
        where: { id: item.id },
        data: { sortIndex: index, checked: Boolean(item.checkedAt) },
      }),
    ),
  );
}

async function loadNativeShoppingItemsById(db: Database, ids: string[]): Promise<NativeShoppingItemRow[]> {
  if (ids.length === 0) return [];
  return await db.shoppingListItem.findMany({
    where: { id: { in: ids } },
    include: { unit: { select: { name: true } }, ingredientRef: { select: { name: true } } },
    orderBy: [{ sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
  });
}

async function loadNativeShoppingItemsForListById(
  db: Database,
  shoppingListId: string,
  ids: string[],
): Promise<NativeShoppingItemRecoveryRow[]> {
  if (ids.length === 0) return [];
  return await db.shoppingListItem.findMany({
    where: { id: { in: ids }, shoppingListId },
    include: { unit: { select: { name: true } }, ingredientRef: { select: { name: true } } },
    orderBy: [{ sortIndex: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
  });
}

function parsedCreatedPayload(payload: string | null): boolean | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { created?: unknown }).created === "boolean"
    ) {
      return (parsed as { created: boolean }).created;
    }
  } catch {
    return null;
  }
  return null;
}

function parsedClearedPayload(payload: string | null): boolean {
  if (!payload) return false;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as { cleared?: unknown }).cleared === true,
    );
  } catch {
    return false;
  }
}

export async function addNativeRecipeIngredientsToShoppingList(
  db: Database,
  userId: string,
  input: NativeShoppingAddFromRecipeInput,
  options: NativeShoppingIdempotencyOptions,
): Promise<ApiV1ShoppingResult<{
  recipe: { id: string; title: string };
  created: number;
  updated: number;
  items: NativeShoppingItemRow[];
}>> {
  const recipe = await loadNativeShoppingRecipeForAdd(db, input.recipeId);
  if (!recipe) {
    return failure("not_found", "Recipe not found", { resource: "recipe", recipeId: input.recipeId });
  }

  const existingList = await loadNativeShoppingList(db, userId);
  const shoppingListId = existingList?.id ?? crypto.randomUUID();
  const changedItemIds: string[] = [];
  let created = 0;
  let updated = 0;
  let nextSortIndex = existingList ? await nextNativeShoppingSortIndex(db, shoppingListId) : 0;
  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (!existingList) {
    operations.push(db.shoppingList.create({
      data: { id: shoppingListId, authorId: userId },
    }));
  }

  for (const group of recipe.groups) {
    const existingItem = await db.shoppingListItem.findUnique({
      where: {
        shoppingListId_unitId_ingredientRefId: {
          shoppingListId,
          unitId: group.unitId,
          ingredientRefId: group.ingredientRefId,
        },
      },
    });
    const affordance = resolveIngredientAffordance(group.ingredientRef.name, null, null);
    const scaledQuantity = group.quantity * input.scaleFactor;

    if (existingItem) {
      const shouldMoveToEnd = Boolean(existingItem.deletedAt || existingItem.checkedAt || existingItem.checked);
      const itemId = existingItem.id;
      changedItemIds.push(itemId);
      updated += 1;
      operations.push(
        db.shoppingListItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: (existingItem.quantity || 0) + scaledQuantity,
            checked: false,
            checkedAt: null,
            deletedAt: null,
            sortIndex: shouldMoveToEnd ? nextSortIndex++ : existingItem.sortIndex,
            categoryKey: existingItem.categoryKey ?? affordance.categoryKey,
            iconKey: affordance.iconKey,
          },
        }),
      );
      operations.push(db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: options.idempotencyKeyId,
          operation: options.operation,
          resourceType: "shopping_list_item",
          resourceId: itemId,
          parentResourceId: recipe.id,
          payload: JSON.stringify({ created: false }),
        },
      }));
    } else {
      const itemId = crypto.randomUUID();
      changedItemIds.push(itemId);
      created += 1;
      operations.push(
        db.shoppingListItem.create({
          data: {
            id: itemId,
            shoppingListId,
            ingredientRefId: group.ingredientRefId,
            unitId: group.unitId,
            quantity: scaledQuantity,
            sortIndex: nextSortIndex++,
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
          },
        }),
      );
      operations.push(db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: options.idempotencyKeyId,
          operation: options.operation,
          resourceType: "shopping_list_item",
          resourceId: itemId,
          parentResourceId: recipe.id,
          payload: JSON.stringify({ created: true }),
        },
      }));
    }
  }

  if (operations.length > 0) {
    await db.$transaction(operations);
  }

  return success({
    recipe: { id: recipe.id, title: recipe.title },
    created,
    updated,
    items: await loadNativeShoppingItemsForListById(db, shoppingListId, changedItemIds),
  });
}

export async function recoverNativeRecipeIngredientsToShoppingList(
  db: Database,
  userId: string,
  input: NativeShoppingAddFromRecipeInput,
  reservation: ApiIdempotencyKey,
): Promise<{
  status: number;
  data: {
    recipe: { id: string; title: string };
    created: number;
    updated: number;
    items: NativeShoppingItemRow[];
    mutation: { clientMutationId: string; replayed: false };
  };
} | null> {
  const recipe = await loadNativeShoppingRecipeForAdd(db, input.recipeId);
  if (!recipe) return null;

  const list = await loadNativeShoppingList(db, userId);
  if (!list) return null;

  const tombstones = await db.apiMutationTombstone.findMany({
    where: {
      idempotencyKeyId: reservation.id,
      operation: "shopping-list.add-from-recipe",
      resourceType: "shopping_list_item",
      parentResourceId: recipe.id,
    },
  });
  if (tombstones.length !== recipe.groups.length) return null;

  const items = await loadNativeShoppingItemsForListById(db, list.id, tombstones.map((tombstone) => tombstone.resourceId));
  if (items.length !== tombstones.length) return null;
  const expectedKeys = new Set(recipe.groups.map((group) => `${group.unitId}\u0000${group.ingredientRefId}`));
  const actualKeys = new Set(items.map((item) => `${item.unitId}\u0000${item.ingredientRefId}`));
  for (const expected of expectedKeys) {
    if (!actualKeys.has(expected)) return null;
  }

  let created = 0;
  let updated = 0;
  for (const tombstone of tombstones) {
    const createdPayload = parsedCreatedPayload(tombstone.payload);
    if (createdPayload === null) return null;
    if (createdPayload) created += 1;
    else updated += 1;
  }

  return {
    status: 200,
    data: {
      recipe: { id: recipe.id, title: recipe.title },
      created,
      updated,
      items,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

export async function clearCompletedNativeShoppingItems(
  db: Database,
  userId: string,
  _input: NativeShoppingClearInput,
  options: NativeShoppingIdempotencyOptions,
): Promise<ApiV1ShoppingResult<{ cleared: number; items: NativeShoppingItemRow[] }>> {
  const list = await loadOrCreateNativeShoppingList(db, userId);
  const items = await db.shoppingListItem.findMany({
    where: {
      shoppingListId: list.id,
      deletedAt: null,
      OR: [
        { checkedAt: { not: null } },
        { checked: true },
      ],
    },
    select: { id: true },
  });
  const ids = items.map((item) => item.id);

  if (ids.length > 0) {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.shoppingListItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      }),
    ];
    ops.push(...ids.map((id) => db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: options.idempotencyKeyId,
        operation: options.operation,
        resourceType: "shopping_list_item",
        resourceId: id,
        payload: JSON.stringify({ cleared: true }),
      },
    })));
    await db.$transaction(ops);
  }
  await normalizeNativeShoppingListOrdering(db, list.id);

  return success({
    cleared: ids.length,
    items: await loadNativeShoppingItemsById(db, ids),
  });
}

export async function clearAllNativeShoppingItems(
  db: Database,
  userId: string,
  _input: NativeShoppingClearInput,
  options: NativeShoppingIdempotencyOptions,
): Promise<ApiV1ShoppingResult<{ cleared: number; items: NativeShoppingItemRow[] }>> {
  const list = await loadOrCreateNativeShoppingList(db, userId);
  const items = await db.shoppingListItem.findMany({
    where: { shoppingListId: list.id, deletedAt: null },
    select: { id: true },
  });
  const ids = items.map((item) => item.id);

  if (ids.length > 0) {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.shoppingListItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      }),
    ];
    ops.push(...ids.map((id) => db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: options.idempotencyKeyId,
        operation: options.operation,
        resourceType: "shopping_list_item",
        resourceId: id,
        payload: JSON.stringify({ cleared: true }),
      },
    })));
    await db.$transaction(ops);
  }

  return success({
    cleared: ids.length,
    items: await loadNativeShoppingItemsById(db, ids),
  });
}

async function recoverNativeClearShoppingItems(
  db: Database,
  userId: string,
  input: NativeShoppingClearInput,
  reservation: ApiIdempotencyKey,
  operation: "shopping-list.clear-completed" | "shopping-list.clear-all",
): Promise<{
  status: number;
  data: {
    cleared: number;
    items: NativeShoppingItemRow[];
    mutation: { clientMutationId: string; replayed: false };
  };
} | null> {
  const list = await loadNativeShoppingList(db, userId);
  if (!list) return null;

  const tombstones = await db.apiMutationTombstone.findMany({
    where: {
      idempotencyKeyId: reservation.id,
      operation,
      resourceType: "shopping_list_item",
    },
  });
  if (tombstones.length === 0) {
    const activeMatchingItems = await db.shoppingListItem.count({
      where: {
        shoppingListId: list.id,
        deletedAt: null,
        ...(operation === "shopping-list.clear-completed"
          ? { OR: [{ checkedAt: { not: null } }, { checked: true }] }
          : {}),
      },
    });
    if (activeMatchingItems > 0) return null;

    return {
      status: 200,
      data: {
        cleared: 0,
        items: [],
        mutation: { clientMutationId: input.clientMutationId, replayed: false },
      },
    };
  }
  if (tombstones.some((tombstone) => !parsedClearedPayload(tombstone.payload))) return null;

  const items = await loadNativeShoppingItemsForListById(db, list.id, tombstones.map((tombstone) => tombstone.resourceId));
  if (items.length !== tombstones.length) return null;
  if (items.some((item) => !item.deletedAt)) return null;

  return {
    status: 200,
    data: {
      cleared: items.length,
      items,
      mutation: { clientMutationId: input.clientMutationId, replayed: false },
    },
  };
}

export async function recoverNativeClearCompletedShoppingItems(
  db: Database,
  userId: string,
  input: NativeShoppingClearInput,
  reservation: ApiIdempotencyKey,
) {
  return await recoverNativeClearShoppingItems(db, userId, input, reservation, "shopping-list.clear-completed");
}

export async function recoverNativeClearAllShoppingItems(
  db: Database,
  userId: string,
  input: NativeShoppingClearInput,
  reservation: ApiIdempotencyKey,
) {
  return await recoverNativeClearShoppingItems(db, userId, input, reservation, "shopping-list.clear-all");
}
