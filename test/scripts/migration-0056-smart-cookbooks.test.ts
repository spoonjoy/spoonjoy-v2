// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0056 (smart cookbooks)", () => {
  it("mirrors the D1 migration in Prisma's folder, and only adds", () => {
    const sql = migration("migrations/0056_smart_cookbooks.sql");
    expect(migration("prisma/migrations/20261125010000_smart_cookbooks/migration.sql")).toBe(sql);
    expect(() => assertAdditiveMigrationSql("0056_smart_cookbooks.sql", sql)).not.toThrow();
  });

  it("keeps titles unique per cook and each rule once per side, keeps a deleted organizer's rules, and deletes a cook's cookbooks and rules with them", () => {
    const database = migratedSqliteD1();
    const run = (sql: string) => database.sqlite.prepare(sql).run();
    const count = (table: string) => database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get();
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`);
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-2', 'other@example.com', 'other')`);
    run(`INSERT INTO "Organizer" ("id", "ownerId", "kind", "name", "slug") VALUES ('o1', 'chef-1', 'tag', 'Quick', 'quick')`);
    run(`INSERT INTO "SmartCookbook" ("id", "ownerId", "title") VALUES ('s1', 'chef-1', 'Quick')`);
    expect(() => run(`INSERT INTO "SmartCookbook" ("id", "ownerId", "title") VALUES ('s2', 'chef-1', 'Quick')`)).toThrow(/UNIQUE/);
    run(`INSERT INTO "SmartCookbook" ("id", "ownerId", "title") VALUES ('s3', 'chef-2', 'Quick')`);
    run(`INSERT INTO "SmartCookbookRule" ("cookbookId", "side", "organizerId", "position") VALUES ('s1', 'with', 'o1', 0)`);
    expect(() => run(`INSERT INTO "SmartCookbookRule" ("cookbookId", "side", "organizerId", "position") VALUES ('s1', 'with', 'o1', 1)`)).toThrow(/UNIQUE|PRIMARY/);
    run(`DELETE FROM "Organizer" WHERE "id" = 'o1'`);
    expect(count("SmartCookbookRule")).toEqual({ n: 1 });
    run(`DELETE FROM "User" WHERE "id" = 'chef-1'`);
    expect(count("SmartCookbookRule")).toEqual({ n: 0 });
    expect(count("SmartCookbook")).toEqual({ n: 1 });
    database.close();
  });
});
