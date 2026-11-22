// Photo upload links: a way for an agent to hand Spoonjoy a photo it holds as a file without the
// photo's bytes passing through its conversation. A chat in claude.ai has an attachment on its code
// sandbox's disk, and writing it out as base64 means reading a megabyte into the transcript and
// copying it back exactly, which fails. Instead:
//
// 1. start_photo_upload makes a PhotoUpload row for the signed-in account and answers a putUrl:
//    `/api/photo-uploads/<uploadId>?exp=<ms>&sig=<HMAC>` on Spoonjoy's own origin.
// 2. The sandbox runs `curl -T <file> "<putUrl>"`. The PUT carries no Authorization header: the
//    signature (HMAC-SHA256 under a key derived from SESSION_SECRET) is what lets it in, and the row
//    makes the link single-use and bound to its account. The bytes go to R2 under
//    `pending-uploads/`, which `/photos/` never serves.
// 3. upload_spoon_photo, upload_recipe_image or create_recipe_cover_from_upload take the uploadId,
//    once. The photo is checked and stored exactly as a base64 upload is (storeFoodImageBytes), so
//    the resulting URL is an ordinary Spoonjoy upload URL.
//
// An upload that is someone else's, expired, already used, not uploaded yet or never existed gets
// one refusal, so an uploadId can't be used to learn anything about another account.

import type { PrismaClient } from "@prisma/client";
import { ApiAuthError } from "~/lib/api-auth.server";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import { storeFoodImageBytes, type FoodImageMimeType, type FoodImageUploadNamespace, type FoodImageUploadResult } from "~/lib/image-upload-tools.server";
import { detectImageMimeType } from "~/lib/image-storage.server";
import { PHOTO_PENDING_UPLOAD_PREFIX } from "~/lib/photo-variants";
import { FOOD_IMAGE_TYPES, IMAGE_MAX_FILE_SIZE } from "~/lib/recipe-image";
import { signedCookieSettings, type SessionEnv } from "~/lib/session.server";

export { PHOTO_PENDING_UPLOAD_PREFIX };

/** How long a link lasts, from start to the action that uses it. */
export const PHOTO_UPLOAD_TTL_MS = 15 * 60 * 1000;
/** The largest photo a link takes: the same limit as every other food photo upload. */
export const PHOTO_UPLOAD_MAX_BYTES = IMAGE_MAX_FILE_SIZE;
export const PHOTO_UPLOAD_MIME_TYPES: readonly FoodImageMimeType[] = FOOD_IMAGE_TYPES;
export const PHOTO_UPLOAD_PATH = "/api/photo-uploads/";
const UPLOAD_ID_PREFIX = "pu_";
const UPLOAD_ID_PATTERN = /^pu_[A-Za-z0-9_-]{22}$/;
// 32 bytes in unpadded base64url: the last character carries 2 spare bits, which must be 0, so
// each signature has exactly one spelling.
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
// Domain separation: the session secret signs cookies too, so this key is derived for links alone.
const KEY_LABEL = "spoonjoy-photo-upload-link-v1";
/** At most this many expired rows are cleared per new link, so a start stays cheap. */
const PRUNE_BATCH = 25;

/** The one answer for an uploadId that can't be used, whatever the reason. */
export const PHOTO_UPLOAD_REFUSAL =
  "No usable upload with that uploadId: it doesn't exist, has expired or was already used. Call start_photo_upload for a new one.";
/** The one answer the PUT gives for a link that can't take a photo, whatever the reason. */
export const PHOTO_UPLOAD_LINK_REFUSAL =
  "This upload link is invalid, has expired or was already used. Call start_photo_upload for a new one.";

type Status = "pending" | "receiving" | "uploaded" | "consuming" | "consumed";

export interface StartedPhotoUpload {
  uploadId: string;
  putUrl: string;
  expiresAt: string;
  maxBytes: number;
  mimeTypes: string[];
}

/** The secret links are signed under: the deployment's SESSION_SECRET, required in production. */
export function photoUploadSigningSecret(env: Pick<SessionEnv, "SESSION_SECRET" | "NODE_ENV"> | null | undefined): string {
  return signedCookieSettings(env as SessionEnv | null | undefined).secret;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const encoder = new TextEncoder();

async function linkKey(secret: string): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", root, encoder.encode(KEY_LABEL)));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function signedMessage(uploadId: string, expiresAtMs: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${uploadId}.${expiresAtMs}`);
}

/** The link's signature over its uploadId and expiry, base64url. */
export async function signPhotoUploadLink(secret: string, uploadId: string, expiresAtMs: number): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await linkKey(secret), signedMessage(uploadId, expiresAtMs));
  return base64Url(new Uint8Array(signature));
}

/** True only for this secret's signature over exactly this uploadId and expiry, compared in constant time. */
export async function verifyPhotoUploadLink(secret: string, uploadId: string, expiresAtMs: number, signature: string): Promise<boolean> {
  if (!UPLOAD_ID_PATTERN.test(uploadId) || !SIGNATURE_PATTERN.test(signature) || !Number.isSafeInteger(expiresAtMs)) return false;
  return crypto.subtle.verify("HMAC", await linkKey(secret), fromBase64Url(signature), signedMessage(uploadId, expiresAtMs));
}

export function photoUploadPendingKey(ownerId: string, uploadId: string): string {
  return `${PHOTO_PENDING_UPLOAD_PREFIX}${ownerId}/${uploadId}`;
}

async function pruneExpiredPhotoUploads(db: PrismaClient, bucket: R2Bucket, now: Date): Promise<void> {
  try {
    const expired = await db.photoUpload.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true, ownerId: true },
      take: PRUNE_BATCH,
    });
    if (expired.length === 0) return;
    await bucket.delete(expired.map((row) => photoUploadPendingKey(row.ownerId, row.id)));
    await db.photoUpload.deleteMany({ where: { id: { in: expired.map((row) => row.id) } } });
  } catch (error) {
    // Housekeeping: a failure leaves rows for the next start, and the photo sweep clears stray objects.
    console.warn(JSON.stringify({ event: "photo_upload.prune_failed", error: error instanceof Error ? error.name : "unknown" }));
  }
}

/** Make a single-use upload link for `ownerId`. */
export async function startPhotoUpload(
  db: PrismaClient,
  input: { ownerId: string; baseUrl: string; secret: string; bucket?: R2Bucket; now?: Date },
): Promise<StartedPhotoUpload> {
  if (!input.bucket) throw new ApiAuthError("Photo upload links require the PHOTOS bucket.", 503);
  const now = input.now ?? new Date();
  await pruneExpiredPhotoUploads(db, input.bucket, now);

  const uploadId = UPLOAD_ID_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = new Date(now.getTime() + PHOTO_UPLOAD_TTL_MS);
  await retryD1Write({
    scope: "photo_upload.start",
    applied: () => db.photoUpload.findUnique({ where: { id: uploadId } }),
  }, () => db.photoUpload.create({ data: { id: uploadId, ownerId: input.ownerId, status: "pending", expiresAt } }));

  const signature = await signPhotoUploadLink(input.secret, uploadId, expiresAt.getTime());
  const putUrl = new URL(`${PHOTO_UPLOAD_PATH}${uploadId}`, input.baseUrl);
  putUrl.searchParams.set("exp", String(expiresAt.getTime()));
  putUrl.searchParams.set("sig", signature);
  return {
    uploadId,
    putUrl: putUrl.toString(),
    expiresAt: expiresAt.toISOString(),
    maxBytes: PHOTO_UPLOAD_MAX_BYTES,
    mimeTypes: [...PHOTO_UPLOAD_MIME_TYPES],
  };
}

/** Moves the row from one status to another only if it is still in the first and unexpired; true when it did. */
async function transition(db: PrismaClient, where: { id: string; ownerId?: string }, from: Status, to: Status, now: Date, data: Record<string, unknown> = {}): Promise<boolean> {
  const result = await db.photoUpload.updateMany({
    where: { ...where, status: from, expiresAt: { gt: now } },
    data: { status: to, ...data },
  });
  return result.count === 1;
}

async function restore(db: PrismaClient, id: string, from: Status, to: Status, data: Record<string, unknown> = {}): Promise<void> {
  await db.photoUpload.updateMany({ where: { id, status: from }, data: { status: to, ...data } }).catch(() => undefined);
}

export interface PhotoUploadPutResult {
  status: number;
  body: Record<string, unknown>;
}

function refusal(status: number, code: string, message: string): PhotoUploadPutResult {
  return { status, body: { error: { code, message } } };
}

/** Reads at most `max` bytes of the body; null when it is longer, without buffering the rest. */
async function readBodyWithinLimit(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A declared Content-Type is optional (curl -T sends none); one that names an image must match the bytes. */
function declaredTypeConflicts(request: Request, detected: string): boolean {
  const declared = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") return false;
  return declared !== detected;
}

/**
 * Take the photo a PUT to a link carries. The link must verify and its row must be waiting for a
 * photo; the bytes must be a JPEG, PNG or WebP (by their signature, whatever the header says) of at
 * most PHOTO_UPLOAD_MAX_BYTES. A rejected photo leaves the link usable, so the right file can be
 * sent before it expires; a stored one spends it.
 */
export async function receivePhotoUpload(
  db: PrismaClient,
  input: { request: Request; uploadId: string; secret: string; bucket?: R2Bucket; now?: Date },
): Promise<PhotoUploadPutResult> {
  const now = input.now ?? new Date();
  const url = new URL(input.request.url);
  const expiresAtMs = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";
  const verified = await verifyPhotoUploadLink(input.secret, input.uploadId, expiresAtMs, signature);
  if (!verified || expiresAtMs <= now.getTime()) {
    return refusal(403, "upload_link_invalid", PHOTO_UPLOAD_LINK_REFUSAL);
  }
  if (!input.bucket) return refusal(503, "storage_unavailable", "Photo uploads require the PHOTOS bucket.");

  const row = await db.photoUpload.findUnique({ where: { id: input.uploadId }, select: { ownerId: true } });
  if (!row || !(await transition(db, { id: input.uploadId }, "pending", "receiving", now))) {
    return refusal(403, "upload_link_invalid", PHOTO_UPLOAD_LINK_REFUSAL);
  }

  try {
    const bytes = await readBodyWithinLimit(input.request, PHOTO_UPLOAD_MAX_BYTES);
    if (bytes === null) {
      await restore(db, input.uploadId, "receiving", "pending");
      return refusal(413, "photo_too_large", `Photos must be ${PHOTO_UPLOAD_MAX_BYTES} bytes (5 MB) or smaller.`);
    }
    const detected = bytes.byteLength > 0 ? detectImageMimeType(bytes) : null;
    if (!detected || !PHOTO_UPLOAD_MIME_TYPES.includes(detected as FoodImageMimeType) || declaredTypeConflicts(input.request, detected)) {
      await restore(db, input.uploadId, "receiving", "pending");
      return refusal(415, "unsupported_photo", "Photos must be JPG, PNG, or WebP.");
    }
    await input.bucket.put(photoUploadPendingKey(row.ownerId, input.uploadId), bytes, { httpMetadata: { contentType: detected } });
    await retryD1Write({ scope: "photo_upload.received" }, () => db.photoUpload.updateMany({
      where: { id: input.uploadId, status: "receiving" },
      data: { status: "uploaded", mimeType: detected, sizeBytes: bytes.byteLength, uploadedAt: now },
    }));
    return { status: 200, body: { uploadId: input.uploadId, status: "uploaded", mimeType: detected, sizeBytes: bytes.byteLength } };
  } catch (error) {
    await restore(db, input.uploadId, "receiving", "pending");
    throw error;
  }
}

/** True when `ownerId` holds an uploaded, unused, unexpired upload with this id; never spends it. */
export async function photoUploadIsUsable(db: PrismaClient, input: { uploadId: string; ownerId: string; now?: Date }): Promise<boolean> {
  if (!UPLOAD_ID_PATTERN.test(input.uploadId)) return false;
  const row = await db.photoUpload.findFirst({
    where: { id: input.uploadId, ownerId: input.ownerId, status: "uploaded", expiresAt: { gt: input.now ?? new Date() } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Spend `ownerId`'s upload: store its photo as a `namespace` food photo, then run `forPhoto` with the
 * stored photo. The upload is spent only when `forPhoto` succeeds; if storing or `forPhoto` fails, it is put
 * back, so the same uploadId works on a retry. Anything else gets PHOTO_UPLOAD_REFUSAL (404).
 */
export async function spendPhotoUpload<T>(
  db: PrismaClient,
  input: {
    uploadId: string;
    ownerId: string;
    namespace: FoodImageUploadNamespace;
    filename?: string;
    bucket?: R2Bucket;
    allowLocalImageFallback?: boolean;
    now?: Date;
  },
  forPhoto: (stored: FoodImageUploadResult) => Promise<T>,
): Promise<T> {
  const now = input.now ?? new Date();
  const refused = new ApiAuthError(PHOTO_UPLOAD_REFUSAL, 404);
  if (!UPLOAD_ID_PATTERN.test(input.uploadId)) throw refused;
  if (!input.bucket) throw new ApiAuthError("Image uploads require the PHOTOS bucket.", 503);
  if (!(await transition(db, { id: input.uploadId, ownerId: input.ownerId }, "uploaded", "consuming", now))) throw refused;

  const key = photoUploadPendingKey(input.ownerId, input.uploadId);
  let result: T;
  try {
    const object = await input.bucket.get(key);
    if (!object) throw refused;
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const mimeType = detectImageMimeType(bytes);
    // The PUT checked these bytes; anything else means the stored object is not the photo it took.
    if (!mimeType) throw refused;
    const stored = await storeFoodImageBytes({
      bytes,
      mimeType,
      filename: input.filename?.trim() || `upload.${mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]}`,
      ownerId: input.ownerId,
      namespace: input.namespace,
      bucket: input.bucket,
      allowLocalImageFallback: input.allowLocalImageFallback,
    });
    result = await forPhoto(stored);
  } catch (error) {
    await restore(db, input.uploadId, "consuming", "uploaded");
    throw error;
  }

  await retryD1Write({ scope: "photo_upload.consumed" }, () => db.photoUpload.updateMany({
    where: { id: input.uploadId, status: "consuming" },
    data: { status: "consumed", consumedAt: now },
  }));
  await input.bucket.delete(key).catch(() => undefined);
  return result;
}
