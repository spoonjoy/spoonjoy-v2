// How a backup is sent to storage in parts: the part size, the largest backup taken that way, and
// the size each part must be. Storage takes up to 10,000 parts, each at least 5 MiB but the last,
// and every part but the last the same size.

/** Every part but the last is this size: 10 MiB, twice storage's 5 MiB smallest, so a phone resends little after a drop. */
export const MOVE_IN_PART_BYTES = 10 * 1024 * 1024;

/**
 * The largest backup sent in parts: 2 GiB, 205 parts. That is four times the 500 MB backup a phone has to
 * manage, and half the 4 GiB a zip can address without its 64-bit records, which move-in doesn't read, so
 * a backup this size can always be opened.
 */
export const MOVE_IN_BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** How many parts a backup of `size` bytes is sent in. */
export function partCount(size: number, partSize: number): number {
  return Math.ceil(size / partSize);
}

/** The size part `partNumber` must be, or null when the backup has no such part. */
export function partBytes(size: number, partSize: number, partNumber: number): number | null {
  const count = partCount(size, partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) return null;
  return partNumber < count ? partSize : size - partSize * (count - 1);
}

/** A file head's digest as the page sends it: SHA-256 in lowercase hex. */
export function isFileHead(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * What tells one backup file from another across a reload: its name, size and the digest of its first MiB. Not its
 * last-change time, which iOS's file picker may report differently each time the same file is chosen
 * (inference: unverified on a device), so a resume keyed on it would quietly start over.
 */
export function uploadFingerprint(name: string, size: number, head: string): string {
  return JSON.stringify([name, size, head]);
}

/** Why a step of an upload in parts was turned away, besides the reasons a move-in itself can stop. */
export const UPLOAD_REFUSAL_MESSAGES = {
  "upload-gone": "That upload isn't here any more: an unfinished one is cleared away after a day. Press Move in to send the backup again from the start.",
  "no-such-part": "That backup has no part with that number.",
  "wrong-part-size": "That part isn't the size this backup's parts are, so it wasn't kept. Send it again.",
  "missing-parts": "Some parts of the backup haven't arrived yet. Send them, then finish again.",
  finished: "That backup has already arrived and is moving in.",
} as const;

export type UploadRefusal = keyof typeof UPLOAD_REFUSAL_MESSAGES;
