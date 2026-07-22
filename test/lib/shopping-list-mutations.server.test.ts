import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  asCompatibleD1Database,
  coalesceShoppingRecipeIngredients,
  createCompatibleShoppingListD1Batch,
  isShoppingListUniqueConflict,
  mutateCompatibleShoppingListItem,
  prepareShoppingListItemD1Write,
  runCompatibleShoppingListBatch,
  type CompatibleD1PreparedStatement,
  type ShoppingListItemWritePlan,
} from "~/lib/shopping-list-mutations.server";

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

  it("prepares exact create and update statements with D1-safe values", () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        const captured = { sql, values: [] as unknown[] };
        statements.push(captured);
        const statement: CompatibleD1PreparedStatement = {
          bind(...values) {
            captured.values = values;
            return statement;
          },
        };
        return statement;
      },
    };
    const base: Omit<ShoppingListItemWritePlan, "mode"> = {
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

    prepareShoppingListItemD1Write(database, {
      ...base,
      mode: "create",
      checked: false,
    });
    prepareShoppingListItemD1Write(database, {
      ...base,
      mode: "update",
      checked: true,
      checkedAt: null,
      deletedAt: new Date("2026-07-21T01:02:03.004Z"),
    });
    prepareShoppingListItemD1Write(database, { ...base, mode: "create" });
    prepareShoppingListItemD1Write(database, {
      ...base,
      mode: "update",
      checked: false,
    });

    expect(statements[0].sql).toContain('INSERT INTO "ShoppingListItem"');
    expect(statements[0].values).toEqual([
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
    expect(statements[1].sql).toContain('UPDATE "ShoppingListItem"');
    expect(statements[1].values).toEqual([
      2.5,
      1,
      null,
      "2026-07-21T01:02:03.004Z",
      7,
      "produce",
      "apple",
      "2026-07-22T01:02:03.004Z",
      "item-id",
    ]);
    expect(statements[2].values[5]).toBe(1);
    expect(statements[3].values[1]).toBe(0);
  });

  it("builds native D1 batches only when a binding is available", () => {
    const statements: CompatibleD1PreparedStatement[] = [];
    const database = {
      prepare() {
        const statement: CompatibleD1PreparedStatement = {
          bind() {
            statements.push(statement);
            return statement;
          },
        };
        return statement;
      },
      batch: vi.fn(),
    };
    const plan: ShoppingListItemWritePlan = {
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
    };

    expect(createCompatibleShoppingListD1Batch(null, [plan], ["item"])).toBeUndefined();
    expect(createCompatibleShoppingListD1Batch(database, [plan], ["item"])).toEqual({
      database,
      statements,
      items: ["item"],
    });
    expect(statements).toHaveLength(1);
  });

  it("rebuilds a native D1 batch once after the exact shopping uniqueness error", async () => {
    const statement = { bind: vi.fn() } as unknown as CompatibleD1PreparedStatement;
    const batch = vi.fn()
      .mockRejectedValueOnce(new Error(
        "D1_ERROR: UNIQUE constraint failed: ShoppingListItem.shoppingListId, ShoppingListItem.unitId, ShoppingListItem.ingredientRefId",
      ))
      .mockResolvedValueOnce([]);
    const database = { $transaction: vi.fn() } as unknown as PrismaClient;
    let builds = 0;

    const result = await runCompatibleShoppingListBatch<number, number>(database, async () => {
      builds += 1;
      const attempt = builds;
      return {
        operations: [],
        metadata: attempt,
        native: {
          database: { batch },
          statements: [statement],
          items: [attempt],
        },
      };
    });

    expect(builds).toBe(2);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ items: [2], metadata: 2 });
    expect(database.$transaction).not.toHaveBeenCalled();
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
    const batch = vi.fn().mockRejectedValue(ordinaryError);
    await expect(runCompatibleShoppingListBatch<string, string>(database, async () => ({
      operations: [],
      metadata: "native",
      native: {
        database: { batch },
        statements: [{ bind: vi.fn() }],
        items: ["uncommitted"],
      },
    }))).rejects.toBe(ordinaryError);
    expect(batch).toHaveBeenCalledOnce();
  });

  it("loads an empty native batch without calling D1 or Prisma transactions", async () => {
    const batch = vi.fn();
    const database = { $transaction: vi.fn() } as unknown as PrismaClient;
    const result = await runCompatibleShoppingListBatch<number, string>(database, async () => ({
      operations: [],
      metadata: "empty",
      native: {
        database: { batch },
        statements: [],
        items: [],
      },
    }));

    expect(result).toEqual({ items: [], metadata: "empty" });
    expect(batch).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
