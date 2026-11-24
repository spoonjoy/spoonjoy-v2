// A backup's upload in parts, in D1: the upload, each part that arrived (storage can't list an
// upload's parts to a Worker, so this is the record of them), and the job it became.
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";

export interface BackupUpload {
  id: string;
  ownerId: string;
  fingerprint: string;
  archiveKey: string;
  /** The storage multipart upload's id. */
  uploadId: string;
  name: string;
  size: number;
  partSize: number;
  startedAt: string;
  jobId: string | null;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

const COLUMNS = `"id", "ownerId", "fingerprint", "archiveKey", "uploadId", "name", "size", "partSize", "startedAt", "jobId"`;

function upload(row: Record<string, unknown>): BackupUpload {
  return {
    id: String(row.id),
    ownerId: String(row.ownerId),
    fingerprint: String(row.fingerprint),
    archiveKey: String(row.archiveKey),
    uploadId: String(row.uploadId),
    name: String(row.name),
    size: Number(row.size),
    partSize: Number(row.partSize),
    startedAt: String(row.startedAt),
    jobId: row.jobId === null ? null : String(row.jobId),
  };
}

export async function insertUpload(db: D1ReadDatabase, row: Omit<BackupUpload, "jobId">): Promise<void> {
  await d1WriteBatch(db, [[
    `INSERT INTO "ImportUpload" ("id", "ownerId", "fingerprint", "archiveKey", "uploadId", "name", "size", "partSize", "startedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.ownerId, row.fingerprint, row.archiveKey, row.uploadId, row.name, row.size, row.partSize, row.startedAt,
  ]]);
}

/** The owner's upload by id, or null when there is none or it is someone else's. */
export async function loadUpload(db: D1ReadDatabase, ownerId: string, id: string): Promise<BackupUpload | null> {
  const [[row]] = await d1ReadBatch(db, [[`SELECT ${COLUMNS} FROM "ImportUpload" WHERE "id" = ? AND "ownerId" = ?`, id, ownerId]]);
  return row ? upload(row) : null;
}

/** The owner's newest unfinished upload of this file started at or after `since`, to resume. */
export async function findUnfinishedUpload(
  db: D1ReadDatabase,
  { ownerId, fingerprint, size, since }: { ownerId: string; fingerprint: string; size: number; since: Date },
): Promise<BackupUpload | null> {
  const [[row]] = await d1ReadBatch(db, [[
    `SELECT ${COLUMNS} FROM "ImportUpload" WHERE "ownerId" = ? AND "fingerprint" = ? AND "size" = ? AND "jobId" IS NULL AND "startedAt" >= ?
     ORDER BY "startedAt" DESC LIMIT 1`,
    ownerId, fingerprint, size, d1Timestamp(since),
  ]]);
  return row ? upload(row) : null;
}

export async function listParts(db: D1ReadDatabase, id: string): Promise<UploadedPart[]> {
  const [rows] = await d1ReadBatch(db, [[`SELECT "partNumber", "etag", "size" FROM "ImportUploadPart" WHERE "uploadId" = ? ORDER BY "partNumber"`, id]]);
  return rows.map((row) => ({ partNumber: Number(row.partNumber), etag: String(row.etag), size: Number(row.size) }));
}

/** Records a part that arrived; a part sent again replaces the record of the first. */
export async function recordPart(db: D1ReadDatabase, id: string, part: UploadedPart): Promise<void> {
  await d1WriteBatch(db, [[
    `INSERT INTO "ImportUploadPart" ("uploadId", "partNumber", "etag", "size") VALUES (?, ?, ?, ?)
     ON CONFLICT ("uploadId", "partNumber") DO UPDATE SET "etag" = excluded."etag", "size" = excluded."size"`,
    id, part.partNumber, part.etag, part.size,
  ]]);
}

/**
 * Creates the upload's move-in job, unless a finish before this one already did, and returns the job
 * the upload became. The job and its record on the upload are written in one transaction, so two
 * finishes at once make one job.
 */
export async function createUploadJob(
  db: D1ReadDatabase,
  upload: Pick<BackupUpload, "id" | "ownerId" | "archiveKey" | "name">,
  { kind, now }: { kind: string; now: Date },
): Promise<string> {
  const id = `movein_${crypto.randomUUID()}`;
  const stamp = d1Timestamp(now);
  const unclaimed = `EXISTS (SELECT 1 FROM "ImportUpload" WHERE "id" = ? AND "jobId" IS NULL)`;
  const [, , [row]] = (await d1WriteBatch(db, [
    [
      `INSERT INTO "ImportJob" ("id", "ownerId", "kind", "status", "phase", "archiveKey", "archiveName", "createdAt", "updatedAt")
       SELECT ?, ?, ?, 'queued', 'inspect', ?, ?, ?, ? WHERE ${unclaimed}`,
      id, upload.ownerId, kind, upload.archiveKey, upload.name, stamp, stamp, upload.id,
    ],
    [`UPDATE "ImportUpload" SET "jobId" = ? WHERE "id" = ? AND "jobId" IS NULL`, id, upload.id],
    [`SELECT "jobId" FROM "ImportUpload" WHERE "id" = ?`, upload.id],
  ])).map((result) => result.rows);
  if (!row) throw new Error(`The move-in upload ${upload.id} is gone`);
  return String(row.jobId);
}

export async function deleteUpload(db: D1ReadDatabase, id: string): Promise<void> {
  await d1WriteBatch(db, [
    [`DELETE FROM "ImportUploadPart" WHERE "uploadId" = ?`, id],
    [`DELETE FROM "ImportUpload" WHERE "id" = ?`, id],
  ]);
}

/** Uploads that never became a job and were started at or before `before`. */
export async function abandonedUploads(db: D1ReadDatabase, before: Date): Promise<BackupUpload[]> {
  const [rows] = await d1ReadBatch(db, [[`SELECT ${COLUMNS} FROM "ImportUpload" WHERE "jobId" IS NULL AND "startedAt" <= ? ORDER BY "startedAt"`, d1Timestamp(before)]]);
  return rows.map(upload);
}
