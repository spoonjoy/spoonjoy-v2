import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0044_organizers.sql");
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261123170000_organizers/migration.sql");

function statements(sql: string): string {
  return sql.split("\n").filter((line) => !line.startsWith("--")).join("\n").trim();
}

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "Recipe" ("id" TEXT PRIMARY KEY, "chefId" TEXT NOT NULL);`);
  db.exec(`INSERT INTO "User" ("id") VALUES ('u'); INSERT INTO "Recipe" ("id", "chefId") VALUES ('r', 'u');`);
  db.exec(readFileSync(ROOT_MIGRATION, "utf8"));
  db.exec(`INSERT INTO "Organizer" ("id", "ownerId", "kind", "name", "slug") VALUES ('o', 'u', 'tag', 'Quick', 'quick')`);
  db.exec(`INSERT INTO "RecipeOrganizer" ("recipeId", "organizerId") VALUES ('r', 'o')`);
  return db;
}

describe("migration 0044 - organizers", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("runs the same statements as its Prisma mirror", () => {
    expect(statements(sql)).toBe(statements(readFileSync(PRISMA_MIGRATION, "utf8")));
  });

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0044_organizers.sql", sql)).not.toThrow();
  });

  it("keeps one organizer per owner, kind and slug", () => {
    const db = migrated();
    expect(() => db.exec(`INSERT INTO "Organizer" ("id", "ownerId", "kind", "name", "slug") VALUES ('o2', 'u', 'tag', 'quick', 'quick')`)).toThrow(/UNIQUE/);
    db.exec(`INSERT INTO "Organizer" ("id", "ownerId", "kind", "name", "slug") VALUES ('o3', 'u', 'tool', 'Quick', 'quick')`);
  });

  it("puts a recipe on an organizer once", () => {
    const db = migrated();
    expect(() => db.exec(`INSERT INTO "RecipeOrganizer" ("recipeId", "organizerId") VALUES ('r', 'o')`)).toThrow(/UNIQUE|PRIMARY/);
  });

  it("drops a recipe's links when the recipe goes, and an organizer's when it goes", () => {
    const db = migrated();
    db.exec(`DELETE FROM "Organizer" WHERE "id" = 'o'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "RecipeOrganizer"`).get()).toEqual({ n: 0 });
    db.exec(`INSERT INTO "Organizer" ("id", "ownerId", "kind", "name", "slug") VALUES ('o', 'u', 'tag', 'Quick', 'quick')`);
    db.exec(`INSERT INTO "RecipeOrganizer" ("recipeId", "organizerId") VALUES ('r', 'o')`);
    db.exec(`DELETE FROM "Recipe" WHERE "id" = 'r'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "RecipeOrganizer"`).get()).toEqual({ n: 0 });
  });

  it("drops a cook's organizers when the account goes", () => {
    const db = migrated();
    db.exec(`DELETE FROM "Recipe"; DELETE FROM "User" WHERE "id" = 'u'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Organizer"`).get()).toEqual({ n: 0 });
  });
});
