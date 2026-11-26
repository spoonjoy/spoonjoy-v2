// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachMovedInPhoto, attachMovedInPhotos, hasMovedInPhoto, MOVED_IN_PHOTO_MAX_BYTES, MOVED_IN_PHOTO_PUTS_AT_ONCE } from "~/domains/move-in/adapters/storage/photo-writer.server";
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

  it("keeps a JPEG or PNG as it is, as another Spoonjoy stores a cook's upload", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const photos = bucket();
    await attachMovedInPhoto({ db: database.binding, bucket: photos, ownerId: "chef-1", recipeId: "recipe-1", bytes: jpeg, now });
    await attachMovedInPhoto({ db: database.binding, bucket: photos, ownerId: "chef-1", recipeId: "recipe-1", bytes: png, now });
    expect(photos.puts).toEqual([
      { key: expect.stringMatching(/^covers\/import\/movein-\d+-[0-9a-f-]{36}\.jpg$/), bytes: jpeg, contentType: "image/jpeg" },
      { key: expect.stringMatching(/^covers\/import\/movein-\d+-[0-9a-f-]{36}\.png$/), bytes: png, contentType: "image/png" },
    ]);
  });

  it("refuses a file that isn't a WebP, JPEG or PNG image, a GIF included, and stores nothing", async () => {
    const photos = bucket();
    for (const bytes of [new Uint8Array([1, 2, 3]), new TextEncoder().encode("GIF89a...")]) {
      await expect(attachMovedInPhoto({ db: database.binding, bucket: photos, ownerId: "chef-1", recipeId: "recipe-1", bytes, now }))
        .rejects.toThrow("it isn't a WebP, JPEG or PNG image");
    }
    expect(photos.puts).toEqual([]);
  });

  it("refuses a photo larger than a recipe photo can be", async () => {
    const big = new Uint8Array(MOVED_IN_PHOTO_MAX_BYTES + 1);
    big.set(webp);
    await expect(attachMovedInPhoto({ db: database.binding, bucket: bucket(), ownerId: "chef-1", recipeId: "recipe-1", bytes: big, now }))
      .rejects.toThrow("it is larger than 10 MB");
  });
});

describe("attachMovedInPhotos", () => {
  beforeEach(() => {
    for (let n = 2; n <= 9; n++) database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES (?, ?, 'chef-1')`).run(`recipe-${n}`, `Dish ${n}`);
  });

  /** A bucket whose puts take a moment, counting how many run at once; `refuse` names puts that fail. */
  function slowBucket(refuse: (bytes: Uint8Array) => boolean = () => false) {
    let running = 0;
    let most = 0;
    const keys: string[] = [];
    return {
      keys,
      most: () => most,
      put: async (key: string, bytes: Uint8Array) => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running--;
        if (refuse(bytes)) throw new Error("R2 refused it");
        keys.push(key);
        return null;
      },
    };
  }
  /** The binding, counting each round trip to the database. */
  function counted() {
    const binding = database.binding;
    let trips = 0;
    return { db: { prepare: binding.prepare.bind(binding), batch: (statements: Parameters<typeof binding.batch>[0]) => (trips++, binding.batch(statements)) }, trips: () => trips };
  }
  const inputs = (db: unknown, photos: unknown, bytes: Array<Uint8Array | Error>, read = async (photo: Uint8Array | Error) => photo) =>
    bytes.map((photo, i) => ({ db: db as typeof database.binding, bucket: photos as never, ownerId: "chef-1", recipeId: `recipe-${i + 1}`, read: () => read(photo), now }));

  it("stores a chunk's photos a few at a time and writes all their covers in one round trip", async () => {
    const photos = slowBucket();
    const { db, trips } = counted();
    expect(await attachMovedInPhotos(inputs(db, photos, Array.from({ length: 9 }, () => webp)))).toEqual(Array(9).fill(null));
    expect(photos.keys).toHaveLength(9);
    expect(photos.most()).toBe(MOVED_IN_PHOTO_PUTS_AT_ONCE);
    expect(trips()).toBe(1);
    const covered = database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "Recipe" WHERE "activeCoverId" IS NOT NULL`).get();
    expect(covered).toEqual({ n: 9 });
  });

  it("reads only as many photos at once as it stores, so a chunk never holds all its photos", async () => {
    let held = 0;
    let most = 0;
    const photos = { put: async () => (await new Promise((resolve) => setTimeout(resolve, 2)), held--, null) };
    const read = async (photo: Uint8Array | Error) => (most = Math.max(most, ++held), photo);
    await attachMovedInPhotos(inputs(database.binding, photos, Array.from({ length: 9 }, () => webp), read));
    expect(most).toBe(MOVED_IN_PHOTO_PUTS_AT_ONCE);
  });

  it("answers why for each photo kept out, and puts the rest on their recipes", async () => {
    const refused = new Uint8Array([...webp, 9]);
    const photos = slowBucket((bytes) => bytes === refused);
    const answers = await attachMovedInPhotos(inputs(database.binding, photos, [webp, new Uint8Array([1, 2, 3]), refused, new Error("the photo in the backup is damaged")]));
    expect(answers.map((answer) => answer?.message ?? null)).toEqual([null, "it isn't a WebP, JPEG or PNG image", "R2 refused it", "the photo in the backup is damaged"]);
    expect(database.sqlite.prepare(`SELECT "recipeId" FROM "RecipeCover"`).all()).toEqual([{ recipeId: "recipe-1" }]);
  });

  it("answers for a put that throws something other than an error", async () => {
    const photos = { put: async () => Promise.reject("no") };
    expect((await attachMovedInPhotos(inputs(database.binding, photos, [webp])))[0]?.message).toBe("no");
  });

  it("writes nothing when no photo could be stored", async () => {
    const { db, trips } = counted();
    expect((await attachMovedInPhotos(inputs(db, slowBucket(), [new Uint8Array([1])])))[0]).toBeInstanceOf(Error);
    expect(trips()).toBe(0);
  });

  it("passes an error in the cover write on, with none of the chunk's covers written", async () => {
    const db = { prepare: database.binding.prepare.bind(database.binding), batch: async () => Promise.reject(new Error("D1 is down")) };
    await expect(attachMovedInPhotos(inputs(db, slowBucket(), [webp, webp]))).rejects.toThrow("D1 is down");
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "RecipeCover"`).get()).toEqual({ n: 0 });
  });

  it("passes on an error a read throws, with none of the chunk's covers written", async () => {
    const read = async (photo: Uint8Array | Error) => (photo instanceof Error ? Promise.reject(photo) : photo);
    await expect(attachMovedInPhotos(inputs(database.binding, slowBucket(), [webp, new Error("the server is down")], read))).rejects.toThrow("the server is down");
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "RecipeCover"`).get()).toEqual({ n: 0 });
  });

  it("does nothing for no photos", async () => {
    expect(await attachMovedInPhotos([])).toEqual([]);
  });
});
