// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0058 (sealed native push tokens)", () => {
  it("mirrors the D1 migration in Prisma's folder, and only adds", () => {
    const sql = migration("migrations/0058_native_push_sealed_token.sql");
    expect(migration("prisma/migrations/20261126180000_native_push_sealed_token/migration.sql")).toBe(sql);
    expect(() => assertAdditiveMigrationSql("0058_native_push_sealed_token.sql", sql)).not.toThrow();
  });

  it("leaves a device registered before it without a sealed token, and keeps one written after", () => {
    const database = migratedSqliteD1();
    const run = (sql: string) => database.sqlite.prepare(sql).run();
    const sealed = () => database.sqlite.prepare(`SELECT "deviceId", "sealedToken" FROM "NativePushDevice" ORDER BY "deviceId"`).all();
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`);
    run(`INSERT INTO "NativePushDevice" ("id", "userId", "deviceId", "platform", "environment", "tokenHash", "tokenPrefix")
      VALUES ('d1', 'chef-1', 'old-phone', 'ios', 'production', 'hash-1', 'prefix')`);
    run(`INSERT INTO "NativePushDevice" ("id", "userId", "deviceId", "platform", "environment", "tokenHash", "tokenPrefix", "sealedToken")
      VALUES ('d2', 'chef-1', 'new-phone', 'ios', 'production', 'hash-2', 'prefix', 'v1.iv.data')`);
    expect(sealed()).toEqual([
      { deviceId: "new-phone", sealedToken: "v1.iv.data" },
      { deviceId: "old-phone", sealedToken: null },
    ]);
    database.close();
  });
});
