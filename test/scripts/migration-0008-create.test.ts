import { describe, it, expect, beforeAll } from "vitest";
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
  "0008_s1_spoon_foundation.sql",
);

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  // Minimal prerequisite schema so FK constraints can resolve.
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "Recipe" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "imageUrl" TEXT NOT NULL DEFAULT '',
      "servings" TEXT,
      "chefId" TEXT NOT NULL,
      "deletedAt" DATETIME,
      "sourceRecipeId" TEXT,
      "sourceUrl" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Recipe_chefId_fkey" FOREIGN KEY ("chefId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Recipe_sourceRecipeId_fkey" FOREIGN KEY ("sourceRecipeId") REFERENCES "Recipe" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
    );

    CREATE UNIQUE INDEX "Recipe_chefId_title_deletedAt_key" ON "Recipe"("chefId","title","deletedAt");
    CREATE INDEX "Recipe_chefId_idx" ON "Recipe"("chefId");
    CREATE INDEX "Recipe_sourceRecipeId_idx" ON "Recipe"("sourceRecipeId");
  `);
  return db;
}

describe("migration 0008 — create tables", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    db = freshDb();
    db.exec(sql);
  });

  describe("RecipeSpoon", () => {
    it("has the expected columns", () => {
      const rows = db
        .prepare(`PRAGMA table_info("RecipeSpoon")`)
        .all() as unknown as TableInfoRow[];
      const cols = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
      expect(cols.chefId).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.recipeId).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.cookedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
      expect(cols.photoUrl).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(cols.note).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(cols.nextTime).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(cols.deletedAt).toMatchObject({ type: "DATETIME", notnull: 0 });
      expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1 });
      expect(cols.updatedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    });

    it("declares the expected indexes", () => {
      const rows = db
        .prepare(`PRAGMA index_list("RecipeSpoon")`)
        .all() as unknown as IndexListRow[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "RecipeSpoon_recipeId_cookedAt_idx",
          "RecipeSpoon_chefId_cookedAt_idx",
        ]),
      );
    });

    it("declares FK constraints with ON DELETE CASCADE", () => {
      const rows = db
        .prepare(`PRAGMA foreign_key_list("RecipeSpoon")`)
        .all() as unknown as ForeignKeyRow[];
      const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
      expect(byTable.User?.on_delete).toBe("CASCADE");
      expect(byTable.Recipe?.on_delete).toBe("CASCADE");
    });
  });

  describe("RecipeCover", () => {
    it("has the expected columns", () => {
      const rows = db
        .prepare(`PRAGMA table_info("RecipeCover")`)
        .all() as unknown as TableInfoRow[];
      const cols = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
      expect(cols.recipeId).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.imageUrl).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.stylizedImageUrl).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(cols.sourceType).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.sourceSpoonId).toMatchObject({ type: "TEXT", notnull: 0 });
      expect(cols.createdAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    });

    it("declares the expected indexes", () => {
      const rows = db
        .prepare(`PRAGMA index_list("RecipeCover")`)
        .all() as unknown as IndexListRow[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "RecipeCover_recipeId_createdAt_idx",
          "RecipeCover_sourceSpoonId_idx",
        ]),
      );
    });

    it("declares FK constraints with correct ON DELETE clauses", () => {
      const rows = db
        .prepare(`PRAGMA foreign_key_list("RecipeCover")`)
        .all() as unknown as ForeignKeyRow[];
      const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
      expect(byTable.Recipe?.on_delete).toBe("CASCADE");
      expect(byTable.RecipeSpoon?.on_delete).toBe("SET NULL");
    });
  });

  describe("ImageGenLedger", () => {
    it("has the expected columns", () => {
      const rows = db
        .prepare(`PRAGMA table_info("ImageGenLedger")`)
        .all() as unknown as TableInfoRow[];
      const cols = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
      expect(cols.userId).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.kind).toMatchObject({ type: "TEXT", notnull: 1 });
      expect(cols.bucketStart).toMatchObject({ type: "DATETIME", notnull: 1 });
      expect(cols.count).toMatchObject({ type: "INTEGER", notnull: 1 });
      expect(cols.updatedAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    });

    it("declares the expected indexes including the unique index", () => {
      const rows = db
        .prepare(`PRAGMA index_list("ImageGenLedger")`)
        .all() as unknown as IndexListRow[];
      const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(byName["ImageGenLedger_userId_kind_bucketStart_key"]).toBeDefined();
      expect(byName["ImageGenLedger_userId_kind_bucketStart_key"]?.unique).toBe(1);
      expect(byName["ImageGenLedger_userId_bucketStart_idx"]).toBeDefined();
    });

    it("declares the user FK with ON DELETE CASCADE", () => {
      const rows = db
        .prepare(`PRAGMA foreign_key_list("ImageGenLedger")`)
        .all() as unknown as ForeignKeyRow[];
      const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
      expect(byTable.User?.on_delete).toBe("CASCADE");
    });
  });
});
