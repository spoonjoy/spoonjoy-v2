import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0020_api_mutation_tombstones.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  on_delete: string;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexInfoRow {
  name: string;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "ApiIdempotencyKey" (
      "id" TEXT NOT NULL PRIMARY KEY
    );
  `);
  return db;
}

function tableColumns(db: DatabaseSyncType): Record<string, TableInfoRow> {
  const rows = db.prepare(`PRAGMA table_info("ApiMutationTombstone")`).all() as unknown as TableInfoRow[];
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function indexColumns(db: DatabaseSyncType, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info("${indexName}")`).all() as unknown as IndexInfoRow[])
    .map((row) => row.name);
}

function hasIndex(db: DatabaseSyncType, columns: string[], unique = false): boolean {
  const indexes = db.prepare(`PRAGMA index_list("ApiMutationTombstone")`).all() as unknown as IndexListRow[];
  return indexes.some((index) => index.unique === (unique ? 1 : 0) && indexColumns(db, index.name).join("|") === columns.join("|"));
}

describe("migration 0020 — API mutation tombstones", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("creates tombstone fields needed for exact hard-delete recovery", () => {
    const cols = tableColumns(db);

    expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
    expect(cols.idempotencyKeyId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.operation).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.resourceType).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.resourceId).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.parentResourceId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.payload).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1, dflt_value: "CURRENT_TIMESTAMP" });
  });

  it("links tombstones to idempotency reservations with cascade cleanup", () => {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("ApiMutationTombstone")`).all() as unknown as ForeignKeyRow[];
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "ApiIdempotencyKey", from: "idempotencyKeyId", on_delete: "CASCADE" }),
    ]));

    db.exec(`INSERT INTO "ApiIdempotencyKey" ("id") VALUES ('idem_1');`);
    db.exec(`
      INSERT INTO "ApiMutationTombstone"
        ("id", "idempotencyKeyId", "operation", "resourceType", "resourceId", "parentResourceId", "payload")
      VALUES
        ('tomb_1', 'idem_1', 'recipes.steps.delete', 'recipe_step', 'step_1', 'recipe_1', '{"recipeId":"recipe_1","stepNum":1}');
    `);
    db.exec(`DELETE FROM "ApiIdempotencyKey" WHERE "id" = 'idem_1';`);

    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM "ApiMutationTombstone"`).get() as { count: number };
    expect(remaining.count).toBe(0);
  });

  it("creates replay uniqueness and lookup indexes", () => {
    expect(hasIndex(db, ["idempotencyKeyId", "resourceType", "resourceId"], true)).toBe(true);
    expect(hasIndex(db, ["idempotencyKeyId"])).toBe(true);
    expect(hasIndex(db, ["resourceType", "resourceId"])).toBe(true);
  });

  it("rejects duplicate resource tombstones within a reservation", () => {
    db.exec(`INSERT INTO "ApiIdempotencyKey" ("id") VALUES ('idem_2');`);
    db.exec(`
      INSERT INTO "ApiMutationTombstone"
        ("id", "idempotencyKeyId", "operation", "resourceType", "resourceId")
      VALUES
        ('tomb_2', 'idem_2', 'recipes.steps.delete', 'recipe_step', 'step_2');
    `);

    expect(() => db.exec(`
      INSERT INTO "ApiMutationTombstone"
        ("id", "idempotencyKeyId", "operation", "resourceType", "resourceId")
      VALUES
        ('tomb_3', 'idem_2', 'recipes.steps.delete', 'recipe_step', 'step_2');
    `)).toThrow();
  });
});
