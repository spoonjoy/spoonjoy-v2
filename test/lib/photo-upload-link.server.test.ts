import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsoleWarning } from "../warning-policy";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  PHOTO_UPLOAD_LINK_REFUSAL,
  PHOTO_UPLOAD_MAX_BYTES,
  PHOTO_UPLOAD_REFUSAL,
  PHOTO_UPLOAD_TTL_MS,
  photoUploadIsUsable,
  photoUploadPendingKey,
  receivePhotoUpload,
  signPhotoUploadLink,
  startPhotoUpload,
  spendPhotoUpload,
  verifyPhotoUploadLink,
} from "~/lib/photo-upload-link.server";
import { isServablePhotoKey as isServableByDelivery } from "~/lib/photo-variants";
import { isServablePhotoKey as isServableBySweep } from "~/lib/photo-lifecycle.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

const SECRET = "photo-upload-test-secret";
const BASE_URL = "https://spoonjoy.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);

/** An in-memory R2 bucket holding raw bytes, read back through `body` like the real one. */
function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    objects,
    put: vi.fn(async (key: string, value: Blob | ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }) => {
      const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value as ArrayBuffer);
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
      return {};
    }),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object ? { body: object.bytes, size: object.bytes.byteLength, httpEtag: '"e"', httpMetadata: { contentType: object.contentType } } : null;
    }),
    head: vi.fn(async (key: string) => (objects.has(key) ? { key } : null)),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }),
  };
  return bucket as typeof bucket & R2Bucket;
}

async function makeUser(db: Database) {
  return db.user.create({
    data: { email: `upload-${faker.string.alphanumeric(8).toLowerCase()}@example.com`, username: `upload_${faker.string.alphanumeric(8).toLowerCase()}` },
  });
}

function put(putUrl: string, body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(putUrl, { method: "PUT", body, headers });
}

function streamOf(size: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) {
        controller.close();
        return;
      }
      const chunk = new Uint8Array(Math.min(1024 * 1024, size - sent));
      chunk.set(PNG.subarray(0, Math.min(PNG.length, chunk.length)));
      sent += chunk.length;
      controller.enqueue(chunk);
    },
  });
}

describe("photo upload links", () => {
  let db: Database;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  describe("signing", () => {
    it("accepts only its own signature over exactly that uploadId and expiry", async () => {
      const uploadId = "pu_AAAAAAAAAAAAAAAAAAAAAA";
      const expiresAt = Date.now() + 60_000;
      const signature = await signPhotoUploadLink(SECRET, uploadId, expiresAt);

      expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await expect(verifyPhotoUploadLink(SECRET, uploadId, expiresAt, signature)).resolves.toBe(true);
      await expect(verifyPhotoUploadLink(SECRET, "pu_BAAAAAAAAAAAAAAAAAAAAA", expiresAt, signature)).resolves.toBe(false);
      await expect(verifyPhotoUploadLink(SECRET, uploadId, expiresAt + 1, signature)).resolves.toBe(false);
      await expect(verifyPhotoUploadLink("another-secret", uploadId, expiresAt, signature)).resolves.toBe(false);
      await expect(verifyPhotoUploadLink(SECRET, uploadId, expiresAt, `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`)).resolves.toBe(false);
      // The same bytes spelled with a spare bit set in the last character are refused too.
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const respelled = `${signature.slice(0, -1)}${alphabet[alphabet.indexOf(signature.at(-1)!) + 1]}`;
      expect(signature).toMatch(/[AEIMQUYcgkosw048]$/);
      await expect(verifyPhotoUploadLink(SECRET, uploadId, expiresAt, respelled)).resolves.toBe(false);
      await expect(verifyPhotoUploadLink(SECRET, uploadId, Number.NaN, signature)).resolves.toBe(false);
      await expect(verifyPhotoUploadLink(SECRET, "not-an-upload", expiresAt, signature)).resolves.toBe(false);
      await expect(verifyPhotoUploadLink(SECRET, uploadId, expiresAt, "short")).resolves.toBe(false);
    });
  });

  describe("starting an upload", () => {
    it("answers a signed single-use link on the base URL, bound to its owner, for about fifteen minutes", async () => {
      const owner = await makeUser(db);
      const now = new Date("2026-11-22T12:00:00.000Z");
      const started = await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket: memoryBucket(), now });

      expect(started).toEqual({
        uploadId: expect.stringMatching(/^pu_[A-Za-z0-9_-]{22}$/),
        putUrl: expect.any(String),
        expiresAt: new Date(now.getTime() + PHOTO_UPLOAD_TTL_MS).toISOString(),
        maxBytes: 5 * 1024 * 1024,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      });
      expect(PHOTO_UPLOAD_TTL_MS).toBe(15 * 60 * 1000);
      const url = new URL(started.putUrl);
      expect(url.origin).toBe(BASE_URL);
      expect(url.pathname).toBe(`/api/photo-uploads/${started.uploadId}`);
      expect(url.searchParams.get("exp")).toBe(String(now.getTime() + PHOTO_UPLOAD_TTL_MS));
      await expect(verifyPhotoUploadLink(SECRET, started.uploadId, Number(url.searchParams.get("exp")), url.searchParams.get("sig")!)).resolves.toBe(true);
      await expect(db.photoUpload.findUniqueOrThrow({ where: { id: started.uploadId } })).resolves.toMatchObject({ ownerId: owner.id, status: "pending" });
    });

    it("refuses without photo storage", async () => {
      const owner = await makeUser(db);
      await expect(startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET })).rejects.toMatchObject({ status: 503 });
    });

    it("starts anyway when clearing old uploads fails, and survives a D1 retry of its own write", async () => {
      const owner = await makeUser(db);
      const bucket = memoryBucket();
      await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket, now: new Date("2026-11-22T10:00:00.000Z") });
      bucket.delete.mockRejectedValueOnce(new Error("R2 down"));
      expectConsoleWarning(JSON.stringify({ event: "photo_upload.prune_failed", error: "Error" }));
      const create = db.photoUpload.create.bind(db.photoUpload);
      // The first try commits, then its answer is lost: the retry finds the row it wrote.
      const spy = vi.spyOn(db.photoUpload, "create").mockImplementationOnce((async (args: Parameters<typeof create>[0]) => {
        await create(args);
        throw new Error("D1_ERROR: Network connection lost.");
      }) as never);

      const started = await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket, now: new Date("2026-11-22T12:00:00.000Z") });

      await expect(db.photoUpload.findUniqueOrThrow({ where: { id: started.uploadId } })).resolves.toMatchObject({ ownerId: owner.id });
      spy.mockRestore();
      expectConsoleWarning(JSON.stringify({ event: "photo_upload.prune_failed", error: "unknown" }));
      bucket.delete.mockRejectedValueOnce("not an error");
      await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket, now: new Date("2026-11-22T14:00:00.000Z") });
    });

    it("clears expired uploads and their pending photos as new ones start", async () => {
      const owner = await makeUser(db);
      const bucket = memoryBucket();
      const old = await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket, now: new Date("2026-11-22T10:00:00.000Z") });
      bucket.objects.set(photoUploadPendingKey(owner.id, old.uploadId), { bytes: PNG });

      await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket, now: new Date("2026-11-22T12:00:00.000Z") });

      await expect(db.photoUpload.findUnique({ where: { id: old.uploadId } })).resolves.toBeNull();
      expect(bucket.objects.has(photoUploadPendingKey(owner.id, old.uploadId))).toBe(false);
    });
  });

  describe("the PUT", () => {
    async function started(bucket = memoryBucket()) {
      const owner = await makeUser(db);
      const link = await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket });
      return { owner, link, bucket };
    }

    it("stores a photo under pending-uploads, which /photos/ never serves, and spends the link", async () => {
      const { owner, link, bucket } = await started();
      const result = await receivePhotoUpload(db, { request: put(link.putUrl, JPEG), uploadId: link.uploadId, secret: SECRET, bucket });

      expect(result).toEqual({ status: 200, body: { uploadId: link.uploadId, status: "uploaded", mimeType: "image/jpeg", sizeBytes: JPEG.length } });
      const key = photoUploadPendingKey(owner.id, link.uploadId);
      expect(bucket.objects.get(key)).toEqual({ bytes: JPEG, contentType: "image/jpeg" });
      expect(isServableByDelivery(key)).toBe(false);
      expect(isServableBySweep(key)).toBe(false);
      expect(isServableByDelivery(`variants/w640/${key}.webp`)).toBe(false);

      const again = await receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET, bucket });
      expect(again).toEqual({ status: 403, body: { error: { code: "upload_link_invalid", message: PHOTO_UPLOAD_LINK_REFUSAL } } });
      expect(bucket.objects.get(key)?.bytes).toEqual(JPEG);
    });

    it("refuses a tampered, expired or unknown link with one answer", async () => {
      const { link, bucket } = await started();
      const url = new URL(link.putUrl);
      const expected = { status: 403, body: { error: { code: "upload_link_invalid", message: PHOTO_UPLOAD_LINK_REFUSAL } } };

      const tampered = new URL(url);
      tampered.searchParams.set("exp", String(Number(url.searchParams.get("exp")) + 60_000));
      await expect(receivePhotoUpload(db, { request: put(tampered.toString(), PNG), uploadId: link.uploadId, secret: SECRET, bucket })).resolves.toEqual(expected);

      const later = new Date(Number(url.searchParams.get("exp")) + 1);
      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET, bucket, now: later })).resolves.toEqual(expected);

      const unknownId = "pu_ZZZZZZZZZZZZZZZZZZZZZZ";
      const exp = Date.now() + 60_000;
      const unknown = `${BASE_URL}/api/photo-uploads/${unknownId}?exp=${exp}&sig=${await signPhotoUploadLink(SECRET, unknownId, exp)}`;
      await expect(receivePhotoUpload(db, { request: put(unknown, PNG), uploadId: unknownId, secret: SECRET, bucket })).resolves.toEqual(expected);

      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: "another-secret", bucket })).resolves.toEqual(expected);
      const unsigned = new URL(url);
      unsigned.searchParams.delete("sig");
      await expect(receivePhotoUpload(db, { request: put(unsigned.toString(), PNG), uploadId: link.uploadId, secret: SECRET, bucket })).resolves.toEqual(expected);
      expect(bucket.put).not.toHaveBeenCalled();
    });

    it("refuses a photo over the limit, by its declared length or while it streams, and keeps the link", async () => {
      const { link, bucket } = await started();
      const declared = await receivePhotoUpload(db, {
        // Request drops a hand-set Content-Length, so this is the shape a Worker sees: the header, and a body never read.
        request: { url: link.putUrl, method: "PUT", headers: new Headers({ "Content-Length": String(PHOTO_UPLOAD_MAX_BYTES + 1) }), body: streamOf(PHOTO_UPLOAD_MAX_BYTES + 1) } as unknown as Request,
        uploadId: link.uploadId,
        secret: SECRET,
        bucket,
      });
      expect(declared.status).toBe(413);

      const streamed = await receivePhotoUpload(db, {
        request: new Request(link.putUrl, { method: "PUT", body: streamOf(PHOTO_UPLOAD_MAX_BYTES + 1), duplex: "half" } as RequestInit & { duplex: "half" }),
        uploadId: link.uploadId,
        secret: SECRET,
        bucket,
      });
      expect(streamed).toMatchObject({ status: 413, body: { error: { code: "photo_too_large" } } });

      // A body that fails to cancel is still refused.
      const stubborn = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(PHOTO_UPLOAD_MAX_BYTES + 1));
        },
        cancel() {
          throw new Error("cannot cancel");
        },
      });
      await expect(receivePhotoUpload(db, {
        request: new Request(link.putUrl, { method: "PUT", body: stubborn, duplex: "half" } as RequestInit & { duplex: "half" }),
        uploadId: link.uploadId,
        secret: SECRET,
        bucket,
      })).resolves.toMatchObject({ status: 413 });
      expect(bucket.put).not.toHaveBeenCalled();

      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET, bucket })).resolves.toMatchObject({ status: 200 });
    });

    it("checks the bytes' signature, not just the header, and keeps the link for the right file", async () => {
      const { link, bucket } = await started();
      const unsupported = { status: 415, body: { error: { code: "unsupported_photo", message: "Photos must be JPG, PNG, or WebP." } } };
      const attempts: Array<[BodyInit | null, Record<string, string>]> = [
        [new TextEncoder().encode("not a photo"), { "Content-Type": "image/jpeg" }],
        [GIF, {}],
        [new Uint8Array(0), {}],
        [JPEG, { "Content-Type": "image/png" }],
        [PNG, { "Content-Type": "text/plain" }],
      ];
      for (const [body, headers] of attempts) {
        await expect(receivePhotoUpload(db, { request: put(link.putUrl, body, headers), uploadId: link.uploadId, secret: SECRET, bucket })).resolves.toEqual(unsupported);
      }
      expect(bucket.put).not.toHaveBeenCalled();

      await expect(receivePhotoUpload(db, {
        request: put(link.putUrl, PNG, { "Content-Type": "image/png" }),
        uploadId: link.uploadId,
        secret: SECRET,
        bucket,
      })).resolves.toMatchObject({ status: 200, body: { mimeType: "image/png" } });
    });

    it("takes an octet-stream body, refuses an empty PUT, and answers 503 without photo storage", async () => {
      const { link, bucket } = await started();
      await expect(receivePhotoUpload(db, { request: put(link.putUrl, null), uploadId: link.uploadId, secret: SECRET, bucket })).resolves.toMatchObject({ status: 415 });
      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET })).resolves.toMatchObject({ status: 503 });
      await expect(receivePhotoUpload(db, {
        request: put(link.putUrl, PNG, { "Content-Type": "application/octet-stream" }),
        uploadId: link.uploadId,
        secret: SECRET,
        bucket,
      })).resolves.toMatchObject({ status: 200, body: { mimeType: "image/png" } });
    });

    it("keeps the original error when putting the link back fails too", async () => {
      const { link, bucket } = await started();
      bucket.put.mockRejectedValueOnce(new Error("R2 down"));
      const updateMany = db.photoUpload.updateMany.bind(db.photoUpload);
      const spy = vi.spyOn(db.photoUpload, "updateMany")
        .mockImplementationOnce(updateMany as never)
        .mockRejectedValueOnce(new Error("D1 down"));
      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET, bucket })).rejects.toThrow("R2 down");
      spy.mockRestore();
    });

    it("keeps the link when storing fails, so the same PUT can be sent again", async () => {
      const { link, bucket } = await started();
      bucket.put.mockRejectedValueOnce(new Error("R2 down"));
      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET, bucket })).rejects.toThrow("R2 down");
      await expect(receivePhotoUpload(db, { request: put(link.putUrl, PNG), uploadId: link.uploadId, secret: SECRET, bucket })).resolves.toMatchObject({ status: 200 });
    });
  });

  describe("using an upload", () => {
    async function uploaded(bytes = PNG) {
      const bucket = memoryBucket();
      const owner = await makeUser(db);
      const link = await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket });
      await receivePhotoUpload(db, { request: put(link.putUrl, bytes), uploadId: link.uploadId, secret: SECRET, bucket });
      return { owner, link, bucket };
    }

    it("stores the photo as an ordinary food photo of its kind, once", async () => {
      const { owner, link, bucket } = await uploaded();
      const stored = await spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "spoons", bucket }, async (photo) => photo);

      expect(stored).toEqual({
        imageUrl: expect.stringMatching(new RegExp(`^/photos/spoons/${owner.id}/uploads/\\d+-[a-f0-9-]+\\.png$`)),
        mimeType: "image/png",
        sizeBytes: PNG.length,
      });
      expect(bucket.objects.has(stored.imageUrl.replace("/photos/", ""))).toBe(true);
      expect(bucket.objects.has(photoUploadPendingKey(owner.id, link.uploadId))).toBe(false);
      await expect(db.photoUpload.findUniqueOrThrow({ where: { id: link.uploadId } })).resolves.toMatchObject({ status: "consumed", consumedAt: expect.any(Date) });

      await expect(spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "spoons", bucket }, async (photo) => photo))
        .rejects.toMatchObject({ status: 404, message: PHOTO_UPLOAD_REFUSAL });
    });

    it("gives another account's, an expired, an unsent and a nonexistent upload the same refusal", async () => {
      const { owner, link, bucket } = await uploaded();
      const stranger = await makeUser(db);
      const unsent = await startPhotoUpload(db, { ownerId: owner.id, baseUrl: BASE_URL, secret: SECRET, bucket });
      const use = (uploadId: string, ownerId: string, now?: Date) =>
        spendPhotoUpload(db, { uploadId, ownerId, namespace: "recipes", bucket, now }, async (photo) => photo);
      const refusal = { status: 404, message: PHOTO_UPLOAD_REFUSAL };

      await expect(use(link.uploadId, stranger.id)).rejects.toMatchObject(refusal);
      await expect(use(link.uploadId, owner.id, new Date(Date.now() + PHOTO_UPLOAD_TTL_MS + 1000))).rejects.toMatchObject(refusal);
      await expect(use(unsent.uploadId, owner.id)).rejects.toMatchObject(refusal);
      await expect(use("pu_ZZZZZZZZZZZZZZZZZZZZZZ", owner.id)).rejects.toMatchObject(refusal);
      await expect(use("anything", owner.id)).rejects.toMatchObject(refusal);
      await expect(photoUploadIsUsable(db, { uploadId: link.uploadId, ownerId: stranger.id })).resolves.toBe(false);

      // None of those spent it: its owner still can.
      await expect(photoUploadIsUsable(db, { uploadId: link.uploadId, ownerId: owner.id })).resolves.toBe(true);
      await expect(use(link.uploadId, owner.id)).resolves.toMatchObject({ mimeType: "image/png" });
    });

    it("answers a used upload even when its pending photo can't be deleted", async () => {
      const { owner, link, bucket } = await uploaded();
      bucket.delete.mockRejectedValueOnce(new Error("R2 down"));
      await expect(spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "spoons", bucket }, async () => "stored")).resolves.toBe("stored");
      await expect(db.photoUpload.findUniqueOrThrow({ where: { id: link.uploadId } })).resolves.toMatchObject({ status: "consumed" });
    });

    it("puts the upload back when what it was for fails, so a retry can use it", async () => {
      const { owner, link, bucket } = await uploaded();
      await expect(spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "recipes", bucket }, async () => {
        throw new Error("cover failed");
      })).rejects.toThrow("cover failed");

      await expect(db.photoUpload.findUniqueOrThrow({ where: { id: link.uploadId } })).resolves.toMatchObject({ status: "uploaded", consumedAt: null });
      expect(bucket.objects.has(photoUploadPendingKey(owner.id, link.uploadId))).toBe(true);
      await expect(spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "recipes", bucket }, async () => "ok")).resolves.toBe("ok");
    });

    it("names the stored photo after its type unless given a name, and needs photo storage", async () => {
      const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
      const first = await uploaded(webp);
      await expect(spendPhotoUpload(db, { uploadId: first.link.uploadId, ownerId: first.owner.id, namespace: "recipes" }, async (photo) => photo))
        .rejects.toMatchObject({ status: 503 });
      await expect(spendPhotoUpload(db, { uploadId: first.link.uploadId, ownerId: first.owner.id, namespace: "recipes", bucket: first.bucket }, async (photo) => photo))
        .resolves.toMatchObject({ imageUrl: expect.stringMatching(/\.webp$/), mimeType: "image/webp" });

      const second = await uploaded();
      await expect(spendPhotoUpload(db, { uploadId: second.link.uploadId, ownerId: second.owner.id, namespace: "recipes", filename: "loaf.png", bucket: second.bucket }, async (photo) => photo))
        .resolves.toMatchObject({ imageUrl: expect.stringMatching(/\.png$/) });

      const third = await uploaded(JPEG);
      await expect(spendPhotoUpload(db, { uploadId: third.link.uploadId, ownerId: third.owner.id, namespace: "spoons", bucket: third.bucket }, async (photo) => photo))
        .resolves.toMatchObject({ imageUrl: expect.stringMatching(/\.jpg$/) });
    });

    it("refuses an upload whose photo has gone from storage or changed there, and keeps its row", async () => {
      const { owner, link, bucket } = await uploaded();
      const key = photoUploadPendingKey(owner.id, link.uploadId);
      const spend = () => spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "spoons", bucket }, async (photo) => photo);
      bucket.objects.set(key, { bytes: new TextEncoder().encode("not a photo") });
      await expect(spend()).rejects.toMatchObject({ status: 404, message: PHOTO_UPLOAD_REFUSAL });
      bucket.objects.delete(key);
      await expect(spend()).rejects.toMatchObject({ status: 404, message: PHOTO_UPLOAD_REFUSAL });
      await expect(db.photoUpload.findUniqueOrThrow({ where: { id: link.uploadId } })).resolves.toMatchObject({ status: "uploaded" });
      await expect(photoUploadIsUsable(db, { uploadId: "anything", ownerId: owner.id })).resolves.toBe(false);
    });

    it("lets one of two racing uses through", async () => {
      const { owner, link, bucket } = await uploaded();
      const use = () => spendPhotoUpload(db, { uploadId: link.uploadId, ownerId: owner.id, namespace: "spoons", bucket }, async (photo) => photo);
      const results = await Promise.allSettled([use(), use()]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 404, message: PHOTO_UPLOAD_REFUSAL } });
    });
  });
});
