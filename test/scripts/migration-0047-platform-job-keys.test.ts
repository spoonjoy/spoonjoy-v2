// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0047 (platform job keys)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0047_platform_job_keys.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261123210000_platform_job_keys/migration.sql")).toBe(withoutComments);
  });

  it("holds one row per job key, pending until it is done", () => {
    const database = migratedSqliteD1();
    const run = (sql: string) => database.sqlite.prepare(sql).run();
    run(`INSERT INTO "PlatformJobKey" ("key", "type") VALUES ('move-in:job-1', 'move-in.run')`);
    expect(() => run(`INSERT INTO "PlatformJobKey" ("key", "type") VALUES ('move-in:job-1', 'move-in.run')`)).toThrow(/UNIQUE/);
    expect(database.sqlite.prepare(`SELECT "status" FROM "PlatformJobKey"`).get()).toEqual({ status: "pending" });
    database.close();
  });
});
