// @vitest-environment node
// The Move in page's upload endpoints: begin, send each part, finish (which starts the move-in) or
// stop. Each is behind the same gate as the page, takes only its own methods, and refuses another
// site's request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Parts of 4 KiB here, so a backup of a few parts stays small; the rules are the same at 10 MiB.
vi.mock("~/domains/move-in/model/backup-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/domains/move-in/model/backup-upload")>()),
  MOVE_IN_PART_BYTES: 4096,
}));
const captured = vi.hoisted(() => [] as Array<{ error: unknown; distinctId: string; route?: string }>);
vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: async (_config: unknown, input: { error: unknown; distinctId: string; route?: string }) => void captured.push(input),
}));
// Prisma on D1 in the Worker; here, the tests' own SQLite, the file the D1 stand-in opens too.
vi.mock("~/lib/db.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/lib/db.server")>();
  return { ...real, get db() { return real.db; }, getDb: vi.fn(() => real.getLocalDb()) };
});
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import * as begin from "~/routes/move-in.uploads";
import * as upload from "~/routes/move-in.uploads.$uploadId";
import * as parts from "~/routes/move-in.uploads.$uploadId.parts.$partNumber";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { makeZip } from "../domains/move-in/support/make-zip";
import { mealieDatabase } from "../domains/move-in/support/mealie-database";
import { multipartBucket, type MemoryMultipartBucket } from "../domains/move-in/support/multipart-bucket";

const PART = 4096;
let d1: SqliteD1;
let photos: MemoryMultipartBucket;
let ownerId: string;
let waiting: Array<Promise<unknown>>;
let jobsQueue: { sent: unknown[]; fails: boolean; send(body: unknown): Promise<void> } | undefined;
let env: Record<string, unknown>;

async function cookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function context() {
  return {
    cloudflare: { env, ctx: { waitUntil: (promise: Promise<unknown>) => void waiting.push(promise), passThroughOnException() {} } },
  } as never;
}

interface Call {
  method?: string;
  body?: BodyInit;
  json?: unknown;
  headers?: Record<string, string>;
  as?: string | null;
}

async function request(path: string, { method = "POST", body, json, headers = {}, as = ownerId }: Call) {
  return new UndiciRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(as ? { cookie: await cookie(as) } : {}),
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      Origin: "http://localhost",
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
    duplex: "half",
  } as never) as unknown as Request;
}

const answer = async (response: Promise<Response>) => {
  const settled = await response;
  return { status: settled.status, body: settled.status === 405 ? null : await settled.json() };
};

const beginUpload = async (json: unknown, call: Call = {}) => answer(begin.action({ request: await request("/move-in/uploads", { json, ...call }), params: {}, context: context() } as never));

const sendPart = async (uploadId: string, n: string, bytes: Uint8Array, call: Call = {}) =>
  answer(parts.action({
    request: await request(`/move-in/uploads/${uploadId}/parts/${n}`, { method: "PUT", body: bytes, headers: { "Content-Length": String(bytes.length) }, ...call }),
    params: { uploadId, partNumber: n },
    context: context(),
  } as never));

const finishUpload = async (uploadId: string, call: Call = {}) =>
  answer(upload.action({ request: await request(`/move-in/uploads/${uploadId}`, { json: { app: "mealie" }, ...call }), params: { uploadId }, context: context() } as never));

function backup() {
  return makeZip([
    { name: "database.json", data: JSON.stringify(mealieDatabase().tables) },
    { name: "data/recipes/filler/images/original.webp", data: new Uint8Array(2 * PART), store: true },
  ]);
}

const H = "a".repeat(64);
const file = (bytes: Uint8Array) => ({ app: "mealie", name: "mealie.zip", size: bytes.length, head: H });

async function sendAll(bytes: Uint8Array) {
  const begun = await beginUpload(file(bytes));
  for (let n = 1; n <= begun.body.partCount; n++) {
    expect(await sendPart(begun.body.uploadId, String(n), bytes.slice((n - 1) * PART, n * PART))).toEqual({ status: 200, body: { partNumber: n } });
  }
  return begun.body.uploadId as string;
}

/** Removes the cook, and with them their uploads, parts and move-ins. */
const removeCook = async () => (await getLocalDb()).user.deleteMany({ where: { email: "cook@example.com" } });

beforeEach(async () => {
  await removeCook();
  d1 = sqliteD1();
  photos = multipartBucket();
  waiting = [];
  captured.length = 0;
  jobsQueue = undefined;
  env = { DB: d1.binding, PHOTOS: photos, SPOONJOY_FLAGS: "move_in" };
  ownerId = (await createUser(await getLocalDb(), "cook@example.com", "cook", "testPassword123")).id;
});

afterEach(async () => {
  d1.close();
  await removeCook();
});

describe("the upload endpoints", () => {
  it("send a backup in parts and start its move-in, which keeps running after the answer", async () => {
    const bytes = backup();
    const uploadId = await sendAll(bytes);
    const finished = await finishUpload(uploadId);
    expect(finished).toEqual({ status: 200, body: { jobId: expect.stringMatching(/^movein_/) } });
    expect(Object.values(photos.objects)).toEqual([bytes]);
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
    // A finish sent again answers with the same move-in and starts nothing more.
    expect(await finishUpload(uploadId)).toEqual(finished);
    expect(waiting).toHaveLength(1);
  });

  it("hand the move-in to the jobs queue where there is one, and report a queue that fails", async () => {
    jobsQueue = {
      sent: [],
      fails: false,
      async send(body) {
        if (jobsQueue!.fails) throw new Error("the queue is down");
        jobsQueue!.sent.push(body);
      },
    };
    env.JOBS = jobsQueue;
    const first = await finishUpload(await sendAll(backup()));
    expect(jobsQueue.sent).toContainEqual({ type: "move-in.run", key: `move-in:${first.body.jobId}:inspect:-`, payload: { jobId: first.body.jobId, queuedAt: expect.any(Number) } });
    expect(waiting).toEqual([]);
    jobsQueue.fails = true;
    await removeCook();
    ownerId = (await createUser(await getLocalDb(), "cook@example.com", "cook", "testPassword123")).id;
    expect((await finishUpload(await sendAll(backup()))).status).toBe(200);
    expect(captured).toEqual([{ error: new Error("the queue is down"), distinctId: ownerId, route: "/move-in", extras: { phase: "queue" } }]);
  });

  it("start over when asked, discarding the unfinished upload of the same file", async () => {
    const bytes = backup();
    const begun = await beginUpload(file(bytes));
    await sendPart(begun.body.uploadId, "2", bytes.slice(PART, 2 * PART));
    const fresh = await beginUpload({ ...file(bytes), resume: begun.body.uploadId, fresh: true });
    expect(fresh).toMatchObject({ status: 200, body: { done: [] } });
    expect(fresh.body.uploadId).not.toBe(begun.body.uploadId);
    expect(await sendPart(begun.body.uploadId, "1", bytes.slice(0, PART))).toMatchObject({ status: 404, body: { code: "upload-gone" } });
  });

  it("resume the unfinished upload of the same file with the parts that arrived", async () => {
    const bytes = backup();
    const begun = await beginUpload(file(bytes));
    await sendPart(begun.body.uploadId, "2", bytes.slice(PART, 2 * PART));
    expect(await beginUpload({ ...file(bytes), resume: begun.body.uploadId })).toEqual({ status: 200, body: { ...begun.body, done: [2] } });
    expect(await finishUpload(begun.body.uploadId)).toEqual({
      status: 409,
      body: { code: "missing-parts", missing: [1, 3], error: "Some parts of the backup haven't arrived yet. Send them, then finish again." },
    });
  });

  it("keep a long file name to its first 255 characters", async () => {
    const bytes = backup();
    await beginUpload({ ...file(bytes), name: `${"a".repeat(300)}.zip` });
    const [row] = (await d1.binding.prepare(`SELECT "name" FROM "ImportUpload"`).all<{ name: string }>()).results;
    expect(row.name).toBe("a".repeat(255));
  });

  it.each([
    ["no JSON", undefined, { "Content-Type": "text/plain" }],
    ["JSON that isn't an object", [1], {}],
    ["JSON that doesn't parse", "{", { "Content-Type": "application/json" }],
    ["no app", { name: "a.zip", size: 1, head: H }, {}],
    ["no name", { app: "mealie", name: "", size: 1, head: H }, {}],
    ["a name that isn't text", { app: "mealie", name: 1, size: 1, head: H }, {}],
    ["a size that isn't a number", { app: "mealie", name: "a.zip", size: "1", head: H }, {}],
    ["no head", { app: "mealie", name: "a.zip", size: 1 }, {}],
    ["a head that isn't text", { app: "mealie", name: "a.zip", size: 1, head: 1 }, {}],
    ["a head that isn't a SHA-256 in hex", { app: "mealie", name: "a.zip", size: 1, head: "A".repeat(64) }, {}],
    ["a head too short to be one", { app: "mealie", name: "a.zip", size: 1, head: "a".repeat(63) }, {}],
    ["a resume that isn't an id", { app: "mealie", name: "a.zip", size: 1, head: H, resume: 1 }, {}],
    ["a fresh that isn't true or false", { app: "mealie", name: "a.zip", size: 1, head: H, fresh: "yes" }, {}],
  ])("refuse a begin with %s", async (_name, json, headers) => {
    const call: Call = typeof json === "string" ? { body: json, headers } : json === undefined ? { body: "hi", headers } : { json, headers };
    expect(await beginUpload(undefined, call)).toEqual({ status: 400, body: { error: "Send the backup's app, name, size and head as JSON." } });
  });

  it("refuse a backup over the largest they take, with the fix-it message", async () => {
    expect(await beginUpload({ ...file(backup()), size: 3 * 1024 ** 3 })).toEqual({
      status: 413,
      body: { code: "backup-too-large", error: expect.stringMatching(/^That backup is larger/) },
    });
  });

  it("refuse a part that isn't one of the backup's, or isn't its size, and one for an upload that's gone", async () => {
    const bytes = backup();
    const { body } = await beginUpload(file(bytes));
    expect(await sendPart(body.uploadId, "abc", bytes.slice(0, PART))).toMatchObject({ status: 400, body: { code: "no-such-part" } });
    expect(await sendPart(body.uploadId, "1", bytes.slice(0, PART - 1))).toMatchObject({ status: 400, body: { code: "wrong-part-size" } });
    expect(await sendPart(body.uploadId, "1", bytes.slice(0, PART), { headers: { "Content-Length": "x" } })).toMatchObject({ status: 400, body: { code: "wrong-part-size" } });
    expect(await sendPart("upload_nope", "1", bytes.slice(0, PART))).toMatchObject({ status: 404, body: { code: "upload-gone" } });
  });

  it("answer a refused backup with the form's fix-it message, and a finish that sends no app", async () => {
    const uploadId = await sendAll(makeZip([{ name: "notes.txt", data: "hi" }]));
    expect(await finishUpload(uploadId, { json: {} })).toEqual({ status: 400, body: { error: "Send the backup's app as JSON." } });
    expect(await finishUpload(uploadId)).toEqual({ status: 400, body: { code: "not-a-backup", error: expect.stringMatching(/^That zip isn't a backup/) } });
    expect(await finishUpload(uploadId)).toMatchObject({ status: 404, body: { code: "upload-gone" } });
  });

  it("stop an unfinished upload, and say so for one that has become a move-in", async () => {
    const bytes = backup();
    const { body } = await beginUpload(file(bytes));
    const stop = async (uploadId: string) => answer(upload.action({ request: await request(`/move-in/uploads/${uploadId}`, { method: "DELETE" }), params: { uploadId }, context: context() } as never));
    expect(await stop(body.uploadId)).toEqual({ status: 200, body: { ok: true } });
    expect(await stop(body.uploadId)).toMatchObject({ status: 404, body: { code: "upload-gone" } });
    const uploadId = await sendAll(bytes);
    await finishUpload(uploadId);
    expect(await stop(uploadId)).toMatchObject({ status: 409, body: { code: "finished", error: "That backup has already arrived and is moving in." } });
  });

  it("take only their own methods, and answer a page load with 405", async () => {
    expect(await answer(begin.action({ request: await request("/move-in/uploads", { method: "PUT", body: "x" }), params: {}, context: context() } as never))).toEqual({ status: 405, body: null });
    const refused = await parts.action({ request: await request("/move-in/uploads/u/parts/1", { method: "POST", body: "x" }), params: { uploadId: "u", partNumber: "1" }, context: context() } as never);
    expect(refused.headers.get("Allow")).toBe("PUT");
    for (const [route, allow] of [[begin, "POST"], [upload, "POST, DELETE"], [parts, "PUT"]] as const) {
      const loaded = route.loader();
      expect([loaded.status, loaded.headers.get("Allow")]).toEqual([405, allow]);
    }
  });

  it("refuse another site's request, and take one from Spoonjoy's own public address", async () => {
    const bytes = backup();
    expect(await beginUpload(file(bytes), { headers: { Origin: "https://evil.example" } })).toEqual({ status: 403, body: { error: "Uploads must come from Spoonjoy's own Move in page." } });
    expect(await beginUpload(file(bytes), { headers: { Origin: "null" } })).toMatchObject({ status: 403 });
    env.SPOONJOY_BASE_URL = "https://spoonjoy.app";
    expect(await beginUpload(file(bytes), { headers: { Origin: "https://spoonjoy.app" } })).toMatchObject({ status: 200 });
    env.SPOONJOY_BASE_URL = "not a url";
    expect(await beginUpload(file(bytes), { headers: { Origin: "https://spoonjoy.app" } })).toMatchObject({ status: 403 });
  });

  it("let in only a signed-in cook with the move_in flag, on a server with storage", async () => {
    const bytes = backup();
    const status = async (call: Call) => {
      try {
        return (await beginUpload(file(bytes), call)).status;
      } catch (thrown) {
        return (thrown as Response).status;
      }
    };
    expect(await status({ as: null })).toBe(401);
    env.SPOONJOY_FLAGS = "";
    expect(await status({})).toBe(404);
    env.SPOONJOY_FLAGS = "move_in";
    env.PHOTOS = undefined;
    expect(await status({})).toBe(503);
  });
});
