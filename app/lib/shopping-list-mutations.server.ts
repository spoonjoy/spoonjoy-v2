import type {
  Prisma,
  PrismaClient,
  ShoppingListItem,
} from "@prisma/client";
import { d1Binding, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import {
  d1Guard,
  d1Timestamp,
  d1WriteBatch,
  isD1GuardFailure,
  type D1WriteResult,
} from "~/lib/d1-write.server";

export interface ShoppingListItemIdentity {
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
}

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

interface CompatibleMutationInput<T> {
  database: PrismaClient;
  identity: ShoppingListItemIdentity;
  update: (existing: ShoppingListItem) => Promise<T>;
  create: () => Promise<T>;
}

interface CompatibleBatch<T, Metadata> {
  operations: Array<Prisma.PrismaPromise<T>>;
  metadata: Metadata;
  native?: CompatibleShoppingListD1Batch<T>;
}

/** A shopping-list write as one atomic D1 batch, and how to read its items from the results. */
export interface CompatibleShoppingListD1Batch<T> {
  database: D1ReadDatabase;
  queries: D1Query[];
  items: (results: D1WriteResult[]) => T[];
}

interface ShoppingListItemWriteFields {
  id: string;
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  /** The quantity the row is expected to hold after the write (what the Prisma path stores). */
  quantity: number | null;
  checked: boolean;
  checkedAt: Date | null;
  deletedAt: Date | null;
  sortIndex: number;
  categoryKey: string | null;
  iconKey: string | null;
  updatedAt: Date;
}

export type ShoppingListItemWritePlan =
  | (ShoppingListItemWriteFields & { mode: "create" })
  | (ShoppingListItemWriteFields & {
    mode: "update";
    /**
     * The amount to add to the stored quantity, in SQL, so a concurrent add to the same item
     * is not lost; null keeps the stored quantity. `quantity` is only what the read predicted.
     */
    quantityDelta: number | null;
  });

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

export function isShoppingListUniqueConflict(error: unknown): boolean {
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

/** The request's D1 binding, or null without one (unit tests, scripts): then Prisma writes. */
export function asCompatibleD1Database(value: unknown): D1ReadDatabase | null {
  return d1Binding(value);
}

function d1Date(value: Date | null): string | null {
  return value ? d1Timestamp(value) : null;
}

/**
 * The statements for one planned write. Each one first re-checks, inside the batch, what the
 * plan was read from: a create needs the identity still free (the unique index does not cover
 * a null unit), an update needs the row still on this list. If either changed, the guard stops
 * the whole batch and `runCompatibleShoppingListBatch` reads again. The write itself returns
 * the quantity it stored.
 */
export function shoppingListItemWriteStatements(plan: ShoppingListItemWritePlan): D1Query[] {
  const updatedAt = d1Timestamp(plan.updatedAt);
  if (plan.mode === "create") {
    return [
      d1Guard(
        `NOT EXISTS (SELECT 1 FROM "ShoppingListItem"
          WHERE "shoppingListId" = ? AND "ingredientRefId" = ? AND "unitId" IS ?)`,
        plan.shoppingListId,
        plan.ingredientRefId,
        plan.unitId,
      ),
      [
        `INSERT INTO "ShoppingListItem" (
          "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
          "checked", "checkedAt", "deletedAt", "sortIndex", "categoryKey",
          "iconKey", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING "quantity"`,
        plan.id,
        plan.shoppingListId,
        plan.quantity,
        plan.unitId,
        plan.ingredientRefId,
        plan.checked ? 1 : 0,
        d1Date(plan.checkedAt),
        d1Date(plan.deletedAt),
        plan.sortIndex,
        plan.categoryKey,
        plan.iconKey,
        updatedAt,
      ],
    ];
  }

  return [
    d1Guard(
      `EXISTS (SELECT 1 FROM "ShoppingListItem" WHERE "id" = ? AND "shoppingListId" = ?)`,
      plan.id,
      plan.shoppingListId,
    ),
    [
      `UPDATE "ShoppingListItem"
      SET "quantity" = CASE WHEN ? IS NULL THEN "quantity" ELSE COALESCE("quantity", 0) + ? END,
          "checked" = ?, "checkedAt" = ?, "deletedAt" = ?,
          "sortIndex" = ?, "categoryKey" = ?, "iconKey" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "shoppingListId" = ?
      RETURNING "quantity"`,
      plan.quantityDelta,
      plan.quantityDelta,
      plan.checked ? 1 : 0,
      d1Date(plan.checkedAt),
      d1Date(plan.deletedAt),
      plan.sortIndex,
      plan.categoryKey,
      plan.iconKey,
      updatedAt,
      plan.id,
      plan.shoppingListId,
    ],
  ];
}

/**
 * The planned writes as one D1 batch, or undefined without a binding. `toItem` builds each
 * response item from its plan and the quantity the row now stores.
 */
export function createCompatibleShoppingListD1Batch<T = never>(
  database: D1ReadDatabase | null,
  writePlans: ShoppingListItemWritePlan[],
  toItem?: (plan: ShoppingListItemWritePlan, storedQuantity: number | null) => T,
): CompatibleShoppingListD1Batch<T> | undefined {
  if (!database) return undefined;
  const queries: D1Query[] = [];
  const writeIndexes: number[] = [];
  for (const plan of writePlans) {
    const statements = shoppingListItemWriteStatements(plan);
    queries.push(...statements);
    writeIndexes.push(queries.length - 1);
  }
  return {
    database,
    queries,
    items: (results) => toItem
      ? writePlans.map((plan, index) => toItem(
        plan,
        results[writeIndexes[index]].rows[0].quantity as number | null,
      ))
      : [],
  };
}

export async function findActiveShoppingListItem(
  database: PrismaClient,
  identity: ShoppingListItemIdentity,
): Promise<ShoppingListItem | null> {
  return database.shoppingListItem.findFirst({
    where: { ...identity, deletedAt: null },
    orderBy: [{ sortIndex: "asc" }, { id: "asc" }],
  });
}

export async function findCompatibleShoppingListItem(
  database: PrismaClient,
  identity: ShoppingListItemIdentity,
): Promise<ShoppingListItem | null> {
  const active = await findActiveShoppingListItem(database, identity);
  if (active) return active;

  return database.shoppingListItem.findFirst({
    where: { ...identity, deletedAt: { not: null } },
    orderBy: [{ sortIndex: "asc" }, { id: "asc" }],
  });
}

export interface ShoppingListItemAddition {
  id: string;
  shoppingListId: string;
  /** Added to the stored quantity in SQL (null keeps it), so a concurrent add is not lost. */
  quantityDelta: number | null;
  sortIndex: number;
  categoryKey: string | null;
  iconKey: string | null;
}

/**
 * Adds to an existing item in one statement: the new quantity is computed from the row as it
 * is when the statement runs, not from an earlier read, and the item is unchecked and
 * restored. Returns the number of rows changed (0 when the row is no longer on the list).
 */
export async function addToShoppingListItem(
  database: PrismaClient,
  addition: ShoppingListItemAddition,
): Promise<number> {
  const updatedAt = d1Timestamp(new Date());
  return database.$executeRaw`
    UPDATE "ShoppingListItem"
    SET "quantity" = CASE WHEN ${addition.quantityDelta} IS NULL THEN "quantity"
          ELSE COALESCE("quantity", 0) + ${addition.quantityDelta} END,
        "checked" = 0, "checkedAt" = NULL, "deletedAt" = NULL,
        "sortIndex" = ${addition.sortIndex}, "categoryKey" = ${addition.categoryKey},
        "iconKey" = ${addition.iconKey}, "updatedAt" = ${updatedAt}
    WHERE "id" = ${addition.id} AND "shoppingListId" = ${addition.shoppingListId}
  `;
}

export async function mutateCompatibleShoppingListItem<T>(
  input: CompatibleMutationInput<T>,
): Promise<{ created: boolean; item: T }> {
  const existing = await findCompatibleShoppingListItem(
    input.database,
    input.identity,
  );

  try {
    return existing
      ? { created: false, item: await input.update(existing) }
      : { created: true, item: await input.create() };
  } catch (error) {
    if (!isShoppingListUniqueConflict(error)) throw error;
    const active = await findActiveShoppingListItem(
      input.database,
      input.identity,
    );
    if (!active) throw error;
    return { created: false, item: await input.update(active) };
  }
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

const SHOPPING_LIST_BATCH_ATTEMPTS = 3;

/**
 * Builds and runs a shopping-list batch: one D1 batch on the Worker, one Prisma
 * `$transaction` without a binding. When the batch loses a race (a guard found the rows it
 * was planned from changed, or a concurrent create took the identity), nothing in it applied,
 * so it is built again from fresh reads, up to three times in all.
 */
export async function runCompatibleShoppingListBatch<T, Metadata>(
  database: PrismaClient,
  build: () => Promise<CompatibleBatch<T, Metadata>>,
): Promise<{ items: T[]; metadata: Metadata }> {
  const execute = async () => {
    const batch = await build();
    let items: T[];
    if (batch.native) {
      const results = batch.native.queries.length > 0
        ? await d1WriteBatch(batch.native.database, batch.native.queries)
        : [];
      items = batch.native.items(results);
    } else {
      items = batch.operations.length > 0
        ? await database.$transaction(batch.operations)
        : [];
    }
    return { items, metadata: batch.metadata };
  };

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      const lostRace = isShoppingListUniqueConflict(error) || isD1GuardFailure(error);
      if (!lostRace || attempt >= SHOPPING_LIST_BATCH_ATTEMPTS) throw error;
    }
  }
}
