import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0033_recipe_cover_generation_started_at.sql");
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20261009200000_recipe_cover_generation_started_at/migration.sql",
);

describe("migration 0033 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0033 - recipe cover generation start time", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0033_recipe_cover_generation_started_at.sql", sql)).not.toThrow();
  });

  it("adds a nullable start time and leaves existing covers untouched, so their createdAt stands in", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "RecipeCover" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "status" TEXT NOT NULL DEFAULT 'ready',
        "generationStatus" TEXT NOT NULL DEFAULT 'none',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "RecipeCover" ("id", "status", "generationStatus", "createdAt")
        VALUES ('existing', 'processing', 'processing', '2026-10-09T12:00:00.000Z');
    `);

    db.exec(sql);

    const columns = db.prepare(`PRAGMA table_info("RecipeCover")`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
    expect(columns.find((column) => column.name === "generationStartedAt")).toMatchObject({ type: "DATETIME", notnull: 0, dflt_value: null });
    expect(db.prepare(`SELECT * FROM "RecipeCover" WHERE "id" = 'existing'`).get()).toEqual({
      id: "existing",
      status: "processing",
      generationStatus: "processing",
      createdAt: "2026-10-09T12:00:00.000Z",
      generationStartedAt: null,
    });
  });
});
