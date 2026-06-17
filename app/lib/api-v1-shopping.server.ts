import type { PrismaClient as PrismaClientType } from "@prisma/client";
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

async function loadOrCreateNativeShoppingList(db: Database, userId: string) {
  const existing = await db.shoppingList.findUnique({
    where: { authorId: userId },
    select: { id: true },
  });
  if (existing) return existing;
  return await db.shoppingList.create({
    data: { authorId: userId },
    select: { id: true },
  });
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

export async function addNativeRecipeIngredientsToShoppingList(
  db: Database,
  userId: string,
  input: NativeShoppingAddFromRecipeInput,
): Promise<ApiV1ShoppingResult<{
  recipe: { id: string; title: string };
  created: number;
  updated: number;
  items: NativeShoppingItemRow[];
}>> {
  const list = await loadOrCreateNativeShoppingList(db, userId);
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, deletedAt: null },
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

  if (!recipe) {
    return failure("not_found", "Recipe not found", { resource: "recipe", recipeId: input.recipeId });
  }

  const changedItems: NativeShoppingItemRow[] = [];
  let created = 0;
  let updated = 0;

  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      const existingItem = await db.shoppingListItem.findUnique({
        where: {
          shoppingListId_unitId_ingredientRefId: {
            shoppingListId: list.id,
            unitId: ingredient.unitId,
            ingredientRefId: ingredient.ingredientRefId,
          },
        },
      });
      const affordance = resolveIngredientAffordance(ingredient.ingredientRef.name, null, null);
      const scaledQuantity = ingredient.quantity ? ingredient.quantity * input.scaleFactor : null;

      if (existingItem) {
        const shouldMoveToEnd = Boolean(existingItem.deletedAt || existingItem.checkedAt || existingItem.checked);
        const item = await db.shoppingListItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: scaledQuantity ? (existingItem.quantity || 0) + scaledQuantity : existingItem.quantity,
            checked: false,
            checkedAt: null,
            deletedAt: null,
            sortIndex: shouldMoveToEnd ? await nextNativeShoppingSortIndex(db, list.id) : existingItem.sortIndex,
            categoryKey: existingItem.categoryKey ?? affordance.categoryKey,
            iconKey: affordance.iconKey,
          },
          include: { unit: { select: { name: true } }, ingredientRef: { select: { name: true } } },
        });
        changedItems.push(item);
        updated += 1;
      } else {
        const item = await db.shoppingListItem.create({
          data: {
            shoppingListId: list.id,
            ingredientRefId: ingredient.ingredientRefId,
            unitId: ingredient.unitId,
            quantity: scaledQuantity,
            sortIndex: await nextNativeShoppingSortIndex(db, list.id),
            categoryKey: affordance.categoryKey,
            iconKey: affordance.iconKey,
          },
          include: { unit: { select: { name: true } }, ingredientRef: { select: { name: true } } },
        });
        changedItems.push(item);
        created += 1;
      }
    }
  }

  return success({
    recipe: { id: recipe.id, title: recipe.title },
    created,
    updated,
    items: changedItems,
  });
}

export async function clearCompletedNativeShoppingItems(
  db: Database,
  userId: string,
  _input: NativeShoppingClearInput,
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
    await db.shoppingListItem.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
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
): Promise<ApiV1ShoppingResult<{ cleared: number; items: NativeShoppingItemRow[] }>> {
  const list = await loadOrCreateNativeShoppingList(db, userId);
  const items = await db.shoppingListItem.findMany({
    where: { shoppingListId: list.id, deletedAt: null },
    select: { id: true },
  });
  const ids = items.map((item) => item.id);

  if (ids.length > 0) {
    await db.shoppingListItem.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
  }

  return success({
    cleared: ids.length,
    items: await loadNativeShoppingItemsById(db, ids),
  });
}
