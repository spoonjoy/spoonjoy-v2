// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Parts of 4 KiB here, so a backup of a few parts stays small; the rules are the same at 10 MiB.
vi.mock("~/domains/move-in/model/backup-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/domains/move-in/model/backup-upload")>()),
  MOVE_IN_PART_BYTES: 4096,
}));
import { MOVE_IN_BACKUP_MAX_BYTES, MOVE_IN_PART_BYTES } from "~/domains/move-in/model/backup-upload";
import {
  MOVE_IN_UPLOAD_KEPT_MS,
  abortBackupUpload,
  beginBackupUpload,
  finishBackupUpload,
  putBackupPart,
} from "~/domains/move-in/adapters/worker/backup-upload.server";
import { createUploadJob, deleteUpload } from "~/domains/move-in/adapters/storage/upload-store.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";
import { multipartBucket, type MemoryMultipartBucket } from "./support/multipart-bucket";

/** The SHA-256 of a backup's first MiB, as the page sends it: one hex digit, 64 times, stands in for one. */
const head = (digit: string) => digit.repeat(64);
const HEAD = head("a");

let database: MigratedSqlite;
let bucket: MemoryMultipartBucket;
const now = new Date("2026-11-24T12:00:00.000Z");
const later = (ms: number) => new Date(now.getTime() + ms);

/** A backup of just over two parts: the database, and a stored filler photo to make it that big. */
function backup(): Uint8Array {
  return makeZip([
    { name: "database.json", data: JSON.stringify(mealieDatabase().tables) },
    { name: "data/recipes/filler/images/original.webp", data: new Uint8Array(2 * MOVE_IN_PART_BYTES), store: true },
  ]);
}

const env = () => ({ DB: database.binding, PHOTOS: bucket }) as never;
const rows = (sql: string) => database.sqlite.prepare(sql).all();

function begin(bytes: Uint8Array, overrides: Partial<Parameters<typeof beginBackupUpload>[0]> = {}) {
  return beginBackupUpload({ env: env(), ownerId: "chef-1", app: "mealie", name: "mealie.zip", size: bytes.length, head: HEAD, now, ...overrides });
}

function part(bytes: Uint8Array, uploadId: string, n: number, { ownerId = "chef-1", length }: { ownerId?: string; length?: number | null } = {}) {
  const slice = bytes.slice((n - 1) * MOVE_IN_PART_BYTES, n * MOVE_IN_PART_BYTES);
  return putBackupPart({
    env: env(),
    ownerId,
    uploadId,
    partNumber: n,
    contentLength: length === undefined ? slice.length : length,
    body: new Blob([slice]).stream(),
  });
}

const finish = (uploadId: string, app = "mealie") => finishBackupUpload({ env: env(), ownerId: "chef-1", uploadId, app, now });

async function sendAll(bytes: Uint8Array) {
  const begun = await begin(bytes);
  if (!begun.ok) throw new Error(begun.code);
  for (let n = 1; n <= begun.partCount; n++) expect(await part(bytes, begun.uploadId, n)).toEqual({ ok: true, partNumber: n });
  return begun.uploadId;
}

beforeEach(() => {
  database = migratedSqliteD1();
  bucket = multipartBucket();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef'), ('chef-2', 'pat@example.com', 'pat')`).run();
});

afterEach(() => database.close());

describe("beginning an upload", () => {
  it("starts an upload in parts where backups wait, and records it", async () => {
    const bytes = backup();
    const begun = await begin(bytes);
    expect(begun).toEqual({ ok: true, uploadId: expect.stringMatching(/^upload_/), partSize: MOVE_IN_PART_BYTES, partCount: 3, done: [] });
    const [upload] = [...bucket.uploads.values()];
    expect(upload.key).toMatch(/^pending-uploads\/move-in\/chef-1\/[0-9a-f-]{36}\.zip$/);
    expect(rows(`SELECT "ownerId", "fingerprint", "archiveKey", "uploadId", "name", "size", "partSize", "startedAt", "jobId" FROM "ImportUpload"`)).toEqual([
      { ownerId: "chef-1", fingerprint: JSON.stringify(["mealie.zip", bytes.length, HEAD]), archiveKey: upload.key, uploadId: "r2-upload-1", name: "mealie.zip", size: bytes.length, partSize: MOVE_IN_PART_BYTES, startedAt: now.toISOString(), jobId: null },
    ]);
  });

  it.each([
    ["an app it can't read yet", { app: "paprika" }, "unknown-app"],
    ["an app name that is only a property of every object", { app: "toString" }, "unknown-app"],
    ["an empty file", { size: 0 }, "no-file"],
    ["a size that isn't a whole number", { size: 1.5 }, "no-file"],
    ["a backup over the largest it takes", { size: MOVE_IN_BACKUP_MAX_BYTES + 1 }, "backup-too-large"],
  ])("refuses %s before storing anything", async (_name, overrides, code) => {
    expect(await begin(new Uint8Array(1), overrides)).toEqual({ ok: false, code });
    expect(bucket.uploads.size).toBe(0);
  });

  it("resumes the unfinished upload of the same file, with the parts that arrived", async () => {
    const bytes = backup();
    const first = await begin(bytes);
    if (!first.ok) throw new Error("not begun");
    await part(bytes, first.uploadId, 2);
    // By the id the page kept, and by the file's name, size and head when the page kept nothing.
    expect(await begin(bytes, { resume: first.uploadId, now: later(60_000) })).toEqual({ ...first, done: [2] });
    expect(await begin(bytes, { resume: null, now: later(60_000) })).toEqual({ ...first, done: [2] });
    expect(bucket.uploads.size).toBe(1);
  });

  it("starts afresh for another file, another cook, a finished upload, or one about to be swept", async () => {
    const bytes = backup();
    const first = await begin(bytes);
    if (!first.ok) throw new Error("not begun");
    // The id it names is for another file, so it goes by this file's name, size and head, and there is none.
    expect(await begin(bytes, { head: head("b"), resume: first.uploadId })).toMatchObject({ ok: true, uploadId: expect.not.stringMatching(first.uploadId) });
    expect(await begin(bytes, { name: "other.zip" })).toMatchObject({ ok: true, uploadId: expect.not.stringMatching(first.uploadId) });
    expect(await begin(bytes, { ownerId: "chef-2", resume: first.uploadId })).toMatchObject({ ok: true, uploadId: expect.not.stringMatching(first.uploadId) });
    expect(await begin(bytes, { now: later(MOVE_IN_UPLOAD_KEPT_MS - 60 * 60 * 1000 + 1) })).toMatchObject({ ok: true, uploadId: expect.not.stringMatching(first.uploadId) });
    database.sqlite.prepare(`UPDATE "ImportUpload" SET "jobId" = 'movein_x'`).run();
    expect(await begin(bytes, { resume: first.uploadId })).toMatchObject({ ok: true, uploadId: expect.not.stringMatching(first.uploadId) });
  });

  it("aborts the upload in parts when it can't record it", async () => {
    database.sqlite.prepare(`DELETE FROM "User" WHERE "id" = 'chef-1'`).run();
    await expect(begin(backup())).rejects.toThrow(/FOREIGN KEY/);
    expect([...bucket.uploads.values()].map((upload) => upload.state)).toEqual(["aborted"]);
  });

  it("still passes on the failure when the abort fails too", async () => {
    database.sqlite.prepare(`DELETE FROM "User" WHERE "id" = 'chef-1'`).run();
    const create = bucket.createMultipartUpload;
    bucket.createMultipartUpload = async (key) => ({ ...(await create(key)), abort: () => Promise.reject(new Error("R2 is down")) });
    await expect(begin(backup())).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("sending a part", () => {
  it("streams the part to storage and records it; a part sent again replaces the first", async () => {
    const bytes = backup();
    const begun = await begin(bytes);
    if (!begun.ok) throw new Error("not begun");
    expect(await part(bytes, begun.uploadId, 3)).toEqual({ ok: true, partNumber: 3 });
    expect(await part(bytes, begun.uploadId, 3)).toEqual({ ok: true, partNumber: 3 });
    const stored = [...bucket.uploads.values()][0].parts.get(3);
    expect(stored?.bytes).toEqual(bytes.slice(2 * MOVE_IN_PART_BYTES));
    expect(rows(`SELECT "partNumber", "etag", "size" FROM "ImportUploadPart"`)).toEqual([{ partNumber: 3, etag: stored?.etag, size: bytes.length - 2 * MOVE_IN_PART_BYTES }]);
  });

  it("refuses a part for an upload that isn't there or is someone else's", async () => {
    const bytes = backup();
    const begun = await begin(bytes);
    if (!begun.ok) throw new Error("not begun");
    expect(await part(bytes, "upload_nope", 1)).toEqual({ ok: false, code: "upload-gone" });
    expect(await part(bytes, begun.uploadId, 1, { ownerId: "chef-2" })).toEqual({ ok: false, code: "upload-gone" });
  });

  it.each([
    ["a part number below the first", 0, undefined, "no-such-part"],
    ["a part number past the last", 4, undefined, "no-such-part"],
    ["a part number that isn't whole", 1.5, undefined, "no-such-part"],
    ["a part that isn't the part size", 1, MOVE_IN_PART_BYTES - 1, "wrong-part-size"],
    ["a part with no length", 1, null, "wrong-part-size"],
  ])("refuses %s, and stores nothing", async (_name, n, length, code) => {
    const bytes = backup();
    const begun = await begin(bytes);
    if (!begun.ok) throw new Error("not begun");
    expect(await putBackupPart({ env: env(), ownerId: "chef-1", uploadId: begun.uploadId, partNumber: n, contentLength: length === undefined ? MOVE_IN_PART_BYTES : length, body: new Blob(["x"]).stream() }))
      .toEqual({ ok: false, code });
    expect(rows(`SELECT * FROM "ImportUploadPart"`)).toEqual([]);
  });

  it("refuses a part with no body", async () => {
    const begun = await begin(backup());
    if (!begun.ok) throw new Error("not begun");
    expect(await putBackupPart({ env: env(), ownerId: "chef-1", uploadId: begun.uploadId, partNumber: 1, contentLength: MOVE_IN_PART_BYTES, body: null }))
      .toEqual({ ok: false, code: "wrong-part-size" });
  });

  it("refuses a part once the upload has become a move-in", async () => {
    const bytes = backup();
    const uploadId = await sendAll(bytes);
    await finish(uploadId);
    expect(await part(bytes, uploadId, 1)).toEqual({ ok: false, code: "finished" });
  });
});

describe("finishing an upload", () => {
  it("puts the parts together, checks the backup, and creates its move-in", async () => {
    const bytes = backup();
    const uploadId = await sendAll(bytes);
    const finished = await finish(uploadId);
    expect(finished).toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/), started: true });
    const [upload] = [...bucket.uploads.values()];
    expect(bucket.objects[upload.key]).toEqual(bytes);
    expect(rows(`SELECT "id", "kind", "status", "archiveKey", "archiveName" FROM "ImportJob"`)).toEqual([
      { id: finished.ok && finished.jobId, kind: "mealie-backup", status: "queued", archiveKey: upload.key, archiveName: "mealie.zip" },
    ]);
    expect(rows(`SELECT "jobId" FROM "ImportUpload"`)).toEqual([{ jobId: finished.ok && finished.jobId }]);
  });

  it("answers a finish sent again with the same move-in, and starts it only once", async () => {
    const uploadId = await sendAll(backup());
    const first = await finish(uploadId);
    expect(await finish(uploadId)).toEqual({ ok: true, jobId: first.ok && first.jobId, started: false });
    expect(rows(`SELECT COUNT(*) AS n FROM "ImportJob"`)).toEqual([{ n: 1 }]);
  });

  it("makes one move-in of two finishes at once", async () => {
    const uploadId = await sendAll(backup());
    const [one, two] = await Promise.all([finish(uploadId), finish(uploadId)]);
    expect(one.ok && two.ok && one.jobId === two.jobId).toBe(true);
    // Only the finish that created the move-in starts it.
    expect([one, two].map((finished) => finished.ok && finished.started).sort()).toEqual([false, true]);
    expect(rows(`SELECT COUNT(*) AS n FROM "ImportJob"`)).toEqual([{ n: 1 }]);
  });

  it("carries on when an earlier finish put the parts together but its job wasn't saved", async () => {
    const uploadId = await sendAll(backup());
    const batch = database.binding.batch;
    database.binding.batch = (statements) =>
      (statements as Array<{ sql: string }>).some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : batch(statements);
    await expect(finish(uploadId)).rejects.toThrow("D1 is down");
    // The backup stays for the finish sent again; the archive sweep deletes it if none comes.
    expect(Object.keys(bucket.objects)).toHaveLength(1);
    database.binding.batch = batch;
    expect(await finish(uploadId)).toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/), started: true });
  });

  it("forgets an upload storage won't put together, so the page sends the backup afresh", async () => {
    const uploadId = await sendAll(backup());
    database.sqlite.prepare(`UPDATE "ImportUploadPart" SET "etag" = 'etag-stale' WHERE "partNumber" = 1`).run();
    expect(await finish(uploadId)).toEqual({ ok: false, code: "upload-gone" });
    expect([...bucket.uploads.values()].map((upload) => upload.state)).toEqual(["aborted"]);
    expect(rows(`SELECT * FROM "ImportUpload"`)).toEqual([]);
    expect(rows(`SELECT * FROM "ImportUploadPart"`)).toEqual([]);
  });

  it("forgets an upload whose backup was swept before it became a move-in, rather than failing every finish", async () => {
    const uploadId = await sendAll(backup());
    const batch = database.binding.batch;
    database.binding.batch = (statements) =>
      (statements as Array<{ sql: string }>).some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : batch(statements);
    await expect(finish(uploadId)).rejects.toThrow("D1 is down");
    database.binding.batch = batch;
    // The archive sweep deletes the backup, which no job names; its parts were already put together.
    for (const key of Object.keys(bucket.objects)) delete bucket.objects[key];
    expect(await finish(uploadId)).toEqual({ ok: false, code: "upload-gone" });
    expect(rows(`SELECT * FROM "ImportUpload"`)).toEqual([]);
  });

  it("names the parts still missing, counting one recorded at the wrong size as missing", async () => {
    const bytes = backup();
    const begun = await begin(bytes);
    if (!begun.ok) throw new Error("not begun");
    await part(bytes, begun.uploadId, 2);
    database.sqlite.prepare(`INSERT INTO "ImportUploadPart" ("uploadId", "partNumber", "etag", "size") VALUES (?, 3, 'etag-x', 5)`).run(begun.uploadId);
    expect(await finish(begun.uploadId)).toEqual({ ok: false, code: "missing-parts", missing: [1, 3] });
  });

  it("deletes a backup it turns away, with its upload, and says how to fix it", async () => {
    const bytes = makeZip([{ name: "notes.txt", data: "hi" }]);
    const uploadId = await sendAll(bytes);
    expect(await finish(uploadId)).toEqual({ ok: false, code: "not-a-backup" });
    expect(bucket.objects).toEqual({});
    expect(rows(`SELECT * FROM "ImportUpload"`)).toEqual([]);
    expect(rows(`SELECT * FROM "ImportUploadPart"`)).toEqual([]);
  });

  it("refuses an app it can't read, and an upload that isn't there", async () => {
    const uploadId = await sendAll(backup());
    expect(await finish(uploadId, "paprika")).toEqual({ ok: false, code: "unknown-app" });
    expect(await finish("upload_nope")).toEqual({ ok: false, code: "upload-gone" });
  });
});

describe("a cook's open uploads", () => {
  it("keeps three at most: beginning a new one aborts the oldest past that", async () => {
    const bytes = backup();
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) {
      const begun = await begin(bytes, { head: head(String(index)), now: later(index * 1000) });
      if (!begun.ok) throw new Error("not begun");
      ids.push(begun.uploadId);
    }
    expect(rows(`SELECT "id" FROM "ImportUpload" ORDER BY "startedAt"`)).toEqual(ids.slice(1).map((id) => ({ id })));
    expect([...bucket.uploads.values()].map((upload) => upload.state)).toEqual(["aborted", "open", "open", "open"]);
    // Another cook's uploads and finished ones don't count.
    expect((await begin(bytes, { ownerId: "chef-2", head: head("c") })).ok).toBe(true);
    expect(rows(`SELECT COUNT(*) AS n FROM "ImportUpload" WHERE "ownerId" = 'chef-1'`)).toEqual([{ n: 3 }]);
  });

  it("still begins when storage won't abort the oldest", async () => {
    const bytes = backup();
    for (let index = 0; index < 3; index++) await begin(bytes, { head: head(String(index)), now: later(index * 1000) });
    const [oldest] = [...bucket.uploads.values()];
    oldest.state = "aborted";
    expect((await begin(bytes, { head: head("3"), now: later(5000) })).ok).toBe(true);
    expect(rows(`SELECT COUNT(*) AS n FROM "ImportUpload"`)).toEqual([{ n: 3 }]);
  });
});

describe("stopping an upload", () => {
  it("aborts the upload in parts and forgets it", async () => {
    const bytes = backup();
    const begun = await begin(bytes);
    if (!begun.ok) throw new Error("not begun");
    await part(bytes, begun.uploadId, 1);
    expect(await abortBackupUpload({ env: env(), ownerId: "chef-1", uploadId: begun.uploadId })).toEqual({ ok: true });
    expect([...bucket.uploads.values()].map((upload) => upload.state)).toEqual(["aborted"]);
    expect(rows(`SELECT * FROM "ImportUpload"`)).toEqual([]);
    expect(rows(`SELECT * FROM "ImportUploadPart"`)).toEqual([]);
  });

  it("deletes the backup whose parts were put together but never became a move-in", async () => {
    const uploadId = await sendAll(backup());
    const [upload] = [...bucket.uploads.values()];
    await bucket.resumeMultipartUpload(upload.key, "r2-upload-1").complete(
      [...upload.parts.entries()].map(([partNumber, { etag }]) => ({ partNumber, etag })),
    );
    expect(await abortBackupUpload({ env: env(), ownerId: "chef-1", uploadId })).toEqual({ ok: true });
    expect(bucket.objects).toEqual({});
  });

  it("refuses an upload that isn't there, or has become a move-in", async () => {
    const uploadId = await sendAll(backup());
    await finish(uploadId);
    expect(await abortBackupUpload({ env: env(), ownerId: "chef-2", uploadId })).toEqual({ ok: false, code: "upload-gone" });
    expect(await abortBackupUpload({ env: env(), ownerId: "chef-1", uploadId })).toEqual({ ok: false, code: "finished" });
  });
});

describe("the upload store", () => {
  it("says so when the upload a job is created for is gone", async () => {
    const begun = await begin(backup());
    if (!begun.ok) throw new Error("not begun");
    await deleteUpload(database.binding, begun.uploadId);
    await expect(createUploadJob(database.binding, { id: begun.uploadId, ownerId: "chef-1", archiveKey: "k", name: "n" }, { kind: "mealie-backup", now }))
      .rejects.toThrow(/is gone/);
  });
});
