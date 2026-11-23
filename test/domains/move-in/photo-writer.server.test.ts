// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachMovedInPhoto, hasMovedInPhoto, MOVED_IN_PHOTO_MAX_BYTES } from "~/domains/move-in/adapters/storage/photo-writer.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");
// The first bytes of a WebP file: RIFF, a size, then WEBP.
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

function bucket() {
  const puts: Array<{ key: string; bytes: unknown; contentType: unknown }> = [];
  return {
    puts,
    put: async (key: string, bytes: unknown, options?: { httpMetadata?: { contentType?: string } }) => {
      puts.push({ key, bytes, contentType: options?.httpMetadata?.contentType });
      return null;
    },
  };
}

function recipe() {
  return database.sqlite.prepare(`SELECT "activeCoverId", "activeCoverVariant", "coverMode" FROM "Recipe" WHERE "id" = 'recipe-1'`).get() as Record<string, unknown>;
}

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'chef@example.com', 'chef')`).run();
  database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('recipe-1', 'Pancakes', 'chef-1')`).run();
});

afterEach(() => database.close());

describe("attachMovedInPhoto", () => {
  it("stores the photo and makes it the recipe's cover", async () => {
    const photos = bucket();
    await attachMovedInPhoto({ db: database.binding, bucket: photos, ownerId: "chef-1", recipeId: "recipe-1", bytes: webp, now });
    expect(photos.puts).toEqual([{ key: expect.stringMatching(/^covers\/import\/movein-1795435200000-[0-9a-f-]{36}\.webp$/), bytes: webp, contentType: "image/webp" }]);
    const covers = database.sqlite.prepare(`SELECT * FROM "RecipeCover"`).all() as Array<Record<string, unknown>>;
    expect(covers).toEqual([expect.objectContaining({
      recipeId: "recipe-1",
      imageUrl: `/photos/${photos.puts[0].key}`,
      sourceType: "import",
      status: "ready",
      generationStatus: "none",
      createdById: "chef-1",
    })]);
    expect(recipe()).toEqual({ activeCoverId: covers[0].id, activeCoverVariant: "image", coverMode: "auto" });
  });

  it("marks the recipe changed, so the phone app fetches its new cover", async () => {
    database.sqlite.prepare(`UPDATE "Recipe" SET "updatedAt" = '2026-01-01T00:00:00.000Z' WHERE "id" = 'recipe-1'`).run();
    await attachMovedInPhoto({ db: database.binding, bucket: bucket(), ownerId: "chef-1", recipeId: "recipe-1", bytes: webp, now });
    expect(database.sqlite.prepare(`SELECT "updatedAt" FROM "Recipe" WHERE "id" = 'recipe-1'`).get()).toEqual({ updatedAt: "2026-11-23T12:00:00.000Z" });
  });

  it("knows whether a recipe already has a photo that moved in", async () => {
    expect(await hasMovedInPhoto(database.binding, "recipe-1")).toBe(false);
    await attachMovedInPhoto({ db: database.binding, bucket: bucket(), ownerId: "chef-1", recipeId: "recipe-1", bytes: webp, now });
    expect(await hasMovedInPhoto(database.binding, "recipe-1")).toBe(true);
  });

  it("keeps a cover the chef already chose", async () => {
    database.sqlite.prepare(`UPDATE "Recipe" SET "coverMode" = 'none' WHERE "id" = 'recipe-1'`).run();
    await attachMovedInPhoto({ db: database.binding, bucket: bucket(), ownerId: "chef-1", recipeId: "recipe-1", bytes: webp, now });
    expect(recipe()).toEqual({ activeCoverId: null, activeCoverVariant: null, coverMode: "none" });
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "RecipeCover"`).get()).toEqual({ n: 1 });
  });

  it("refuses a file that isn't a WebP image, and stores nothing", async () => {
    const photos = bucket();
    await expect(attachMovedInPhoto({ db: database.binding, bucket: photos, ownerId: "chef-1", recipeId: "recipe-1", bytes: new Uint8Array([1, 2, 3]), now }))
      .rejects.toThrow("it isn't a WebP image");
    expect(photos.puts).toEqual([]);
  });

  it("refuses a photo larger than a recipe photo can be", async () => {
    const big = new Uint8Array(MOVED_IN_PHOTO_MAX_BYTES + 1);
    big.set(webp);
    await expect(attachMovedInPhoto({ db: database.binding, bucket: bucket(), ownerId: "chef-1", recipeId: "recipe-1", bytes: big, now }))
      .rejects.toThrow("it is larger than 10 MB");
  });
});
