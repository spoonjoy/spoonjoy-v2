import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { D1GuardFailure } from "~/lib/d1-write.server";
import {
  asCompatibleD1Database,
  coalesceShoppingRecipeIngredients,
  createCompatibleShoppingListD1Batch,
  isShoppingListUniqueConflict,
  mutateCompatibleShoppingListItem,
  runCompatibleShoppingListBatch,
  shoppingListItemsRemoveStatements,
  shoppingListItemWriteStatements,
  type ShoppingListItemWritePlan,
} from "~/lib/shopping-list-mutations.server";

/** A D1 binding whose batch answers each statement with the given rows. */
function fakeBinding(batch = vi.fn()): D1ReadDatabase & { batch: ReturnType<typeof vi.fn> } {
  return {
    prepare: (sql: string) => {
      const statement = { sql, values: [] as unknown[], bind: (...values: unknown[]) => ({ ...statement, values }) };
      return statement;
    },
    batch,
  };
}

function results(...rows: unknown[][]) {
  return rows.map((row) => ({ results: row, meta: { changes: row.length } }));
}

describe("shopping-list compatibility mutations", () => {
  it("takes category and icon from the first non-null value in deterministic identity order", () => {
    const rows = [
      {
        stepNum: 2,
        ingredientId: "ingredient-z",
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 3,
        categoryKey: "later-category",
        iconKey: "first-icon",
      },
      {
        stepNum: 1,
        ingredientId: "ingredient-a",
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 1,
        categoryKey: "first-category",
        iconKey: null,
      },
      {
        stepNum: 1,
        ingredientId: "ingredient-A",
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 2,
        categoryKey: null,
        iconKey: null,
      },
      {
        stepNum: 1,
        ingredientId: "ingredient-A",
        ingredientRefId: "second-ref",
        unitId: "unit",
        quantity: 4,
        categoryKey: null,
        iconKey: null,
      },
    ];

    expect(coalesceShoppingRecipeIngredients(rows, 1)).toEqual([
      {
        ingredientRefId: "ingredient-ref",
        unitId: "unit",
        quantity: 6,
        categoryKey: "first-category",
        iconKey: "first-icon",
      },
      {
        ingredientRefId: "second-ref",
        unitId: "unit",
        quantity: 4,
        categoryKey: null,
        iconKey: null,
      },
    ]);
    expect(() => coalesceShoppingRecipeIngredients(rows, Number.POSITIVE_INFINITY))
      .toThrow("Shopping-list recipe scale must be finite");
  });

  it("orders ingredient ids by SQLite UTF-8 binary bytes instead of UTF-16 code units", () => {
    expect(coalesceShoppingRecipeIngredients([
      {
        stepNum: 1,
        ingredientId: "\u{10000}",
        ingredientRefId: "ingredient-ref",
        unitId: null,
        quantity: 1,
        categoryKey: "supplementary",
        iconKey: null,
      },
      {
        stepNum: 1,
        ingredientId: "\uE000",
        ingredientRefId: "ingredient-ref",
        unitId: null,
        quantity: 1,
        categoryKey: "private-use",
        iconKey: null,
      },
    ], 1)).toEqual([
      {
        ingredientRefId: "ingredient-ref",
        unitId: null,
        quantity: 2,
        categoryKey: "private-use",
        iconKey: null,
      },
    ]);
  });

  it("recognizes only callable native D1 bindings", () => {
    expect(asCompatibleD1Database(null)).toBeNull();
    expect(asCompatibleD1Database({ prepare() {} })).toBeNull();
    expect(asCompatibleD1Database({ batch() {} })).toBeNull();
    const binding = { prepare() {}, batch() {} };
    expect(asCompatibleD1Database(binding)).toBe(binding);
  });

  it("writes creates and updates behind guards, adding update quantities in SQL", () => {
    const base = {
      id: "item-id",
      shoppingListId: "list-id",
      ingredientRefId: "ref-id",
      unitId: "unit-id",
      quantity: 2.5,
      checked: true,
      checkedAt: new Date("2026-07-20T01:02:03.004Z"),
      deletedAt: null,
      sortIndex: 7,
      categoryKey: "produce",
      iconKey: "apple",
      updatedAt: new Date("2026-07-22T01:02:03.004Z"),
    };

    const [createGuard, insert] = shoppingListItemWriteStatements({ ...base, mode: "create", checked: false });
    expect(createGuard[0]).toContain('NOT EXISTS (SELECT 1 FROM "ShoppingListItem"');
    expect(createGuard[0]).toContain('"unitId" IS ?');
    expect(createGuard.slice(1)).toEqual(["list-id", "ref-id", "unit-id"]);
    expect(insert[0]).toContain('INSERT INTO "ShoppingListItem"');
    expect(insert[0]).toContain('RETURNING "quantity"');
    expect(insert.slice(1)).toEqual([
      "item-id",
      "list-id",
      2.5,
      "unit-id",
      "ref-id",
      0,
      "2026-07-20T01:02:03.004Z",
      null,
      7,
      "produce",
      "apple",
      "2026-07-22T01:02:03.004Z",
    ]);

    const [updateGuard, update] = shoppingListItemWriteStatements({
      ...base,
      mode: "update",
      quantityDelta: 1.5,
      checkedAt: null,
      deletedAt: new Date("2026-07-21T01:02:03.004Z"),
    });
    expect(updateGuard[0]).toContain('EXISTS (SELECT 1 FROM "ShoppingListItem" WHERE "id" = ? AND "shoppingListId" = ?)');
    expect(updateGuard.slice(1)).toEqual(["item-id", "list-id"]);
    expect(update[0]).toContain('COALESCE("quantity", 0) + ?');
    expect(update[0]).toContain('WHERE "id" = ? AND "shoppingListId" = ?');
    expect(update.slice(1)).toEqual([
      1.5,
      1.5,
      1,
      null,
      "2026-07-21T01:02:03.004Z",
      7,
      "produce",
      "apple",
      "2026-07-22T01:02:03.004Z",
      "item-id",
      "list-id",
    ]);
    expect(shoppingListItemWriteStatements({ ...base, mode: "create" })[1][6]).toBe(1);
    expect(shoppingListItemWriteStatements({ ...base, mode: "update", quantityDelta: null, checked: false })[1][3]).toBe(0);
  });

  it("removes a list's items in chunks under D1's bound-parameter limit, filtered by the list", () => {
    const ids = Array.from({ length: 95 }, (_, index) => `item-${index}`);
    const deletedAt = new Date("2026-07-20T00:00:00.000Z");

    const statements = shoppingListItemsRemoveStatements("list-id", ids, deletedAt);

    expect(statements).toHaveLength(2);
    expect(statements[0][0]).toContain('WHERE "shoppingListId" = ? AND "id" IN (');
    expect(statements[0].slice(1, 4)).toEqual(["2026-07-20T00:00:00.000Z", "2026-07-20T00:00:00.000Z", "list-id"]);
    expect(statements[0].slice(4)).toEqual(ids.slice(0, 90));
    expect(statements[1].slice(4)).toEqual(ids.slice(90));
    expect(statements.every((statement) => statement.length <= 100)).toBe(true);
    expect(shoppingListItemsRemoveStatements("list-id", [], deletedAt)).toEqual([]);
  });

  it("builds native D1 batches only when a binding is available, reading back stored quantities", () => {
    const database = fakeBinding();
    const plans: ShoppingListItemWritePlan[] = [
      {
        mode: "create",
        id: "native-item",
        shoppingListId: "native-list",
        ingredientRefId: "native-ref",
        unitId: null,
        quantity: 1,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        sortIndex: 0,
        categoryKey: null,
        iconKey: null,
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
      },
      {
        mode: "update",
        id: "native-existing",
        shoppingListId: "native-list",
        ingredientRefId: "native-other-ref",
        unitId: null,
        quantity: 3,
        quantityDelta: 2,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        sortIndex: 1,
        categoryKey: null,
        iconKey: null,
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
      },
    ];

    expect(createCompatibleShoppingListD1Batch(null, plans, () => "item")).toBeUndefined();
    const withItems = createCompatibleShoppingListD1Batch(database, plans, (plan, quantity) => `${plan.id}:${quantity}`)!;
    expect(withItems.database).toBe(database);
    expect(withItems.queries).toHaveLength(4);
    // A concurrent add landed in between: the update stored 5, not the predicted 3.
    const written = [[], [{ quantity: 1 }], [], [{ quantity: 5 }]].map((rows) => ({ rows, changes: rows.length }));
    expect(withItems.items(written)).toEqual(["native-item:1", "native-existing:5"]);
    const withoutItems = createCompatibleShoppingListD1Batch(database, plans)!;
    expect(withoutItems.items(written)).toEqual([]);
  });

  it("rebuilds a native D1 batch after a uniqueness error or a guard failure, up to three runs", async () => {
    const batch = vi.fn()
      .mockRejectedValueOnce(new Error(
        "D1_ERROR: UNIQUE constraint failed: ShoppingListItem.shoppingListId, ShoppingListItem.unitId, ShoppingListItem.ingredientRefId",
      ))
      .mockRejectedValueOnce(new Error("D1_ERROR: malformed JSON: SQLITE_ERROR"))
      .mockResolvedValueOnce(results([{ quantity: 4 }]));
    const binding = fakeBinding(batch);
    const database = { $transaction: vi.fn() } as unknown as PrismaClient;
    let builds = 0;

    const result = await runCompatibleShoppingListBatch<string, number>(database, async () => {
      builds += 1;
      const attempt = builds;
      return {
        operations: [],
        metadata: attempt,
        native: {
          database: binding,
          queries: [["UPDATE x RETURNING quantity"]],
          items: (rows) => [`${attempt}:${rows[0].rows[0].quantity}`],
        },
      };
    });

    expect(builds).toBe(3);
    expect(batch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ items: ["3:4"], metadata: 3 });
    expect(database.$transaction).not.toHaveBeenCalled();

    const exhausted = fakeBinding(vi.fn().mockRejectedValue(new Error("D1_ERROR: malformed JSON: SQLITE_ERROR")));
    await expect(runCompatibleShoppingListBatch<string, null>(database, async () => ({
      operations: [],
      metadata: null,
      native: { database: exhausted, queries: [["SELECT 1"]], items: () => [] },
    }))).rejects.toBeInstanceOf(D1GuardFailure);
    expect(exhausted.batch).toHaveBeenCalledTimes(3);

    expect(isShoppingListUniqueConflict(new Error(
      "D1_ERROR: UNIQUE constraint failed: index 'ShoppingListItem_active_identity_key'",
    ))).toBe(true);
    expect(isShoppingListUniqueConflict(new Error(
      "D1_ERROR: UNIQUE constraint failed: index 'ShoppingListItem_active_identity_key_suffix'",
    ))).toBe(false);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("legacy"), {
      code: "P2002",
      meta: { target: ["shoppingListId", "unitId", "ingredientRefId"] },
    }))).toBe(true);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("partial"), {
      code: "P2002",
      meta: { target: "ShoppingListItem_active_identity_key" },
    }))).toBe(true);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("D1 partial index"), {
      code: "P2002",
      meta: { target: ["index 'ShoppingListItem_active_identity_key'"] },
    }))).toBe(true);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("unrelated"), {
      code: "P2002",
      meta: { target: ["shoppingListId", "ingredientRefId"] },
    }))).toBe(false);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("bare"), {
      code: "P2002",
    }))).toBe(false);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("different Prisma code"), {
      code: "P2025",
    }))).toBe(false);
    expect(isShoppingListUniqueConflict(Object.assign(new Error("D1 partial index near miss"), {
      code: "P2002",
      meta: { target: ["index 'ShoppingListItem_active_identity_key_suffix'"] },
    }))).toBe(false);
    expect(isShoppingListUniqueConflict(new Error(
      "UNIQUE constraint failed: ShoppingListItem.shoppingListId, ShoppingListItem.unitId, ShoppingListItem.ingredientRefId, ShoppingListItem.id",
    ))).toBe(false);
    expect(isShoppingListUniqueConflict(new Error(
      "UNIQUE constraint failed: ShoppingListItem.shoppingListId, ShoppingListItem.unitId, ShoppingListItem.ingredientRefIdExtra",
    ))).toBe(false);
    expect(isShoppingListUniqueConflict(new Error(
      "UNIQUE constraint failed: ShoppingListItem.shoppingListId, ShoppingListItem.unitId, ShoppingListItem.ingredientRefId.foo",
    ))).toBe(false);
    expect(isShoppingListUniqueConflict(new Error("ordinary UNIQUE constraint failed"))).toBe(false);
    expect(isShoppingListUniqueConflict(null)).toBe(false);
  });

  it("rethrows a uniqueness race when no active winner exists", async () => {
    const conflict = Object.assign(new Error("race"), {
      code: "P2002",
      meta: { target: ["shoppingListId", "unitId", "ingredientRefId"] },
    });
    const findFirst = vi.fn().mockResolvedValue(null);
    const database = {
      shoppingListItem: { findFirst },
    } as unknown as PrismaClient;

    await expect(mutateCompatibleShoppingListItem({
      database,
      identity: {
        shoppingListId: "list-id",
        ingredientRefId: "ref-id",
        unitId: null,
      },
      update: vi.fn(),
      create: vi.fn().mockRejectedValue(conflict),
    })).rejects.toBe(conflict);
    expect(findFirst).toHaveBeenCalledTimes(3);
  });

  it("updates existing rows, creates missing rows, and recovers an exact create race", async () => {
    const identity = {
      shoppingListId: "list-id",
      ingredientRefId: "ref-id",
      unitId: null,
    };
    const existing = { id: "existing-id" };
    const updateExisting = vi.fn().mockResolvedValue("updated-existing");
    const existingDatabase = {
      shoppingListItem: { findFirst: vi.fn().mockResolvedValue(existing) },
    } as unknown as PrismaClient;
    await expect(mutateCompatibleShoppingListItem({
      database: existingDatabase,
      identity,
      update: updateExisting,
      create: vi.fn(),
    })).resolves.toEqual({ created: false, item: "updated-existing" });
    expect(updateExisting).toHaveBeenCalledWith(existing);

    const missingDatabase = {
      shoppingListItem: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    await expect(mutateCompatibleShoppingListItem({
      database: missingDatabase,
      identity,
      update: vi.fn(),
      create: vi.fn().mockResolvedValue("created-item"),
    })).resolves.toEqual({ created: true, item: "created-item" });

    const conflict = Object.assign(new Error("race"), {
      code: "P2002",
      meta: { target: ["shoppingListId", "unitId", "ingredientRefId"] },
    });
    const winner = { id: "winner-id" };
    const updateWinner = vi.fn().mockResolvedValue("updated-winner");
    const raceDatabase = {
      shoppingListItem: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner),
      },
    } as unknown as PrismaClient;
    await expect(mutateCompatibleShoppingListItem({
      database: raceDatabase,
      identity,
      update: updateWinner,
      create: vi.fn().mockRejectedValue(conflict),
    })).resolves.toEqual({ created: false, item: "updated-winner" });
    expect(updateWinner).toHaveBeenCalledWith(winner);

    const ordinaryError = new Error("ordinary failure");
    await expect(mutateCompatibleShoppingListItem({
      database: missingDatabase,
      identity,
      update: vi.fn(),
      create: vi.fn().mockRejectedValue(ordinaryError),
    })).rejects.toBe(ordinaryError);
  });

  it("rejects non-finite scaled and coalesced recipe quantities", () => {
    const candidate = {
      stepNum: 1,
      ingredientId: "ingredient-a",
      ingredientRefId: "ref-id",
      unitId: null,
      quantity: Number.MAX_VALUE,
      categoryKey: null,
      iconKey: null,
    };
    expect(() => coalesceShoppingRecipeIngredients([candidate], 2))
      .toThrow("Shopping-list recipe quantity must be finite");
    expect(() => coalesceShoppingRecipeIngredients([
      candidate,
      { ...candidate, ingredientId: "ingredient-b" },
    ], 1)).toThrow("Shopping-list recipe quantity must be finite");
  });

  it("executes or skips local Prisma batches and propagates ordinary native failures", async () => {
    const transaction = vi.fn().mockResolvedValue(["local-item"]);
    const database = { $transaction: transaction } as unknown as PrismaClient;
    await expect(runCompatibleShoppingListBatch<string, string>(database, async () => ({
      operations: [Promise.resolve("local-item") as never],
      metadata: "local",
    }))).resolves.toEqual({ items: ["local-item"], metadata: "local" });
    expect(transaction).toHaveBeenCalledOnce();

    await expect(runCompatibleShoppingListBatch<string, string>(database, async () => ({
      operations: [],
      metadata: "local-empty",
    }))).resolves.toEqual({ items: [], metadata: "local-empty" });
    expect(transaction).toHaveBeenCalledOnce();

    const ordinaryError = new Error("native batch failed");
    const binding = fakeBinding(vi.fn().mockRejectedValue(ordinaryError));
    await expect(runCompatibleShoppingListBatch<string, string>(database, async () => ({
      operations: [],
      metadata: "native",
      native: {
        database: binding,
        queries: [["SELECT 1"]],
        items: () => ["uncommitted"],
      },
    }))).rejects.toBe(ordinaryError);
    expect(binding.batch).toHaveBeenCalledOnce();
  });

  it("loads an empty native batch without calling D1 or Prisma transactions", async () => {
    const binding = fakeBinding();
    const database = { $transaction: vi.fn() } as unknown as PrismaClient;
    const result = await runCompatibleShoppingListBatch<number, string>(database, async () => ({
      operations: [],
      metadata: "empty",
      native: {
        database: binding,
        queries: [],
        items: () => [],
      },
    }));

    expect(result).toEqual({ items: [], metadata: "empty" });
    expect(binding.batch).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
