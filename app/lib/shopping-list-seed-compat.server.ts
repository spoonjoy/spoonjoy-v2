import type { PrismaClient, ShoppingListItem } from "@prisma/client";

export interface SeedShoppingListItemInput {
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number | null;
  checked: boolean;
  checkedAt: Date | null;
  deletedAt: Date | null;
  categoryKey: string | null;
  iconKey: string | null;
  sortIndex: number;
}

function isSeedShoppingListUniqueConflict(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const candidate = error as {
      code?: unknown;
      meta?: { target?: unknown } | null;
    };
    if (candidate.code === "P2002") {
      const target = candidate.meta?.target;
      if (Array.isArray(target)) {
        return (
          target.length === 3 &&
          target[0] === "shoppingListId" &&
          target[1] === "unitId" &&
          target[2] === "ingredientRefId"
        ) || (
          target.length === 1 &&
          target[0] === "index 'ShoppingListItem_active_identity_key'"
        );
      }
      return target === "ShoppingListItem_active_identity_key";
    }
  }

  const message = error && typeof error === "object" && "message" in error
    ? (error as { message?: unknown }).message
    : null;
  return typeof message === "string" &&
    /UNIQUE constraint failed: (?:ShoppingListItem\.shoppingListId, ShoppingListItem\.unitId, ShoppingListItem\.ingredientRefId(?![A-Za-z0-9_.]|\s*,)|index ['"]ShoppingListItem_active_identity_key['"](?![A-Za-z0-9_]))/.test(message);
}

export async function provisionSeedShoppingListItem(
  database: PrismaClient,
  input: SeedShoppingListItemInput,
): Promise<ShoppingListItem> {
  const identity = {
    shoppingListId: input.shoppingListId,
    ingredientRefId: input.ingredientRefId,
    unitId: input.unitId,
  };
  const data = {
    quantity: input.quantity,
    checked: input.checked,
    checkedAt: input.checkedAt,
    deletedAt: input.deletedAt,
    categoryKey: input.categoryKey,
    iconKey: input.iconKey,
    sortIndex: input.sortIndex,
  };

  const findActive = () => database.shoppingListItem.findFirst({
    where: { ...identity, deletedAt: null },
    orderBy: [{ sortIndex: "asc" }, { id: "asc" }],
  });
  const update = (existing: ShoppingListItem) => database.shoppingListItem.update({
    where: { id: existing.id },
    data,
  });
  const active = await findActive();
  const existing = active ?? await database.shoppingListItem.findFirst({
    where: { ...identity, deletedAt: { not: null } },
    orderBy: [{ sortIndex: "asc" }, { id: "asc" }],
  });

  try {
    return existing
      ? await update(existing)
      : await database.shoppingListItem.create({
          data: { ...identity, ...data },
        });
  } catch (error) {
    if (!isSeedShoppingListUniqueConflict(error)) throw error;
    const winner = await findActive();
    if (!winner) throw error;
    return update(winner);
  }
}
