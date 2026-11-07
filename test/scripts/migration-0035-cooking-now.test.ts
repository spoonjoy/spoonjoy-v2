import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");
const MIGRATION = "0035_cooking_now.sql";
const ROOT_MIGRATION = resolve(MIGRATIONS_DIR, MIGRATION);
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261024120000_cooking_now/migration.sql");

/** A database with every root D1 migration applied in order, optionally without one. */
function migratedDatabase(without?: string) {
  const db = new DatabaseSync(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    if (file === without) continue;
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

function schema(db: DatabaseSync.Database) {
  return db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
}

describe("migration 0035 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0035 - cooking now", () => {
  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql(MIGRATION, readFileSync(ROOT_MIGRATION, "utf8"))).not.toThrow();
  });

  it("rolls back with the DROP TABLE its header names, leaving the schema as it was", () => {
    const db = migratedDatabase();
    db.exec(`DROP TABLE "CookingNow";`);

    expect(schema(db)).toEqual(schema(migratedDatabase(MIGRATION)));
  });

  it("keeps one row per cook and recipe and removes it with either", () => {
    const db = migratedDatabase();
    const at = "2026-10-24T12:00:00.000Z";
    db.prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`).run("u1", "u1@example.com", "u1", at, at);
    for (const id of ["r1", "r2"]) {
      db.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`).run(id, id, "u1", at, at);
    }
    const insert = db.prepare(`INSERT INTO "CookingNow" ("userId", "recipeId", "attemptId", "revision", "activeStepIndex", "stepCount", "checkedCount", "totalCount", "touchedAt") VALUES (?, ?, 'a', 0, 0, 0, 0, 0, 1)`);
    insert.run("u1", "r1");
    insert.run("u1", "r2");

    expect(() => insert.run("u1", "r1")).toThrow(/UNIQUE constraint failed/);
    expect(() => insert.run("u1", "missing")).toThrow(/FOREIGN KEY constraint failed/);
    expect(db.prepare(`SELECT "listed" FROM "CookingNow" WHERE "recipeId" = 'r1'`).get()).toEqual({ listed: 1 });

    db.prepare(`DELETE FROM "Recipe" WHERE "id" = 'r1'`).run();
    expect(db.prepare(`SELECT "recipeId" FROM "CookingNow"`).all()).toEqual([{ recipeId: "r2" }]);
    db.prepare(`DELETE FROM "User" WHERE "id" = 'u1'`).run();
    expect(db.prepare(`SELECT "recipeId" FROM "CookingNow"`).all()).toEqual([]);
  });
});
