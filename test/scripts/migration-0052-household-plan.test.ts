// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");
const MIGRATION = "0052_household_plan.sql";
const ROOT_MIGRATION = resolve(MIGRATIONS_DIR, MIGRATION);
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261124100000_household_plan/migration.sql");
const AT = "2026-11-24T12:00:00.000Z";

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

/** A cook with their own plan and entry, a household and its plan with one entry by that cook. */
function seed(db: DatabaseSync.Database) {
  db.prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES ('u1', 'u1@example.com', 'u1', ?, ?)`).run(AT, AT);
  db.prepare(`INSERT INTO "MealPlan" ("id", "ownerId", "updatedAt") VALUES ('p1', 'u1', ?)`).run(AT);
  db.prepare(`INSERT INTO "PlanEntry" ("id", "mealPlanId", "date", "mealType", "kind", "title") VALUES ('own', 'p1', '2026-11-24', 'dinner', 'note', 'Mine')`).run();
  db.prepare(`INSERT INTO "Household" ("id", "name") VALUES ('h1', 'Our kitchen')`).run();
  db.prepare(`INSERT INTO "HouseholdPlan" ("id", "householdId") VALUES ('hp1', 'h1')`).run();
  db.prepare(`INSERT INTO "HouseholdPlanEntry" ("id", "householdPlanId", "date", "mealType", "kind", "title", "addedById") VALUES ('shared', 'hp1', '2026-11-24', 'dinner', 'note', 'Ours', 'u1')`).run();
}

const count = (db: DatabaseSync.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

describe("migration 0052 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0052 - household plan", () => {
  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql(MIGRATION, readFileSync(ROOT_MIGRATION, "utf8"))).not.toThrow();
  });

  it("rolls back with the DROP TABLEs its header names, leaving the schema as it was", () => {
    const db = migratedDatabase();
    db.exec(`DROP TABLE "HouseholdPlanEntry"; DROP TABLE "HouseholdPlan";`);
    expect(schema(db)).toEqual(schema(migratedDatabase(MIGRATION)));
  });

  it("gives a household one plan, with an entry shaped like a cook's", () => {
    const db = migratedDatabase();
    seed(db);
    expect(() => db.prepare(`INSERT INTO "HouseholdPlan" ("id", "householdId") VALUES ('hp2', 'h1')`).run()).toThrow(/UNIQUE constraint failed/);
    expect(() => db.prepare(`INSERT INTO "HouseholdPlan" ("id", "householdId") VALUES ('hp3', 'missing')`).run()).toThrow(/FOREIGN KEY constraint failed/);
    expect(db.prepare(`SELECT "firstDayOfWeek", "timeZone" FROM "HouseholdPlan"`).get()).toEqual({ firstDayOfWeek: 1, timeZone: "UTC" });
    const columns = (table: string) => (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[])
      .map(({ name, type, notnull, dflt_value }) => ({ name: name === "householdPlanId" ? "planId" : name === "mealPlanId" ? "planId" : name, type, notnull, dflt_value }));
    expect(columns("HouseholdPlanEntry")).toEqual(columns("PlanEntry"));
  });

  it("removes a household's plan and entries with the household, keeps the cook's own, and keeps an entry whose cook leaves", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(`DELETE FROM "User" WHERE "id" = 'u1'`).run();
    expect(db.prepare(`SELECT "addedById" FROM "HouseholdPlanEntry"`).get()).toEqual({ addedById: null });
    db.prepare(`DELETE FROM "Household" WHERE "id" = 'h1'`).run();
    expect([count(db, "HouseholdPlan"), count(db, "HouseholdPlanEntry")]).toEqual([0, 0]);
  });

  it("leaves cooks' plans alone", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(`DELETE FROM "Household" WHERE "id" = 'h1'`).run();
    expect([count(db, "MealPlan"), count(db, "PlanEntry")]).toEqual([1, 1]);
  });
});
