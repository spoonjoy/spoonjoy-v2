// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("migration 0046 (household lists)", () => {
  it("mirrors the D1 migration in Prisma's folder", () => {
    const withoutComments = migration("migrations/0046_household_lists.sql").split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(migration("prisma/migrations/20261123190000_household_lists/migration.sql")).toBe(withoutComments);
  });
});
