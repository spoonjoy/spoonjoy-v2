// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D1 applies migrations/ in filename order and records each by name. Two pull requests can each
// add the next number without a git conflict, because their filenames differ; if both merge, the
// same number appears twice and the order between them is accidental. Branch protection makes
// the second pull request update from main and re-run this test, so it must take the next number.

const migrationsDir = join(process.cwd(), "migrations");

// Already applied in production under these names. D1 records a migration by its filename, so
// renaming any of them would run it again; these historical pairs stay, and no other may join them.
const APPLIED_DUPLICATES = new Set([
  "0020_native_push_devices.sql",
  "0020_recipe_box_indexes.sql",
  "0031_image_gen_daily_budget.sql",
  "0031_oauth_token_expiry.sql",
]);

// The email verification and image generation budget mirror folders share one timestamp; they
// merged before this check existed and stay as they are.
const SHARED_MIRROR_STAMPS = new Set(["20261009060000"]);

function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
}

describe("D1 migration numbering", () => {
  it("names every migration NNNN_snake_case.sql", () => {
    for (const name of migrationFiles()) expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it("never uses a number twice", () => {
    const seen = new Map<string, string[]>();
    for (const name of migrationFiles().filter((file) => !APPLIED_DUPLICATES.has(file))) {
      const number = name.slice(0, 4);
      seen.set(number, [...(seen.get(number) ?? []), name]);
    }
    const duplicates = [...seen.values()].filter((names) => names.length > 1);
    expect(duplicates, "take the next free number for the migration that merged second").toEqual([]);
  });

  it("never gives two Prisma mirror folders the same timestamp", () => {
    const folders = readdirSync(join(process.cwd(), "prisma", "migrations")).filter((name) => /^\d{14}_/.test(name));
    const stamps = folders.map((name) => name.slice(0, 14)).filter((stamp) => !SHARED_MIRROR_STAMPS.has(stamp));
    const repeated = stamps.filter((stamp, index) => stamps.indexOf(stamp) !== index);
    expect(repeated, "give the mirror folder that merged second a later timestamp").toEqual([]);
  });

  it("keeps the historical duplicate pairs exactly as applied", () => {
    for (const name of APPLIED_DUPLICATES) expect(migrationFiles()).toContain(name);
    const folders = readdirSync(join(process.cwd(), "prisma", "migrations"));
    for (const stamp of SHARED_MIRROR_STAMPS) {
      expect(folders.filter((name) => name.startsWith(`${stamp}_`)).length).toBeGreaterThan(1);
    }
  });
});
