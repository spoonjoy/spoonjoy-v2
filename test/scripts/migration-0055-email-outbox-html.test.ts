// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migratedSqliteD1 } from "../helpers/migrated-sqlite";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0055 (email outbox HTML)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0055_email_outbox_html.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261124150000_email_outbox_html/migration.sql")).toBe(withoutComments);
  });

  it("keeps a captured mail's HTML part beside its text, empty for older rows", () => {
    const database = migratedSqliteD1();
    const columns = database.sqlite.prepare(`PRAGMA table_info("EmailOutbox")`).all() as Array<{ name: string; notnull: number }>;
    expect(columns.find((column) => column.name === "htmlBody")).toMatchObject({ notnull: 0 });
    database.close();
  });
});
