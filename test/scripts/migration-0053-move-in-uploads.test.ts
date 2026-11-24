// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0053 (move-in uploads)", () => {
  it("mirrors the D1 migration in Prisma's folder, and only adds", () => {
    const sql = migration("migrations/0053_move_in_uploads.sql");
    expect(migration("prisma/migrations/20261124110000_move_in_uploads/migration.sql")).toBe(sql);
    expect(() => assertAdditiveMigrationSql("0053_move_in_uploads.sql", sql)).not.toThrow();
  });

  it("keeps one row per part, and deletes an account's uploads and their parts with it", () => {
    const database = migratedSqliteD1();
    const run = (sql: string) => database.sqlite.prepare(sql).run();
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`);
    run(`INSERT INTO "ImportUpload" ("id", "ownerId", "fingerprint", "archiveKey", "uploadId", "name", "size", "partSize") VALUES ('u1', 'chef-1', 'fp', 'k', 'r2', 'a.zip', 20, 10)`);
    run(`INSERT INTO "ImportUploadPart" ("uploadId", "partNumber", "etag", "size") VALUES ('u1', 1, 'e', 10)`);
    expect(() => run(`INSERT INTO "ImportUploadPart" ("uploadId", "partNumber", "etag", "size") VALUES ('u1', 1, 'e2', 10)`)).toThrow(/UNIQUE|PRIMARY/);
    expect(database.sqlite.prepare(`SELECT "jobId", "startedAt" IS NOT NULL AS started FROM "ImportUpload"`).get()).toEqual({ jobId: null, started: 1 });
    run(`DELETE FROM "User" WHERE "id" = 'chef-1'`);
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "ImportUploadPart"`).get()).toEqual({ n: 0 });
    database.close();
  });
});
