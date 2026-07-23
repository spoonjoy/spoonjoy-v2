import type {
  PrismaClient,
  ShoppingListItem,
} from "@prisma/client";

export interface ShoppingRecipeIngredientCandidate {
  stepNum: number;
  ingredientId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number;
  categoryKey: string | null;
  iconKey: string | null;
}

export interface CoalescedShoppingRecipeIngredient {
  ingredientRefId: string;
  unitId: string | null;
  quantity: number;
  categoryKey: string | null;
  iconKey: string | null;
}

export interface CompatibleD1PreparedStatement {
  bind(...values: unknown[]): CompatibleD1PreparedStatement;
}

export interface CompatibleD1Database {
  prepare(query: string): CompatibleD1PreparedStatement;
  batch(statements: CompatibleD1PreparedStatement[]): Promise<unknown>;
}

export interface AtomicShoppingListMutationInput {
  id: string;
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number | null;
  categoryKey: string | null;
  iconKey: string | null;
  boundNowMs: number;
}

export interface AtomicShoppingListMutationResult {
  created: boolean;
  item: ShoppingListItem;
}

export interface AtomicShoppingListBatchResult {
  items: AtomicShoppingListMutationResult[];
  created: number;
  updated: number;
}

interface AtomicShoppingListRawRow {
  id: unknown;
  shoppingListId: unknown;
  quantity: unknown;
  unitId: unknown;
  ingredientRefId: unknown;
  checked: unknown;
  checkedAt: unknown;
  deletedAt: unknown;
  sortIndex: unknown;
  categoryKey: unknown;
  iconKey: unknown;
  updatedAt: unknown;
  created: unknown;
}

const ATOMIC_SHOPPING_LIST_MUTATION_SQL = `
WITH
"input" (
  "id", "shoppingListId", "ingredientRefId", "unitId", "quantity",
  "incomingQuantityValid", "categoryKey", "iconKey", "boundNowMs"
) AS (
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
),
"owner" AS MATERIALIZED (
  SELECT "ShoppingList"."authorId" AS "ownerId"
  FROM "ShoppingList"
  INNER JOIN "input" ON "input"."shoppingListId" = "ShoppingList"."id"
),
"preexisting_identity" AS MATERIALIZED (
  SELECT
    "ShoppingListItem"."id",
    "ShoppingListItem"."sortIndex",
    CASE
      WHEN "ShoppingListItem"."checked" = 1
        OR "ShoppingListItem"."checkedAt" IS NOT NULL
      THEN 1 ELSE 0
    END AS "logicallyChecked"
  FROM "ShoppingListItem"
  INNER JOIN "input"
    ON "input"."shoppingListId" = "ShoppingListItem"."shoppingListId"
    AND "input"."ingredientRefId" = "ShoppingListItem"."ingredientRefId"
    AND COALESCE('u:' || "input"."unitId", 'n:')
      = COALESCE('u:' || "ShoppingListItem"."unitId", 'n:')
  WHERE "ShoppingListItem"."deletedAt" IS NULL
  LIMIT 1
),
"position_state" AS MATERIALIZED (
  SELECT MAX("ShoppingListItem"."sortIndex") AS "maximumSortIndex"
  FROM "ShoppingListItem"
  INNER JOIN "input"
    ON "input"."shoppingListId" = "ShoppingListItem"."shoppingListId"
  WHERE "ShoppingListItem"."deletedAt" IS NULL
),
"user_timestamps" AS MATERIALIZED (
  SELECT
    CASE
      WHEN typeof("User"."updatedAt") IN ('integer', 'real')
      THEN CAST("User"."updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("User"."updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("User"."updatedAt") IN ('integer', 'real')
        AND CAST("User"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("User"."updatedAt") = 'text'
        AND julianday("User"."updatedAt") IS NOT NULL
        AND round((julianday("User"."updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "User"
  INNER JOIN "owner" ON "owner"."ownerId" = "User"."id"
),
"recipe_timestamps" AS MATERIALIZED (
  SELECT
    CASE
      WHEN typeof("Recipe"."updatedAt") IN ('integer', 'real')
      THEN CAST("Recipe"."updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("Recipe"."updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("Recipe"."updatedAt") IN ('integer', 'real')
        AND CAST("Recipe"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("Recipe"."updatedAt") = 'text'
        AND julianday("Recipe"."updatedAt") IS NOT NULL
        AND round((julianday("Recipe"."updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "Recipe"
  INNER JOIN "owner" ON "owner"."ownerId" = "Recipe"."chefId"
  WHERE "Recipe"."deletedAt" IS NULL
),
"cookbook_timestamps" AS MATERIALIZED (
  SELECT
    CASE
      WHEN typeof("Cookbook"."updatedAt") IN ('integer', 'real')
      THEN CAST("Cookbook"."updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("Cookbook"."updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("Cookbook"."updatedAt") IN ('integer', 'real')
        AND CAST("Cookbook"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("Cookbook"."updatedAt") = 'text'
        AND julianday("Cookbook"."updatedAt") IS NOT NULL
        AND round((julianday("Cookbook"."updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "Cookbook"
  INNER JOIN "owner" ON "owner"."ownerId" = "Cookbook"."authorId"
),
"tombstone_timestamps" AS MATERIALIZED (
  SELECT
    CASE
      WHEN typeof("NativeSyncTombstone"."updatedAt") IN ('integer', 'real')
      THEN CAST("NativeSyncTombstone"."updatedAt" AS INTEGER)
      ELSE CAST(
        round(
          (julianday("NativeSyncTombstone"."updatedAt") - 2440587.5) * 86400000
        ) AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("NativeSyncTombstone"."updatedAt") IN ('integer', 'real')
        AND CAST("NativeSyncTombstone"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("NativeSyncTombstone"."updatedAt") = 'text'
        AND julianday("NativeSyncTombstone"."updatedAt") IS NOT NULL
        AND round(
          (julianday("NativeSyncTombstone"."updatedAt") - 2440587.5) * 86400000
        ) BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "NativeSyncTombstone"
  INNER JOIN "owner"
    ON "owner"."ownerId" = "NativeSyncTombstone"."accountId"
),
"shopping_list_timestamps" AS MATERIALIZED (
  SELECT
    CASE
      WHEN typeof("ShoppingList"."updatedAt") IN ('integer', 'real')
      THEN CAST("ShoppingList"."updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("ShoppingList"."updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("ShoppingList"."updatedAt") IN ('integer', 'real')
        AND CAST("ShoppingList"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("ShoppingList"."updatedAt") = 'text'
        AND julianday("ShoppingList"."updatedAt") IS NOT NULL
        AND round((julianday("ShoppingList"."updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "ShoppingList"
  INNER JOIN "owner" ON "owner"."ownerId" = "ShoppingList"."authorId"
),
"shopping_item_timestamps" AS MATERIALIZED (
  SELECT
    CASE
      WHEN typeof("ShoppingListItem"."updatedAt") IN ('integer', 'real')
      THEN CAST("ShoppingListItem"."updatedAt" AS INTEGER)
      ELSE CAST(
        round(
          (julianday("ShoppingListItem"."updatedAt") - 2440587.5) * 86400000
        ) AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("ShoppingListItem"."updatedAt") IN ('integer', 'real')
        AND CAST("ShoppingListItem"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("ShoppingListItem"."updatedAt") = 'text'
        AND julianday("ShoppingListItem"."updatedAt") IS NOT NULL
        AND round(
          (julianday("ShoppingListItem"."updatedAt") - 2440587.5) * 86400000
        ) BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "ShoppingListItem"
  INNER JOIN "ShoppingList"
    ON "ShoppingList"."id" = "ShoppingListItem"."shoppingListId"
  INNER JOIN "owner" ON "owner"."ownerId" = "ShoppingList"."authorId"
),
"owner_high_water" AS MATERIALIZED (
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM "user_timestamps") <> 1 THEN NULL
    WHEN (SELECT "valid" FROM "user_timestamps") <> 1 THEN NULL
    WHEN COALESCE((SELECT MIN("valid") FROM "recipe_timestamps"), 1) <> 1
    THEN NULL
    WHEN COALESCE((SELECT MIN("valid") FROM "cookbook_timestamps"), 1) <> 1
    THEN NULL
    WHEN COALESCE((SELECT MIN("valid") FROM "tombstone_timestamps"), 1) <> 1
    THEN NULL
    WHEN COALESCE((SELECT MIN("valid") FROM "shopping_list_timestamps"), 1) <> 1
    THEN NULL
    WHEN COALESCE((SELECT MIN("valid") FROM "shopping_item_timestamps"), 1) <> 1
    THEN NULL
    ELSE max(
      (SELECT "valueMs" FROM "user_timestamps"),
      COALESCE((SELECT MAX("valueMs") FROM "recipe_timestamps"), -62167219200000),
      COALESCE((SELECT MAX("valueMs") FROM "cookbook_timestamps"), -62167219200000),
      COALESCE((SELECT MAX("valueMs") FROM "tombstone_timestamps"), -62167219200000),
      COALESCE((SELECT MAX("valueMs") FROM "shopping_list_timestamps"), -62167219200000),
      COALESCE((SELECT MAX("valueMs") FROM "shopping_item_timestamps"), -62167219200000)
    )
  END AS "highWaterMs"
),
"mutation_state" AS MATERIALIZED (
  SELECT
    "input".*,
    "preexisting_identity"."id" AS "preexistingId",
    "preexisting_identity"."sortIndex" AS "preexistingSortIndex",
    COALESCE("preexisting_identity"."logicallyChecked", 0)
      AS "preexistingLogicallyChecked",
    CASE
      WHEN "position_state"."maximumSortIndex" IS NULL THEN 0
      WHEN "position_state"."maximumSortIndex" < 2147483647
      THEN "position_state"."maximumSortIndex" + 1
      ELSE NULL
    END AS "freshSortIndex",
    CASE
      WHEN (SELECT COUNT(*) FROM "owner") <> 1 THEN NULL
      WHEN (SELECT "highWaterMs" FROM "owner_high_water") IS NULL THEN NULL
      WHEN (SELECT "highWaterMs" FROM "owner_high_water") >= 253402300799999
      THEN NULL
      WHEN typeof("input"."boundNowMs") NOT IN ('integer', 'real')
        OR "input"."boundNowMs" <> CAST("input"."boundNowMs" AS INTEGER)
        OR CAST("input"."boundNowMs" AS INTEGER)
          NOT BETWEEN 0 AND 253402300799999
      THEN NULL
      WHEN "input"."incomingQuantityValid" <> 1 THEN NULL
      ELSE max(
        "input"."boundNowMs",
        (SELECT "highWaterMs" FROM "owner_high_water") + 1
      )
    END AS "newMs"
  FROM "input"
  LEFT JOIN "preexisting_identity" ON TRUE
  CROSS JOIN "position_state"
),
"write_values" AS MATERIALIZED (
  SELECT
    "mutation_state".*,
    CASE
      WHEN (
        "preexistingId" IS NULL OR "preexistingLogicallyChecked" = 1
      ) AND "freshSortIndex" IS NULL
      THEN NULL
      WHEN "newMs" IS NOT NULL
        AND length(strftime(
          '%Y-%m-%dT%H:%M:%fZ',
          "newMs" / 1000.0,
          'unixepoch'
        )) = 24
      THEN strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        "newMs" / 1000.0,
        'unixepoch'
      )
      ELSE NULL
    END AS "newText"
  FROM "mutation_state"
)
INSERT INTO "ShoppingListItem" (
  "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
  "checked", "checkedAt", "deletedAt", "sortIndex", "categoryKey",
  "iconKey", "updatedAt"
)
SELECT
  "id",
  "shoppingListId",
  "quantity",
  "unitId",
  "ingredientRefId",
  0,
  NULL,
  NULL,
  CASE
    WHEN "preexistingId" IS NOT NULL THEN "preexistingSortIndex"
    ELSE "freshSortIndex"
  END,
  "categoryKey",
  "iconKey",
  "newText"
FROM "write_values"
WHERE TRUE
ON CONFLICT ("shoppingListId", "ingredientRefId", COALESCE('u:' || "unitId", 'n:'))
WHERE "deletedAt" IS NULL
DO UPDATE SET
  "quantity" = CASE
    WHEN "ShoppingListItem"."quantity" IS NULL THEN excluded."quantity"
    WHEN excluded."quantity" IS NULL THEN "ShoppingListItem"."quantity"
    ELSE "ShoppingListItem"."quantity" + excluded."quantity"
  END,
  "checked" = 0,
  "checkedAt" = NULL,
  "deletedAt" = NULL,
  "sortIndex" = CASE
    WHEN "ShoppingListItem"."checked" = 1
      OR "ShoppingListItem"."checkedAt" IS NOT NULL
    THEN (SELECT "freshSortIndex" FROM "write_values")
    ELSE "ShoppingListItem"."sortIndex"
  END,
  "categoryKey" = COALESCE(excluded."categoryKey", "ShoppingListItem"."categoryKey"),
  "iconKey" = COALESCE(excluded."iconKey", "ShoppingListItem"."iconKey"),
  "updatedAt" = CASE
    WHEN "ShoppingListItem"."quantity" IS NOT NULL
      AND (
        typeof("ShoppingListItem"."quantity") NOT IN ('integer', 'real')
        OR "ShoppingListItem"."quantity" NOT BETWEEN
          -1.7976931348623157e308 AND 1.7976931348623157e308
      )
    THEN NULL
    WHEN excluded."quantity" IS NOT NULL
      AND (
        typeof(excluded."quantity") NOT IN ('integer', 'real')
        OR excluded."quantity" NOT BETWEEN
          -1.7976931348623157e308 AND 1.7976931348623157e308
      )
    THEN NULL
    WHEN "ShoppingListItem"."quantity" IS NOT NULL
      AND excluded."quantity" IS NOT NULL
      AND (
        typeof("ShoppingListItem"."quantity" + excluded."quantity")
          NOT IN ('integer', 'real')
        OR "ShoppingListItem"."quantity" + excluded."quantity" NOT BETWEEN
          -1.7976931348623157e308 AND 1.7976931348623157e308
      )
    THEN NULL
    ELSE excluded."updatedAt"
  END
RETURNING
  "id",
  "shoppingListId",
  "quantity",
  "unitId",
  "ingredientRefId",
  "checked",
  "checkedAt",
  "deletedAt",
  "sortIndex",
  "categoryKey",
  "iconKey",
  "updatedAt",
  (SELECT CASE WHEN "preexistingId" IS NULL THEN 1 ELSE 0 END
    FROM "write_values") AS "created"
`;

function compareBinary(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function identityKey(ingredientRefId: string, unitId: string | null): string {
  return JSON.stringify([ingredientRefId, unitId]);
}

export function asCompatibleD1Database(value: unknown): CompatibleD1Database | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CompatibleD1Database>;
  return typeof candidate.prepare === "function" && typeof candidate.batch === "function"
    ? candidate as CompatibleD1Database
    : null;
}

function atomicShoppingListBindings(input: AtomicShoppingListMutationInput) {
  const incomingQuantityValid = input.quantity === null || Number.isFinite(input.quantity);
  return [
    input.id,
    input.shoppingListId,
    input.ingredientRefId,
    input.unitId,
    incomingQuantityValid ? input.quantity : null,
    incomingQuantityValid ? 1 : 0,
    input.categoryKey,
    input.iconKey,
    input.boundNowMs,
  ];
}

export function prepareAtomicShoppingListItemD1Write(
  database: Pick<CompatibleD1Database, "prepare">,
  input: AtomicShoppingListMutationInput,
): CompatibleD1PreparedStatement {
  return database.prepare(ATOMIC_SHOPPING_LIST_MUTATION_SQL)
    .bind(...atomicShoppingListBindings(input));
}

function requiredAtomicString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid atomic shopping mutation result");
  }
  return value;
}

function nullableAtomicString(value: unknown): string | null {
  if (value === null) return null;
  return requiredAtomicString(value);
}

function requiredAtomicNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid atomic shopping mutation result");
  }
  return value;
}

function nullableAtomicNumber(value: unknown): number | null {
  if (value === null) return null;
  return requiredAtomicNumber(value);
}

function nullableAtomicDate(value: unknown): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(requiredAtomicString(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid atomic shopping mutation result");
  }
  return date;
}

function requiredAtomicDate(value: unknown): Date {
  const date = nullableAtomicDate(value);
  if (!date) throw new Error("Invalid atomic shopping mutation result");
  return date;
}

function atomicBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n) return true;
  if (value === false || value === 0 || value === 0n) return false;
  throw new Error("Invalid atomic shopping mutation result");
}

function decodeAtomicShoppingListRow(value: unknown): AtomicShoppingListMutationResult {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid atomic shopping mutation result");
  }
  const row = value as AtomicShoppingListRawRow;
  return {
    created: atomicBoolean(row.created),
    item: {
      id: requiredAtomicString(row.id),
      shoppingListId: requiredAtomicString(row.shoppingListId),
      quantity: nullableAtomicNumber(row.quantity),
      unitId: nullableAtomicString(row.unitId),
      ingredientRefId: requiredAtomicString(row.ingredientRefId),
      checked: atomicBoolean(row.checked),
      checkedAt: nullableAtomicDate(row.checkedAt),
      deletedAt: nullableAtomicDate(row.deletedAt),
      sortIndex: requiredAtomicNumber(row.sortIndex),
      categoryKey: nullableAtomicString(row.categoryKey),
      iconKey: nullableAtomicString(row.iconKey),
      updatedAt: requiredAtomicDate(row.updatedAt),
    },
  };
}

function atomicShoppingListBatchResult(
  items: AtomicShoppingListMutationResult[],
): AtomicShoppingListBatchResult {
  const created = items.filter((item) => item.created).length;
  return { items, created, updated: items.length - created };
}

function requiredD1AtomicRows(results: unknown, expectedCount: number): unknown[] {
  if (!Array.isArray(results) || results.length !== expectedCount) {
    throw new Error("D1 shopping batch result count did not match statement count");
  }
  return results.map((result) => {
    if (!result || typeof result !== "object") {
      throw new Error("D1 shopping batch statement failed");
    }
    const candidate = result as { success?: unknown; results?: unknown };
    if (candidate.success !== true) {
      throw new Error("D1 shopping batch statement failed");
    }
    if (!Array.isArray(candidate.results) || candidate.results.length !== 1) {
      throw new Error("D1 shopping batch did not return exactly one row per statement");
    }
    return candidate.results[0];
  });
}

function requiredLocalAtomicRows(results: unknown[]): unknown[] {
  return results.map((result) => {
    if (!Array.isArray(result) || result.length !== 1) {
      throw new Error("Local shopping statement did not return exactly one row");
    }
    return result[0];
  });
}

export async function runAtomicShoppingListBatch(input: {
  database: PrismaClient;
  nativeDatabase: CompatibleD1Database | null;
  mutations: AtomicShoppingListMutationInput[];
}): Promise<AtomicShoppingListBatchResult> {
  if (input.mutations.length === 0) {
    return { items: [], created: 0, updated: 0 };
  }

  let rows: unknown[];
  if (input.nativeDatabase) {
    const statements = input.mutations.map((mutation) =>
      prepareAtomicShoppingListItemD1Write(input.nativeDatabase!, mutation)
    );
    rows = requiredD1AtomicRows(
      await input.nativeDatabase.batch(statements),
      statements.length,
    );
  } else {
    const operations = input.mutations.map((mutation) =>
      input.database.$queryRawUnsafe<unknown[]>(
        ATOMIC_SHOPPING_LIST_MUTATION_SQL,
        ...atomicShoppingListBindings(mutation),
      )
    );
    rows = requiredLocalAtomicRows(await input.database.$transaction(operations));
  }

  return atomicShoppingListBatchResult(rows.map(decodeAtomicShoppingListRow));
}

export async function mutateAtomicShoppingListItem(input: {
  database: PrismaClient;
  nativeDatabase: CompatibleD1Database | null;
  mutation: AtomicShoppingListMutationInput;
}): Promise<AtomicShoppingListMutationResult> {
  const result = await runAtomicShoppingListBatch({
    database: input.database,
    nativeDatabase: input.nativeDatabase,
    mutations: [input.mutation],
  });
  return result.items[0];
}

export function coalesceShoppingRecipeIngredients(
  candidates: ShoppingRecipeIngredientCandidate[],
  scaleFactor: number,
): CoalescedShoppingRecipeIngredient[] {
  if (!Number.isFinite(scaleFactor)) {
    throw new RangeError("Shopping-list recipe scale must be finite");
  }

  const sorted = [...candidates].sort((left, right) => (
    left.stepNum - right.stepNum ||
    compareBinary(left.ingredientId, right.ingredientId)
  ));
  const coalesced = new Map<string, CoalescedShoppingRecipeIngredient>();

  for (const candidate of sorted) {
    const scaledQuantity = candidate.quantity * scaleFactor;
    if (!Number.isFinite(scaledQuantity)) {
      throw new RangeError("Shopping-list recipe quantity must be finite");
    }

    const key = identityKey(candidate.ingredientRefId, candidate.unitId);
    const existing = coalesced.get(key);
    if (!existing) {
      coalesced.set(key, {
        ingredientRefId: candidate.ingredientRefId,
        unitId: candidate.unitId,
        quantity: scaledQuantity,
        categoryKey: candidate.categoryKey,
        iconKey: candidate.iconKey,
      });
      continue;
    }

    const quantity = existing.quantity + scaledQuantity;
    if (!Number.isFinite(quantity)) {
      throw new RangeError("Shopping-list recipe quantity must be finite");
    }
    existing.quantity = quantity;
    existing.categoryKey ??= candidate.categoryKey;
    existing.iconKey ??= candidate.iconKey;
  }

  return [...coalesced.values()];
}
