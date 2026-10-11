import type { D1Query, D1ReadDatabase } from "~/lib/d1-read.server";
import { d1ReadBatch } from "~/lib/d1-read.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { resolveIngredientAffordance } from "~/lib/ingredient-affordances";
import { coalesceShoppingRecipeIngredients } from "~/lib/shopping-list-mutations.server";
import { d1WriteOnceClaim, type D1WriteOnceClaim, type D1WriteOnceKey } from "~/lib/d1-write-once.server";

// The shopping list page's writes (`/shopping-list` actions) on the request's D1 binding, with no
// Prisma client. Each intent is one D1 batch, and a batch is one SQLite transaction, so the reads
// that decide a write (is the item already on the list, is it checked, where does the list end)
// happen inside the statement that writes. A concurrent request cannot slip between them, so
// these writes need neither the Prisma path's retries nor its guards.
//
// Prisma sets `updatedAt` on every update; every statement here sets it explicitly, because the
// sync API reads changes by it.
//
// After a transient D1 error (retryD1Write), every write here runs again. Making the list,
// setting an item's checked state, removing items and renumbering the rest leave the same rows
// however often they run. Adding items adds to the quantity, so each add claims a write-once key
// in its batch and adds only under that claim (d1-write-once.server.ts): a retry, or a resubmit of
// the same form, adds nothing more. A check always says which state it sets; nothing flips.

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
 * identity. Exactly one of them changes a row while the list exists and the try holds its claim.
 */
function putItemStatements(
  shoppingListId: string,
  identity: ItemIdentitySql,
  write: ItemWrite,
  itemId: string,
  updatedAt: string,
  claim: D1WriteOnceClaim,
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
       WHERE "id" = (${findExisting}) AND ${claim.guard}`,
      write.quantity,
      write.quantity,
      write.quantity,
      shoppingListId,
      write.categoryKey,
      write.iconKey,
      updatedAt,
      ...findValues,
      ...claim.guardValues,
    ],
    [
      `INSERT INTO "ShoppingListItem" (
         "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
         "checked", "sortIndex", "categoryKey", "iconKey", "updatedAt"
       )
       SELECT ?, ?, ?, ${identity.unit}, ${identity.ingredientRef}, 0, ${NEXT_SORT_INDEX}, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM "ShoppingList" WHERE "id" = ?)
         AND NOT EXISTS (${findExisting})
         AND ${claim.guard}`,
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
      ...claim.guardValues,
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
  const listId = crypto.randomUUID();
  // Creates the list only if the chef has none, so it runs again after a transient D1 error.
  const [, lists] = await retryD1Write({ scope: "shopping_list.ensure" }, () => d1WriteBatch(db, [
    [
      `INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)
       ON CONFLICT ("authorId") DO NOTHING`,
      listId,
      userId,
      at,
      at,
    ],
    [`SELECT "id" FROM "ShoppingList" WHERE "authorId" = ?`, userId],
  ]));
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
  /** The add's write-once key: a retry or resubmit with it adds nothing more. */
  writeKey: D1WriteOnceKey;
  now: Date;
}

/**
 * Adds one typed item: finds or creates its ingredient and unit, then adds to the item already
 * on the list or creates it, in one batch. Returns false when the list no longer exists. An add
 * whose key an earlier try or submission already claimed adds nothing and answers true.
 */
export async function addShoppingListItemOnD1(db: D1ReadDatabase, add: D1ShoppingItemAdd): Promise<boolean> {
  return retryD1Write({ scope: "shopping_list.add_item" }, () => addShoppingListItemOnce(db, add));
}

async function addShoppingListItemOnce(db: D1ReadDatabase, add: D1ShoppingItemAdd): Promise<boolean> {
  const at = d1Timestamp(add.now);
  const claim = d1WriteOnceClaim(add.writeKey, add.now);
  const statements: D1Query[] = [...claim.statements, [
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
  }, crypto.randomUUID(), at, claim));

  const results = await d1WriteBatch(db, statements);
  if (results[1]!.changes === 0) return true;
  const [updated, inserted] = results.slice(-2);
  return updated!.changes + inserted!.changes > 0;
}

export interface D1ShoppingItemPut {
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number | null;
  categoryKey: string | null;
  iconKey: string | null;
  /** The id a new item gets; the claim keeps it, so a later try knows which item this add created. */
  itemId: string;
  writeKey: D1WriteOnceKey;
  now: Date;
}

/**
 * Adds one item whose ingredient and unit already exist (the REST and tool adds), in one batch
 * under its write-once key, so a retry after a transient D1 error or a resubmission with the same
 * key adds nothing more. Answers the list's item with that identity afterwards, and whether this
 * add created it (by whichever try holds the key), or null when the list no longer exists.
 */
export async function putShoppingListItemOnceOnD1(
  db: D1ReadDatabase,
  put: D1ShoppingItemPut,
): Promise<{ id: string; created: boolean } | null> {
  const identity: ItemIdentitySql = {
    ingredientRef: "?",
    ingredientRefValues: [put.ingredientRefId],
    unit: "?",
    unitValues: [put.unitId],
  };
  const at = d1Timestamp(put.now);
  const results = await retryD1Write({ scope: "api_v1.shopping_item_create" }, () => {
    // The claim notes the id this try gives a new item, so a later try can tell whether the
    // item on the list is the one this add created.
    const claim = d1WriteOnceClaim(put.writeKey, put.now, put.itemId);
    return d1WriteBatch(db, [
      ...claim.statements,
      ...putItemStatements(put.shoppingListId, identity, {
        quantity: put.quantity,
        categoryKey: put.categoryKey,
        categoryKeyWins: "submitted",
        iconKey: put.iconKey,
        iconKeyWins: "submitted-if-set",
      }, put.itemId, at, claim),
      [
        `SELECT "id" FROM "ShoppingListItem"
         WHERE "shoppingListId" = ? AND "ingredientRefId" = ? AND "unitId" IS ?
         ORDER BY "deletedAt" IS NOT NULL, "sortIndex", "id" LIMIT 1`,
        put.shoppingListId,
        put.ingredientRefId,
        put.unitId,
      ],
      claim.readNote,
    ]);
  });
  const id = results.at(-2)!.rows[0]?.id;
  if (typeof id !== "string") return null;
  return { id, created: results.at(-1)!.rows[0]!.note === id };
}

const RECIPE_SQL = `SELECT "id" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL`;

const RECIPE_INGREDIENTS_SQL = `SELECT i."id", i."stepNum", i."ingredientRefId", i."unitId", i."quantity", r."name" AS "ingredientName"
  FROM "Ingredient" i
  JOIN "RecipeStep" s ON s."recipeId" = i."recipeId" AND s."stepNum" = i."stepNum"
  JOIN "IngredientRef" r ON r."id" = i."ingredientRefId"
  WHERE i."recipeId" = ?`;

/**
 * Adds a recipe's ingredients, scaled and combined by identity, in one batch. Returns false when
 * the recipe does not exist or was deleted. Under the add's write-once key, a retry or resubmit
 * adds nothing more.
 */
export async function addRecipeToShoppingListOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; recipeId: string; scaleFactor: number; writeKey: D1WriteOnceKey; now: Date },
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
  await retryD1Write({ scope: "shopping_list.add_recipe" }, () => {
    const claim = d1WriteOnceClaim(input.writeKey, input.now);
    return d1WriteBatch(db, [...claim.statements, ...ingredients.flatMap((ingredient) => putItemStatements(input.shoppingListId, {
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
  }, crypto.randomUUID(), at, claim))]);
  });
  return true;
}

/** Checks or unchecks one item. It sets the state it is given, so it runs again after a transient D1 error. */
export async function setShoppingListItemCheckedOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; itemId: string; checked: boolean; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await retryD1Write({ scope: "shopping_list.set_checked" }, () => d1WriteBatch(db, [[
    `UPDATE "ShoppingListItem"
     SET "checked" = ?, "checkedAt" = ?, "updatedAt" = ?
     WHERE "id" = ? AND "shoppingListId" = ?`,
    input.checked ? 1 : 0,
    input.checked ? at : null,
    at,
    input.itemId,
    input.shoppingListId,
  ]]));
}

/** Removes one active item and closes the gap it leaves. */
export async function removeShoppingListItemOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; itemId: string; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await retryD1Write({ scope: "shopping_list.remove_item" }, () => d1WriteBatch(db, [
    [
      `UPDATE "ShoppingListItem" SET "deletedAt" = ?, "updatedAt" = ?
       WHERE "id" = ? AND "shoppingListId" = ? AND "deletedAt" IS NULL`,
      at,
      at,
      input.itemId,
      input.shoppingListId,
    ],
    normalizeOrderingStatement(input.shoppingListId, at),
  ]));
}

/** Removes every checked item and renumbers the rest. */
export async function clearCompletedShoppingListItemsOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await retryD1Write({ scope: "shopping_list.clear_completed" }, () => d1WriteBatch(db, [
    [
      `UPDATE "ShoppingListItem" SET "deletedAt" = ?, "updatedAt" = ?
       WHERE "shoppingListId" = ? AND "deletedAt" IS NULL AND ("checkedAt" IS NOT NULL OR "checked" = 1)`,
      at,
      at,
      input.shoppingListId,
    ],
    normalizeOrderingStatement(input.shoppingListId, at),
  ]));
}

/** Removes every item on the list. */
export async function clearShoppingListOnD1(
  db: D1ReadDatabase,
  input: { shoppingListId: string; now: Date },
): Promise<void> {
  const at = d1Timestamp(input.now);
  await retryD1Write({ scope: "shopping_list.clear" }, () => d1WriteBatch(db, [[
    `UPDATE "ShoppingListItem" SET "deletedAt" = ?, "updatedAt" = ? WHERE "shoppingListId" = ? AND "deletedAt" IS NULL`,
    at,
    at,
    input.shoppingListId,
  ]]));
}
