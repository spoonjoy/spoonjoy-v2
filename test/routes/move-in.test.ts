// @vitest-environment node
// The Move in page: behind the move_in flag, it takes a backup zip, starts the move-in, keeps it
// running in the request's waitUntil, and shows the owner (and only the owner) how it went.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
const UndiciFile = File;
type UndiciFile = File;
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { action, loader } from "~/routes/move-in";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { makeZip } from "../domains/move-in/support/make-zip";
import { mealieDatabase } from "../domains/move-in/support/mealie-database";

const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

function memoryBucket() {
  const objects: Record<string, Uint8Array> = {};
  return {
    objects,
    head: async (key: string) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    put: async (key: string, value: Uint8Array | Blob) => void (objects[key] = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value)),
    delete: async (key: string) => void delete objects[key],
  };
}

let d1: SqliteD1;
let photos: ReturnType<typeof memoryBucket>;
let ownerId: string;
let otherId: string;
let waiting: Array<Promise<unknown>>;

async function cookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function context(flags: string | undefined = "move_in") {
  return {
    cloudflare: {
      env: { DB: d1.binding, PHOTOS: photos, SPOONJOY_FLAGS: flags },
      ctx: { waitUntil: (promise: Promise<unknown>) => void waiting.push(promise), passThroughOnException() {} },
    },
  } as never;
}

async function load(url: string, { as = ownerId, flags }: { as?: string; flags?: string } = {}) {
  return loader({
    request: new UndiciRequest(`http://localhost${url}`, { headers: { cookie: await cookie(as) } }) as unknown as Request,
    params: {},
    context: context(flags),
  } as never);
}

async function post(fields: Record<string, string | UndiciFile>, { as = ownerId, headers = {} }: { as?: string; headers?: Record<string, string> } = {}) {
  const body = new UndiciFormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return action({
    request: new UndiciRequest("http://localhost/move-in", { method: "POST", headers: { cookie: await cookie(as), ...headers }, body }) as unknown as Request,
    params: {},
    context: context(),
  } as never) as Promise<unknown>;
}

function backup() {
  const { tables, keys } = mealieDatabase();
  return new UndiciFile([makeZip([
    { name: "database.json", data: JSON.stringify(tables) },
    { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: webp, store: true },
  ])], "mealie_2026.11.23.zip", { type: "application/zip" });
}

beforeEach(async () => {
  await cleanupDatabase();
  d1 = sqliteD1();
  photos = memoryBucket();
  waiting = [];
  ownerId = (await createUser(db, "cook@example.com", "cook", "testPassword123")).id;
  otherId = (await createUser(db, "pat@example.com", "pat", "testPassword123")).id;
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("the Move in page", () => {
  it("isn't there while the move_in flag is off", async () => {
    await expect(load("/move-in", { flags: "" })).rejects.toMatchObject({ status: 404 });
  });

  it("offers the upload form when nothing is moving in", async () => {
    expect(await load("/move-in")).toEqual({ move: null, maxBytes: 50 * 1024 * 1024 });
  });

  it("moves a backup in and shows what arrived", async () => {
    const result = await post({ app: "mealie", backup: backup() });
    expect(result).toBeInstanceOf(Response);
    const location = (result as Response).headers.get("Location") as string;
    expect(location).toMatch(/^\/move-in\?job=movein_/);
    await Promise.all(waiting);

    const { move } = await load(location);
    expect(move).toMatchObject({
      status: "done-with-issues",
      finished: true,
      archiveName: "mealie_2026.11.23.zip",
      recipes: { found: 3, done: 3, created: 3, failed: 0 },
      photos: { found: 1, in: 1 },
      failure: null,
    });
    expect(move?.notes.map((note) => note.message)).toContain("Spoonjoy doesn't have tags, categories or tools yet, so 1 tag, 1 category, 1 tool stayed in the backup.");
    expect(await db.recipe.count({ where: { chefId: ownerId } })).toBe(3);
    // Only the moved-in cover is left in storage: the backup is gone.
    expect(Object.keys(photos.objects)).toEqual([expect.stringMatching(/^covers\/import\/movein-/)]);
  });

  it("counts a photo already here as in when the same backup moves in again", async () => {
    await post({ app: "mealie", backup: backup() });
    await Promise.all(waiting);
    waiting = [];
    const again = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);
    expect((await load(again)).move).toMatchObject({ recipes: { found: 3, created: 0, unchanged: 3 }, photos: { found: 1, in: 1 } });
  });

  it("keeps a move-in going each time the page asks", async () => {
    const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    const jobId = new URL(location, "http://localhost").searchParams.get("job") as string;
    await Promise.all(waiting);
    waiting = [];
    expect(await post({ intent: "continue", jobId })).toEqual({ error: null });
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
  });

  it("says what to do when no file is chosen, or the file isn't a backup", async () => {
    expect(await post({ app: "mealie" })).toMatchObject({ init: { status: 400 }, data: { error: "Choose your backup's .zip file first, then press Move in." } });
    const notZip = new UndiciFile(["hello"], "notes.zip", { type: "application/zip" });
    expect(await post({ app: "mealie", backup: notZip })).toMatchObject({ init: { status: 400 }, data: { error: expect.stringMatching(/^That file isn't a zip archive/) } });
    expect(await post({ app: "other", backup: backup() })).toMatchObject({ data: { error: expect.stringMatching(/^Move-in reads backups only/) } });
    expect(photos.objects).toEqual({});
  });

  it("refuses an upload bigger than a backup can be before reading it", async () => {
    expect(await post({ app: "mealie", backup: backup() }, { headers: { "Content-Length": String(60 * 1024 * 1024) } })).toMatchObject({ init: { status: 413 } });
  });

  it("shows a move-in only to the person it belongs to", async () => {
    const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);
    const jobId = new URL(location, "http://localhost").searchParams.get("job") as string;
    await expect(load(location, { as: otherId })).rejects.toMatchObject({ status: 404 });
    await expect(post({ intent: "continue", jobId }, { as: otherId })).rejects.toMatchObject({ status: 404 });
  });
});
