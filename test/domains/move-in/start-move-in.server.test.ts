// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOVE_IN_UPLOAD_MAX_BYTES, admitStoredBackup, moveInKind, startMoveIn, startServerMoveIn } from "~/domains/move-in/adapters/worker/start-move-in.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";
import { recipeServer, SERVER_TOKEN } from "./support/recipe-server";
import { openServerConnection } from "~/domains/move-in/adapters/worker/server-connection.server";

const SECRET = "the deployment's session secret";
let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");

/** An R2 bucket in memory: put (of bytes or a Blob), head, ranged get and delete. */
function memoryBucket() {
  const objects: Record<string, Uint8Array> = {};
  return {
    objects,
    put: async (key: string, value: Blob | Uint8Array) => void (objects[key] = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value),
    head: async (key: string) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    delete: async (key: string) => void delete objects[key],
  };
}

function zip(tables: unknown = mealieDatabase().tables) {
  return makeZip([{ name: "database.json", data: JSON.stringify(tables) }]);
}

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`).run();
});

afterEach(() => database.close());

const start = (bytes: Uint8Array, bucket = memoryBucket(), name = "mealie_2026.11.23.zip") =>
  startMoveIn({ env: { DB: database.binding, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name, size: bytes.length, data: bytes }, now });

describe("startMoveIn", () => {
  it("keeps the backup where it is never served and queues its move-in", async () => {
    const bucket = memoryBucket();
    const result = await start(zip(), bucket);
    expect(result).toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/) });
    const [key] = Object.keys(bucket.objects);
    expect(key).toMatch(/^pending-uploads\/move-in\/chef-1\/[0-9a-f-]{36}\.zip$/);
    const job = database.sqlite.prepare(`SELECT "ownerId", "kind", "status", "phase", "archiveKey", "archiveName" FROM "ImportJob"`).get();
    expect(job).toEqual({ ownerId: "chef-1", kind: "mealie-backup", status: "queued", phase: "inspect", archiveKey: key, archiveName: "mealie_2026.11.23.zip" });
  });

  it.each([
    ["a file that isn't a zip", new TextEncoder().encode("hello, this is not a zip at all"), "broken-zip"],
    ["a zip with no backup in it", makeZip([{ name: "notes.txt", data: "hi" }]), "not-a-backup"],
  ])("answers %s with its fix-it message, and stores nothing", async (_name, bytes, code) => {
    const bucket = memoryBucket();
    expect(await start(bytes, bucket)).toEqual({ ok: false, code });
    expect(bucket.objects).toEqual({});
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "ImportJob"`).get()).toEqual({ n: 0 });
  });

  it("says which email to use when the backup holds several kitchens and none is the person's", async () => {
    database.sqlite.prepare(`UPDATE "User" SET "email" = 'someone@example.com'`).run();
    const bucket = memoryBucket();
    expect(await start(zip(), bucket)).toEqual({ ok: false, code: "pick-a-group" });
    expect(bucket.objects).toEqual({});
  });

  it("takes the upload as the form's file, without copying it first", async () => {
    const bucket = memoryBucket();
    const data = new Blob([zip()]);
    expect(await startMoveIn({ env: { DB: database.binding, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: data.size, data }, now }))
      .toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/) });
    expect(Object.values(bucket.objects)).toEqual([zip()]);
  });

  it("refuses a backup larger than it can take", async () => {
    expect(await start(new Uint8Array(MOVE_IN_UPLOAD_MAX_BYTES + 1))).toEqual({ ok: false, code: "backup-too-large" });
  });

  it("passes on an outage rather than calling it a bad backup", async () => {
    const down = { prepare: database.binding.prepare, batch: () => Promise.reject(new Error("D1 is down")) };
    await expect(startMoveIn({ env: { DB: down, PHOTOS: memoryBucket() } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: 1, data: zip() }, now }))
      .rejects.toThrow("D1 is down");
  });

  it("still answers a bad backup when deleting it fails, and leaves it to the sweep", async () => {
    const bucket = { ...memoryBucket(), delete: async () => Promise.reject(new Error("R2 is down")) };
    expect(await start(new TextEncoder().encode("not a zip"), bucket)).toEqual({ ok: false, code: "broken-zip" });
  });

  it("still passes on a failed save when deleting the backup fails", async () => {
    const bucket = { ...memoryBucket(), delete: async () => Promise.reject(new Error("R2 is down")) };
    const failing = {
      prepare: database.binding.prepare,
      batch: (statements: Array<{ sql: string }>) =>
        statements.some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : database.binding.batch(statements as never),
    };
    await expect(startMoveIn({ env: { DB: failing, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: 1, data: zip() }, now }))
      .rejects.toThrow("D1 is down");
  });

  it("deletes the backup again when the job can't be saved", async () => {
    const bucket = memoryBucket();
    const failing = {
      prepare: database.binding.prepare,
      batch: (statements: Array<{ sql: string }>) =>
        statements.some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : database.binding.batch(statements as never),
    };
    await expect(startMoveIn({ env: { DB: failing, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: 1, data: zip() }, now }))
      .rejects.toThrow("D1 is down");
    expect(bucket.objects).toEqual({});
  });

  it("refuses an app it can't read yet", async () => {
    const result = await startMoveIn({ env: { DB: database.binding, PHOTOS: memoryBucket() } as never, ownerId: "chef-1", app: "paprika", file: { name: "x.zip", size: 1, data: zip() }, now });
    expect(result).toEqual({ ok: false, code: "unknown-app" });
  });

  it("refuses an app name that is only a property of every object", async () => {
    expect(moveInKind("toString")).toBeNull();
    expect(moveInKind("mealie")).toBe("mealie-backup");
  });
});

describe("admitStoredBackup", () => {
  it("keeps a backup it couldn't finish checking for an upload whose finish is sent again", async () => {
    const bucket = memoryBucket();
    await bucket.put("pending-uploads/move-in/chef-1/a.zip", zip());
    const down = { prepare: database.binding.prepare, batch: () => Promise.reject(new Error("D1 is down")) };
    await expect(admitStoredBackup({ env: { DB: down, PHOTOS: bucket } as never, ownerId: "chef-1", archiveKey: "pending-uploads/move-in/chef-1/a.zip", createJob: async () => "movein_1", keepOnSaveFailure: true }))
      .rejects.toThrow("D1 is down");
    expect(Object.keys(bucket.objects)).toEqual(["pending-uploads/move-in/chef-1/a.zip"]);
  });
});

describe("startServerMoveIn", () => {
  const startFrom = (options: { address?: string; token?: string; app?: string; fetch?: typeof globalThis.fetch; bucket?: ReturnType<typeof memoryBucket>; db?: unknown; home?: string } = {}) =>
    startServerMoveIn({
      env: { DB: options.db ?? database.binding, PHOTOS: options.bucket ?? memoryBucket(), SESSION_SECRET: SECRET, SPOONJOY_BASE_URL: options.home } as never,
      ownerId: "chef-1",
      app: options.app ?? "mealie",
      address: options.address ?? "https://recipes.example.com/",
      token: options.token ?? ` ${SERVER_TOKEN} `,
      fetch: options.fetch ?? recipeServer(),
      now,
    });

  it("checks the server and token at once, keeps them sealed where they are never served, and queues the move-in", async () => {
    const bucket = memoryBucket();
    expect(await startFrom({ bucket })).toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/) });
    const [key] = Object.keys(bucket.objects);
    expect(key).toMatch(/^pending-uploads\/move-in\/chef-1\/[0-9a-f-]{36}\.json$/);
    // Storage holds neither the token nor the address in the clear; only the Worker's secret opens them.
    const kept = new TextDecoder().decode(bucket.objects[key]);
    expect(kept).not.toContain(SERVER_TOKEN);
    expect(kept).not.toContain("recipes.example.com");
    expect(await openServerConnection(SECRET, key, bucket.objects[key])).toEqual({ address: "https://recipes.example.com", token: SERVER_TOKEN });
    expect(await openServerConnection("another secret", key, bucket.objects[key])).toBeNull();
    expect(await openServerConnection(SECRET, `${key}.copy`, bucket.objects[key])).toBeNull();
    // Any change to the sealed bytes opens as nothing.
    const sealed = JSON.parse(kept) as { data: string };
    const flipped = atob(sealed.data);
    const tampered = { ...sealed, data: btoa(String.fromCharCode(flipped.charCodeAt(0) ^ 1) + flipped.slice(1)) };
    expect(await openServerConnection(SECRET, key, new TextEncoder().encode(JSON.stringify(tampered)))).toBeNull();
    const job = database.sqlite.prepare(`SELECT "kind", "status", "archiveKey", "archiveName" FROM "ImportJob"`).get();
    expect(job).toEqual({ kind: "mealie-api", status: "queued", archiveKey: key, archiveName: "recipes.example.com" });
  });

  it.each([
    ["no address", { address: " " }, "no-address"],
    ["no token", { token: " " }, "no-token"],
    ["a token the server refuses", { token: "wrong" }, "server-token"],
    ["an address that isn't the recipe app", { address: "https://example.com" }, "server-address"],
    ["a server that doesn't answer", { fetch: recipeServer({ down: true }) }, "server-unreachable"],
    ["an app it can't read yet", { app: "paprika" }, "unknown-app"],
    ["an app name that is only a property of every object", { app: "toString" }, "unknown-app"],
  ])("answers %s with its fix-it message, and keeps nothing", async (_name, options, code) => {
    const bucket = memoryBucket();
    expect(await startFrom({ ...options, bucket })).toEqual({ ok: false, code });
    expect(bucket.objects).toEqual({});
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "ImportJob"`).get()).toEqual({ n: 0 });
  });

  /** Another Spoonjoy whose token is for the account `account`. */
  const otherSpoonjoy = (asked: string[] = [], account = "cm_ada"): typeof globalThis.fetch => async (input) => {
    const path = new URL(String(input)).pathname;
    asked.push(path);
    if (path === "/api/v1/health") return Response.json({ ok: true, data: { version: "v1" } });
    if (path === "/api/v1/me/export") return Response.json({ ok: true, data: { format: "spoonjoy.account-export.v1", account: { id: account, username: "ada" }, recipes: [] } });
    return new Response("not found", { status: 404 });
  };

  it("won't move a cook's kitchen in from this Spoonjoy itself, by its own address or by their own account", async () => {
    expect(await startFrom({ app: "spoonjoy", address: "https://spoonjoy.app/", home: "https://spoonjoy.app", fetch: otherSpoonjoy() })).toEqual({ ok: false, code: "same-kitchen" });
    expect(await startFrom({ app: "spoonjoy", address: "https://spoonjoy.workers.dev", home: "https://spoonjoy.app", fetch: otherSpoonjoy([], "chef-1") })).toEqual({ ok: false, code: "same-kitchen" });
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS "jobs" FROM "ImportJob"`).get()).toEqual({ jobs: 0 });
  });

  it("starts a move-in from another Spoonjoy, reading its account export with the cook's token", async () => {
    const asked: string[] = [];
    const spoonjoy: typeof globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      asked.push(path);
      if (path === "/api/v1/health") return Response.json({ ok: true, data: { version: "v1" } });
      if (path === "/api/v1/me/export") return Response.json({ ok: true, data: { format: "spoonjoy.account-export.v1", account: { id: "cm_ada", username: "ada" }, recipes: [] } });
      return new Response("not found", { status: 404 });
    };
    const bucket = memoryBucket();
    expect(await startFrom({ app: "spoonjoy", address: "https://spoonjoy.app", fetch: spoonjoy, bucket })).toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/) });
    expect(asked).toEqual(["/api/v1/health", "/api/v1/me/export"]);
    expect(database.sqlite.prepare(`SELECT "kind", "archiveName" FROM "ImportJob"`).get()).toEqual({ kind: "spoonjoy-api", archiveName: "spoonjoy.app" });
    // Another Spoonjoy has no backup a cook can drop.
    expect(moveInKind("spoonjoy")).toBeNull();
  });

  it("passes on a storage failure, and deletes the token again when the job can't be saved", async () => {
    const garbled: typeof globalThis.fetch = async (input, init) =>
      String(input).endsWith("/users/self") ? new Response("{") : recipeServer()(input, init);
    // An answer the server garbles is a wrong address, not a crash.
    await expect(startFrom({ fetch: garbled })).resolves.toEqual({ ok: false, code: "server-address" });
    const bucket = memoryBucket();
    const failing = {
      prepare: database.binding.prepare,
      batch: (statements: Array<{ sql: string }>) =>
        statements.some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : database.binding.batch(statements as never),
    };
    await expect(startFrom({ bucket, db: failing })).rejects.toThrow("D1 is down");
    expect(bucket.objects).toEqual({});
    // A delete that fails too leaves the token for the sweep, and the cook sees the first failure.
    const stuck = { ...memoryBucket(), delete: () => Promise.reject(new Error("R2 is down")) };
    await expect(startFrom({ bucket: stuck as never, db: failing })).rejects.toThrow("D1 is down");
  });
});
