import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";
import { readChefProfileFromD1 } from "~/lib/chef-profile-reads.server";

const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");
const MIGRATION = "0032_recipe_chef_keyset_index.sql";
const ROOT_MIGRATION = resolve(MIGRATIONS_DIR, MIGRATION);
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20261009180000_recipe_chef_keyset_index/migration.sql",
);

/** A database with every root D1 migration applied in order, optionally stopping before one. */
function migratedDatabase(before?: string) {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    if (before && file >= before) break;
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** The SQL and bound values of the profile's recipe page query, as the D1 reader sends them. */
async function recipePageQuery(recipeAfter: string | null) {
  const sent: Array<{ sql: string; values: unknown[] }> = [];
  const recorder = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
    batch: async (statements: Array<{ sql: string; values: unknown[] }>) => {
      sent.push(...statements);
      return statements.map(() => ({ results: [] }));
    },
  };
  await readChefProfileFromD1(recorder as never, { identifier: "chef", recipeLimit: 25, recipeAfter });
  const page = sent.find(({ sql }) => /FROM "Recipe" r\b/.test(sql) && /ORDER BY r\."updatedAt" DESC, r\."id" DESC/.test(sql));
  expect(page, "the reader's recipe page query").toBeDefined();
  return page!;
}

function plan(db: DatabaseSync.Database, query: { sql: string; values: unknown[] }): string[] {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values) as Array<{ detail: string }>;
  return rows.map((row) => row.detail);
}

describe("migration 0032 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0032 - chef recipe keyset index", () => {
  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql(MIGRATION, readFileSync(ROOT_MIGRATION, "utf8"))).not.toThrow();
  });

  it("lets the profile's recipe pages read in index order instead of sorting", async () => {
    for (const recipeAfter of [null, "cursor-recipe"]) {
      const query = await recipePageQuery(recipeAfter);

      // Before the index, the id tiebreak was sorted in a temporary B-tree.
      const without = plan(migratedDatabase(MIGRATION), query);
      expect(without.join("\n")).toMatch(/TEMP B-TREE/);

      const withIndex = plan(migratedDatabase(), query);
      expect(withIndex.join("\n"), `plan with recipeAfter=${recipeAfter}`).not.toMatch(/TEMP B-TREE/);
      expect(withIndex.some((detail) => /^SEARCH r USING INDEX Recipe_chefId_deletedAt_updatedAt_id_idx \(chefId=\? AND deletedAt=\?/.test(detail)), withIndex.join("\n")).toBe(true);
    }
  });
});
