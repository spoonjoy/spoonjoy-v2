// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizersOnRecipe, prismaOrganizerStore } from "~/domains/kitchen";
import { getDb, getLocalDb } from "~/lib/db.server";
import { createMoveInJob } from "~/domains/move-in/adapters/storage/job-store.server";
import { moveInEnv, moveInPorts, openMoveInSource, r2RangeSource } from "~/domains/move-in/adapters/worker/move-in-ports.server";
import { runForAWhile } from "~/domains/move-in/application/run-move-in";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { cleanupDatabase } from "../../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../../utils";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";
import { recipeServer, SERVER_TOKEN } from "./support/recipe-server";
import { sealServerConnection, serverConnectionSecret } from "~/domains/move-in/adapters/worker/server-connection.server";

const SECRET = "the deployment's session secret";

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
    get: async (key: string, options?: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      if (!options) return { arrayBuffer: async () => bytes.slice().buffer };
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
    expect(await ports.hasMovedInPhoto("no-such-recipe")).toBe(false);
    expect((await ports.openArchive({ archiveKey } as never)).size).toBe(zip.length);
    // A chunk brings its photos together; a recipe written alone brings its own.
    await expect(ports.attachPhoto({ ownerId: "chef-1", recipeId: "no-such-recipe", bytes: new Uint8Array([1]) })).rejects.toThrow("it isn't a WebP image");

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

describe("moveInPorts from a server", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("moves a kitchen in from the server its start checked, records the address, and deletes the token once done", async () => {
    vi.stubGlobal("fetch", recipeServer());
    const archiveKey = "pending-uploads/move-in/chef-1/a.json";
    const connection = await sealServerConnection(serverConnectionSecret(null), archiveKey, { address: "https://recipes.example.com", token: SERVER_TOKEN });
    const photos = memoryBucket({ [archiveKey]: connection });
    const jobId = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-api", archiveKey, archiveName: "recipes.example.com", now });
    const ports = moveInPorts({ DB: database.binding, PHOTOS: photos } as never, () => now);
    expect(await runForAWhile(jobId, ports, { budgetMs: 1000 })).toMatchObject({ status: "done" });
    expect(database.sqlite.prepare(`SELECT "title" FROM "Recipe" ORDER BY "title"`).all()).toEqual([{ title: "Soup" }, { title: "Toast" }]);
    // The same app as its backups, so a backup of this kitchen finds these recipes.
    expect(database.sqlite.prepare(`SELECT "kind", "label", "serverUrl", "sourceVersion" FROM "ImportSource"`).all())
      .toEqual([{ kind: "mealie-backup", label: "Home", serverUrl: "https://recipes.example.com", sourceVersion: "v3.31.0" }]);
    expect(photos.objects).toEqual({});
  });

  it("brings a kitchen moved in from its server once, when it moves in again from its backup, and keeps the address", async () => {
    const { tables, keys } = mealieDatabase();
    const backupKey = "pending-uploads/move-in/chef-1/a.zip";
    const serverKey = "pending-uploads/move-in/chef-1/b.json";
    const photos = memoryBucket({
      [backupKey]: makeZip([{ name: "database.json", data: JSON.stringify(tables) }]),
      [serverKey]: await sealServerConnection(serverConnectionSecret(null), serverKey, { address: "https://recipes.example.com", token: SERVER_TOKEN }),
    });
    // The backup's recipes by id, with dashes as the server gives them; their content differs, so the backup updates them.
    const recipes = [["pancakes", "Pancakes"], ["soup", "Soup"]].map(([slug, name]) => ({ id: keys[slug as "soup"], slug, name, image: null, createdAt: "2026-11-23T16:00:00Z" }));
    vi.stubGlobal("fetch", recipeServer({ kitchen: keys.group, recipes }));
    const ports = moveInPorts({ DB: database.binding, PHOTOS: photos } as never, () => now);
    const server = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-api", archiveKey: serverKey, archiveName: "recipes.example.com", now });
    await runForAWhile(server, ports, { budgetMs: 1000 });
    const backup = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-backup", archiveKey: backupKey, archiveName: "backup.zip", now });
    await runForAWhile(backup, ports, { budgetMs: 1000 });
    expect(database.sqlite.prepare(`SELECT "title" FROM "Recipe" ORDER BY "title"`).all()).toEqual([{ title: "Pancakes" }, { title: "Soup" }, { title: "Untitled recipe" }]);
    expect(database.sqlite.prepare(`SELECT "kind", "serverUrl" FROM "ImportSource"`).all()).toEqual([{ kind: "mealie-backup", serverUrl: "https://recipes.example.com" }]);
  });

  it("stops a server move-in whose token is no longer kept, as expired", async () => {
    const job = { id: "j", ownerId: "chef-1", kind: "mealie-api", sourceId: null, status: "running", phase: "inspect", cursor: null, archiveKey: "gone.json", lastError: null, attempt: 0 } as const;
    await expect(openMoveInSource(memoryBucket() as never, job, recipeServer(), () => SECRET)).rejects.toMatchObject({ code: "expired" });
  });

  it("stops a server move-in whose connection doesn't open under the Worker's secret, as expired", async () => {
    const key = "pending-uploads/move-in/chef-1/c.json";
    const job = { id: "j", ownerId: "chef-1", kind: "mealie-api", sourceId: null, status: "running", phase: "inspect", cursor: null, archiveKey: key, lastError: null, attempt: 0 } as const;
    const connection = { address: "https://recipes.example.com", token: SERVER_TOKEN };
    const kept = (bytes: Uint8Array) => memoryBucket({ [key]: bytes }) as never;
    // Sealed under another secret, sealed for another key, or kept in the clear as before they were sealed.
    await expect(openMoveInSource(kept(await sealServerConnection("another secret", key, connection)), job, recipeServer(), () => SECRET)).rejects.toMatchObject({ code: "expired" });
    await expect(openMoveInSource(kept(await sealServerConnection(SECRET, "elsewhere.json", connection)), job, recipeServer(), () => SECRET)).rejects.toMatchObject({ code: "expired" });
    await expect(openMoveInSource(kept(new TextEncoder().encode(JSON.stringify(connection))), job, recipeServer(), () => SECRET)).rejects.toMatchObject({ code: "expired" });
    const source = await openMoveInSource(kept(await sealServerConnection(SECRET, key, connection)), job, recipeServer(), () => SECRET);
    expect(source.serverUrl).toBe("https://recipes.example.com");
  });

  it("deletes a server move-in's sealed token when it fails, under the Worker's own secret", async () => {
    const key = "pending-uploads/move-in/chef-1/d.json";
    // A token the server no longer takes, as when the cook deleted it there, fails the move-in.
    const photos = memoryBucket({ [key]: await sealServerConnection(SECRET, key, { address: "https://recipes.example.com", token: "a deleted token" }) });
    vi.stubGlobal("fetch", recipeServer());
    const ports = moveInPorts({ DB: database.binding, PHOTOS: photos, SESSION_SECRET: SECRET } as never, () => now);
    const job = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-api", archiveKey: key, archiveName: "recipes.example.com", now });
    expect(await runForAWhile(job, ports, { budgetMs: 1000 })).toMatchObject({ status: "failed", lastError: "server-token" });
    expect(photos.objects).toEqual({});
  });
});

describe("moveInPorts' organizers", () => {
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("go on through Kitchen's organizers in the Worker's database, opened once for the run, and again after an open that failed", async () => {
    const db = await getLocalDb();
    await cleanupDatabase();
    const cook = await db.user.create({ data: createTestUser() });
    const first = await db.recipe.create({ data: createTestRecipe(cook.id) });
    const second = await db.recipe.create({ data: createTestRecipe(cook.id) });
    const source = await db.importSource.create({ data: { id: "source-1", ownerId: cook.id, kind: "mealie-backup", instanceKey: "k", label: "Home" } });
    const at = { ownerId: cook.id, sourceId: source.id, jobId: "job-1" };
    vi.mocked(getDb).mockClear();
    vi.mocked(getDb).mockRejectedValueOnce(new Error("D1 is down"));
    const ports = moveInPorts({ DB: database.binding, PHOTOS: memoryBucket() } as never, () => now);

    await expect(ports.organizers?.attach({ ...at, recipeId: first.id, tags: ["Quick"], categories: [], tools: [] })).rejects.toThrow("D1 is down");
    await ports.organizers?.attach({ ...at, recipeId: first.id, tags: ["Quick"], categories: [], tools: [] });
    await ports.organizers?.attach({ ...at, recipeId: second.id, tags: [], categories: [], tools: ["Skillet"] });

    const store = prismaOrganizerStore(db);
    expect((await organizersOnRecipe(store, first.id, "tag")).map((tag) => tag.name)).toEqual(["Quick"]);
    expect((await organizersOnRecipe(store, second.id, "tool")).map((tool) => tool.name)).toEqual(["Skillet"]);
    // Once for the run, after the open that failed.
    expect(getDb).toHaveBeenCalledTimes(2);
    expect(getDb).toHaveBeenCalledWith({ DB: database.binding });
  });
  it("put a chunk's on through the Worker's database, without Prisma", async () => {
    const sql = database.sqlite;
    sql.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId") VALUES ('recipe-1', 'Pancakes', 'chef-1')`).run();
    sql.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('source-1', 'chef-1', 'mealie-backup', 'k', 'Home')`).run();
    vi.mocked(getDb).mockClear();
    const ports = moveInPorts({ DB: database.binding, PHOTOS: memoryBucket() } as never, () => now);

    expect(await ports.organizers?.attachMany?.([{ ownerId: "chef-1", sourceId: "source-1", jobId: "job-1", recipeId: "recipe-1", tags: ["Quick"], categories: [], tools: [] }])).toEqual([null]);

    expect(sql.prepare(`SELECT o."name" FROM "RecipeOrganizer" ro JOIN "Organizer" o ON o."id" = ro."organizerId" WHERE ro."recipeId" = 'recipe-1'`).all()).toEqual([{ name: "Quick" }]);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("moveInEnv", () => {
  it("takes the database, photo storage and flags a move-in runs with, and nothing without the database or storage", () => {
    const DB = { prepare: () => null };
    const PHOTOS = memoryBucket();
    expect(moveInEnv({ DB, PHOTOS, SPOONJOY_FLAGS: "move_in", SPOONJOY_FLAG_USERS: "{}", JOBS: {} } as never)).toEqual({
      DB, PHOTOS, SPOONJOY_FLAGS: "move_in", SPOONJOY_FLAG_USERS: "{}",
    });
    expect(moveInEnv({ DB } as never)).toBeNull();
    expect(moveInEnv({ PHOTOS } as never)).toBeNull();
    expect(moveInEnv(undefined)).toBeNull();
  });
});
