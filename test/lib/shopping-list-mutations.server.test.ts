import type { PrismaClient } from "@prisma/client";
import DatabaseSync from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";

import * as shoppingListMutations from "~/lib/shopping-list-mutations.server";
import {
  asCompatibleD1Database,
  coalesceShoppingRecipeIngredients,
  type CompatibleD1PreparedStatement,
} from "~/lib/shopping-list-mutations.server";

const ATOMIC_BOUND_NOW_MS = Date.parse("2026-07-22T12:00:00.000Z");
const BASE_SYNC_MS = Date.parse("2026-07-20T00:00:00.000Z");
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;

interface AtomicStatementInput {
  id: string;
  shoppingListId: string;
  ingredientRefId: string;
  unitId: string | null;
  quantity: number | null;
  categoryKey: string | null;
  iconKey: string | null;
  boundNowMs: number;
}

interface AtomicStatementRow {
  id: string;
  shoppingListId: string;
  quantity: number | null;
  unitId: string | null;
  ingredientRefId: string;
  checked: number;
  checkedAt: string | null;
  deletedAt: string | null;
  sortIndex: number;
  categoryKey: string | null;
  iconKey: string | null;
  updatedAt: string;
  created: number;
}

interface AtomicMutationResult {
  created: boolean;
  item: Omit<
    AtomicStatementRow,
    "checked" | "checkedAt" | "created" | "deletedAt" | "updatedAt"
  > & {
    checked: boolean;
    checkedAt: Date | null;
    deletedAt: Date | null;
    updatedAt: Date;
  };
}

interface AtomicBatchResult {
  items: AtomicMutationResult[];
  created: number;
  updated: number;
}

type PrepareAtomicStatement = (
  database: { prepare(query: string): CompatibleD1PreparedStatement },
  input: AtomicStatementInput,
) => CompatibleD1PreparedStatement;

type RunAtomicBatch = (input: {
  database: PrismaClient;
  nativeDatabase: {
    prepare(query: string): CompatibleD1PreparedStatement;
    batch(statements: CompatibleD1PreparedStatement[]): Promise<unknown>;
  } | null;
  mutations: AtomicStatementInput[];
}) => Promise<AtomicBatchResult>;

function requireAtomicPrepare(): PrepareAtomicStatement {
  const candidate = (shoppingListMutations as unknown as {
    prepareAtomicShoppingListItemD1Write?: PrepareAtomicStatement;
  }).prepareAtomicShoppingListItemD1Write;
  if (!candidate) throw new Error("Atomic shopping statement is not implemented");
  return candidate;
}

function requireAtomicBatch(): RunAtomicBatch {
  const candidate = (shoppingListMutations as unknown as {
    runAtomicShoppingListBatch?: RunAtomicBatch;
  }).runAtomicShoppingListBatch;
  if (!candidate) throw new Error("Atomic shopping batch is not implemented");
  return candidate;
}

function executeAtomicBatch(input: Parameters<RunAtomicBatch>[0]) {
  return Promise.resolve().then(() => requireAtomicBatch()(input));
}

function atomicInput(
  overrides: Partial<AtomicStatementInput> = {},
): AtomicStatementInput {
  return {
    id: "incoming-item",
    shoppingListId: "list-a",
    ingredientRefId: "ref-a",
    unitId: null,
    quantity: 2,
    categoryKey: null,
    iconKey: null,
    boundNowMs: ATOMIC_BOUND_NOW_MS,
    ...overrides,
  };
}

function rawAtomicRow(overrides: Partial<AtomicStatementRow> = {}): AtomicStatementRow {
  return {
    id: "returned-item",
    shoppingListId: "list-a",
    quantity: 2,
    unitId: null,
    ingredientRefId: "ref-a",
    checked: 0,
    checkedAt: null,
    deletedAt: null,
    sortIndex: 0,
    categoryKey: null,
    iconKey: null,
    updatedAt: "2026-07-22T12:00:00.000Z",
    created: 1,
    ...overrides,
  };
}

function captureAtomicStatement(input = atomicInput()) {
  let sql = "";
  let values: unknown[] = [];
  const database = {
    prepare(query: string) {
      sql = query;
      const statement: CompatibleD1PreparedStatement = {
        bind(...boundValues) {
          values = boundValues;
          return statement;
        },
      };
      return statement;
    },
  };

  requireAtomicPrepare()(database, input);

  return { sql, values };
}

function createAtomicShoppingDatabase(filename = ":memory:") {
  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "Recipe" (
      "id" TEXT PRIMARY KEY,
      "chefId" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL,
      "deletedAt" DATETIME
    );
    CREATE TABLE "Cookbook" (
      "id" TEXT PRIMARY KEY,
      "authorId" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "NativeSyncTombstone" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ShoppingList" (
      "id" TEXT PRIMARY KEY,
      "authorId" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ShoppingListItem" (
      "id" TEXT PRIMARY KEY,
      "shoppingListId" TEXT NOT NULL,
      "quantity" REAL,
      "unitId" TEXT,
      "ingredientRefId" TEXT NOT NULL,
      "checked" BOOLEAN NOT NULL DEFAULT 0,
      "checkedAt" DATETIME,
      "deletedAt" DATETIME,
      "sortIndex" INTEGER NOT NULL,
      "categoryKey" TEXT,
      "iconKey" TEXT,
      "updatedAt" DATETIME NOT NULL,
      FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id")
    );
    CREATE UNIQUE INDEX "ShoppingListItem_active_identity_key"
    ON "ShoppingListItem" (
      "shoppingListId",
      "ingredientRefId",
      COALESCE('u:' || "unitId", 'n:')
    )
    WHERE "deletedAt" IS NULL;
  `);
  database.prepare(`
    INSERT INTO "User" ("id", "updatedAt") VALUES (?, ?)
  `).run("user-a", BASE_SYNC_MS);
  database.prepare(`
    INSERT INTO "ShoppingList" ("id", "authorId", "updatedAt")
    VALUES (?, ?, ?)
  `).run("list-a", "user-a", BASE_SYNC_MS);
  return database;
}

function executeConcurrentWorker(
  databasePath: string,
  sql: string,
  values: unknown[],
  gate: SharedArrayBuffer,
): Promise<AtomicStatementRow> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const Database = require("better-sqlite3");
      const { parentPort, workerData } = require("node:worker_threads");
      const database = new Database(workerData.databasePath);
      database.pragma("busy_timeout = 5000");
      const gate = new Int32Array(workerData.gate);
      Atomics.wait(gate, 0, 0);
      try {
        const row = database.prepare(workerData.sql).get(...workerData.values);
        database.close();
        parentPort.postMessage({ row });
      } catch (error) {
        database.close();
        parentPort.postMessage({ error: String(error && error.stack || error) });
      }
    `, {
      eval: true,
      workerData: { databasePath, sql, values, gate },
    });
    worker.once("message", (message: { row?: AtomicStatementRow; error?: string }) => {
      if (message.error) reject(new Error(message.error));
      else resolve(message.row!);
    });
    worker.once("error", reject);
  });
}

function executeAtomicStatement(
  database: DatabaseSyncType,
  input = atomicInput(),
): AtomicStatementRow {
  const { sql, values } = captureAtomicStatement(input);
  return database.prepare(sql).get(...values) as AtomicStatementRow;
}

function insertShoppingItem(
  database: DatabaseSyncType,
  input: Partial<AtomicStatementRow> & Pick<AtomicStatementRow, "id" | "ingredientRefId">,
) {
  database.prepare(`
    INSERT INTO "ShoppingListItem" (
      "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
      "checked", "checkedAt", "deletedAt", "sortIndex", "categoryKey",
      "iconKey", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.shoppingListId ?? "list-a",
    input.quantity ?? null,
    input.unitId ?? null,
    input.ingredientRefId,
    input.checked ?? 0,
    input.checkedAt ?? null,
    input.deletedAt ?? null,
    input.sortIndex ?? 0,
    input.categoryKey ?? null,
    input.iconKey ?? null,
    input.updatedAt ?? new Date(BASE_SYNC_MS).toISOString(),
  );
}

function loadShoppingItems(database: DatabaseSyncType) {
  return database.prepare(`
    SELECT * FROM "ShoppingListItem"
    ORDER BY "sortIndex", "id" COLLATE BINARY
  `).all() as AtomicStatementRow[];
}

type SyncTimestampFamily =
  | "user"
  | "recipe"
  | "cookbook"
  | "tombstone"
  | "shopping-list"
  | "active-item"
  | "deleted-item";

function setSyncTimestamp(
  database: DatabaseSyncType,
  family: SyncTimestampFamily,
  value: unknown,
) {
  switch (family) {
    case "user":
      database.prepare('UPDATE "User" SET "updatedAt" = ? WHERE "id" = ?')
        .run(value, "user-a");
      break;
    case "recipe":
      database.prepare(`
        INSERT INTO "Recipe" ("id", "chefId", "updatedAt", "deletedAt")
        VALUES ('recipe-source', 'user-a', ?, NULL)
      `).run(value);
      break;
    case "cookbook":
      database.prepare(`
        INSERT INTO "Cookbook" ("id", "authorId", "updatedAt")
        VALUES ('cookbook-source', 'user-a', ?)
      `).run(value);
      break;
    case "tombstone":
      database.prepare(`
        INSERT INTO "NativeSyncTombstone" ("id", "accountId", "updatedAt")
        VALUES ('tombstone-source', 'user-a', ?)
      `).run(value);
      break;
    case "shopping-list":
      database.prepare('UPDATE "ShoppingList" SET "updatedAt" = ? WHERE "id" = ?')
        .run(value, "list-a");
      break;
    case "active-item":
      insertShoppingItem(database, {
        id: "active-clock-source",
        ingredientRefId: "clock-active-ref",
        quantity: 1,
        updatedAt: value as string,
      });
      break;
    case "deleted-item":
      insertShoppingItem(database, {
        id: "deleted-clock-source",
        ingredientRefId: "clock-deleted-ref",
        quantity: 1,
        deletedAt: "2026-07-19T00:00:00.000Z",
        updatedAt: value as string,
      });
      break;
  }
}

describe("atomic shopping-list add/restore statement", () => {
  it("prepares one exact partial-index upsert with canonical bindings and RETURNING", () => {
    const input = atomicInput({
      id: "new-id",
      shoppingListId: "list-id",
      ingredientRefId: "ref-id",
      unitId: "",
      quantity: 2.5,
      categoryKey: "produce",
      iconKey: "apple",
      boundNowMs: 1_790_000_000_123,
    });
    const { sql, values } = captureAtomicStatement(input);
    const normalized = sql.replace(/\s+/g, " ").trim();

    expect(normalized).toContain('INSERT INTO "ShoppingListItem"');
    expect(normalized).toMatch(/"preexisting_identity" AS MATERIALIZED \( SELECT/);
    expect(normalized).toContain(
      "ON CONFLICT (\"shoppingListId\", \"ingredientRefId\", COALESCE('u:' || \"unitId\", 'n:')) WHERE \"deletedAt\" IS NULL DO UPDATE",
    );
    expect(normalized).toContain("RETURNING");
    expect(normalized).toMatch(/RETURNING .*\bcreated\b/);
    expect(normalized).not.toContain("OR REPLACE");
    expect(normalized.match(/INSERT INTO/g)).toHaveLength(1);
    expect(sql.trim().replace(/;$/, "")).not.toContain(";");
    expect(values).toEqual([
      "new-id",
      "list-id",
      "ref-id",
      "",
      2.5,
      1,
      "produce",
      "apple",
      1_790_000_000_123,
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "binds non-finite incoming quantity %s as null with an invalidity marker",
    (quantity) => {
      const { values } = captureAtomicStatement(atomicInput({ quantity }));
      expect(values.slice(4, 6)).toEqual([null, 0]);
    },
  );

  it("inserts at index zero on an empty list and returns canonical stored state", () => {
    const database = createAtomicShoppingDatabase();
    try {
      const row = executeAtomicStatement(database);
      expect(row).toEqual({
        id: "incoming-item",
        shoppingListId: "list-a",
        quantity: 2,
        unitId: null,
        ingredientRefId: "ref-a",
        checked: 0,
        checkedAt: null,
        deletedAt: null,
        sortIndex: 0,
        categoryKey: null,
        iconKey: null,
        updatedAt: "2026-07-22T12:00:00.000Z",
        created: 1,
      });
      expect(row.updatedAt).toHaveLength(24);
    } finally {
      database.close();
    }
  });

  it.each([
    { existing: null, incoming: null, expected: null },
    { existing: null, incoming: 3, expected: 3 },
    { existing: 4, incoming: null, expected: 4 },
    { existing: 4, incoming: 3, expected: 7 },
    { existing: 0, incoming: 0, expected: 0 },
    { existing: -4, incoming: 1.5, expected: -2.5 },
  ])("merges finite quantities atomically: $existing plus $incoming", ({
    existing,
    incoming,
    expected,
  }) => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "active-item",
        ingredientRefId: "ref-a",
        quantity: existing,
        sortIndex: 4,
      });
      const row = executeAtomicStatement(database, atomicInput({ quantity: incoming }));
      expect(row.id).toBe("active-item");
      expect(row.created).toBe(0);
      expect(row.quantity).toBe(expected);
      expect(row.sortIndex).toBe(4);
    } finally {
      database.close();
    }
  });

  it("replaces metadata only with incoming non-null values", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "active-item",
        ingredientRefId: "ref-a",
        quantity: 1,
        categoryKey: "pantry",
        iconKey: "jar",
      });
      const preserved = executeAtomicStatement(database, atomicInput({
        id: "ignored-one",
        categoryKey: null,
        iconKey: null,
      }));
      expect(preserved).toMatchObject({ categoryKey: "pantry", iconKey: "jar" });

      const replaced = executeAtomicStatement(database, atomicInput({
        id: "ignored-two",
        categoryKey: "",
        iconKey: "",
      }));
      expect(replaced).toMatchObject({ categoryKey: "", iconKey: "" });
    } finally {
      database.close();
    }
  });

  it.each([
    {
      incomingCategory: "produce",
      incomingIcon: null,
      expectedCategory: "produce",
      expectedIcon: "jar",
    },
    {
      incomingCategory: null,
      incomingIcon: "apple",
      expectedCategory: "pantry",
      expectedIcon: "apple",
    },
  ])("merges category and icon independently", ({
    incomingCategory,
    incomingIcon,
    expectedCategory,
    expectedIcon,
  }) => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "active-item",
        ingredientRefId: "ref-a",
        categoryKey: "pantry",
        iconKey: "jar",
      });
      expect(executeAtomicStatement(database, atomicInput({
        categoryKey: incomingCategory,
        iconKey: incomingIcon,
      }))).toMatchObject({
        categoryKey: expectedCategory,
        iconKey: expectedIcon,
      });
    } finally {
      database.close();
    }
  });

  it("updates the active row while leaving a matching tombstone byte-for-byte unchanged", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "active-item",
        ingredientRefId: "ref-a",
        quantity: 1,
        sortIndex: -4,
        updatedAt: "2026-07-20T00:00:00.001Z",
      });
      insertShoppingItem(database, {
        id: "old-tombstone",
        ingredientRefId: "ref-a",
        quantity: 50,
        deletedAt: "2026-07-19T00:00:00.000Z",
        sortIndex: 99,
        categoryKey: "old-category",
        iconKey: "old-icon",
        updatedAt: "2026-07-20T00:00:00.002Z",
      });
      const tombstoneBefore = loadShoppingItems(database)
        .find((row) => row.id === "old-tombstone");

      const row = executeAtomicStatement(database, atomicInput({ quantity: 2 }));
      expect(row).toMatchObject({
        id: "active-item",
        quantity: 3,
        sortIndex: -4,
        created: 0,
      });
      expect(loadShoppingItems(database).find((item) => item.id === "old-tombstone"))
        .toEqual(tombstoneBefore);
    } finally {
      database.close();
    }
  });

  it("classifies an active conflict as updated even when the candidate id equals the active id", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "same-id",
        ingredientRefId: "ref-a",
        quantity: 1,
      });
      expect(executeAtomicStatement(database, atomicInput({
        id: "same-id",
        quantity: 2,
      }))).toMatchObject({
        id: "same-id",
        quantity: 3,
        created: 0,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    { checked: 1, checkedAt: null },
    { checked: 0, checkedAt: "2026-07-20T01:00:00.000Z" },
    { checked: 1, checkedAt: "2026-07-20T01:00:00.000Z" },
  ])("retains a logically checked id, clears it, and moves it to the fresh end", ({
    checked,
    checkedAt,
  }) => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "checked-target",
        ingredientRefId: "ref-a",
        quantity: 1,
        checked,
        checkedAt,
        sortIndex: 2,
      });
      insertShoppingItem(database, {
        id: "end-item",
        ingredientRefId: "ref-z",
        quantity: 1,
        sortIndex: 7,
      });

      expect(executeAtomicStatement(database)).toMatchObject({
        id: "checked-target",
        checked: 0,
        checkedAt: null,
        deletedAt: null,
        sortIndex: 8,
        created: 0,
      });
    } finally {
      database.close();
    }
  });

  it("creates a new active id after deletion at the fresh end and advances past the tombstone", () => {
    const database = createAtomicShoppingDatabase();
    const tombstoneMs = ATOMIC_BOUND_NOW_MS + 5_000;
    try {
      insertShoppingItem(database, {
        id: "z-prior-tombstone",
        ingredientRefId: "ref-a",
        quantity: 99,
        checked: 1,
        checkedAt: "2026-07-21T00:00:00.000Z",
        deletedAt: "2026-07-21T01:00:00.000Z",
        sortIndex: 1,
        categoryKey: "old-category",
        iconKey: "old-icon",
        updatedAt: new Date(tombstoneMs).toISOString(),
      });
      insertShoppingItem(database, {
        id: "other-active",
        ingredientRefId: "ref-z",
        quantity: 1,
        sortIndex: 5,
      });

      const row = executeAtomicStatement(database, atomicInput({
        id: "a-new-active",
        quantity: null,
        categoryKey: null,
        iconKey: null,
      }));
      expect(row).toMatchObject({
        id: "a-new-active",
        quantity: null,
        checked: 0,
        checkedAt: null,
        deletedAt: null,
        sortIndex: 6,
        categoryKey: null,
        iconKey: null,
        updatedAt: new Date(tombstoneMs + 1).toISOString(),
        created: 1,
      });
      expect(loadShoppingItems(database)).toHaveLength(3);
    } finally {
      database.close();
    }
  });

  it("excludes a maximum-position tombstone when an otherwise empty list starts at zero", () => {
    const database = createAtomicShoppingDatabase();
    const tombstoneMs = ATOMIC_BOUND_NOW_MS + 7_000;
    try {
      insertShoppingItem(database, {
        id: "maximum-tombstone",
        ingredientRefId: "ref-a",
        quantity: 99,
        deletedAt: "2026-07-21T00:00:00.000Z",
        sortIndex: 2_147_483_647,
        updatedAt: new Date(tombstoneMs).toISOString(),
      });
      expect(executeAtomicStatement(database, atomicInput({ id: "fresh-after-delete" })))
        .toMatchObject({
          id: "fresh-after-delete",
          sortIndex: 0,
          updatedAt: new Date(tombstoneMs + 1).toISOString(),
          created: 1,
        });
    } finally {
      database.close();
    }
  });

  it("keeps null, empty, and arbitrary unit identities distinct", () => {
    const database = createAtomicShoppingDatabase();
    try {
      const units = [null, "", "n:", "u:cup", "\u{10000}"];
      for (const [index, unitId] of units.entries()) {
        const row = executeAtomicStatement(database, atomicInput({
          id: `item-${index}`,
          unitId,
          quantity: index,
        }));
        expect(row).toMatchObject({ id: `item-${index}`, unitId, created: 1 });
      }
      expect(loadShoppingItems(database).map((row) => row.unitId)).toEqual(units);
    } finally {
      database.close();
    }
  });

  it("serializes competing ids through the active identity index without a read/retry race", () => {
    const database = createAtomicShoppingDatabase();
    try {
      const first = executeAtomicStatement(database, atomicInput({
        id: "winner-id",
        quantity: 1,
      }));
      const second = executeAtomicStatement(database, atomicInput({
        id: "loser-id",
        quantity: 2,
      }));

      expect(first).toMatchObject({ id: "winner-id", quantity: 1, created: 1 });
      expect(second).toMatchObject({
        id: "winner-id",
        quantity: 3,
        created: 0,
        updatedAt: new Date(ATOMIC_BOUND_NOW_MS + 1).toISOString(),
      });
      expect(loadShoppingItems(database)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("serializes genuinely concurrent independent connections without a lost update", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "spoonjoy-atomic-shopping-"));
    const databasePath = join(temporaryDirectory, "shopping.sqlite");
    const setupDatabase = createAtomicShoppingDatabase(databasePath);
    setupDatabase.pragma("journal_mode = WAL");
    setupDatabase.close();

    try {
      const first = captureAtomicStatement(atomicInput({ id: "concurrent-a", quantity: 2 }));
      const second = captureAtomicStatement(atomicInput({ id: "concurrent-b", quantity: 3 }));
      const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const firstPromise = executeConcurrentWorker(
        databasePath,
        first.sql,
        first.values,
        gate,
      );
      const secondPromise = executeConcurrentWorker(
        databasePath,
        second.sql,
        second.values,
        gate,
      );
      const gateView = new Int32Array(gate);
      Atomics.store(gateView, 0, 1);
      Atomics.notify(gateView, 0, 2);

      const results = await Promise.all([firstPromise, secondPromise]);
      const verificationDatabase = new DatabaseSync(databasePath);
      const rows = loadShoppingItems(verificationDatabase);
      verificationDatabase.close();

      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(5);
      expect(results.map((row) => row.created).sort()).toEqual([0, 1]);
      expect(results[0].id).toBe(results[1].id);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("assigns consecutive fresh-end positions and clocks to sequential statements", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "existing-end",
        ingredientRefId: "ref-existing",
        quantity: 1,
        sortIndex: 3,
      });
      const [first, second] = database.transaction(() => [
        executeAtomicStatement(database, atomicInput({
          id: "first-new",
          ingredientRefId: "ref-first",
        })),
        executeAtomicStatement(database, atomicInput({
          id: "second-new",
          ingredientRefId: "ref-second",
        })),
      ])();

      expect(first).toMatchObject({ sortIndex: 4, created: 1 });
      expect(second).toMatchObject({
        sortIndex: 5,
        updatedAt: new Date(ATOMIC_BOUND_NOW_MS + 1).toISOString(),
        created: 1,
      });
    } finally {
      database.close();
    }
  });

  it("aborts when a required fresh-end position exceeds Prisma's signed Int range", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "maximum-position",
        ingredientRefId: "ref-existing",
        quantity: 1,
        sortIndex: 2_147_483_647,
      });
      const before = loadShoppingItems(database);
      expect(() => executeAtomicStatement(database)).toThrow();
      expect(loadShoppingItems(database)).toEqual(before);
    } finally {
      database.close();
    }
  });

  it("retains a maximum signed Int position for an active unchecked update", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "maximum-position-target",
        ingredientRefId: "ref-a",
        quantity: 1,
        sortIndex: 2_147_483_647,
      });
      expect(executeAtomicStatement(database)).toMatchObject({
        id: "maximum-position-target",
        quantity: 3,
        sortIndex: 2_147_483_647,
        created: 0,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_VALUE,
  ])("aborts non-finite or overflowing incoming quantity %s without changing the row", (quantity) => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "active-item",
        ingredientRefId: "ref-a",
        quantity: Number.MAX_VALUE,
        sortIndex: 3,
      });
      const before = loadShoppingItems(database);
      expect(() => executeAtomicStatement(database, atomicInput({ quantity }))).toThrow();
      expect(loadShoppingItems(database)).toEqual(before);
    } finally {
      database.close();
    }
  });

  it.each([Number.MAX_VALUE, -Number.MAX_VALUE])(
    "accepts finite quantity boundary %s on a fresh identity",
    (quantity) => {
      const database = createAtomicShoppingDatabase();
      try {
        expect(executeAtomicStatement(database, atomicInput({ quantity })))
          .toMatchObject({ quantity, created: 1 });
      } finally {
        database.close();
      }
    },
  );

  it("aborts negative aggregate overflow without changing the row", () => {
    const database = createAtomicShoppingDatabase();
    try {
      insertShoppingItem(database, {
        id: "active-item",
        ingredientRefId: "ref-a",
        quantity: -Number.MAX_VALUE,
      });
      const before = loadShoppingItems(database);
      expect(() => executeAtomicStatement(database, atomicInput({
        quantity: -Number.MAX_VALUE,
      }))).toThrow();
      expect(loadShoppingItems(database)).toEqual(before);
    } finally {
      database.close();
    }
  });

  it.each(["not-numeric", Number.POSITIVE_INFINITY, Buffer.from("blob")])(
    "aborts invalid existing quantity %s without changing the row",
    (quantity) => {
      const database = createAtomicShoppingDatabase();
      try {
        insertShoppingItem(database, {
          id: "active-item",
          ingredientRefId: "ref-a",
          quantity: quantity as never,
          sortIndex: 3,
        });
        const before = loadShoppingItems(database);
        expect(() => executeAtomicStatement(database)).toThrow();
        expect(loadShoppingItems(database)).toEqual(before);
      } finally {
        database.close();
      }
    },
  );

  it.each([
    {
      label: "integer",
      value: Date.parse("2026-07-20T00:00:01.001Z"),
      highWaterMs: Date.parse("2026-07-20T00:00:01.001Z"),
    },
    {
      label: "fractional real with integer truncation",
      value: Date.parse("2026-07-20T00:00:01.002Z") + 0.75,
      highWaterMs: Date.parse("2026-07-20T00:00:01.002Z"),
    },
    {
      label: "canonical Z text",
      value: "2026-07-20T00:00:01.003Z",
      highWaterMs: Date.parse("2026-07-20T00:00:01.003Z"),
    },
    {
      label: "offset text with milliseconds",
      value: "2026-07-20T01:00:01.004+01:00",
      highWaterMs: Date.parse("2026-07-20T00:00:01.004Z"),
    },
    {
      label: "offset text without milliseconds",
      value: "2026-07-20T01:00:02+01:00",
      highWaterMs: Date.parse("2026-07-20T00:00:02.000Z"),
    },
    {
      label: "CURRENT_TIMESTAMP-shaped text",
      value: "2026-07-20 00:00:03",
      highWaterMs: Date.parse("2026-07-20T00:00:03.000Z"),
    },
  ])("normalizes a sole newer $label cursor exactly", ({ value, highWaterMs }) => {
    const database = createAtomicShoppingDatabase();
    try {
      setSyncTimestamp(database, "user", value);
      const row = executeAtomicStatement(database, atomicInput({
        boundNowMs: Date.parse("2026-07-19T00:00:00.000Z"),
      }));
      expect(row.updatedAt).toBe(new Date(highWaterMs + 1).toISOString());
      expect(row.updatedAt).toHaveLength(24);
    } finally {
      database.close();
    }
  });

  it.each<SyncTimestampFamily>([
    "user",
    "recipe",
    "cookbook",
    "tombstone",
    "shopping-list",
    "active-item",
    "deleted-item",
  ])("advances strictly one millisecond past a newer %s cursor", (family) => {
    const database = createAtomicShoppingDatabase();
    const newerMs = Date.parse("2026-07-23T00:00:00.123Z");
    try {
      setSyncTimestamp(database, family, newerMs);
      const row = executeAtomicStatement(database, atomicInput({
        boundNowMs: Date.parse("2026-07-19T00:00:00.000Z"),
      }));
      expect(row.updatedAt).toBe(new Date(newerMs + 1).toISOString());
    } finally {
      database.close();
    }
  });

  it("ignores another owner's newer account cursor", () => {
    const database = createAtomicShoppingDatabase();
    try {
      database.prepare('INSERT INTO "User" ("id", "updatedAt") VALUES (?, ?)')
        .run("user-b", Date.parse("2026-07-25T00:00:00.000Z"));
      database.prepare(`
        INSERT INTO "Recipe" ("id", "chefId", "updatedAt", "deletedAt")
        VALUES (?, ?, ?, NULL)
      `).run("other-recipe", "user-b", Date.parse("2026-07-26T00:00:00.000Z"));
      database.prepare(`
        INSERT INTO "Cookbook" ("id", "authorId", "updatedAt")
        VALUES (?, ?, ?)
      `).run("other-cookbook", "user-b", Date.parse("2026-07-29T00:00:00.000Z"));
      database.prepare(`
        INSERT INTO "ShoppingList" ("id", "authorId", "updatedAt")
        VALUES (?, ?, ?)
      `).run("list-b", "user-b", Date.parse("2026-07-27T00:00:00.000Z"));
      insertShoppingItem(database, {
        id: "other-item",
        shoppingListId: "list-b",
        ingredientRefId: "other-ref",
        updatedAt: "2026-07-28T00:00:00.000Z",
      });

      expect(executeAtomicStatement(database).updatedAt)
        .toBe(new Date(ATOMIC_BOUND_NOW_MS).toISOString());
    } finally {
      database.close();
    }
  });

  it("ignores invalid timestamps owned by another account", () => {
    const database = createAtomicShoppingDatabase();
    try {
      database.prepare('INSERT INTO "User" ("id", "updatedAt") VALUES (?, ?)')
        .run("user-b", "not-a-timestamp");
      database.prepare(`
        INSERT INTO "Recipe" ("id", "chefId", "updatedAt", "deletedAt")
        VALUES (?, ?, ?, NULL)
      `).run("other-invalid-recipe", "user-b", "not-a-timestamp");
      database.prepare(`
        INSERT INTO "Cookbook" ("id", "authorId", "updatedAt")
        VALUES (?, ?, ?)
      `).run("other-invalid-cookbook", "user-b", "not-a-timestamp");
      database.prepare(`
        INSERT INTO "NativeSyncTombstone" ("id", "accountId", "updatedAt")
        VALUES (?, ?, ?)
      `).run("other-invalid-tombstone", "user-b", "not-a-timestamp");
      database.prepare(`
        INSERT INTO "ShoppingList" ("id", "authorId", "updatedAt")
        VALUES (?, ?, ?)
      `).run("list-b", "user-b", "not-a-timestamp");
      insertShoppingItem(database, {
        id: "other-invalid-item",
        shoppingListId: "list-b",
        ingredientRefId: "other-ref",
        updatedAt: "not-a-timestamp",
      });

      expect(executeAtomicStatement(database).updatedAt)
        .toBe(new Date(ATOMIC_BOUND_NOW_MS).toISOString());
    } finally {
      database.close();
    }
  });

  it("excludes deleted recipes from the account high-water", () => {
    const database = createAtomicShoppingDatabase();
    try {
      database.prepare(`
        INSERT INTO "Recipe" ("id", "chefId", "updatedAt", "deletedAt")
        VALUES (?, ?, ?, ?)
      `).run(
        "deleted-recipe",
        "user-a",
        Date.parse("2026-07-29T00:00:00.000Z"),
        "2026-07-21T00:00:00.000Z",
      );
      expect(executeAtomicStatement(database).updatedAt)
        .toBe(new Date(ATOMIC_BOUND_NOW_MS).toISOString());
    } finally {
      database.close();
    }
  });

  it.each<SyncTimestampFamily>([
    "user",
    "recipe",
    "cookbook",
    "tombstone",
    "shopping-list",
    "active-item",
    "deleted-item",
  ])("aborts an invalid %s cursor without inserting", (family) => {
    const database = createAtomicShoppingDatabase();
    try {
      setSyncTimestamp(database, family, "not-a-timestamp");
      expect(() => executeAtomicStatement(database)).toThrow();
      expect(loadShoppingItems(database).filter((row) => row.id === "incoming-item"))
        .toEqual([]);
    } finally {
      database.close();
    }
  });

  it("aborts when the shopping-list owner has no account timestamp row", () => {
    const database = createAtomicShoppingDatabase();
    try {
      database.prepare('DELETE FROM "User" WHERE "id" = ?').run("user-a");
      expect(() => executeAtomicStatement(database)).toThrow();
      expect(loadShoppingItems(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it.each([
    { label: "null", value: null as never },
    { label: "negative", value: -1 },
    { label: "fractional", value: 1.5 },
    { label: "NaN", value: Number.NaN },
    { label: "positive infinity", value: Number.POSITIVE_INFINITY },
    { label: "beyond Date range", value: 253_402_300_800_000 },
  ])("aborts a $label bound clock without inserting", ({ value }) => {
    const database = createAtomicShoppingDatabase();
    try {
      expect(() => executeAtomicStatement(database, atomicInput({ boundNowMs: value })))
        .toThrow();
      expect(loadShoppingItems(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it.each([
    { value: 0, expected: "1970-01-01T00:00:00.000Z", lowerExistingClocks: true },
    {
      value: 253_402_300_799_999,
      expected: "9999-12-31T23:59:59.999Z",
      lowerExistingClocks: false,
    },
  ])("accepts inclusive bound-clock endpoint $value", ({
    value,
    expected,
    lowerExistingClocks,
  }) => {
    const database = createAtomicShoppingDatabase();
    try {
      if (lowerExistingClocks) {
        setSyncTimestamp(database, "user", -62_167_219_200_000);
        setSyncTimestamp(database, "shopping-list", -62_167_219_200_000);
      }
      expect(executeAtomicStatement(database, atomicInput({ boundNowMs: value })).updatedAt)
        .toBe(expected);
    } finally {
      database.close();
    }
  });

  it("aborts when advancing the account high-water would overflow canonical time", () => {
    const database = createAtomicShoppingDatabase();
    try {
      setSyncTimestamp(database, "user", 253_402_300_799_999);
      expect(() => executeAtomicStatement(database, atomicInput({ boundNowMs: 0 })))
        .toThrow();
      expect(loadShoppingItems(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("accepts the highest cursor that can still advance into canonical time", () => {
    const database = createAtomicShoppingDatabase();
    try {
      setSyncTimestamp(database, "user", 253_402_300_799_998);
      expect(executeAtomicStatement(database, atomicInput({ boundNowMs: 0 })).updatedAt)
        .toBe("9999-12-31T23:59:59.999Z");
    } finally {
      database.close();
    }
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 253_402_300_800_000])(
    "aborts invalid or out-of-range account timestamp %s",
    (updatedAt) => {
      const database = createAtomicShoppingDatabase();
      try {
        setSyncTimestamp(database, "user", updatedAt);
        expect(() => executeAtomicStatement(database)).toThrow();
        expect(loadShoppingItems(database)).toEqual([]);
      } finally {
        database.close();
      }
    },
  );
});

describe("shopping-list mutation helpers", () => {
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

  it("does not rebuild an atomic native D1 batch after a uniqueness error", async () => {
    const conflict = new Error(
      "D1_ERROR: UNIQUE constraint failed: index 'ShoppingListItem_active_identity_key'",
    );
    const batch = vi.fn().mockRejectedValue(conflict);
    const statement = { bind: vi.fn() } as unknown as CompatibleD1PreparedStatement;
    const nativeDatabase = {
      prepare: vi.fn(() => statement),
      batch,
    };

    await expect(executeAtomicBatch({
      database: {} as PrismaClient,
      nativeDatabase,
      mutations: [atomicInput()],
    })).rejects.toBe(conflict);

    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("normalizes ordered native D1 RETURNING rows and derives authoritative counts", async () => {
    const mutations = [
      atomicInput({ id: "planned-one" }),
      atomicInput({ id: "planned-two" }),
    ];
    const expectedStatements = mutations.map(captureAtomicStatement);
    const preparedStatements: Array<{ sql: string; values: unknown[] }> = [];
    const returnedItems = [
      rawAtomicRow({ id: "actual-one", created: 1 }),
      rawAtomicRow({
        id: "actual-two",
        checked: 1,
        checkedAt: "2026-07-21T00:00:00.000Z",
        deletedAt: "2026-07-21T01:00:00.000Z",
        updatedAt: "2026-07-22T12:00:00.001Z",
        created: 0,
      }),
    ];
    const batch = vi.fn().mockResolvedValue(
      returnedItems.map((item) => ({ success: true, results: [item] })),
    );
    const nativeDatabase = {
      prepare: vi.fn((sql: string) => {
        const captured = { sql, values: [] as unknown[] };
        preparedStatements.push(captured);
        const statement: CompatibleD1PreparedStatement = {
          bind(...values) {
            captured.values = values;
            return statement;
          },
        };
        return statement;
      }),
      batch,
    };

    const result = await executeAtomicBatch({
      database: {} as PrismaClient,
      nativeDatabase,
      mutations,
    });

    expect(result).toMatchObject({
      created: 1,
      updated: 1,
      items: [
        { created: true, item: { id: "actual-one", checked: false } },
        { created: false, item: { id: "actual-two", checked: true } },
      ],
    });
    expect(result.items[0].item.updatedAt).toEqual(new Date("2026-07-22T12:00:00.000Z"));
    expect(result.items[1].item.checkedAt).toEqual(new Date("2026-07-21T00:00:00.000Z"));
    expect(result.items[1].item.deletedAt).toEqual(new Date("2026-07-21T01:00:00.000Z"));
    expect(preparedStatements).toEqual(expectedStatements);
    expect(batch).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "missing", results: [] },
    { label: "multiple", results: [{ id: "one" }, { id: "two" }] },
    { label: "malformed", results: null },
  ])("rejects a $label native RETURNING result", async ({ results }) => {
    const statement = { bind: vi.fn() } as unknown as CompatibleD1PreparedStatement;
    const batch = vi.fn().mockResolvedValue([{ success: true, results }]);

    await expect(executeAtomicBatch({
      database: {} as PrismaClient,
      nativeDatabase: { prepare: vi.fn(() => statement), batch },
      mutations: [atomicInput()],
    })).rejects.toThrow("D1 shopping batch did not return exactly one row per statement");
    expect(batch).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "fewer", results: [] },
    {
      label: "more",
      results: [
        { success: true, results: [rawAtomicRow()] },
        { success: true, results: [rawAtomicRow({ id: "extra" })] },
      ],
    },
  ])("rejects $label outer D1 results than prepared statements", async ({ results }) => {
    const statement = { bind: vi.fn() } as unknown as CompatibleD1PreparedStatement;
    const batch = vi.fn().mockResolvedValue(results);
    await expect(executeAtomicBatch({
      database: {} as PrismaClient,
      nativeDatabase: { prepare: vi.fn(() => statement), batch },
      mutations: [atomicInput()],
    })).rejects.toThrow("D1 shopping batch result count did not match statement count");
  });

  it("rejects an explicit unsuccessful D1 statement result", async () => {
    const statement = { bind: vi.fn() } as unknown as CompatibleD1PreparedStatement;
    const batch = vi.fn().mockResolvedValue([{
      success: false,
      results: [rawAtomicRow()],
    }]);
    await expect(executeAtomicBatch({
      database: {} as PrismaClient,
      nativeDatabase: { prepare: vi.fn(() => statement), batch },
      mutations: [atomicInput()],
    })).rejects.toThrow("D1 shopping batch statement failed");
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

  it("runs identical local raw statements in one array transaction and normalizes results", async () => {
    const mutations = [
      atomicInput({ id: "local-created" }),
      atomicInput({ id: "local-updated" }),
    ];
    const expectedStatements = mutations.map(captureAtomicStatement);
    const rows = [
      [rawAtomicRow({ id: "local-created", created: 1 })],
      [rawAtomicRow({ id: "local-updated", created: 0 })],
    ];
    const queryRawUnsafe = vi.fn()
      .mockResolvedValueOnce(rows[0])
      .mockResolvedValueOnce(rows[1]);
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    const database = {
      $queryRawUnsafe: queryRawUnsafe,
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(executeAtomicBatch({
      database,
      nativeDatabase: null,
      mutations,
    })).resolves.toMatchObject({
      created: 1,
      updated: 1,
      items: [
        { created: true, item: { id: "local-created" } },
        { created: false, item: { id: "local-updated" } },
      ],
    });
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(queryRawUnsafe.mock.calls).toEqual(
      expectedStatements.map(({ sql, values }) => [sql, ...values]),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it.each([
    { label: "zero", rows: [] },
    { label: "two", rows: [rawAtomicRow(), rawAtomicRow({ id: "second" })] },
  ])("rejects a local raw statement that returns $label rows", async ({ rows }) => {
    const queryRawUnsafe = vi.fn().mockResolvedValue(rows);
    const database = {
      $queryRawUnsafe: queryRawUnsafe,
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaClient;

    await expect(executeAtomicBatch({
      database,
      nativeDatabase: null,
      mutations: [atomicInput()],
    })).rejects.toThrow("Local shopping statement did not return exactly one row");
  });

  it("propagates a local raw failure after exactly one transaction attempt", async () => {
    const ordinaryError = new Error("local raw failed");
    const queryRawUnsafe = vi.fn().mockRejectedValue(ordinaryError);
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    const database = {
      $queryRawUnsafe: queryRawUnsafe,
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(executeAtomicBatch({
      database,
      nativeDatabase: null,
      mutations: [atomicInput()],
    })).rejects.toBe(ordinaryError);
    expect(queryRawUnsafe).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("propagates an ordinary native batch failure without retry", async () => {
    const ordinaryError = new Error("native batch failed");
    const batch = vi.fn().mockRejectedValue(ordinaryError);
    const statement = { bind: vi.fn() } as unknown as CompatibleD1PreparedStatement;
    await expect(executeAtomicBatch({
      database: {} as PrismaClient,
      nativeDatabase: { prepare: vi.fn(() => statement), batch },
      mutations: [atomicInput()],
    })).rejects.toBe(ordinaryError);
    expect(batch).toHaveBeenCalledOnce();
  });

  it("returns an empty authoritative batch without calling D1 or Prisma", async () => {
    const batch = vi.fn();
    const database = { $transaction: vi.fn() } as unknown as PrismaClient;
    const result = await executeAtomicBatch({
      database,
      nativeDatabase: { prepare: vi.fn(), batch },
      mutations: [],
    });

    expect(result).toEqual({ items: [], created: 0, updated: 0 });
    expect(batch).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
