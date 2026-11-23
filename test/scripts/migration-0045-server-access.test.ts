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
  for (const name of ["ann", "ben"]) {
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('${name}', '${name}@example.com', '${name}')`);
  }
  run(`INSERT INTO "ServerInvite" ("id", "tokenHash", "createdById", "expiresAt", "usedAt", "usedById") VALUES ('i1', 'hash', 'ann', '2026-12-01T00:00:00Z', '2026-11-23T00:00:00Z', 'ben')`);
});

afterEach(() => database.close());

describe("migration 0045 (server access)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0045_server_access.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261123180000_server_access/migration.sql")).toBe(withoutComments);
  });

  it("keeps one row per setting, so a second admin claim is ignored", () => {
    run(`INSERT OR IGNORE INTO "ServerSetting" ("key", "value") VALUES ('admin', 'ann')`);
    run(`INSERT OR IGNORE INTO "ServerSetting" ("key", "value") VALUES ('admin', 'ben')`);
    expect(rows(`SELECT * FROM "ServerSetting"`)).toEqual([{ key: "admin", value: "ann" }]);
  });

  it("keeps a used invite when its user's account goes, and drops an invite with its maker's", () => {
    run(`DELETE FROM "User" WHERE "id" = 'ben'`);
    expect(rows(`SELECT "id", "usedById" FROM "ServerInvite"`)).toEqual([{ id: "i1", usedById: null }]);
    run(`DELETE FROM "User" WHERE "id" = 'ann'`);
    expect(rows(`SELECT "id" FROM "ServerInvite"`)).toEqual([]);
  });

  it("refuses two invites with the same token hash", () => {
    expect(() =>
      run(`INSERT INTO "ServerInvite" ("id", "tokenHash", "createdById", "expiresAt") VALUES ('i2', 'hash', 'ann', '2026-12-01T00:00:00Z')`),
    ).toThrow(/UNIQUE/);
  });
});
