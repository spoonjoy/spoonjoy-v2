// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");
const MIGRATION = "0048_calendar_feed.sql";
const ROOT_MIGRATION = resolve(MIGRATIONS_DIR, MIGRATION);
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261123200000_calendar_feed/migration.sql");
const AT = "2026-11-23T12:00:00.000Z";

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

function seed(db: DatabaseSync.Database) {
  db.prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES ('u1', 'u1@example.com', 'u1', ?, ?)`).run(AT, AT);
  db.prepare(`INSERT INTO "MealPlan" ("id", "ownerId", "updatedAt") VALUES ('p1', 'u1', ?)`).run(AT);
}

describe("migration 0048 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0048 - calendar feed links", () => {
  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql(MIGRATION, readFileSync(ROOT_MIGRATION, "utf8"))).not.toThrow();
  });

  it("rolls back with the DROP TABLE its header names, leaving the schema as it was", () => {
    const db = migratedDatabase();
    db.exec(`DROP TABLE "CalendarFeed";`);
    expect(schema(db)).toEqual(schema(migratedDatabase(MIGRATION)));
  });

  it("gives a plan one link, and a token hash to one plan", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(`INSERT INTO "CalendarFeed" ("mealPlanId", "tokenHash") VALUES ('p1', 'h1')`).run();
    expect(() => db.prepare(`INSERT INTO "CalendarFeed" ("mealPlanId", "tokenHash") VALUES ('p1', 'h2')`).run()).toThrow(/UNIQUE constraint failed/);
    expect(() => db.prepare(`INSERT INTO "CalendarFeed" ("mealPlanId", "tokenHash") VALUES ('missing', 'h3')`).run()).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("removes the link with its plan", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(`INSERT INTO "CalendarFeed" ("mealPlanId", "tokenHash") VALUES ('p1', 'h1')`).run();
    db.prepare(`DELETE FROM "User" WHERE "id" = 'u1'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "CalendarFeed"`).get()).toEqual({ n: 0 });
  });
});
