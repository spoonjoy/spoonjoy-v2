// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0050 (platform job key expiry)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0050_platform_job_key_expiry.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261123220000_platform_job_key_expiry/migration.sql")).toBe(withoutComments);
  });

  it("lets the expiry sweep find old done keys by the index, not by reading every key", () => {
    const database = migratedSqliteD1();
    const plan = database.sqlite
      .prepare(`EXPLAIN QUERY PLAN SELECT "key" FROM "PlatformJobKey" WHERE "status" = 'done' AND "updatedAt" < ? LIMIT 500`)
      .all("2026-10-24T12:00:00.000Z") as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join("\n")).toContain("PlatformJobKey_status_updatedAt_idx");
    database.close();
  });
});
