// @vitest-environment node
// The Move in page: behind the move_in flag, it takes a backup zip, starts the move-in, keeps it
// running in the request's waitUntil, and shows the owner (and only the owner) how it went.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => [] as Array<{ error: unknown; distinctId: string; route?: string }>);
const runFails = vi.hoisted(() => ({ with: null as Error | null }));
vi.mock("~/domains/move-in", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/domains/move-in")>();
  return {
    ...real,
    runForAWhile: (...args: Parameters<typeof real.runForAWhile>) =>
      runFails.with ? Promise.reject(runFails.with) : real.runForAWhile(...args),
  };
});
// Prisma on D1 in the Worker; here, the tests' own SQLite, the file the D1 stand-in opens too.
vi.mock("~/lib/db.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/lib/db.server")>();
  // db is assigned once the local database opens, so it is read through, not copied.
  return { ...real, get db() { return real.db; }, getDb: vi.fn(() => real.getLocalDb()) };
});
vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: async (_config: unknown, input: { error: unknown; distinctId: string; route?: string }) => void captured.push(input),
}));
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
/** The Worker's jobs queue, when the test gives it one: what it was sent, and whether sending fails. */
let jobsQueue: { sent: unknown[]; fails: boolean; send(body: unknown): Promise<void> } | undefined;

async function cookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

/** What the Worker hands a request; a test can leave the photo bucket or the waitUntil context out. */
const platform = { photos: true, ctx: true };

function context(flags: string | undefined = "move_in") {
  return {
    cloudflare: {
      env: { DB: d1.binding, PHOTOS: platform.photos ? photos : undefined, SPOONJOY_FLAGS: flags, JOBS: jobsQueue },
      ctx: platform.ctx ? { waitUntil: (promise: Promise<unknown>) => void waiting.push(promise), passThroughOnException() {} } : undefined,
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

// `plain` sends the fields url-encoded, as the page's progress checks are sent; otherwise they go as multipart.
async function post(fields: Record<string, string | UndiciFile>, { as = ownerId, headers = {}, flags, plain = false }: { as?: string; headers?: Record<string, string>; flags?: string; plain?: boolean } = {}) {
  const form = new UndiciFormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const body = plain ? new URLSearchParams(fields as Record<string, string>) : form;
  return action({
    request: new UndiciRequest("http://localhost/move-in", { method: "POST", headers: { cookie: await cookie(as), ...headers }, body }) as unknown as Request,
    params: {},
    context: context(flags),
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
  captured.length = 0;
  runFails.with = null;
  platform.photos = true;
  platform.ctx = true;
  jobsQueue = undefined;
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
    expect(await load("/move-in")).toEqual({ move: null, uploadMaxBytes: 2 * 1024 * 1024 * 1024 });
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
      runsOnServer: false,
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

  it("puts the backup's tags, categories and tools on the recipes for a cook with organizers, and counts them", async () => {
    const flags = "move_in,organizers";
    const location = ((await post({ app: "mealie", backup: backup() }, { flags })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);

    const { move } = await load(location, { flags });
    expect(move?.organizers).toEqual({ tags: 1, categories: 1, tools: 1 });
    expect(move?.notes.some((note) => note.message.includes("stayed in the backup"))).toBe(false);
    const pancakes = await (db as NonNullable<typeof db>).recipe.findFirstOrThrow({
      where: { chefId: ownerId, title: "Pancakes" },
      select: { organizers: { select: { organizer: { select: { kind: true, name: true } } } } },
    });
    expect(pancakes.organizers.map(({ organizer }) => `${organizer.kind} ${organizer.name}`).sort()).toEqual(["category Dinner", "tag Quick"]);
  });

  it("counts a photo already here as in when the same backup moves in again", async () => {
    await post({ app: "mealie", backup: backup() });
    await Promise.all(waiting);
    waiting = [];
    const again = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);
    expect((await load(again)).move).toMatchObject({ recipes: { found: 3, created: 0, already: 3, updated: 0, unchanged: 3 }, photos: { found: 1, in: 1 } });
  });

  it("lists recipes that got a number apart from the notes", async () => {
    await db.recipe.create({ data: { title: "Soup", chefId: ownerId } });
    const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);
    const { move } = await load(location);
    expect(move?.renamed).toEqual([{ seq: expect.any(Number), message: 'You already had a recipe called "Soup", so this one is "Soup (2)".' }]);
    expect(move?.notes.map((note) => note.message)).not.toContain('You already had a recipe called "Soup", so this one is "Soup (2)".');
  });

  it("notes a recipe whose cook's version stays", async () => {
    await post({ app: "mealie", backup: backup() });
    await Promise.all(waiting);
    waiting = [];
    const soup = await db.recipe.findFirstOrThrow({ where: { chefId: ownerId, title: "Soup" } });
    await db.recipe.update({ where: { id: soup.id }, data: { description: "My own soup." } });
    // The backup's soup changed as well.
    await d1.binding.prepare(`UPDATE "SourceRecord" SET "contentHash" = 'before' WHERE "targetId" = ?`).bind(soup.id).run();
    const again = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);
    const { move } = await load(again);
    expect(move?.recipes).toMatchObject({ already: 3, updated: 0 });
    expect(move?.notes).toContainEqual({ seq: expect.any(Number), level: "info", message: "Soup changed in the backup, but you've changed it in Spoonjoy too, so your version stays." });
  });

  it("keeps a move-in going each time the page asks", async () => {
    const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    const jobId = new URL(location, "http://localhost").searchParams.get("job") as string;
    await Promise.all(waiting);
    waiting = [];
    expect(await post({ intent: "continue", jobId }, { plain: true })).toEqual({ error: null });
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
  });

  describe("where the Worker has a jobs queue", () => {
    beforeEach(() => {
      const queue = {
        sent: [] as unknown[],
        fails: false,
        async send(body: unknown) {
          if (queue.fails) throw new Error("the queue is down");
          queue.sent.push(body);
        },
      };
      jobsQueue = queue;
    });

    const started = async () => {
      const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
      return { location, jobId: new URL(location, "http://localhost").searchParams.get("job") as string };
    };

    it("hands the move-in to the queue, runs none of it in the request, and says the page can close", async () => {
      const { location, jobId } = await started();
      expect(waiting).toEqual([]);
      expect(jobsQueue?.sent).toEqual([
        { type: "move-in.watch", key: `move-in:${jobId}:watch:1`, payload: { jobId, look: 1 } },
        { type: "move-in.run", key: `move-in:${jobId}:inspect:-`, payload: { jobId, queuedAt: expect.any(Number) } },
      ]);
      expect((await load(location)).move).toMatchObject({ status: "queued", finished: false, runsOnServer: true });
    });

    it("says how long is left from the rate since recipes began to come in, and nothing before that or once it's finished", async () => {
      const { location, jobId } = await started();
      // The job waited and read its backup for 20 minutes; recipes began coming in when that phase was done.
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000).toISOString();
      await d1.binding.prepare(`UPDATE "ImportJob" SET "createdAt" = ?, "status" = 'running'`).bind(twentyMinutesAgo).run();
      await d1.binding
        .prepare(`INSERT INTO "ImportEntityCount" ("jobId", "entity", "found", "created", "updated", "unchanged", "skipped", "failed") VALUES (?, 'recipes', 500, 100, 0, 0, 0, 0)`)
        .bind(jobId)
        .run();
      // No recipes phase yet, so no rate to go on.
      expect((await load(location)).move?.timeLeft).toBeNull();
      // 100 of 500 in 130 s since then: 400 more at that rate is 520 s, about 9 minutes (away from a minute's edge, so the test's own time doesn't tip it).
      const recipesBegan = new Date(Date.now() - 130_000).toISOString();
      await d1.binding
        .prepare(`INSERT INTO "ImportEvent" ("id", "jobId", "seq", "level", "kind", "message", "createdAt") VALUES ('event_found', ?, 1, 'info', 'phase-done', 'Found 500 recipes.', ?)`)
        .bind(jobId, recipesBegan)
        .run();
      expect((await load(location)).move?.timeLeft).toBe("About 9 minutes left");
      await d1.binding.prepare(`UPDATE "ImportJob" SET "status" = 'done'`).run();
      expect((await load(location)).move?.timeLeft).toBeNull();
    });

    it("queues a move-in again from the page only once nothing has moved it for a minute", async () => {
      const { jobId } = await started();
      expect(await post({ intent: "continue", jobId })).toEqual({ error: null });
      expect(jobsQueue?.sent).toHaveLength(2);
      expect(waiting).toEqual([]);

      // Its segment's run died and nothing has written to the job since; its own key still waits.
      const quiet = new Date(Date.now() - 61_000).toISOString();
      await d1.binding.prepare(`UPDATE "ImportJob" SET "updatedAt" = ?`).bind(quiet).run();
      await post({ intent: "continue", jobId });
      await post({ intent: "continue", jobId });
      expect(jobsQueue?.sent).toHaveLength(3);
      expect(jobsQueue?.sent.at(-1)).toEqual({ type: "move-in.run", key: expect.stringMatching(new RegExp(`^move-in:${jobId}:nudge:${quiet}:\\d+$`)), payload: { jobId, queuedAt: expect.any(Number) } });
    });

    it("reports a move-in it couldn't queue, and leaves it for the page to pick up", async () => {
      jobsQueue!.fails = true;
      const { location, jobId } = await started();
      expect(location).toMatch(/^\/move-in\?job=movein_/);
      await d1.binding.prepare(`UPDATE "ImportJob" SET "updatedAt" = ?`).bind(new Date(Date.now() - 61_000).toISOString()).run();
      expect(await post({ intent: "continue", jobId })).toEqual({ error: null });
      expect(captured).toEqual([
        { error: new Error("the queue is down"), distinctId: ownerId, route: "/move-in", extras: { phase: "queue" } },
        { error: new Error("the queue is down"), distinctId: ownerId, route: "/move-in", extras: { phase: "queue" } },
      ]);
    });
  });

  it("reports a run that stops with an error, for the next poll to resume", async () => {
    runFails.with = new Error("storage is down");
    await post({ app: "mealie", backup: backup() });
    await Promise.all(waiting);
    expect(captured).toEqual([{ error: runFails.with, distinctId: ownerId, route: "/move-in", extras: { phase: "run" } }]);
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

  it("says so when the server has no photo storage", async () => {
    platform.photos = false;
    await expect(load("/move-in")).rejects.toMatchObject({ status: 503 });
  });

  it("starts a move-in that waits for its first run where nothing keeps a request going", async () => {
    platform.ctx = false;
    const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    expect(waiting).toEqual([]);
    const { move } = await load(location);
    expect(move).toMatchObject({ status: "queued", finished: false, recipes: { found: 0, done: 0 }, photos: { found: 0, in: 0 } });
  });

  it("asks for an app and a move-in by name", async () => {
    expect(await post({ backup: backup() })).toMatchObject({ init: { status: 400 } });
    await expect(post({ intent: "continue" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a backup bigger than a backup can be once it has read it", async () => {
    const big = new UndiciFile([new Uint8Array(50 * 1024 * 1024 + 1)], "mealie.zip", { type: "application/zip" });
    expect(await post({ app: "mealie", backup: big })).toMatchObject({ init: { status: 413 } });
  });

  it("shows a move-in only to the person it belongs to", async () => {
    const location = ((await post({ app: "mealie", backup: backup() })) as Response).headers.get("Location") as string;
    await Promise.all(waiting);
    const jobId = new URL(location, "http://localhost").searchParams.get("job") as string;
    await expect(load(location, { as: otherId })).rejects.toMatchObject({ status: 404 });
    await expect(post({ intent: "continue", jobId }, { as: otherId })).rejects.toMatchObject({ status: 404 });
  });
});
