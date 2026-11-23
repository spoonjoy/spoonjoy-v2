import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0040_recipe_visibility.sql");
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261123010000_recipe_visibility/migration.sql");

function statements(sql: string): string {
  return sql.split("\n").filter((line) => !line.startsWith("--")).join("\n").trim();
}

describe("migration 0040 - recipe visibility", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("runs the same statements as its Prisma mirror", () => {
    expect(statements(sql)).toBe(statements(readFileSync(PRISMA_MIGRATION, "utf8")));
  });

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0040_recipe_visibility.sql", sql)).not.toThrow();
  });

  it("keeps every existing recipe and cook public", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "Recipe" ("id" TEXT PRIMARY KEY, "chefId" TEXT NOT NULL);`);
    db.exec(`INSERT INTO "User" ("id") VALUES ('u'); INSERT INTO "Recipe" ("id", "chefId") VALUES ('r', 'u');`);
    db.exec(sql);
    expect(db.prepare(`SELECT "visibility" FROM "Recipe"`).get()).toEqual({ visibility: "public" });
    expect(db.prepare(`SELECT "defaultRecipeVisibility" FROM "User"`).get()).toEqual({ defaultRecipeVisibility: "public" });
    db.exec(`INSERT INTO "Recipe" ("id", "chefId") VALUES ('r2', 'u')`);
    expect(db.prepare(`SELECT "visibility" FROM "Recipe" WHERE "id" = 'r2'`).get()).toEqual({ visibility: "public" });
  });
});
