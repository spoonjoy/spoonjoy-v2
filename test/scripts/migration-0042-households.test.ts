// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

let database: MigratedSqlite;
const run = (sql: string) => database.sqlite.prepare(sql).run();
const rows = (sql: string) => database.sqlite.prepare(sql).all();

beforeEach(() => {
  database = migratedSqliteD1();
  for (const name of ["ann", "ben", "cal"]) {
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('${name}', '${name}@example.com', '${name}')`);
  }
  run(`INSERT INTO "Household" ("id", "name", "createdById") VALUES ('h1', 'Home', 'ann')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role", "joinedAt") VALUES ('h1', 'ann', 'owner', '2026-01-01T00:00:00Z')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role", "joinedAt") VALUES ('h1', 'ben', 'member', '2026-01-02T00:00:00Z')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role", "joinedAt") VALUES ('h1', 'cal', 'viewer', '2026-01-03T00:00:00Z')`);
  run(`INSERT INTO "HouseholdInvite" ("id", "householdId", "createdById", "tokenHash", "expiresAt") VALUES ('i1', 'h1', 'ann', 'hash', '2026-12-01T00:00:00Z')`);
});

afterEach(() => database.close());

describe("migration 0042 (households)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0042_households.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261123150000_households/migration.sql")).toBe(withoutComments);
  });

  it("keeps an owner: when the last owner's account goes, the longest-standing member becomes owner", () => {
    run(`DELETE FROM "User" WHERE "id" = 'ann'`);
    expect(rows(`SELECT "userId", "role" FROM "HouseholdMember" ORDER BY "userId"`)).toEqual([
      { userId: "ben", role: "owner" },
      { userId: "cal", role: "viewer" },
    ]);
    expect(rows(`SELECT "id", "createdById" FROM "Household"`)).toEqual([{ id: "h1", createdById: null }]);
  });

  it("deletes a household, its invites and its members once nobody is left", () => {
    run(`DELETE FROM "User" WHERE "id" IN ('ben', 'cal')`);
    expect(rows(`SELECT "id" FROM "Household"`)).toEqual([{ id: "h1" }]);
    run(`DELETE FROM "HouseholdMember" WHERE "userId" = 'ann'`);
    for (const table of ["Household", "HouseholdMember", "HouseholdInvite"]) {
      expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get(), table).toEqual({ n: 0 });
    }
  });

  it("refuses a role it doesn't know and a second membership of the same household", () => {
    expect(() => run(`UPDATE "HouseholdMember" SET "role" = 'admin' WHERE "userId" = 'ben'`)).toThrow(/CHECK/);
    expect(() =>
      run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ben', 'member')`),
    ).toThrow(/UNIQUE/);
    expect(() =>
      run(`INSERT INTO "HouseholdInvite" ("id", "householdId", "createdById", "tokenHash", "role", "expiresAt") VALUES ('i2', 'h1', 'ann', 'other', 'owner', '2026-12-01T00:00:00Z')`),
    ).toThrow(/CHECK/);
  });
});
