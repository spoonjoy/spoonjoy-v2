import type { PrismaClient, ShoppingListItem } from "@prisma/client";

import { mutateCompatibleShoppingListItem } from "~/lib/shopping-list-mutations.server";

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

  const result = await mutateCompatibleShoppingListItem({
    database,
    identity,
    update: (existing) => database.shoppingListItem.update({
      where: { id: existing.id },
      data,
    }),
    create: () => database.shoppingListItem.create({
      data: { ...identity, ...data },
    }),
  });

  return result.item;
}
