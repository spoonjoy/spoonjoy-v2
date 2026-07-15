import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const ROOT_D1_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0023_recipe_cover_prompt_lineage.sql",
);
const PRISMA_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "prisma",
  "migrations",
  "20260714123600_recipe_cover_prompt_lineage",
  "migration.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexInfoRow {
  name: string;
}

interface RecipeCoverLineageRow {
  id: string;
  parentCoverId: string | null;
  promptAddition: string | null;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL
    );
    CREATE TABLE "Recipe" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "chefId" TEXT NOT NULL,
      "activeCoverId" TEXT,
      "activeCoverVariant" TEXT,
      "coverMode" TEXT NOT NULL DEFAULT 'auto',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "RecipeCover" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "recipeId" TEXT NOT NULL,
      "imageUrl" TEXT NOT NULL,
      "stylizedImageUrl" TEXT,
      "sourceType" TEXT NOT NULL,
      "sourceSpoonId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'ready',
      "createdById" TEXT,
      "sourceImageUrl" TEXT,
      "generationStatus" TEXT NOT NULL DEFAULT 'none',
      "failureReason" TEXT,
      "promptVersion" TEXT,
      "styleVersion" TEXT,
      "archivedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "RecipeCover_recipeId_createdAt_idx" ON "RecipeCover"("recipeId", "createdAt");
    CREATE INDEX "RecipeCover_sourceSpoonId_idx" ON "RecipeCover"("sourceSpoonId");
    CREATE INDEX "RecipeCover_recipeId_status_createdAt_idx" ON "RecipeCover"("recipeId", "status", "createdAt");
    CREATE INDEX "RecipeCover_status_idx" ON "RecipeCover"("status");

    INSERT INTO "User" ("id", "email", "username") VALUES ('chef', 'chef@example.com', 'chef');
    INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('recipe_1', 'Lineage Soup', 'chef');
    INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "status", "generationStatus") VALUES
      ('cover_parent', 'recipe_1', '/photos/covers/parent.png', '/photos/covers/parent-editorial.png', 'chef-upload', 'ready', 'succeeded'),
      ('cover_existing', 'recipe_1', '/photos/covers/existing.png', NULL, 'ai-placeholder', 'ready', 'none');
  `);
  return db;
}

function tableColumns(db: DatabaseSyncType, tableName: string): Record<string, TableInfoRow> {
  const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as unknown as TableInfoRow[];
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function indexColumns(db: DatabaseSyncType, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info("${indexName}")`).all() as unknown as IndexInfoRow[])
    .map((row) => row.name);
}

function hasIndex(db: DatabaseSyncType, tableName: string, columns: string[]): boolean {
  const indexes = db.prepare(`PRAGMA index_list("${tableName}")`).all() as unknown as IndexListRow[];
  return indexes.some((index) => index.unique === 0 && indexColumns(db, index.name).join("|") === columns.join("|"));
}

describe.each([
  ["root D1 migration", ROOT_D1_MIGRATION_PATH],
  ["Prisma migration", PRISMA_MIGRATION_PATH],
] as const)("migration 0023 — recipe cover prompt lineage (%s)", (_label, migrationPath) => {
  let db: DatabaseSyncType;

  beforeEach(() => {
    db = freshDb();
    db.exec(readFileSync(migrationPath, "utf8"));
  });

  it("adds nullable prompt and parent lineage fields", () => {
    const cols = tableColumns(db, "RecipeCover");

    expect(cols.promptAddition).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.parentCoverId).toMatchObject({ type: "TEXT", notnull: 0 });
  });

  it("creates a parent cover lookup index", () => {
    expect(hasIndex(db, "RecipeCover", ["parentCoverId"])).toBe(true);
  });

  it("preserves existing covers and allows regenerated covers to store lineage", () => {
    const existing = db.prepare(`
      SELECT id, parentCoverId, promptAddition
      FROM "RecipeCover"
      WHERE id = ?
    `).get("cover_existing") as RecipeCoverLineageRow;
    expect(existing).toEqual({
      id: "cover_existing",
      parentCoverId: null,
      promptAddition: null,
    });

    db.prepare(`
      INSERT INTO "RecipeCover" (
        "id", "recipeId", "imageUrl", "sourceType", "status", "generationStatus", "parentCoverId", "promptAddition"
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "cover_child",
      "recipe_1",
      "/photos/covers/child.png",
      "chef-upload",
      "processing",
      "processing",
      "cover_parent",
      "brighter herbs and tighter crop",
    );

    const child = db.prepare(`
      SELECT id, parentCoverId, promptAddition
      FROM "RecipeCover"
      WHERE id = ?
    `).get("cover_child") as RecipeCoverLineageRow;
    expect(child).toEqual({
      id: "cover_child",
      parentCoverId: "cover_parent",
      promptAddition: "brighter herbs and tighter crop",
    });
  });
});
