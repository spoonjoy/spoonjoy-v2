// Stores a moved-in recipe's photo in R2 and gives the recipe a cover row for it, the way a photo
// from a recipe link becomes a cover. The cover becomes the recipe's active cover only while the
// recipe is still on an automatic cover with none chosen.
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { putWithTransientRetry } from "~/lib/r2-transient-retry.server";

/** The same ceiling as a photo brought from a recipe link. */
export const MOVED_IN_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const RIFF = [82, 73, 70, 70];
const WEBP = [87, 69, 66, 80];

function isWebp(bytes: Uint8Array): boolean {
  return RIFF.every((byte, i) => bytes[i] === byte) && WEBP.every((byte, i) => bytes[8 + i] === byte);
}

export interface AttachMovedInPhotoInput {
  db: D1ReadDatabase;
  bucket: Pick<R2Bucket, "put">;
  ownerId: string;
  recipeId: string;
  bytes: Uint8Array;
  now: Date;
}

export async function attachMovedInPhoto({ db, bucket, ownerId, recipeId, bytes, now }: AttachMovedInPhotoInput): Promise<void> {
  if (!isWebp(bytes)) throw new Error("it isn't a WebP image");
  if (bytes.length > MOVED_IN_PHOTO_MAX_BYTES) throw new Error("it is larger than 10 MB");
  const key = `covers/import/movein-${now.getTime()}-${crypto.randomUUID()}.webp`;
  await putWithTransientRetry(bucket, key, bytes, { httpMetadata: { contentType: "image/webp" } });
  const coverId = `cover_movein_${crypto.randomUUID()}`;
  const stamp = d1Timestamp(now);
  await d1WriteBatch(db, [
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
      `UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = 'image'
       WHERE "id" = ? AND "coverMode" = 'auto' AND "activeCoverId" IS NULL`,
      coverId,
      recipeId,
    ],
  ]);
}
