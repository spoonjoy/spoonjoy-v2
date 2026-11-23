// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0040 (move-in)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0040_move_in.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261123120000_move_in/migration.sql")).toBe(withoutComments);
  });

  it("deletes a person's move-ins with their account", () => {
    const database = migratedSqliteD1();
    const run = (sql: string) => database.sqlite.prepare(sql).run();
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef', 'chef@example.com', 'chef')`);
    run(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source', 'chef', 'mealie-backup', 'g', 'Home')`);
    run(`INSERT INTO "ImportJob" ("id", "ownerId", "kind", "sourceId") VALUES ('job', 'chef', 'mealie-backup', 'source')`);
    run(`INSERT INTO "ImportJob" ("id", "ownerId", "kind") VALUES ('upload', 'chef', 'mealie-backup')`);
    run(`INSERT INTO "ImportEntityCount" ("jobId", "entity", "found") VALUES ('job', 'recipes', 3)`);
    run(`INSERT INTO "ImportEvent" ("id", "jobId", "seq", "level", "kind", "message") VALUES ('event', 'job', 1, 'info', 'job-done', 'Done')`);
    run(`INSERT INTO "SourceRecord" ("id", "sourceId", "sourceTable", "sourceKey", "targetType", "targetId", "lastJobId")
      VALUES ('record', 'source', 'recipes', 'r', 'Recipe', 'x', 'job')`);
    run(`DELETE FROM "User" WHERE "id" = 'chef'`);
    for (const table of ["ImportSource", "ImportJob", "ImportEntityCount", "ImportEvent", "SourceRecord"]) {
      expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get(), table).toEqual({ n: 0 });
    }
    database.close();
  });
});
