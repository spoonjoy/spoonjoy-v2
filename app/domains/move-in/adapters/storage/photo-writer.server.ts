// Stores a moved-in recipe's photo in R2 and gives the recipe a cover row for it, the way a photo
// from a recipe link becomes a cover. The cover becomes the recipe's active cover only while the
// recipe is still on an automatic cover with none chosen. attachMovedInPhotos does the same for a
// chunk's photos: a few stored at a time, then every cover row in one write.
import { d1ReadBatch, type D1Query, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { mapAtMost } from "~/lib/map-at-most";
import { detectImageMimeType, type DetectedImageMimeType } from "~/lib/image-storage.server";
import { putWithTransientRetry } from "~/lib/r2-transient-retry.server";

/** The same ceiling as a photo brought from a recipe link. */
export const MOVED_IN_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The photo formats a moved-in recipe keeps, with the extension each is stored under. Mealie keeps WebP; another
 * Spoonjoy keeps the JPEG, PNG or WebP the cook uploaded.
 */
const PHOTO_EXTENSIONS: Partial<Record<DetectedImageMimeType, string>> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export interface AttachMovedInPhotoInput {
  db: D1ReadDatabase;
  bucket: Pick<R2Bucket, "put">;
  ownerId: string;
  recipeId: string;
  bytes: Uint8Array;
  now: Date;
}

/** Checks the photo and stores it under a new key; the key, for its cover row. */
async function storePhoto(bucket: Pick<R2Bucket, "put">, bytes: Uint8Array, now: Date): Promise<string> {
  const type = detectImageMimeType(bytes);
  const extension = type && PHOTO_EXTENSIONS[type];
  if (!type || !extension) throw new Error("it isn't a WebP, JPEG or PNG image");
  if (bytes.length > MOVED_IN_PHOTO_MAX_BYTES) throw new Error("it is larger than 10 MB");
  // A new key every time, so there is nothing to look for before the put.
  const key = `covers/import/movein-${now.getTime()}-${crypto.randomUUID()}.${extension}`;
  await putWithTransientRetry(bucket, key, bytes, { httpMetadata: { contentType: type } });
  return key;
}

/** The cover row for a stored photo, and the recipe's switch to it while it has no cover chosen. */
function coverStatements(ownerId: string, recipeId: string, key: string, now: Date): D1Query[] {
  const coverId = `cover_movein_${crypto.randomUUID()}`;
  const stamp = d1Timestamp(now);
  return [
    [
      `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceType", "status", "createdById", "generationStatus", "createdAt")
       VALUES (?, ?, ?, 'import', 'ready', ?, 'none', ?)`,
      coverId,
      recipeId,
      `/photos/${key}`,
      ownerId,
      stamp,
    ],
    [
      `UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = 'image', "updatedAt" = ?
       WHERE "id" = ? AND "coverMode" = 'auto' AND "activeCoverId" IS NULL`,
      coverId,
      stamp,
      recipeId,
    ],
  ];
}

export async function attachMovedInPhoto({ db, bucket, ownerId, recipeId, bytes, now }: AttachMovedInPhotoInput): Promise<void> {
  const key = await storePhoto(bucket, bytes, now);
  await d1WriteBatch(db, coverStatements(ownerId, recipeId, key, now));
}

/** How many photos a chunk stores at once. */
export const MOVED_IN_PHOTO_PUTS_AT_ONCE = 6;

export interface AttachMovedInPhotosInput extends Omit<AttachMovedInPhotoInput, "bytes"> {
  /** Reads the photo: its bytes, or the error that kept it from being read. An error it throws stops the whole call. */
  read(): Promise<Uint8Array | Error>;
}

/**
 * Reads and stores a chunk's photos, a few at a time, so only that many are held at once, then writes all their cover
 * rows in one batch. Each answer, in the inputs' order, is null for a photo now on its recipe, or the error that kept
 * that photo out. An error a read throws, or one in the cover write, is passed on, with none of the chunk's covers
 * written.
 */
export async function attachMovedInPhotos(inputs: AttachMovedInPhotosInput[]): Promise<Array<Error | null>> {
  if (!inputs.length) return [];
  const { db, bucket, now } = inputs[0];
  const keys = await mapAtMost(MOVED_IN_PHOTO_PUTS_AT_ONCE, inputs, async ({ read }) => {
    const bytes = await read();
    if (bytes instanceof Error) return bytes;
    try {
      return await storePhoto(bucket, bytes, now);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  });
  const statements = inputs.flatMap(({ ownerId, recipeId }, i) => {
    const key = keys[i];
    return typeof key === "string" ? coverStatements(ownerId, recipeId, key, now) : [];
  });
  if (statements.length) await d1WriteBatch(db, statements);
  return keys.map((key) => (typeof key === "string" ? null : key));
}

const MOVED_IN_PHOTO_URL = "/photos/covers/import/movein-%";

/** Whether the recipe has a cover that moved in, so a repeated run doesn't add its photo twice. */
export async function hasMovedInPhoto(db: D1ReadDatabase, recipeId: string): Promise<boolean> {
  const [rows] = await d1ReadBatch(db, [[`SELECT 1 FROM "RecipeCover" WHERE "recipeId" = ? AND "imageUrl" LIKE ? LIMIT 1`, recipeId, MOVED_IN_PHOTO_URL]]);
  return rows.length > 0;
}
