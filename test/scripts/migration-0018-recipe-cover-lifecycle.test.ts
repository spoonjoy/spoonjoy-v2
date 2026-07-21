import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;


const ROOT_D1_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0018_recipe_cover_lifecycle.sql",
);
const PRISMA_MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "prisma",
  "migrations",
  "20260609011000_recipe_cover_lifecycle",
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

interface RecipeRow {
  id: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
}

interface RecipeCoverRow {
  id: string;
  status: string;
  generationStatus: string;
  createdById: string | null;
  sourceImageUrl: string | null;
  failureReason: string | null;
  promptVersion: string | null;
  styleVersion: string | null;
  archivedAt: string | null;
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
      "description" TEXT,
      "servings" TEXT,
      "chefId" TEXT NOT NULL,
      "deletedAt" DATETIME,
      "sourceRecipeId" TEXT,
      "sourceUrl" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Recipe_chefId_fkey" FOREIGN KEY ("chefId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "RecipeSpoon" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "chefId" TEXT NOT NULL,
      "recipeId" TEXT NOT NULL,
      "cookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "photoUrl" TEXT,
      "note" TEXT,
      "nextTime" TEXT,
      "deletedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RecipeSpoon_chefId_fkey" FOREIGN KEY ("chefId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "RecipeSpoon_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE "RecipeCover" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "recipeId" TEXT NOT NULL,
      "imageUrl" TEXT NOT NULL,
      "stylizedImageUrl" TEXT,
      "sourceType" TEXT NOT NULL,
      "sourceSpoonId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RecipeCover_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "RecipeCover_sourceSpoonId_fkey" FOREIGN KEY ("sourceSpoonId") REFERENCES "RecipeSpoon" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE INDEX "RecipeCover_recipeId_createdAt_idx" ON "RecipeCover"("recipeId", "createdAt");
    CREATE INDEX "RecipeCover_sourceSpoonId_idx" ON "RecipeCover"("sourceSpoonId");

    INSERT INTO "User" ("id", "email", "username") VALUES ('chef', 'chef@example.com', 'chef');
    INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt") VALUES
      ('r-empty-latest', 'Empty Latest', 'chef', '2026-01-01T00:00:00.000Z'),
      ('r-raw-only', 'Raw Only', 'chef', '2026-01-01T00:00:00.000Z'),
      ('r-no-cover', 'No Cover', 'chef', '2026-01-01T00:00:00.000Z');
    INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "createdAt") VALUES
      ('old-real', 'r-empty-latest', 'old', NULL, 'chef-upload', '2026-01-01T00:00:00.000Z'),
      ('winner-stylized', 'r-empty-latest', 'raw', 'stylized', 'spoon', '2026-02-01T00:00:00.000Z'),
      ('new-empty', 'r-empty-latest', '', '', 'ai-placeholder', '2026-03-01T00:00:00.000Z'),
      ('raw-cover', 'r-raw-only', 'raw-only', NULL, 'chef-upload', '2026-02-01T00:00:00.000Z');
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
] as const)("migration 0018 — recipe cover lifecycle (%s)", (_label, migrationPath) => {
  let db: DatabaseSyncType;

  beforeEach(() => {
    db = freshDb();
    db.exec(readFileSync(migrationPath, "utf8"));
  });

  it("adds active-cover fields to Recipe", () => {
    const cols = tableColumns(db, "Recipe");

    expect(cols.activeCoverId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.activeCoverVariant).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.coverMode).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: "'auto'" });
  });

  it("adds lifecycle fields to RecipeCover", () => {
    const cols = tableColumns(db, "RecipeCover");

    expect(cols.status).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: "'ready'" });
    expect(cols.createdById).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.sourceImageUrl).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.generationStatus).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: "'none'" });
    expect(cols.failureReason).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.promptVersion).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.styleVersion).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.archivedAt).toMatchObject({ type: "DATETIME", notnull: 0 });
  });

  it("creates lookup indexes used by active-cover and archive helpers", () => {
    expect(hasIndex(db, "Recipe", ["activeCoverId"])).toBe(true);
    expect(hasIndex(db, "Recipe", ["coverMode"])).toBe(true);
    expect(hasIndex(db, "RecipeCover", ["recipeId", "status", "createdAt"])).toBe(true);
    expect(hasIndex(db, "RecipeCover", ["status"])).toBe(true);
  });

  it("backfills active cover to the newest ready non-empty displayable cover", () => {
    const row = db.prepare(`SELECT id, activeCoverId, activeCoverVariant, coverMode FROM "Recipe" WHERE id = ?`)
      .get("r-empty-latest") as RecipeRow;

    expect(row).toMatchObject({
      id: "r-empty-latest",
      activeCoverId: "winner-stylized",
      activeCoverVariant: "stylized",
      coverMode: "auto",
    });
  });

  it("backfills image variant when only raw image is available", () => {
    const row = db.prepare(`SELECT id, activeCoverId, activeCoverVariant, coverMode FROM "Recipe" WHERE id = ?`)
      .get("r-raw-only") as RecipeRow;

    expect(row).toMatchObject({
      id: "r-raw-only",
      activeCoverId: "raw-cover",
      activeCoverVariant: "image",
      coverMode: "auto",
    });
  });

  it("leaves recipes without displayable covers in auto/no-active state", () => {
    const row = db.prepare(`SELECT id, activeCoverId, activeCoverVariant, coverMode FROM "Recipe" WHERE id = ?`)
      .get("r-no-cover") as RecipeRow;

    expect(row).toMatchObject({
      id: "r-no-cover",
      activeCoverId: null,
      activeCoverVariant: null,
      coverMode: "auto",
    });
  });

  it("backfills existing covers with ready lifecycle defaults", () => {
    const row = db.prepare(`
      SELECT id, status, generationStatus, createdById, sourceImageUrl, failureReason, promptVersion, styleVersion, archivedAt
      FROM "RecipeCover"
      WHERE id = ?
    `).get("winner-stylized") as RecipeCoverRow;

    expect(row).toMatchObject({
      id: "winner-stylized",
      status: "ready",
      generationStatus: "none",
      createdById: null,
      sourceImageUrl: null,
      failureReason: null,
      promptVersion: null,
      styleVersion: null,
      archivedAt: null,
    });
  });

  it("sets activeCoverId to null when the active cover is hard-deleted", () => {
    db.exec(`DELETE FROM "RecipeCover" WHERE id = 'winner-stylized'`);
    const row = db.prepare(`SELECT activeCoverId, activeCoverVariant, coverMode FROM "Recipe" WHERE id = ?`)
      .get("r-empty-latest") as RecipeRow;

    expect(row.activeCoverId).toBeNull();
    expect(row.activeCoverVariant).toBe("stylized");
    expect(row.coverMode).toBe("auto");
  });
});
