import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");
const MIGRATION = "0043_meal_plan.sql";
const ROOT_MIGRATION = resolve(MIGRATIONS_DIR, MIGRATION);
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261123160000_meal_plan/migration.sql");
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
  for (const id of ["u1", "u2"]) {
    db.prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`).run(id, `${id}@example.com`, id, AT, AT);
  }
  db.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt") VALUES ('r1', 'Soup', 'u2', ?, ?)`).run(AT, AT);
  db.prepare(`INSERT INTO "MealPlan" ("id", "ownerId", "updatedAt") VALUES ('p1', 'u1', ?)`).run(AT);
}

const insertEntry = `INSERT INTO "PlanEntry" ("id", "mealPlanId", "date", "mealType", "kind", "recipeId", "recipeTitle", "title", "addedById", "sourceSystem", "sourceId", "updatedAt") VALUES (?, 'p1', '2026-11-23', 'dinner', ?, ?, ?, ?, ?, ?, ?, ?)`;

describe("migration 0043 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0043 - meal plan", () => {
  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql(MIGRATION, readFileSync(ROOT_MIGRATION, "utf8"))).not.toThrow();
  });

  it("rolls back with the DROP TABLEs its header names, leaving the schema as it was", () => {
    const db = migratedDatabase();
    db.exec(`DROP TABLE "PlanEntry"; DROP TABLE "MealPlan";`);
    expect(schema(db)).toEqual(schema(migratedDatabase(MIGRATION)));
  });

  it("gives each cook one plan, with weeks starting Monday by default", () => {
    const db = migratedDatabase();
    seed(db);
    expect(db.prepare(`SELECT "firstDayOfWeek", "timeZone", "householdId" FROM "MealPlan"`).get()).toEqual({ firstDayOfWeek: 1, timeZone: "UTC", householdId: null });
    expect(() => db.prepare(`INSERT INTO "MealPlan" ("id", "ownerId", "updatedAt") VALUES ('p2', 'u1', ?)`).run(AT)).toThrow(/UNIQUE constraint failed/);
  });

  it("defaults an entry to a one-day plan at the recipe's own size", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(insertEntry).run("e1", "note", null, null, "Out", null, null, null, AT);
    expect(db.prepare(`SELECT "span", "position", "scaleFactor", "note", "deletedAt" FROM "PlanEntry"`).get()).toEqual({ span: "day", position: 0, scaleFactor: 1, note: "", deletedAt: null });
  });

  it("keeps an entry readable when its recipe or the cook who added it goes, and moves in each source row once", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(insertEntry).run("e1", "recipe", "r1", "Soup", "", "u2", "other-app", "g:1", AT);
    expect(() => db.prepare(insertEntry).run("e2", "recipe", "r1", "Soup", "", "u2", "other-app", "g:1", AT)).toThrow(/UNIQUE constraint failed/);
    db.prepare(insertEntry).run("e3", "note", null, null, "Out", null, null, null, AT);
    db.prepare(insertEntry).run("e4", "note", null, null, "Out", null, null, null, AT);
    expect(() => db.prepare(insertEntry).run("e5", "recipe", "missing", "Soup", "", null, null, null, AT)).toThrow(/FOREIGN KEY constraint failed/);

    db.prepare(`DELETE FROM "Recipe" WHERE "id" = 'r1'`).run();
    db.prepare(`DELETE FROM "User" WHERE "id" = 'u2'`).run();
    expect(db.prepare(`SELECT "recipeId", "recipeTitle", "addedById" FROM "PlanEntry" WHERE "id" = 'e1'`).get()).toEqual({ recipeId: null, recipeTitle: "Soup", addedById: null });
  });

  it("removes the plan and its entries with its owner", () => {
    const db = migratedDatabase();
    seed(db);
    db.prepare(insertEntry).run("e1", "note", null, null, "Out", null, null, null, AT);
    db.prepare(`DELETE FROM "User" WHERE "id" = 'u1'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "MealPlan"`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "PlanEntry"`).get()).toEqual({ n: 0 });
  });
});
