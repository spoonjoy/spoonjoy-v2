// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizersOnRecipe, prismaOrganizerStore } from "~/domains/kitchen";
import { getDb, getLocalDb } from "~/lib/db.server";
import { createMoveInJob } from "~/domains/move-in/adapters/storage/job-store.server";
import { moveInEnv, moveInPorts, r2RangeSource } from "~/domains/move-in/adapters/worker/move-in-ports.server";
import { runForAWhile } from "~/domains/move-in/application/run-move-in";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

// Prisma on D1 in the Worker; here, the tests' own SQLite.
vi.mock("~/lib/db.server", async (original) => {
  const real = await original<typeof import("~/lib/db.server")>();
  // db is assigned once the local database opens, so it is read through, not copied.
  return { ...real, get db() { return real.db; }, getDb: vi.fn(() => real.getLocalDb()) };
});

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

/** An R2 bucket in memory that answers head, ranged get and put. */
function memoryBucket(objects: Record<string, Uint8Array> = {}) {
  const reads: Array<{ offset: number; length: number }> = [];
  return {
    objects,
    reads,
    head: async (key: string) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      reads.push(options.range);
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    put: async (key: string, value: Uint8Array) => {
      objects[key] = value;
      return null;
    },
    delete: async (key: string) => void delete objects[key],
  };
}

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`).run();
});

afterEach(() => database.close());

describe("r2RangeSource", () => {
  it("reads only the ranges asked for", async () => {
    const bucket = memoryBucket({ "a.zip": new Uint8Array([1, 2, 3, 4, 5]) });
    const source = await r2RangeSource(bucket as never, "a.zip");
    expect(source.size).toBe(5);
    expect([...(await source.read(1, 2))]).toEqual([2, 3]);
    expect(bucket.reads).toEqual([{ offset: 1, length: 2 }]);
  });

  it("asks for the backup again when the upload is gone", async () => {
    const bucket = memoryBucket();
    await expect(r2RangeSource(bucket as never, "gone.zip")).rejects.toBeInstanceOf(MoveInError);
    bucket.objects["late.zip"] = new Uint8Array(4);
    const source = await r2RangeSource(bucket as never, "late.zip");
    delete bucket.objects["late.zip"];
    await expect(source.read(0, 1)).rejects.toMatchObject({ code: "broken-zip" });
  });
});

describe("moveInPorts", () => {
  it("moves a backup in from R2 into D1, with the photo as the recipe's cover", async () => {
    const { tables, keys } = mealieDatabase();
    const zip = makeZip([
      { name: "database.json", data: JSON.stringify(tables) },
      { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: webp, store: true },
    ]);
    const archiveKey = "pending-uploads/move-in/chef-1/a.zip";
    const photos = memoryBucket({ [archiveKey]: zip });
    const jobId = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-backup", archiveKey, archiveName: "backup.zip", now });
    const ports = moveInPorts({ DB: database.binding, PHOTOS: photos } as never, () => now);
    expect(await ports.ownerEmail("chef-1")).toBe("cook@example.com");
    expect(await ports.ownerEmail("nobody")).toBeNull();

    expect(await runForAWhile(jobId, ports, { budgetMs: 1000 })).toMatchObject({ status: "done-with-issues" });
    const recipes = database.sqlite.prepare(`SELECT "title", "activeCoverId" IS NOT NULL AS "hasCover" FROM "Recipe" ORDER BY "title"`).all();
    expect(recipes).toEqual([
      { title: "Pancakes", hasCover: 1 },
      { title: "Soup", hasCover: 0 },
      { title: "Untitled recipe", hasCover: 0 },
    ]);
    // The backup is deleted once it has moved in; the cover photo stays.
    expect(Object.keys(photos.objects)).toEqual([expect.stringMatching(/^covers\/import\/movein-/)]);
  });
});

describe("moveInPorts' organizers", () => {
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("are on for a cook with the organizers flag", () => {
    const ports = (flags: object) => moveInPorts({ DB: database.binding, PHOTOS: memoryBucket(), ...flags } as never, () => now);
    expect(ports({ SPOONJOY_FLAGS: "organizers" }).organizers?.on("chef-1")).toBe(true);
    expect(ports({ SPOONJOY_FLAG_USERS: JSON.stringify({ "chef-1": ["organizers"] }) }).organizers?.on("chef-1")).toBe(true);
    expect(ports({ SPOONJOY_FLAG_USERS: JSON.stringify({ "chef-1": ["organizers"] }) }).organizers?.on("chef-2")).toBe(false);
    expect(ports({}).organizers?.on("chef-1")).toBe(false);
  });

  it("go on through Kitchen's organizers in the Worker's database, opened once for the run", async () => {
    const db = await getLocalDb();
    await cleanupDatabase();
    const cook = await db.user.create({ data: createTestUser() });
    const first = await db.recipe.create({ data: createTestRecipe(cook.id) });
    const second = await db.recipe.create({ data: createTestRecipe(cook.id) });
    vi.mocked(getDb).mockClear();
    const ports = moveInPorts({ DB: database.binding, PHOTOS: memoryBucket(), SPOONJOY_FLAGS: "organizers" } as never, () => now);

    await ports.organizers?.attach({ ownerId: cook.id, recipeId: first.id, tags: ["Quick"], categories: [], tools: [] });
    await ports.organizers?.attach({ ownerId: cook.id, recipeId: second.id, tags: [], categories: [], tools: ["Skillet"] });

    const store = prismaOrganizerStore(db);
    expect((await organizersOnRecipe(store, first.id, "tag")).map((tag) => tag.name)).toEqual(["Quick"]);
    expect((await organizersOnRecipe(store, second.id, "tool")).map((tool) => tool.name)).toEqual(["Skillet"]);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(getDb).toHaveBeenCalledWith({ DB: database.binding });
  });
});

describe("moveInEnv", () => {
  it("takes the database, photo storage and flags a move-in runs with, and nothing without the database or storage", () => {
    const DB = { prepare: () => null };
    const PHOTOS = memoryBucket();
    expect(moveInEnv({ DB, PHOTOS, SPOONJOY_FLAGS: "organizers", SPOONJOY_FLAG_USERS: "{}", JOBS: {} } as never)).toEqual({
      DB, PHOTOS, SPOONJOY_FLAGS: "organizers", SPOONJOY_FLAG_USERS: "{}",
    });
    expect(moveInEnv({ DB } as never)).toBeNull();
    expect(moveInEnv({ PHOTOS } as never)).toBeNull();
    expect(moveInEnv(undefined)).toBeNull();
  });
});
