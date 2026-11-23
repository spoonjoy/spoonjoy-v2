// The move-in job in D1: the store port the runner uses, creating a job once its archive is
// uploaded, and reading a job's progress for its owner.
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { FINISHED, LostClaimError, type MoveInCounts, type MoveInEvent, type MoveInJob, type MoveInPorts } from "../../application/run-move-in";

const JOB_COLUMNS = `"id", "ownerId", "kind", "sourceId", "status", "phase", "cursor", "archiveKey", "lastError", "attempt"`;
// What the owner may see of a job: no archive key, which names where the other app's accounts wait.
const PROGRESS_COLUMNS = `"id", "ownerId", "kind", "sourceId", "status", "phase", "cursor", "lastError", "attempt", "archiveName", "createdAt", "finishedAt"`;
const COUNT_FIELDS = ["found", "created", "updated", "unchanged", "skipped", "failed"] as const;
/** How long a run may go without a heartbeat before another run may take its job over. */
export const MOVE_IN_CLAIM_MS = 45_000;
// The job fields the runner may change, and so the only columns updateJob writes.
const PATCHABLE = ["sourceId", "status", "phase", "cursor", "archiveKey", "lastError", "attempt"] as const;

export async function createMoveInJob(
  db: D1ReadDatabase,
  { ownerId, kind, archiveKey, archiveName, now }: { ownerId: string; kind: string; archiveKey: string; archiveName: string; now: Date },
): Promise<string> {
  const id = `movein_${crypto.randomUUID()}`;
  const stamp = d1Timestamp(now);
  await d1WriteBatch(db, [[
    `INSERT INTO "ImportJob" ("id", "ownerId", "kind", "status", "phase", "archiveKey", "archiveName", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 'queued', 'inspect', ?, ?, ?, ?)`,
    id, ownerId, kind, archiveKey, archiveName, stamp, stamp,
  ]]);
  return id;
}

async function loadJob(db: D1ReadDatabase, id: string): Promise<MoveInJob | null> {
  const [[row]] = await d1ReadBatch(db, [[`SELECT ${JOB_COLUMNS} FROM "ImportJob" WHERE "id" = ?`, id]]);
  return row ? (row as unknown as MoveInJob) : null;
}

export function moveInJobStore(db: D1ReadDatabase, now: () => Date): MoveInPorts["store"] {
  return {
    loadJob: (id) => loadJob(db, id),

    async updateJob(id, patch, token) {
      const stamp = d1Timestamp(now());
      const fields = PATCHABLE.filter((field) => field in patch);
      const sets = [...fields.map((field) => `"${field}" = ?`), `"updatedAt" = ?`];
      const values: unknown[] = [...fields.map((field) => patch[field] ?? null), stamp];
      // Each write under a claim is also its heartbeat.
      const stamped = (column: string) => {
        sets.push(column);
        values.push(stamp);
      };
      if (token !== undefined) stamped(`"heartbeatAt" = ?`);
      if (patch.status === "running") stamped(`"startedAt" = COALESCE("startedAt", ?)`);
      if (patch.status && FINISHED.includes(patch.status)) stamped(`"finishedAt" = ?`);
      const fence = token === undefined ? "" : ` AND "claimToken" = ?`;
      const [{ changes }] = await d1WriteBatch(db, [[
        `UPDATE "ImportJob" SET ${sets.join(", ")} WHERE "id" = ?${fence}`,
        ...values, id, ...(token === undefined ? [] : [token]),
      ]]);
      if (token !== undefined && changes === 0) throw new LostClaimError();
    },

    async sourceInstanceKey(sourceId) {
      const [[row]] = await d1ReadBatch(db, [[`SELECT "instanceKey" FROM "ImportSource" WHERE "id" = ?`, sourceId]]);
      return row ? String(row.instanceKey) : null;
    },

    async resetCounts(jobId) {
      await d1WriteBatch(db, [[`DELETE FROM "ImportEntityCount" WHERE "jobId" = ?`, jobId]]);
    },

    async ensureSource({ ownerId, kind, instanceKey, label, sourceVersion }) {
      const [, { rows: [row] }] = await d1WriteBatch(db, [
        [
          `INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label", "sourceVersion", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("ownerId", "kind", "instanceKey") DO UPDATE SET "label" = excluded."label", "sourceVersion" = excluded."sourceVersion"`,
          `source_${crypto.randomUUID()}`, ownerId, kind, instanceKey, label, sourceVersion, d1Timestamp(now()),
        ],
        [`SELECT "id" FROM "ImportSource" WHERE "ownerId" = ? AND "kind" = ? AND "instanceKey" = ?`, ownerId, kind, instanceKey],
      ]);
      return String(row.id);
    },

    async addCounts(jobId, entity, delta) {
      const values = COUNT_FIELDS.map((field) => delta[field] ?? 0);
      await d1WriteBatch(db, [[
        `INSERT INTO "ImportEntityCount" ("jobId", "entity", ${COUNT_FIELDS.map((field) => `"${field}"`).join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT ("jobId", "entity") DO UPDATE SET ${COUNT_FIELDS.map((field) => `"${field}" = "${field}" + excluded."${field}"`).join(", ")}`,
        jobId, entity, ...values,
      ]]);
    },

    async addEvent(jobId, event: MoveInEvent) {
      // One statement, so two writers never take the same seq: the unique index refuses the second.
      await d1WriteBatch(db, [[
        `INSERT INTO "ImportEvent" ("id", "jobId", "seq", "level", "kind", "entity", "sourceKey", "targetId", "message", "detail", "createdAt")
         SELECT ?, ?, COALESCE(MAX("seq"), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ? FROM "ImportEvent" WHERE "jobId" = ?`,
        `event_${crypto.randomUUID()}`, jobId, event.level, event.kind, event.entity, event.sourceKey, event.targetId, event.message, event.detail ?? null, d1Timestamp(now()), jobId,
      ]]);
    },

    async claim(jobId, at) {
      const token = `claim_${crypto.randomUUID()}`;
      const [{ changes }] = await d1WriteBatch(db, [[
        `UPDATE "ImportJob" SET "heartbeatAt" = ?, "claimToken" = ? WHERE "id" = ? AND ("heartbeatAt" IS NULL OR "heartbeatAt" < ?)`,
        d1Timestamp(at), token, jobId, d1Timestamp(new Date(at.getTime() - MOVE_IN_CLAIM_MS)),
      ]]);
      return changes === 1 ? token : null;
    },

    async release(jobId, token) {
      await d1WriteBatch(db, [[`UPDATE "ImportJob" SET "heartbeatAt" = NULL, "claimToken" = NULL WHERE "id" = ? AND "claimToken" = ?`, jobId, token]]);
    },

    async hasIssues(jobId) {
      const [rows] = await d1ReadBatch(db, [[`SELECT 1 FROM "ImportEvent" WHERE "jobId" = ? AND "level" != 'info' LIMIT 1`, jobId]]);
      return rows.length > 0;
    },
  };
}

export interface MoveInProgress {
  job: Omit<MoveInJob, "archiveKey"> & { archiveName: string | null; createdAt: string; finishedAt: string | null };
  counts: Record<string, MoveInCounts>;
  events: Array<MoveInEvent & { seq: number }>;
}

/** A job's state, counts and report, or null when the job isn't this owner's. */
export async function readMoveInProgress(db: D1ReadDatabase, { ownerId, jobId }: { ownerId: string; jobId: string }): Promise<MoveInProgress | null> {
  const [[job], counts, events] = await d1ReadBatch(db, [
    [`SELECT ${PROGRESS_COLUMNS} FROM "ImportJob" WHERE "id" = ? AND "ownerId" = ?`, jobId, ownerId],
    [`SELECT * FROM "ImportEntityCount" WHERE "jobId" = ? ORDER BY "entity"`, jobId],
    [`SELECT "seq", "level", "kind", "entity", "sourceKey", "targetId", "message" FROM "ImportEvent" WHERE "jobId" = ? ORDER BY "seq"`, jobId],
  ]);
  if (!job) return null;
  return {
    job: job as unknown as MoveInProgress["job"],
    counts: Object.fromEntries(counts.map((row) => [String(row.entity), Object.fromEntries(COUNT_FIELDS.map((field) => [field, Number(row[field])])) as unknown as MoveInCounts])),
    events: events as unknown as MoveInProgress["events"],
  };
}
