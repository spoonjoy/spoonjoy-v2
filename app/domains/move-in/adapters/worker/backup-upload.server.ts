// A backup sent straight to storage in parts, so a big one never passes through the Worker's memory
// and a dropped connection costs only the parts that hadn't arrived. The page begins the upload (or
// resumes the unfinished one of the same file), sends each part, and finishes it, which checks the
// backup in storage the way the form's upload is checked and creates its move-in job.
import { MOVE_IN_BACKUP_MAX_BYTES, MOVE_IN_PART_BYTES, partBytes, partCount, uploadFingerprint, type UploadRefusal } from "../../model/backup-upload";
import type { MoveInErrorCode } from "../../model/move-in-error";
import {
  createUploadJob,
  deleteUpload,
  findUnfinishedUpload,
  insertUpload,
  listParts,
  loadUpload,
  recordPart,
  unfinishedUploads,
  type BackupUpload,
} from "../storage/upload-store.server";
import { MOVE_IN_ARCHIVE_PREFIX, type MoveInEnv } from "./move-in-ports.server";
import { admitStoredBackup, moveInKind } from "./start-move-in.server";

/** How long an unfinished upload is kept: the move-in sweep aborts one older than this. */
export const MOVE_IN_UPLOAD_KEPT_MS = 24 * 60 * 60 * 1000;
/** An upload resumes only while it has this long left, so the sweep doesn't abort it under a cook still sending it. */
const RESUME_MARGIN_MS = 60 * 60 * 1000;
/**
 * Unfinished uploads a cook may have at once, counting the one being begun. A new one aborts the oldest past this,
 * so made-up fingerprints can't hold more than three backups' worth of parts in storage for a day.
 */
export const MOVE_IN_OPEN_UPLOADS = 3;

export type UploadResult<T> = ({ ok: true } & T) | { ok: false; code: MoveInErrorCode | UploadRefusal; missing?: number[] };

export interface UploadPlan {
  uploadId: string;
  partSize: number;
  partCount: number;
  /** The parts that have already arrived, so a resumed upload sends only the rest. */
  done: number[];
}

/** The parts that arrived whole: a part recorded at another size than its place in the backup takes doesn't count. */
async function arrivedParts(env: MoveInEnv, upload: BackupUpload) {
  const parts = await listParts(env.DB, upload.id);
  return parts.filter((part) => part.size === partBytes(upload.size, upload.partSize, part.partNumber));
}

async function plan(env: MoveInEnv, upload: BackupUpload): Promise<UploadPlan> {
  const done = (await arrivedParts(env, upload)).map((part) => part.partNumber);
  return { uploadId: upload.id, partSize: upload.partSize, partCount: partCount(upload.size, upload.partSize), done };
}

/** Aborts an unfinished upload in storage and forgets it. */
async function discard(env: MoveInEnv, upload: BackupUpload) {
  await env.PHOTOS.resumeMultipartUpload(upload.archiveKey, upload.uploadId).abort().catch(() => undefined);
  await deleteUpload(env.DB, upload.id);
}

/**
 * Begins sending a backup of `size` bytes, or resumes this owner's unfinished upload of the same file: the one
 * `resume` names when it still fits, otherwise the newest of the same file: same name, size and `head`, the
 * SHA-256 of its first MiB. `fresh` starts over instead, discarding every unfinished upload of the same file: the
 * page asks for it after the cook stopped one whose abort may not have arrived.
 */
export async function beginBackupUpload({ env, ownerId, app, name, size, head, resume, fresh = false, now }: {
  env: MoveInEnv;
  ownerId: string;
  app: string;
  name: string;
  size: number;
  head: string;
  resume?: string | null;
  fresh?: boolean;
  now: Date;
}): Promise<UploadResult<UploadPlan>> {
  if (!moveInKind(app)) return { ok: false, code: "unknown-app" };
  if (!Number.isSafeInteger(size) || size <= 0) return { ok: false, code: "no-file" };
  if (size > MOVE_IN_BACKUP_MAX_BYTES) return { ok: false, code: "backup-too-large" };
  const fingerprint = uploadFingerprint(name, size, head);
  if (fresh) {
    for (const same of await unfinishedUploads(env.DB, ownerId)) {
      if (same.fingerprint === fingerprint && same.size === size) await discard(env, same);
    }
  } else {
    const since = new Date(now.getTime() - MOVE_IN_UPLOAD_KEPT_MS + RESUME_MARGIN_MS);
    const named = resume ? await loadUpload(env.DB, ownerId, resume) : null;
    const fits = named && named.fingerprint === fingerprint && named.size === size && !named.jobId && named.startedAt >= since.toISOString();
    const existing = fits ? named : await findUnfinishedUpload(env.DB, { ownerId, fingerprint, size, since });
    if (existing) return { ok: true, ...(await plan(env, existing)) };
  }

  for (const stale of (await unfinishedUploads(env.DB, ownerId)).slice(MOVE_IN_OPEN_UPLOADS - 1)) await discard(env, stale);

  const archiveKey = `${MOVE_IN_ARCHIVE_PREFIX}${ownerId}/${crypto.randomUUID()}.zip`;
  const multipart = await env.PHOTOS.createMultipartUpload(archiveKey, { httpMetadata: { contentType: "application/zip" } });
  const upload = {
    id: `upload_${crypto.randomUUID()}`,
    ownerId,
    fingerprint,
    archiveKey,
    uploadId: multipart.uploadId,
    name,
    size,
    partSize: MOVE_IN_PART_BYTES,
    startedAt: now.toISOString(),
  };
  try {
    await insertUpload(env.DB, upload);
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    throw error;
  }
  return { ok: true, uploadId: upload.id, partSize: upload.partSize, partCount: partCount(size, upload.partSize), done: [] };
}

/**
 * Streams one part from the request into storage, without holding it, and records it. `contentLength` must be the
 * size this part takes. Sending a part again replaces it, so a part whose answer was lost is safe to resend.
 */
export async function putBackupPart({ env, ownerId, uploadId, partNumber, contentLength, body }: {
  env: MoveInEnv;
  ownerId: string;
  uploadId: string;
  partNumber: number;
  contentLength: number | null;
  body: ReadableStream | null;
}): Promise<UploadResult<{ partNumber: number }>> {
  const upload = await loadUpload(env.DB, ownerId, uploadId);
  if (!upload) return { ok: false, code: "upload-gone" };
  if (upload.jobId) return { ok: false, code: "finished" };
  const expected = partBytes(upload.size, upload.partSize, partNumber);
  if (expected === null) return { ok: false, code: "no-such-part" };
  if (contentLength !== expected || !body) return { ok: false, code: "wrong-part-size" };
  const part = await env.PHOTOS.resumeMultipartUpload(upload.archiveKey, upload.uploadId).uploadPart(partNumber, body);
  await recordPart(env.DB, upload.id, { partNumber, etag: part.etag, size: expected });
  return { ok: true, partNumber };
}

/**
 * Puts the parts together once every one has arrived, checks the backup in storage, and creates its move-in job.
 * A backup that is turned away is deleted, with its upload, and answered with the form's fix-it message. A finish
 * sent again answers with the same job; `started` says whether this finish created it, so only that one queues it.
 */
export async function finishBackupUpload({ env, ownerId, uploadId, app, now }: {
  env: MoveInEnv;
  ownerId: string;
  uploadId: string;
  app: string;
  now: Date;
}): Promise<UploadResult<{ jobId: string; started: boolean }>> {
  const kind = moveInKind(app);
  if (!kind) return { ok: false, code: "unknown-app" };
  const upload = await loadUpload(env.DB, ownerId, uploadId);
  if (!upload) return { ok: false, code: "upload-gone" };
  if (upload.jobId) return { ok: true, jobId: upload.jobId, started: false };
  const parts = await arrivedParts(env, upload);
  const arrived = new Set(parts.map((part) => part.partNumber));
  const missing = Array.from({ length: partCount(upload.size, upload.partSize) }, (_, index) => index + 1).filter((n) => !arrived.has(n));
  if (missing.length) return { ok: false, code: "missing-parts", missing };
  // A finish whose answer was lost, or one sent at the same time, may have put the parts together already;
  // they can't be put together twice, so the backup they made is enough.
  const stored = () => env.PHOTOS.head(upload.archiveKey);
  if (!(await stored())) {
    const completed = await env.PHOTOS.resumeMultipartUpload(upload.archiveKey, upload.uploadId)
      .complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })))
      .then(() => true, () => stored().then(Boolean));
    // With no backup there, the parts were put together before and the backup they made was swept before it became a
    // move-in, or storage refused them. Either way, finishing again would fail the same way (inference: storage won't
    // put an upload's parts together twice), so the upload is forgotten and the page sends the backup afresh.
    if (!completed) {
      await env.PHOTOS.resumeMultipartUpload(upload.archiveKey, upload.uploadId).abort().catch(() => undefined);
      await deleteUpload(env.DB, upload.id);
      return { ok: false, code: "upload-gone" };
    }
  }
  let started = false;
  const admitted = await admitStoredBackup({
    env,
    ownerId,
    archiveKey: upload.archiveKey,
    keepOnSaveFailure: true,
    createJob: async () => {
      const job = await createUploadJob(env.DB, upload, { kind, now });
      started = job.created;
      return job.jobId;
    },
  });
  if (!admitted.ok) {
    await deleteUpload(env.DB, upload.id);
    return admitted;
  }
  return { ok: true, jobId: admitted.jobId, started };
}

/** Stops an unfinished upload: storage drops its parts, or the backup they made, and the upload is forgotten. */
export async function abortBackupUpload({ env, ownerId, uploadId }: { env: MoveInEnv; ownerId: string; uploadId: string }): Promise<UploadResult<object>> {
  const upload = await loadUpload(env.DB, ownerId, uploadId);
  if (!upload) return { ok: false, code: "upload-gone" };
  if (upload.jobId) return { ok: false, code: "finished" };
  // Parts already put together can't be aborted (inference: storage refuses an upload it has completed), so the backup they made is deleted instead.
  await env.PHOTOS.resumeMultipartUpload(upload.archiveKey, upload.uploadId).abort().catch(() => undefined);
  await env.PHOTOS.delete(upload.archiveKey);
  await deleteUpload(env.DB, upload.id);
  return { ok: true };
}
