// The move-in job in D1: the store port the runner uses, creating a job once its archive is
// uploaded, and reading a job's progress for its owner.
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { FINISHED, LostClaimError, type MoveInCounts, type MoveInEvent, type MoveInJob, type MoveInPorts } from "../../application/run-move-in";

const JOB_COLUMNS = `"id", "ownerId", "kind", "sourceId", "status", "phase", "cursor", "archiveKey", "lastError", "attempt"`;
// What the owner may see of a job: no archive key, which names where the other app's accounts wait.
const PROGRESS_COLUMNS = `"id", "ownerId", "kind", "sourceId", "status", "phase", "cursor", "lastError", "attempt", "archiveName", "createdAt", "updatedAt", "finishedAt"`;
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

    async updateJob(id, patch, token, report = {}) {
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
      // Every statement holds only while the job is unfinished and, under a claim, still this run's. The batch is one
      // transaction and the job's own row changes last, so a run that lost its claim writes nothing at all.
      const claimed = token === undefined ? "" : ` AND "claimToken" = ?`;
      const quiet = report.quietSince === undefined ? "" : ` AND ("heartbeatAt" IS NULL OR "heartbeatAt" <= ?) AND "updatedAt" <= ?`;
      const fenceSql = `EXISTS (SELECT 1 FROM "ImportJob" WHERE "id" = ? AND "status" NOT IN (${FINISHED.map(() => "?").join(", ")})${claimed}${quiet})`;
      const fence = [id, ...FINISHED, ...(token === undefined ? [] : [token]), ...(report.quietSince === undefined ? [] : [report.quietSince, report.quietSince])];
      const statements: Array<[string, ...unknown[]]> = [];
      if (report.restart) {
        statements.push([`DELETE FROM "ImportEntityCount" WHERE "jobId" = ? AND ${fenceSql}`, id, ...fence]);
        statements.push([`DELETE FROM "ImportEvent" WHERE "jobId" = ? AND ${fenceSql}`, id, ...fence]);
      }
      for (const [entity, delta] of report.counts ?? []) {
        statements.push([
          `INSERT INTO "ImportEntityCount" ("jobId", "entity", ${COUNT_FIELDS.map((field) => `"${field}"`).join(", ")})
           SELECT ?, ?, ${COUNT_FIELDS.map(() => "?").join(", ")} WHERE ${fenceSql}
           ON CONFLICT ("jobId", "entity") DO UPDATE SET ${COUNT_FIELDS.map((field) => `"${field}" = "${field}" + excluded."${field}"`).join(", ")}`,
          id, entity, ...COUNT_FIELDS.map((field) => delta[field] ?? 0), ...fence,
        ]);
      }
      for (const event of report.events ?? []) {
        // The seq comes from the same statement, so two writers never take the same one: the unique index refuses the second.
        statements.push([
          `INSERT INTO "ImportEvent" ("id", "jobId", "seq", "level", "kind", "entity", "sourceKey", "targetId", "message", "detail", "createdAt")
           SELECT ?, ?, (SELECT COALESCE(MAX("seq"), 0) + 1 FROM "ImportEvent" WHERE "jobId" = ?), ?, ?, ?, ?, ?, ?, ?, ? WHERE ${fenceSql}`,
          `event_${crypto.randomUUID()}`, id, id, event.level, event.kind, event.entity, event.sourceKey, event.targetId, event.message, event.detail ?? null, stamp, ...fence,
        ]);
      }
      statements.push([`UPDATE "ImportJob" SET ${sets.join(", ")} WHERE "id" = ? AND ${fenceSql}`, ...values, id, ...fence]);
      const results = await d1WriteBatch(db, statements);
      const changed = results[results.length - 1].changes;
      if (token !== undefined && changed === 0) throw new LostClaimError();
      return changed;
    },

    async sourceInstanceKey(sourceId) {
      const [[row]] = await d1ReadBatch(db, [[`SELECT "instanceKey" FROM "ImportSource" WHERE "id" = ?`, sourceId]]);
      return row ? String(row.instanceKey) : null;
    },

    async ensureSource({ ownerId, kind, instanceKey, label, serverUrl, sourceVersion }) {
      // A backup has no address, so moving one in keeps the address a move-in from the server recorded.
      const [, { rows: [row] }] = await d1WriteBatch(db, [
        [
          `INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label", "serverUrl", "sourceVersion", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("ownerId", "kind", "instanceKey") DO UPDATE SET "label" = excluded."label", "sourceVersion" = excluded."sourceVersion",
             "serverUrl" = COALESCE(excluded."serverUrl", "ImportSource"."serverUrl")`,
          `source_${crypto.randomUUID()}`, ownerId, kind, instanceKey, label, serverUrl, sourceVersion, d1Timestamp(now()),
        ],
        [`SELECT "id" FROM "ImportSource" WHERE "ownerId" = ? AND "kind" = ? AND "instanceKey" = ?`, ownerId, kind, instanceKey],
      ]);
      return String(row.id);
    },

    async claim(jobId, at) {
      const token = `claim_${crypto.randomUUID()}`;
      const [{ changes }] = await d1WriteBatch(db, [[
        `UPDATE "ImportJob" SET "heartbeatAt" = ?, "claimToken" = ?, "attempt" = "attempt" + 1 WHERE "id" = ? AND ("heartbeatAt" IS NULL OR "heartbeatAt" < ?)`,
        d1Timestamp(at), token, jobId, d1Timestamp(new Date(at.getTime() - MOVE_IN_CLAIM_MS)),
      ]]);
      return changes === 1 ? token : null;
    },

    async forgiveAttempt(jobId, token) {
      // Leaves "updatedAt" alone: an outage isn't progress, so a day of them still expires the job.
      await d1WriteBatch(db, [[`UPDATE "ImportJob" SET "attempt" = MAX("attempt" - 1, 0) WHERE "id" = ? AND "claimToken" = ?`, jobId, token]]);
    },

    async release(jobId, token) {
      await d1WriteBatch(db, [[`UPDATE "ImportJob" SET "heartbeatAt" = NULL, "claimToken" = NULL WHERE "id" = ? AND "claimToken" = ?`, jobId, token]]);
    },

    async hasIssues(jobId) {
      const [rows] = await d1ReadBatch(db, [[`SELECT 1 FROM "ImportEvent" WHERE "jobId" = ? AND "level" != 'info' LIMIT 1`, jobId]]);
      return rows.length > 0;
    },

    async organizing(jobId) {
      const [rows] = await d1ReadBatch(db, [[
        `SELECT 1 FROM "ImportEntityCount" WHERE "jobId" = ? AND "entity" IN ('tags', 'categories', 'tools') AND "found" > 0 AND "skipped" = 0 LIMIT 1`,
        jobId,
      ]]);
      return rows.length > 0;
    },
  };
}

export interface MoveInProgress {
  job: Omit<MoveInJob, "archiveKey"> & { archiveName: string | null; createdAt: string; updatedAt: string; finishedAt: string | null };
  counts: Record<string, MoveInCounts>;
  events: Array<MoveInEvent & { seq: number; createdAt: string }>;
  /** The newest recipes this move-in brought in that are still in the kitchen, newest first, with their photos. */
  latest: Array<{ id: string; title: string; photoUrl: string | null }>;
}

/** How many of a move-in's newest recipes its page shows while it runs. */
export const MOVE_IN_LATEST = 5;

/** Where the job stands and when it was last written to, or null when there is no such job. */
export async function readMoveInPosition(
  db: D1ReadDatabase,
  jobId: string,
): Promise<(Pick<MoveInJob, "id" | "phase" | "cursor" | "status"> & { updatedAt: string }) | null> {
  const [[row]] = await d1ReadBatch(db, [[`SELECT "id", "phase", "cursor", "status", "updatedAt" FROM "ImportJob" WHERE "id" = ?`, jobId]]);
  return (row as unknown as Awaited<ReturnType<typeof readMoveInPosition>>) ?? null;
}

/** How many recipes the job's kitchen has, as inspect counted them, or null before it has. */
export async function readMoveInRecipesFound(db: D1ReadDatabase, jobId: string): Promise<number | null> {
  const [[row]] = await d1ReadBatch(db, [[`SELECT "found" FROM "ImportEntityCount" WHERE "jobId" = ? AND "entity" = 'recipes'`, jobId]]);
  return row ? Number(row.found) : null;
}

/** A job's state, counts and report, or null when the job isn't this owner's. */
export async function readMoveInProgress(db: D1ReadDatabase, { ownerId, jobId }: { ownerId: string; jobId: string }): Promise<MoveInProgress | null> {
  const [[job], counts, events, latest] = await d1ReadBatch(db, [
    [`SELECT ${PROGRESS_COLUMNS} FROM "ImportJob" WHERE "id" = ? AND "ownerId" = ?`, jobId, ownerId],
    [`SELECT * FROM "ImportEntityCount" WHERE "jobId" = ? ORDER BY "entity"`, jobId],
    [`SELECT "seq", "level", "kind", "entity", "sourceKey", "targetId", "message", "createdAt" FROM "ImportEvent" WHERE "jobId" = ? ORDER BY "seq"`, jobId],
    // A move-in's records are all under its source, so this reads one source's records, not every one.
    [
      `SELECT r."id", r."title", c."imageUrl" AS "photoUrl" FROM "SourceRecord" s
       JOIN "Recipe" r ON r."id" = s."targetId" AND r."chefId" = ? AND r."deletedAt" IS NULL
       LEFT JOIN "RecipeCover" c ON c."id" = r."activeCoverId"
       WHERE s."sourceId" = (SELECT "sourceId" FROM "ImportJob" WHERE "id" = ? AND "ownerId" = ?) AND s."lastJobId" = ? AND s."targetType" = 'Recipe'
       ORDER BY r."createdAt" DESC, s.rowid DESC LIMIT ?`,
      ownerId, jobId, ownerId, jobId, MOVE_IN_LATEST,
    ],
  ]);
  if (!job) return null;
  return {
    job: job as unknown as MoveInProgress["job"],
    counts: Object.fromEntries(counts.map((row) => [String(row.entity), Object.fromEntries(COUNT_FIELDS.map((field) => [field, Number(row[field])])) as unknown as MoveInCounts])),
    events: events as unknown as MoveInProgress["events"],
    latest: latest.map((row) => ({ id: String(row.id), title: String(row.title), photoUrl: row.photoUrl as string | null })),
  };
}
