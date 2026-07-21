import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;


const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0008_s1_spoon_foundation.sql",
);

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface RecipeCoverRow {
  id: string;
  recipeId: string;
  imageUrl: string;
  stylizedImageUrl: string | null;
  sourceType: string;
  sourceSpoonId: string | null;
}

function seededDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "Recipe" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "imageUrl" TEXT NOT NULL DEFAULT '',
      "servings" TEXT,
      "chefId" TEXT NOT NULL,
      "deletedAt" DATETIME,
      "sourceRecipeId" TEXT,
      "sourceUrl" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Recipe_chefId_fkey" FOREIGN KEY ("chefId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Recipe_sourceRecipeId_fkey" FOREIGN KEY ("sourceRecipeId") REFERENCES "Recipe" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
    );

    CREATE UNIQUE INDEX "Recipe_chefId_title_deletedAt_key" ON "Recipe"("chefId","title","deletedAt");
    CREATE INDEX "Recipe_chefId_idx" ON "Recipe"("chefId");
    CREATE INDEX "Recipe_sourceRecipeId_idx" ON "Recipe"("sourceRecipeId");
  `);

  db.exec(`
    INSERT INTO "User"("id","email","username") VALUES ('u1','u1@test.dev','u1');
  `);

  db.prepare(
    `INSERT INTO "Recipe"("id","title","chefId","imageUrl","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
  ).run(
    "r1",
    "legacy default",
    "u1",
    "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/clbe7wr180009tkhggghtl1qd.png",
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
  db.prepare(
    `INSERT INTO "Recipe"("id","title","chefId","imageUrl","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
  ).run(
    "r2",
    "custom upload",
    "u1",
    "https://example.com/custom.jpg",
    "2026-01-02T00:00:00Z",
    "2026-01-02T00:00:00Z",
  );
  db.prepare(
    `INSERT INTO "Recipe"("id","title","chefId","imageUrl","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
  ).run(
    "r3",
    "r2-stored",
    "u1",
    "/photos/recipes/uid/rid/123.jpg",
    "2026-01-03T00:00:00Z",
    "2026-01-03T00:00:00Z",
  );
  db.prepare(
    `INSERT INTO "Recipe"("id","title","chefId","imageUrl","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
  ).run(
    "r4",
    "legacy token substring",
    "u1",
    "https://random.com/clbe7wr180009tkhggghtl1qd.png?qs=1",
    "2026-01-04T00:00:00Z",
    "2026-01-04T00:00:00Z",
  );
  db.prepare(
    `INSERT INTO "Recipe"("id","title","chefId","imageUrl","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
  ).run(
    "r5",
    "empty string",
    "u1",
    "",
    "2026-01-05T00:00:00Z",
    "2026-01-05T00:00:00Z",
  );

  return db;
}

describe("migration 0008 — backfill and drop imageUrl", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    db = seededDb();
    db.exec(sql);
  });

  it("creates RecipeCover rows only for non-default, non-empty imageUrls", () => {
    const rows = db
      .prepare(
        `SELECT id, recipeId, imageUrl, stylizedImageUrl, sourceType, sourceSpoonId FROM "RecipeCover" ORDER BY recipeId`,
      )
      .all() as unknown as RecipeCoverRow[];
    expect(rows).toHaveLength(2);
    const byRecipe = Object.fromEntries(rows.map((r) => [r.recipeId, r]));
    expect(byRecipe.r1).toBeUndefined();
    expect(byRecipe.r4).toBeUndefined();
    expect(byRecipe.r5).toBeUndefined();
    expect(byRecipe.r2).toMatchObject({
      recipeId: "r2",
      imageUrl: "https://example.com/custom.jpg",
      sourceType: "chef-upload",
      stylizedImageUrl: null,
      sourceSpoonId: null,
    });
    expect(byRecipe.r3).toMatchObject({
      recipeId: "r3",
      imageUrl: "/photos/recipes/uid/rid/123.jpg",
      sourceType: "chef-upload",
      stylizedImageUrl: null,
      sourceSpoonId: null,
    });
  });

  it("drops the Recipe.imageUrl column", () => {
    const rows = db
      .prepare(`PRAGMA table_info("Recipe")`)
      .all() as unknown as TableInfoRow[];
    const names = rows.map((r) => r.name);
    expect(names).not.toContain("imageUrl");
    // The remaining Recipe columns must still be present.
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "description",
        "servings",
        "chefId",
        "deletedAt",
        "sourceRecipeId",
        "sourceUrl",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("preserves Recipe rows and their indexes after the column drop", () => {
    const recipes = db
      .prepare(`SELECT id, title FROM "Recipe" ORDER BY id`)
      .all() as unknown as { id: string; title: string }[];
    expect(recipes.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);

    const indexNames = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Recipe' AND sql IS NOT NULL`,
        )
        .all() as unknown as { name: string }[]
    ).map((r) => r.name);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        "Recipe_chefId_title_deletedAt_key",
        "Recipe_chefId_idx",
        "Recipe_sourceRecipeId_idx",
      ]),
    );
  });
});
