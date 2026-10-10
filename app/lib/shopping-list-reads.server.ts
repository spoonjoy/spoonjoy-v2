import type { IngredientRef, PrismaClient, ShoppingList, ShoppingListItem, Unit } from "@prisma/client";
import { d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import {
  INGREDIENT_REF_COLUMNS,
  mapModel,
  selectColumns,
  UNIT_COLUMNS,
  type ColumnSpec,
} from "~/lib/d1-models.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";

// Reads behind the shopping list page (`/shopping-list`). The Prisma reader is the original
// sequence of queries; the D1 reader returns the same data in one batch, plus one write the
// first time a chef opens the page.

export type ShoppingListPageItem = ShoppingListItem & { unit: Unit | null; ingredientRef: IngredientRef };

export interface ShoppingListPageReads {
  shoppingList: ShoppingList & { items: ShoppingListPageItem[] };
  recipes: Array<{ id: string; title: string }>;
}

const SHOPPING_LIST_COLUMNS: ColumnSpec<ShoppingList> = {
  id: "string",
  authorId: "string",
  createdAt: "dateTime",
  updatedAt: "dateTime",
};

const SHOPPING_LIST_ITEM_COLUMNS: ColumnSpec<ShoppingListItem> = {
  id: "string",
  shoppingListId: "string",
  quantity: "float?",
  unitId: "string?",
  ingredientRefId: "string",
  checked: "boolean",
  checkedAt: "dateTime?",
  deletedAt: "dateTime?",
  sortIndex: "int",
  categoryKey: "string?",
  iconKey: "string?",
  updatedAt: "dateTime",
};

export async function readShoppingListWithPrisma(db: PrismaClient, userId: string): Promise<ShoppingListPageReads> {
  let shoppingList = await db.shoppingList.findUnique({
    where: { authorId: userId },
    include: {
      items: {
        where: { deletedAt: null },
        include: { unit: true, ingredientRef: true },
        orderBy: [{ sortIndex: "asc" }, { ingredientRef: { name: "asc" } }],
      },
    },
  });

  if (!shoppingList) {
    shoppingList = await db.shoppingList.create({
      data: { authorId: userId },
      include: { items: { include: { unit: true, ingredientRef: true } } },
    });
  }

  const recipes = await db.recipe.findMany({
    where: { chefId: userId, deletedAt: null },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  return { shoppingList, recipes };
}

const LIST_SQL = `SELECT ${selectColumns(SHOPPING_LIST_COLUMNS, "sl")} FROM "ShoppingList" sl WHERE sl."authorId" = ?`;

const ITEMS_SQL = `SELECT ${selectColumns(SHOPPING_LIST_ITEM_COLUMNS, "sli")},
    ${selectColumns(UNIT_COLUMNS, "u", "u_")},
    ${selectColumns(INGREDIENT_REF_COLUMNS, "r", "r_")}
  FROM "ShoppingListItem" sli
  JOIN "ShoppingList" sl ON sl."id" = sli."shoppingListId"
  LEFT JOIN "Unit" u ON u."id" = sli."unitId"
  JOIN "IngredientRef" r ON r."id" = sli."ingredientRefId"
  WHERE sl."authorId" = ? AND sli."deletedAt" IS NULL
  ORDER BY sli."sortIndex" ASC, r."name" ASC`;

const RECIPES_SQL = `SELECT "id", "title" FROM "Recipe" WHERE "chefId" = ? AND "deletedAt" IS NULL ORDER BY "title" ASC`;

function mapItem(row: D1Row): ShoppingListPageItem {
  return {
    ...mapModel(SHOPPING_LIST_ITEM_COLUMNS, row),
    unit: row.u_id === null ? null : mapModel(UNIT_COLUMNS, row, "u_"),
    ingredientRef: mapModel(INGREDIENT_REF_COLUMNS, row, "r_"),
  };
}

function mapRecipe(row: D1Row): { id: string; title: string } {
  if (typeof row.id !== "string" || typeof row.title !== "string") {
    throw new Error("D1 recipe row is missing its id or title");
  }
  return { id: row.id, title: row.title };
}

/**
 * The shopping list page's reads in one D1 batch. A chef with no list yet gets one created,
 * as the Prisma reader does; the insert ignores a list a concurrent request created first.
 */
export async function readShoppingListFromD1(
  db: D1ReadDatabase,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<ShoppingListPageReads> {
  let [lists, items, recipes] = await d1ReadBatch(db, [
    [LIST_SQL, userId],
    [ITEMS_SQL, userId],
    [RECIPES_SQL, userId],
  ]);

  if (lists.length === 0) {
    const at = d1Timestamp(now());
    await d1WriteBatch(db, [[
      `INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)
       ON CONFLICT ("authorId") DO NOTHING`,
      crypto.randomUUID(),
      userId,
      at,
      at,
    ]]);
    [lists, items] = await d1ReadBatch(db, [
      [LIST_SQL, userId],
      [ITEMS_SQL, userId],
    ]);
  }

  const [list] = lists;
  /* istanbul ignore if -- @preserve the insert above leaves exactly one list for the chef */
  if (!list) throw new Error("D1 shopping list was not created");

  return {
    shoppingList: { ...mapModel(SHOPPING_LIST_COLUMNS, list), items: items.map(mapItem) },
    recipes: recipes.map(mapRecipe),
  };
}
