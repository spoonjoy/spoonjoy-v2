import type {
  Prisma,
  PrismaClient,
  ShoppingListItem,
} from "@prisma/client";

// The quantity a shopping-list row ends up with when an amount is added to an existing row with
// the same ingredient and unit. A live row (checked or not) merges: the added amount goes on top
// of what is already there. A removed or cleared row is kept only as a record to reuse (the
// identity is unique), so it restarts from the added amount; otherwise a cleared "1 lemon" would
// come back as 2 when "1 lemon" is added again. `added` is null when no amount was given.
export function mergedShoppingItemQuantity(
  existing: { quantity: number | null; deletedAt: Date | null },
  added: number | null,
): number | null {
  if (existing.deletedAt) return added;
  if (added === null) return existing.quantity;
  return (existing.quantity ?? 0) + added;
}

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
  native?: {
    database: Pick<CompatibleD1Database, "batch">;
    statements: CompatibleD1PreparedStatement[];
    items: T[];
  };
}

export interface CompatibleD1PreparedStatement {
  bind(...values: unknown[]): CompatibleD1PreparedStatement;
}

export interface CompatibleD1Database {
  prepare(query: string): CompatibleD1PreparedStatement;
  batch(statements: CompatibleD1PreparedStatement[]): Promise<unknown>;
}

export interface ShoppingListItemWritePlan {
  mode: "create" | "update";
  id: string;
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number | null;
  checked: boolean;
  checkedAt: Date | null;
  deletedAt: Date | null;
  sortIndex: number;
  categoryKey: string | null;
  iconKey: string | null;
  updatedAt: Date;
}

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

export function asCompatibleD1Database(value: unknown): CompatibleD1Database | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CompatibleD1Database>;
  return typeof candidate.prepare === "function" && typeof candidate.batch === "function"
    ? candidate as CompatibleD1Database
    : null;
}

function d1Date(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function prepareShoppingListItemD1Write(
  database: Pick<CompatibleD1Database, "prepare">,
  plan: ShoppingListItemWritePlan,
): CompatibleD1PreparedStatement {
  const updatedAt = plan.updatedAt.toISOString();
  if (plan.mode === "create") {
    return database.prepare(`
      INSERT INTO "ShoppingListItem" (
        "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
        "checked", "checkedAt", "deletedAt", "sortIndex", "categoryKey",
        "iconKey", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
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
    );
  }

  return database.prepare(`
    UPDATE "ShoppingListItem"
    SET "quantity" = ?, "checked" = ?, "checkedAt" = ?, "deletedAt" = ?,
        "sortIndex" = ?, "categoryKey" = ?, "iconKey" = ?, "updatedAt" = ?
    WHERE "id" = ?
  `).bind(
    plan.quantity,
    plan.checked ? 1 : 0,
    d1Date(plan.checkedAt),
    d1Date(plan.deletedAt),
    plan.sortIndex,
    plan.categoryKey,
    plan.iconKey,
    updatedAt,
    plan.id,
  );
}

export function createCompatibleShoppingListD1Batch<T>(
  database: CompatibleD1Database | null,
  writePlans: ShoppingListItemWritePlan[],
  items: T[],
) {
  if (!database) return undefined;
  return {
    database,
    statements: writePlans.map((plan) => prepareShoppingListItemD1Write(database, plan)),
    items,
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

// Adds `added` to one row in a single statement, so the new quantity is computed from the row as
// it is when the write lands rather than from an earlier read: two adds that race on the same row
// (two devices, a double tap) both count. It follows mergedShoppingItemQuantity: a removed or
// cleared row restarts from `added`, a live row adds on top (a null `added` leaves it as is). The
// same statement brings the row back and unchecks it; SQLite evaluates every SET expression
// against the row before the update, so the CASE sees the old "deletedAt".
export async function addToShoppingListItemQuantity(
  database: PrismaClient,
  itemId: string,
  added: number | null,
): Promise<void> {
  await database.$executeRaw`
    UPDATE "ShoppingListItem"
    SET "quantity" = CASE
          WHEN "deletedAt" IS NOT NULL THEN ${added}
          WHEN ${added} IS NULL THEN "quantity"
          ELSE COALESCE("quantity", 0) + ${added}
        END,
        "checked" = 0,
        "checkedAt" = NULL,
        "deletedAt" = NULL
    WHERE "id" = ${itemId}
  `;
}

interface CompatibleAddInput<T> {
  database: PrismaClient;
  identity: ShoppingListItemIdentity;
  /** The amount to add; null when no amount was given. */
  added: number | null;
  /** Where the matched row goes on the list. Runs before the row comes back, so a "move to the
   * end" position is computed from the other rows. */
  sortIndex: (existing: ShoppingListItem) => Promise<number>;
  /** Sets the fields that aren't additive (sort position, category, icon) and returns the row. */
  update: (existing: ShoppingListItem, sortIndex: number) => Promise<T>;
  create: () => Promise<T>;
}

// mutateCompatibleShoppingListItem for an add: the matched row's quantity, check and removed
// state change atomically (addToShoppingListItemQuantity), and `update` sets only the rest.
export async function addToCompatibleShoppingListItem<T>(
  input: CompatibleAddInput<T>,
): Promise<{ created: boolean; item: T }> {
  return mutateCompatibleShoppingListItem({
    database: input.database,
    identity: input.identity,
    create: input.create,
    update: async (existing) => {
      const sortIndex = await input.sortIndex(existing);
      await addToShoppingListItemQuantity(input.database, existing.id, input.added);
      return input.update(existing, sortIndex);
    },
  });
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

export async function runCompatibleShoppingListBatch<T, Metadata>(
  database: PrismaClient,
  build: () => Promise<CompatibleBatch<T, Metadata>>,
): Promise<{ items: T[]; metadata: Metadata }> {
  const execute = async () => {
    const batch = await build();
    let items: T[];
    if (batch.native) {
      if (batch.native.statements.length > 0) {
        await batch.native.database.batch(batch.native.statements);
      }
      items = batch.native.items;
    } else {
      items = batch.operations.length > 0
        ? await database.$transaction(batch.operations)
        : [];
    }
    return { items, metadata: batch.metadata };
  };

  try {
    return await execute();
  } catch (error) {
    if (!isShoppingListUniqueConflict(error)) throw error;
    return execute();
  }
}
