// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectLivePhotoKeys,
  isPhotoKeyLive,
  isServablePhotoKey,
  originalKeyOfVariant,
  PHOTO_QUARANTINE_RETENTION_MS,
  PHOTO_SWEEP_GRACE_MS,
  photoCleanupRequestStatement,
  photoKeyFromStoredUrl,
  photoSweepD1Database,
  resolvePhotoSweepMode,
  runPhotoSweep,
  runScheduledPhotoSweep,
  type PhotoHttpMetadata,
  type PhotoSweepBucket,
  type PhotoSweepDatabase,
} from "~/lib/photo-lifecycle.server";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-01T00:00:00.000Z");

interface StoredObject {
  bytes: Uint8Array;
  httpMetadata?: PhotoHttpMetadata;
  customMetadata?: Record<string, string>;
}

/** An in-memory R2 bucket that pages its listing two objects at a time. */
function memoryBucket(initial: Record<string, string> = {}) {
  const objects = new Map<string, StoredObject>();
  for (const [key, text] of Object.entries(initial)) {
    objects.set(key, { bytes: new TextEncoder().encode(text), httpMetadata: { contentType: "image/jpeg" } });
  }
  const bucket: PhotoSweepBucket & { objects: Map<string, StoredObject> } = {
    objects,
    list: vi.fn(async ({ cursor }: { cursor?: string }) => {
      const keys = [...objects.keys()].sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + 2);
      const next = start + 2;
      return {
        objects: page.map((key) => ({ key, size: objects.get(key)!.bytes.byteLength })),
        truncated: next < keys.length,
        cursor: next < keys.length ? String(next) : undefined,
      };
    }),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: new Response(object.bytes).body!,
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      };
    }),
    put: vi.fn(async (key: string, value: ReadableStream, options: { httpMetadata?: PhotoHttpMetadata; customMetadata?: Record<string, string> }) => {
      objects.set(key, {
        bytes: new Uint8Array(await new Response(value).arrayBuffer()),
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      });
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }),
  };
  return bucket;
}

let database: MigratedSqlite;
let db: PhotoSweepDatabase;

function insertUser(id: string, photoUrl: string | null = null) {
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username", "photoUrl") VALUES (?, ?, ?, ?)`)
    .run(id, `${id}@example.com`, id, photoUrl);
}

function insertRecipe(id: string, chefId: string, options: { deletedAt?: string; sourceRecipeId?: string } = {}) {
  database.sqlite.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId", "deletedAt", "sourceRecipeId") VALUES (?, ?, ?, ?, ?)`)
    .run(id, `Recipe ${id}`, chefId, options.deletedAt ?? null, options.sourceRecipeId ?? null);
}

function insertSpoon(id: string, chefId: string, recipeId: string, photoUrl: string, deletedAt: string | null = null) {
  database.sqlite.prepare(`INSERT INTO "RecipeSpoon" ("id", "chefId", "recipeId", "photoUrl", "deletedAt") VALUES (?, ?, ?, ?, ?)`)
    .run(id, chefId, recipeId, photoUrl, deletedAt);
}

function insertCover(
  id: string,
  recipeId: string,
  urls: { imageUrl: string; stylizedImageUrl?: string; sourceImageUrl?: string },
  options: { archivedAt?: string; status?: string } = {},
) {
  database.sqlite.prepare(
    `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceImageUrl", "sourceType", "status", "archivedAt")
     VALUES (?, ?, ?, ?, ?, 'upload', ?, ?)`,
  ).run(id, recipeId, urls.imageUrl, urls.stylizedImageUrl ?? null, urls.sourceImageUrl ?? null, options.status ?? "ready", options.archivedAt ?? null);
}

function cleanupRows() {
  return database.sqlite.prepare(`SELECT "key", "reason", "eligibleAt", "quarantinedAt", "purgedAt" FROM "PhotoCleanup" ORDER BY "key"`).all() as Array<{
    key: string;
    reason: string;
    eligibleAt: string;
    quarantinedAt: string | null;
    purgedAt: string | null;
  }>;
}

function at(offsetMs: number) {
  return () => new Date(T0.getTime() + offsetMs);
}

beforeEach(() => {
  database = migratedSqliteD1();
  db = photoSweepD1Database(database.binding as never);
});

afterEach(() => {
  database.close();
});

describe("photo lifecycle helpers", () => {
  it("runs a dry run for anything but an exact off or apply", () => {
    expect(resolvePhotoSweepMode(undefined)).toBe("dry-run");
    expect(resolvePhotoSweepMode(null)).toBe("dry-run");
    expect(resolvePhotoSweepMode("")).toBe("dry-run");
    expect(resolvePhotoSweepMode("applyy")).toBe("dry-run");
    expect(resolvePhotoSweepMode(" Apply ")).toBe("apply");
    expect(resolvePhotoSweepMode("off")).toBe("off");
  });

  it("reads keys only from stored /photos/ URLs", () => {
    expect(photoKeyFromStoredUrl(null)).toBeNull();
    expect(photoKeyFromStoredUrl(undefined)).toBeNull();
    expect(photoKeyFromStoredUrl("https://example.com/photos/a.jpg")).toBeNull();
    expect(photoKeyFromStoredUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(photoKeyFromStoredUrl("/photos/")).toBeNull();
    expect(photoKeyFromStoredUrl("/photos/recipes/u/1.jpg")).toBe("recipes/u/1.jpg");
    expect(photoKeyFromStoredUrl("/photos/recipes/u/1.jpg?w=512")).toBe("recipes/u/1.jpg");
    expect(photoKeyFromStoredUrl("/photos/recipes/u/1.jpg#top")).toBe("recipes/u/1.jpg");
  });

  it("never serves quarantined keys and recognises variant keys", () => {
    expect(isServablePhotoKey("recipes/u/1.jpg")).toBe(true);
    expect(isServablePhotoKey("quarantine/recipes/u/1.jpg")).toBe(false);
    expect(originalKeyOfVariant("variants/w512/recipes/u/1.jpg.webp")).toBe("recipes/u/1.jpg");
    expect(originalKeyOfVariant("variants/oops")).toBeNull();
    expect(originalKeyOfVariant("recipes/u/1.jpg")).toBeNull();
  });
});

describe("collectLivePhotoKeys", () => {
  it("counts only references from live rows", async () => {
    insertUser("chef", "/photos/profiles/chef/me.jpg");
    insertUser("plain", "https://avatars.example.com/plain.png");
    insertRecipe("live", "chef");
    insertRecipe("gone", "chef", { deletedAt: T0.toISOString() });
    insertSpoon("spoon-live", "chef", "live", "/photos/spoons/live.jpg");
    insertSpoon("spoon-deleted", "chef", "live", "/photos/spoons/deleted.jpg", T0.toISOString());
    insertSpoon("spoon-on-deleted-recipe", "chef", "gone", "/photos/spoons/on-gone.jpg");
    insertCover("cover-live", "live", {
      imageUrl: "/photos/covers/live.jpg",
      stylizedImageUrl: "/photos/covers/live-styled.jpg",
      sourceImageUrl: "/photos/covers/live-source.jpg",
    });
    insertCover("cover-archived-at", "live", { imageUrl: "/photos/covers/archived.jpg" }, { archivedAt: T0.toISOString() });
    insertCover("cover-archived-status", "live", { imageUrl: "/photos/covers/archived-status.jpg" }, { status: "archived" });
    insertCover("cover-on-deleted-recipe", "gone", { imageUrl: "/photos/covers/on-gone.jpg" });
    insertCover("cover-external", "live", { imageUrl: "https://example.com/x.jpg" });

    expect([...(await collectLivePhotoKeys(db))].sort()).toEqual([
      "covers/live-source.jpg",
      "covers/live-styled.jpg",
      "covers/live.jpg",
      "profiles/chef/me.jpg",
      "spoons/live.jpg",
    ]);
  });

  it("ignores a bare /photos/ URL and non-text values", async () => {
    insertUser("bare", "/photos/");
    expect([...(await collectLivePhotoKeys(db))]).toEqual([]);
    const fake: PhotoSweepDatabase = { all: async () => [{ url: 42 }, { url: null }], run: async () => undefined };
    expect([...(await collectLivePhotoKeys(fake))]).toEqual([]);
  });

  it("keeps a key live while a fork still uses it after the source recipe is deleted", async () => {
    insertUser("a");
    insertUser("b");
    insertRecipe("source", "a", { deletedAt: T0.toISOString() });
    insertRecipe("fork", "b", { sourceRecipeId: "source" });
    insertCover("source-cover", "source", { imageUrl: "/photos/recipes/a/source/1.jpg" });
    insertCover("fork-cover", "fork", { imageUrl: "/photos/recipes/a/source/1.jpg" });

    expect(await isPhotoKeyLive(db, "recipes/a/source/1.jpg")).toBe(true);
    expect(await isPhotoKeyLive(db, "recipes/a/source/2.jpg")).toBe(false);
  });

  it("matches a stored URL that carries a query or fragment", async () => {
    insertUser("chef", "/photos/profiles/chef/me.jpg?v=2");
    expect(await isPhotoKeyLive(db, "profiles/chef/me.jpg")).toBe(true);
    expect(await isPhotoKeyLive(db, "profiles/chef/me")).toBe(false);
  });
});

describe("runPhotoSweep", () => {
  function arrangeKitchen() {
    insertUser("chef", "/photos/profiles/chef/me.jpg");
    insertRecipe("live", "chef");
    insertSpoon("spoon-deleted", "chef", "live", "/photos/spoons/deleted.jpg", T0.toISOString());
    insertCover("cover-archived", "live", { imageUrl: "/photos/covers/archived.jpg" }, { archivedAt: T0.toISOString() });
    return memoryBucket({
      "profiles/chef/me.jpg": "me",
      "spoons/deleted.jpg": "deleted spoon",
      "covers/archived.jpg": "archived",
      "variants/w512/covers/archived.jpg.webp": "v",
      "variants/w512/profiles/chef/me.jpg.webp": "v",
      "variants/w256/missing/original.jpg.webp": "v",
      "variants/garbage": "not a variant key",
    });
  }

  it("does nothing when off", async () => {
    const bucket = arrangeKitchen();
    const report = await runPhotoSweep({ db, bucket, mode: "off", now: at(0), newId: () => "run-off" });
    expect(report).toMatchObject({ id: "run-off", mode: "off", note: "sweep is off", objectsScanned: 0 });
    expect(bucket.list).not.toHaveBeenCalled();
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS "n" FROM "PhotoSweepRun"`).get()).toEqual({ n: 0 });
  });

  it("reports unreferenced photos in a dry run without touching R2", async () => {
    const bucket = arrangeKitchen();
    const report = await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0), newId: () => "run-1" });

    expect(report).toMatchObject({
      mode: "dry-run",
      objectsScanned: 3,
      referencedObjects: 1,
      unreferencedObjects: 2,
      unreferencedBytes: "deleted spoon".length + "archived".length,
      orphanVariants: 2,
      eligibleObjects: 0,
      quarantined: 0,
      purged: 0,
      truncated: false,
    });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(7);
    expect(cleanupRows()).toEqual([
      { key: "covers/archived.jpg", reason: "unreferenced", eligibleAt: new Date(T0.getTime() + PHOTO_SWEEP_GRACE_MS).toISOString(), quarantinedAt: null, purgedAt: null },
      { key: "spoons/deleted.jpg", reason: "unreferenced", eligibleAt: new Date(T0.getTime() + PHOTO_SWEEP_GRACE_MS).toISOString(), quarantinedAt: null, purgedAt: null },
    ]);
    expect(database.sqlite.prepare(`SELECT "id", "mode", "unreferencedObjects", "truncated" FROM "PhotoSweepRun"`).all())
      .toEqual([{ id: "run-1", mode: "dry-run", unreferencedObjects: 2, truncated: 0 }]);

    // A later dry run past the grace period counts them as eligible but still moves nothing.
    const later = await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(later.eligibleObjects).toBe(2);
    expect(bucket.objects.size).toBe(7);
  });

  it("waits for the grace period, then moves unreferenced photos to quarantine and drops their variants", async () => {
    const bucket = arrangeKitchen();
    const first = await runPhotoSweep({ db, bucket, mode: "apply", now: at(0) });
    expect(first.quarantined).toBe(0);
    expect(bucket.objects.has("covers/archived.jpg")).toBe(true);

    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(report).toMatchObject({ eligibleObjects: 2, quarantined: 2, failures: 0 });
    expect([...bucket.objects.keys()].sort()).toEqual([
      "profiles/chef/me.jpg",
      "quarantine/covers/archived.jpg",
      "quarantine/spoons/deleted.jpg",
      "variants/garbage",
      "variants/w512/profiles/chef/me.jpg.webp",
    ]);
    expect(bucket.objects.get("quarantine/covers/archived.jpg")).toMatchObject({
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { originalKey: "covers/archived.jpg", quarantinedAt: new Date(T0.getTime() + PHOTO_SWEEP_GRACE_MS).toISOString() },
    });
    expect(new TextDecoder().decode(bucket.objects.get("quarantine/covers/archived.jpg")!.bytes)).toBe("archived");
    expect(cleanupRows().every((row) => row.quarantinedAt !== null)).toBe(true);

    // Purged only once the retention period has passed.
    const early = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS + DAY) });
    expect(early.purged).toBe(0);
    const purge = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS + PHOTO_QUARANTINE_RETENTION_MS) });
    expect(purge.purged).toBe(2);
    expect([...bucket.objects.keys()].sort()).toEqual(["profiles/chef/me.jpg", "variants/garbage", "variants/w512/profiles/chef/me.jpg.webp"]);
    expect(cleanupRows().every((row) => row.purgedAt !== null)).toBe(true);
    const again = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS + 2 * PHOTO_QUARANTINE_RETENTION_MS) });
    expect(again.purged).toBe(0);
  });

  it("forgets a photo that is referenced again before it is moved", async () => {
    const bucket = arrangeKitchen();
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    insertSpoon("spoon-new", "chef", "live", "/photos/covers/archived.jpg");

    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(report).toMatchObject({ unreferencedObjects: 1, quarantined: 1 });
    expect(bucket.objects.has("covers/archived.jpg")).toBe(true);
    expect(cleanupRows().map((row) => row.key)).toEqual(["spoons/deleted.jpg"]);
  });

  it("forgets a bookkeeping row whose object is already gone", async () => {
    const bucket = arrangeKitchen();
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    bucket.objects.delete("spoons/deleted.jpg");
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(DAY) });
    expect(cleanupRows().map((row) => row.key)).toEqual(["covers/archived.jpg"]);
  });

  it("checks each photo again just before moving it", async () => {
    const bucket = arrangeKitchen();
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    // A reference written after the run read its live set, while it lists the bucket.
    bucket.list = vi.fn(async (options) => {
      insertSpoon("spoon-racing", "chef", "live", "/photos/spoons/deleted.jpg");
      return memoryBucket({ "spoons/deleted.jpg": "deleted spoon" }).list(options);
    });

    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(report).toMatchObject({ eligibleObjects: 1, quarantined: 0 });
    expect(bucket.objects.has("spoons/deleted.jpg")).toBe(true);
  });

  it("stops at the per-run change limit", async () => {
    const bucket = arrangeKitchen();
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS), maxChanges: 1 });
    expect(report).toMatchObject({ quarantined: 1, truncated: true });

    const next = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS + DAY), maxChanges: 1 });
    expect(next).toMatchObject({ quarantined: 1, truncated: false });

    const purge = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS + DAY + PHOTO_QUARANTINE_RETENTION_MS), maxChanges: 1 });
    expect(purge).toMatchObject({ purged: 1, truncated: true });
  });

  it("refuses to move anything when no live references are found", async () => {
    const bucket = memoryBucket({ "spoons/a.jpg": "a" });
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(report).toMatchObject({ eligibleObjects: 1, quarantined: 0, note: "no live photo references found; refusing to apply" });
    expect(bucket.objects.has("spoons/a.jpg")).toBe(true);
  });

  it("counts failures and carries on", async () => {
    const bucket = arrangeKitchen();
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    bucket.get = vi.fn(async () => {
      throw new Error("R2 unavailable");
    });
    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(report).toMatchObject({ quarantined: 0, failures: 2 });

    // An object deleted between the listing and the move is skipped, not counted as moved.
    const vanishing = memoryBucket({ "spoons/deleted.jpg": "x", "covers/archived.jpg": "y", "profiles/chef/me.jpg": "z" });
    vanishing.get = vi.fn(async () => null);
    const skipped = await runPhotoSweep({ db, bucket: vanishing, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    expect(skipped).toMatchObject({ quarantined: 0, failures: 0 });
  });

  it("counts failed purges and failed variant deletes", async () => {
    const bucket = arrangeKitchen();
    await runPhotoSweep({ db, bucket, mode: "dry-run", now: at(0) });
    await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS) });
    bucket.objects.set("variants/w256/missing/original.jpg.webp", { bytes: new Uint8Array([1]) });
    bucket.delete = vi.fn(async () => {
      throw new Error("R2 unavailable");
    });
    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(PHOTO_SWEEP_GRACE_MS + PHOTO_QUARANTINE_RETENTION_MS) });
    expect(report).toMatchObject({ purged: 0, failures: 3 });
  });

  it("removes photos of a deleted account on the next run, unless a fork still uses them", async () => {
    insertUser("keeper", "/photos/profiles/keeper/me.jpg");
    insertUser("forker");
    insertRecipe("fork", "forker");
    insertCover("fork-cover", "fork", { imageUrl: "/photos/recipes/gone/shared.jpg" });
    const bucket = memoryBucket({
      "profiles/keeper/me.jpg": "k",
      "profiles/gone/me.jpg": "g",
      "recipes/gone/shared.jpg": "s",
    });
    const [sql, ...values] = photoCleanupRequestStatement(
      `SELECT ? AS "url" UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ?`,
      ["/photos/profiles/gone/me.jpg", "/photos/recipes/gone/shared.jpg", "/photos/profiles/gone/me.jpg", "https://example.com/x.jpg", "/photos/"],
      "account_deleted",
      T0,
      T0,
    );
    database.sqlite.prepare(sql).run(...values);
    expect(cleanupRows().map((row) => [row.key, row.reason])).toEqual([
      ["profiles/gone/me.jpg", "account_deleted"],
      ["recipes/gone/shared.jpg", "account_deleted"],
    ]);

    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(1000) });
    expect(report).toMatchObject({ quarantined: 1, referencedObjects: 2 });
    expect([...bucket.objects.keys()].sort()).toEqual(["profiles/keeper/me.jpg", "quarantine/profiles/gone/me.jpg", "recipes/gone/shared.jpg"]);
    expect(cleanupRows().map((row) => row.key)).toEqual(["profiles/gone/me.jpg"]);
  });

  it("keeps the earlier eligibility and leaves quarantined rows alone when a cleanup is requested again", () => {
    const run = (eligibleAt: Date) => {
      const [sql, ...values] = photoCleanupRequestStatement(`SELECT ? AS "url"`, ["/photos/a.jpg"], "account_deleted", T0, eligibleAt);
      database.sqlite.prepare(sql).run(...values);
    };
    run(new Date(T0.getTime() + DAY));
    run(new Date(T0.getTime() + 2 * DAY));
    expect(cleanupRows()[0].eligibleAt).toBe(new Date(T0.getTime() + DAY).toISOString());
    run(T0);
    expect(cleanupRows()[0].eligibleAt).toBe(T0.toISOString());

    database.sqlite.prepare(`UPDATE "PhotoCleanup" SET "quarantinedAt" = ?, "eligibleAt" = ?`).run(T0.toISOString(), "2026-12-01T00:00:00.000Z");
    run(T0);
    expect(cleanupRows()[0].eligibleAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("treats an unreadable eligibility time as not yet eligible", async () => {
    insertUser("chef", "/photos/profiles/chef/me.jpg");
    const bucket = memoryBucket({ "profiles/chef/me.jpg": "me", "spoons/a.jpg": "a", "spoons/b.jpg": "b" });
    database.sqlite.prepare(`INSERT INTO "PhotoCleanup" ("key", "reason", "firstUnreferencedAt", "eligibleAt") VALUES ('spoons/a.jpg', 'unreferenced', ?, 'not a time')`).run(T0.toISOString());
    database.sqlite.prepare(`INSERT INTO "PhotoCleanup" ("key", "reason", "firstUnreferencedAt", "eligibleAt") VALUES ('spoons/b.jpg', 'unreferenced', ?, ?)`).run(T0.toISOString(), T0.getTime());
    const report = await runPhotoSweep({ db, bucket, mode: "apply", now: at(DAY) });
    expect(report).toMatchObject({ eligibleObjects: 1, quarantined: 1 });
    expect(bucket.objects.has("spoons/a.jpg")).toBe(true);
  });

  it("reads integer and bigint times from the database", async () => {
    const rows = [{ key: "spoons/a.jpg", eligibleAt: BigInt(T0.getTime()), quarantinedAt: null, purgedAt: undefined }];
    const fake: PhotoSweepDatabase = {
      all: vi.fn(async (sql: string) => (sql.includes(`FROM "PhotoCleanup"`) ? rows : sql.includes(`"live"`) ? [] : [{ url: "/photos/live.jpg" }])),
      run: vi.fn(async () => undefined),
    };
    const report = await runPhotoSweep({ db: fake, bucket: memoryBucket({ "spoons/a.jpg": "a", "live.jpg": "l" }), mode: "apply", now: at(DAY) });
    expect(report).toMatchObject({ eligibleObjects: 1, quarantined: 1 });
  });

  it("uses the real clock and a random id by default", async () => {
    const report = await runPhotoSweep({ db, bucket: memoryBucket(), mode: "dry-run" });
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(report.startedAt)).not.toBeNaN();
  });
});

describe("photoSweepD1Database", () => {
  it("reads an empty result when D1 returns no rows array", async () => {
    const statement = { bind: () => statement, all: async () => ({}), run: async () => ({}) };
    const adapted = photoSweepD1Database({ prepare: () => statement });
    expect(await adapted.all("SELECT 1")).toEqual([]);
    await expect(adapted.run("SELECT 1")).resolves.toBeUndefined();
  });
});

describe("runScheduledPhotoSweep", () => {
  it("has nothing to sweep without a database or a bucket", async () => {
    expect(await runScheduledPhotoSweep({})).toBeNull();
    expect(await runScheduledPhotoSweep({ DB: database.binding as never })).toBeNull();
  });

  it("runs in the configured mode and logs the report", async () => {
    insertUser("chef", "/photos/profiles/chef/me.jpg");
    const bucket = memoryBucket({ "profiles/chef/me.jpg": "me", "spoons/a.jpg": "a" });
    const log = vi.fn();
    const report = await runScheduledPhotoSweep({ DB: database.binding as never, PHOTOS: bucket as never }, log);
    expect(report).toMatchObject({ mode: "dry-run", unreferencedObjects: 1 });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ event: "spoonjoy.photo_sweep", mode: "dry-run", unreferencedObjects: 1 });

    const off = await runScheduledPhotoSweep({ DB: database.binding as never, PHOTOS: bucket as never, PHOTO_SWEEP_MODE: "off" }, log);
    expect(off?.mode).toBe("off");
  });

  it("logs to the console by default", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runScheduledPhotoSweep({ DB: database.binding as never, PHOTOS: memoryBucket() as never });
    expect(consoleLog).toHaveBeenCalledTimes(1);
    consoleLog.mockRestore();
  });
});
