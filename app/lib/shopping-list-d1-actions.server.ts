import type { D1Query, D1ReadDatabase } from "~/lib/d1-read.server";
import { d1ReadBatch } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { coalesceShoppingRecipeIngredients } from "~/lib/shopping-list-mutations.server";

// The shopping list page's writes (`/shopping-list` actions) on the request's D1 binding, with no
// Prisma client. Each intent is one D1 batch, and a batch is one SQLite transaction, so the reads
// that decide a write (is the item already on the list, is it checked, where does the list end)
// happen inside the statement that writes. A concurrent request cannot slip between them, so
// these writes need neither the Prisma path's retries nor its guards.
//
// Prisma sets `updatedAt` on every update; every statement here sets it explicitly, because the
// sync API reads changes by it.

/** The end of the list: the sort index after the last active item, as the Prisma path computes it. */
const NEXT_SORT_INDEX = `(SELECT COALESCE(MAX("sortIndex"), -1) + 1 FROM "ShoppingListItem" WHERE "shoppingListId" = ? AND "deletedAt" IS NULL)`;

/** An item's identity on a list: the ingredient, and the unit compared null-safely. */
interface ItemIdentitySql {
  ingredientRef: string;
  ingredientRefValues: unknown[];
  unit: string;
  unitValues: unknown[];
}

interface ItemWrite {
  /** Added to the stored quantity (null keeps it); a removed item restarts from it. */
  quantity: number | null;
  /** Kept when null on an existing item (single add), or always kept when set (recipe add). */
  categoryKey: string | null;
  categoryKeyWins: "submitted" | "existing";
  /** Kept when null on an existing item (single add), or always written (recipe add). */
  iconKey: string | null;
  iconKeyWins: "submitted-if-set" | "submitted";
}

/**
 * Two statements that put one item on the list: the first adds to the item already there (the
 * active one first, else the removed one), unchecks and restores it, and moves it to the end
 * when it was checked or removed; the second creates the item when the list has none with its
 * identity. Exactly one of them changes a row while the list exists.
 */
function putItemStatements(
  shoppingListId: string,
  identity: ItemIdentitySql,
  write: ItemWrite,
  itemId: string,
  updatedAt: string,
): D1Query[] {
  const findExisting = `SELECT "id" FROM "ShoppingListItem"
      WHERE "shoppingListId" = ? AND "ingredientRefId" = ${identity.ingredientRef} AND "unitId" IS ${identity.unit}
      ORDER BY "deletedAt" IS NOT NULL, "sortIndex", "id" LIMIT 1`;
  const findValues = [shoppingListId, ...identity.ingredientRefValues, ...identity.unitValues];
  const categoryKey = write.categoryKeyWins === "submitted" ? `COALESCE(?, "categoryKey")` : `COALESCE("categoryKey", ?)`;
  const iconKey = write.iconKeyWins === "submitted-if-set" ? `COALESCE(?, "iconKey")` : `?`;

  return [
    [
      `UPDATE "ShoppingListItem"
       SET "quantity" = CASE
             WHEN "deletedAt" IS NOT NULL THEN ?
             WHEN ? IS NULL THEN "quantity"
             ELSE COALESCE("quantity", 0) + ?
           END,
           "sortIndex" = CASE
             WHEN "checked" = 1 OR "checkedAt" IS NOT NULL OR "deletedAt" IS NOT NULL THEN ${NEXT_SORT_INDEX}
             ELSE "sortIndex"
           END,
           "checked" = 0, "checkedAt" = NULL, "deletedAt" = NULL,
           "categoryKey" = ${categoryKey}, "iconKey" = ${iconKey}, "updatedAt" = ?
       WHERE "id" = (${findExisting})`,
      write.quantity,
      write.quantity,
      write.quantity,
      shoppingListId,
      write.categoryKey,
      write.iconKey,
      updatedAt,
      ...findValues,
    ],
    [
      `INSERT INTO "ShoppingListItem" (
         "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
         "checked", "sortIndex", "categoryKey", "iconKey", "updatedAt"
       )
       SELECT ?, ?, ?, ${identity.unit}, ${identity.ingredientRef}, 0, ${NEXT_SORT_INDEX}, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM "ShoppingList" WHERE "id" = ?)
         AND NOT EXISTS (${findExisting})`,
      itemId,
      shoppingListId,
      write.quantity,
      ...identity.unitValues,
      ...identity.ingredientRefValues,
      shoppingListId,
      write.categoryKey,
      write.iconKey,
      updatedAt,
      shoppingListId,
      ...findValues,
    ],
  ];
}

/**
 * Renumbers the active items 0..n-1 in their current order (sort index, then last change, then
 * id) after items leave the list, writing only the items whose position changes. The positions
 * are computed once, before any row is written.
 */
function normalizeOrderingStatement(shoppingListId: string, updatedAt: string): D1Query {
  return [
    `UPDATE "ShoppingListItem"
     SET "sortIndex" = "ranked"."position", "updatedAt" = ?
     FROM (
       SELECT "id", "sortIndex",
         ROW_NUMBER() OVER (ORDER BY "sortIndex", "updatedAt", "id") - 1 AS "position"
       FROM "ShoppingListItem"
       WHERE "shoppingListId" = ? AND "deletedAt" IS NULL
     ) AS "ranked"
     WHERE "ShoppingListItem"."id" = "ranked"."id" AND "ranked"."position" <> "ranked"."sortIndex"`,
    updatedAt,
    shoppingListId,
  ];
}

/** The chef's shopping list id, creating the list on the first write as the Prisma path does. */
export async function ensureShoppingListIdOnD1(db: D1ReadDatabase, userId: string, now: Date): Promise<string> {
  const at = d1Timestamp(now);
  const [, lists] = await d1WriteBatch(db, [
    [
      `INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)
       ON CONFLICT ("authorId") DO NOTHING`,
      crypto.randomUUID(),
      userId,
      at,
      at,
    ],
    [`SELECT "id" FROM "ShoppingList" WHERE "authorId" = ?`, userId],
  ]);
  const id = lists.rows[0]?.id;
  /* istanbul ignore if -- @preserve the insert in the same batch leaves exactly one list */
  if (typeof id !== "string") throw new Error("D1 shopping list was not created");
  return id;
}

export interface D1ShoppingItemAdd {
  shoppingListId: string;
  /** Lowercased, as the ingredient and unit tables store names. */
  ingredientName: string;
  unitName: string | null;
  quantity: number | null;
  categoryKey: string | null;
  iconKey: string | null;
  now: Date;
}

/**
 * Adds one typed item: finds or creates its ingredient and unit, then adds to the item already
 * on the list or creates it, in one batch. Returns false when the list no longer exists.
 */
export async function addShoppingListItemOnD1(db: D1ReadDatabase, add: D1ShoppingItemAdd): Promise<boolean> {
  const at = d1Timestamp(add.now);
  const statements: D1Query[] = [[
    `INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("name") DO NOTHING`,
    crypto.randomUUID(),
    add.ingredientName,
    at,
  ]];
  if (add.unitName) {
    statements.push([
      `INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("name") DO NOTHING`,
      crypto.randomUUID(),
      add.unitName,
      at,
    ]);
  }
  const identity: ItemIdentitySql = {
    ingredientRef: `(SELECT "id" FROM "IngredientRef" WHERE "name" = ?)`,
    ingredientRefValues: [add.ingredientName],
    unit: add.unitName ? `(SELECT "id" FROM "Unit" WHERE "name" = ?)` : "NULL",
    unitValues: add.unitName ? [add.unitName] : [],
  };
  statements.push(...putItemStatements(add.shoppingListId, identity, {
    quantity: add.quantity,
    categoryKey: add.categoryKey,
    categoryKeyWins: "submitted",
    iconKey: add.iconKey,
    iconKeyWins: "submitted-if-set",
  }, crypto.randomUUID(), at));

  const results = await d1WriteBatch(db, statements);
  const [updated, inserted] = results.slice(-2);
  return updated!.changes + inserted!.changes > 0;
}

const RECIPE_SQL = `SELECT "id" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL`;

const RECIPE_INGREDIENTS_SQL = `SELECT i."id", i."stepNum", i."ingredientRefId", i."unitId", i."quantity", r."name" AS "ingredientName"
  FROM "Ingredient" i
  JOIN "RecipeStep" s ON s."recipeId" = i."recipeId" AND s."stepNum" = i."stepNum"
  JOIN "IngredientRef" r ON r."id" = i."ingredientRefId"
  WHERE i."recipeId" = ?`;

/**
 * Adds a recipe's ingredients, scaled and combined by identity, in one batch. Returns false when
 * the recipe does not exist or was deleted.
 */
export async function addRecipeToShoppingListOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; recipeId: string; scaleFactor: number; now: Date },
): Promise<boolean> {
  const [recipes, rows] = await d1ReadBatch(db, [
    [RECIPE_SQL, input.recipeId],
    [RECIPE_INGREDIENTS_SQL, input.recipeId],
  ]);
  if (recipes.length === 0) return false;

  const ingredients = coalesceShoppingRecipeIngredients(rows.map((row) => {
    const affordance = resolveIngredientAffordance(String(row.ingredientName), null, null);
    return {
      stepNum: Number(row.stepNum),
      ingredientId: String(row.id),
      ingredientRefId: String(row.ingredientRefId),
      unitId: String(row.unitId),
      quantity: Number(row.quantity),
      categoryKey: affordance.categoryKey,
      iconKey: affordance.iconKey,
    };
  }), input.scaleFactor);
  if (ingredients.length === 0) return true;

  const at = d1Timestamp(input.now);
  await d1WriteBatch(db, ingredients.flatMap((ingredient) => putItemStatements(input.shoppingListId, {
    ingredientRef: "?",
    ingredientRefValues: [ingredient.ingredientRefId],
    // A recipe ingredient always has a unit; `IS ?` would also match a null one null-safely.
    unit: "?",
    unitValues: [ingredient.unitId],
  }, {
    quantity: ingredient.quantity || null,
    categoryKey: ingredient.categoryKey,
    categoryKeyWins: "existing",
    iconKey: ingredient.iconKey,
    iconKeyWins: "submitted",
  }, crypto.randomUUID(), at)));
  return true;
}

/** Checks or unchecks one item; with no `nextChecked`, flips it. */
export async function toggleShoppingListItemOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; itemId: string; nextChecked: boolean | null; now: Date },
): Promise<void> {
  const next = input.nextChecked === null ? null : input.nextChecked ? 1 : 0;
  const at = d1Timestamp(input.now);
  await d1WriteBatch(db, [[
    `UPDATE "ShoppingListItem"
     SET "checked" = COALESCE(?, 1 - "checked"),
         "checkedAt" = CASE WHEN COALESCE(?, 1 - "checked") = 1 THEN ? ELSE NULL END,
         "updatedAt" = ?
     WHERE "id" = ? AND "shoppingListId" = ?`,
    next,
    next,
    at,
    at,
    input.itemId,
    input.shoppingListId,
  ]]);
}

/** Removes one active item and closes the gap it leaves. */
export async function removeShoppingListItemOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; itemId: string; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await d1WriteBatch(db, [
    [
      `UPDATE "ShoppingListItem" SET "deletedAt" = ?, "updatedAt" = ?
       WHERE "id" = ? AND "shoppingListId" = ? AND "deletedAt" IS NULL`,
      at,
      at,
      input.itemId,
      input.shoppingListId,
    ],
    normalizeOrderingStatement(input.shoppingListId, at),
  ]);
}

/** Removes every checked item and renumbers the rest. */
export async function clearCompletedShoppingListItemsOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await d1WriteBatch(db, [
    [
      `UPDATE "ShoppingListItem" SET "deletedAt" = ?, "updatedAt" = ?
       WHERE "shoppingListId" = ? AND "deletedAt" IS NULL AND ("checkedAt" IS NOT NULL OR "checked" = 1)`,
      at,
      at,
      input.shoppingListId,
    ],
    normalizeOrderingStatement(input.shoppingListId, at),
  ]);
}

/** Removes every item on the list. */
export async function clearShoppingListOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await d1WriteBatch(db, [[
    `UPDATE "ShoppingListItem" SET "deletedAt" = ?, "updatedAt" = ? WHERE "shoppingListId" = ? AND "deletedAt" IS NULL`,
    at,
    at,
    input.shoppingListId,
  ]]);
}
