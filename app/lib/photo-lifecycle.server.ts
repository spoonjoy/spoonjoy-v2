/**
 * Stored photo lifecycle: finding R2 objects that nothing references any more, and removing them
 * reversibly.
 *
 * Photos live in the `PHOTOS` R2 bucket and are served publicly from `/photos/<key>`. Rows refer to
 * them by that relative URL: `User.photoUrl`, `RecipeSpoon.photoUrl` and the three URL columns of
 * `RecipeCover`. Forks copy their source's cover row, so one key can be referenced by several
 * recipes; a key is only safe to remove when no live row anywhere references it.
 *
 * A key is live while at least one of these references it:
 * - a user's profile photo;
 * - a spoon that is not deleted, on a recipe that is not deleted;
 * - a cover that is not archived, on a recipe that is not deleted (its image, its stylized image
 *   or the source image it was made from).
 *
 * The sweep runs from the Worker's cron trigger. Every run lists the bucket, works out which
 * originals are unreferenced and records each one in `PhotoCleanup` the first time it is seen,
 * with the time it becomes eligible for removal (`PHOTO_SWEEP_GRACE_MS` later, or straight away
 * for photos of a deleted account). What happens next depends on the mode:
 * - `dry-run` (the default): only the bookkeeping rows and a `PhotoSweepRun` report are written.
 *   R2 is not touched.
 * - `apply`: an eligible original is moved under `quarantine/`, which `/photos/` never serves, and
 *   its size variants are deleted (they can be generated again). A quarantined object is purged
 *   `PHOTO_QUARANTINE_RETENTION_MS` after it was moved. Until then the move can be undone by
 *   copying the object back to its original key (see docs/photo-lifecycle.md).
 * - `off`: nothing runs.
 * A key that is referenced again before it is moved simply loses its bookkeeping row.
 */


import { captureException, resolvePostHogServerConfig, type PostHogServerEnv } from "~/lib/analytics-server";
/** Where stored photos are served from; rows keep this relative URL. */
export const PHOTO_URL_PREFIX = "/photos/";
/** Moved objects wait here, unserved, until they are purged or restored. */
export const PHOTO_QUARANTINE_PREFIX = "quarantine/";
/**
 * Size variants of an original `<key>` are stored as `variants/w<width>/<key>.webp`. They are
 * derived, so they follow their original: live with it, removed with it.
 */
export const PHOTO_VARIANT_PREFIX = "variants/";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long an original must stay unreferenced before it may be moved to quarantine. */
export const PHOTO_SWEEP_GRACE_MS = 7 * DAY_MS;
/** How long a quarantined object is kept, so that a mistaken move can be undone. */
export const PHOTO_QUARANTINE_RETENTION_MS = 30 * DAY_MS;
/** At most this many moves and purges per run, so one run stays well inside the cron limits. */
export const PHOTO_SWEEP_MAX_CHANGES_PER_RUN = 200;

export const PHOTO_SWEEP_MODES = ["off", "dry-run", "apply"] as const;
export type PhotoSweepMode = (typeof PHOTO_SWEEP_MODES)[number];

/** Why a key has a `PhotoCleanup` row. */
export type PhotoCleanupReason = "unreferenced" | "account_deleted";

/**
 * The sweep mode from the `PHOTO_SWEEP_MODE` setting. Anything other than an exact `off` or
 * `apply` means `dry-run`, so a typo can never switch removal on.
 */
export function resolvePhotoSweepMode(raw: string | null | undefined): PhotoSweepMode {
  const value = raw?.trim().toLowerCase();
  return value === "off" || value === "apply" ? value : "dry-run";
}

/** The R2 key behind a stored `/photos/<key>` URL, or null for any other URL (external, data:). */
export function photoKeyFromStoredUrl(url: string | null | undefined): string | null {
  if (!url?.startsWith(PHOTO_URL_PREFIX)) return null;
  const key = url.slice(PHOTO_URL_PREFIX.length).split(/[?#]/, 1)[0];
  return key || null;
}

/** False for keys `/photos/` must never serve: quarantined objects. */
export function isServablePhotoKey(key: string): boolean {
  return !key.startsWith(PHOTO_QUARANTINE_PREFIX);
}

const VARIANT_KEY = /^variants\/w[0-9]+\/(.+)\.webp$/;

/** The original key a variant key was made from, or null when `key` is not a variant key. */
export function originalKeyOfVariant(key: string): string | null {
  return VARIANT_KEY.exec(key)?.[1] ?? null;
}

/** A row from the sweep's database. */
export type SweepRow = Record<string, unknown>;

/**
 * The slice of a SQL database the sweep needs. `photoSweepD1Database` adapts the Worker's D1
 * binding; tests adapt an SQLite database built from the repository migrations.
 */
export interface PhotoSweepDatabase {
  all(sql: string, ...values: unknown[]): Promise<SweepRow[]>;
  run(sql: string, ...values: unknown[]): Promise<void>;
}

interface D1LikeStatement {
  bind(...values: unknown[]): D1LikeStatement;
  all(): Promise<{ results?: unknown[] }>;
  run(): Promise<unknown>;
}

interface D1Like {
  prepare(sql: string): D1LikeStatement;
}

export function photoSweepD1Database(d1: D1Like): PhotoSweepDatabase {
  return {
    async all(sql, ...values) {
      const result = await d1.prepare(sql).bind(...values).all();
      return (result.results ?? []) as SweepRow[];
    },
    async run(sql, ...values) {
      await d1.prepare(sql).bind(...values).run();
    },
  };
}

/** An R2 object's HTTP metadata (content type and friends), carried over unchanged on a move. */
export type PhotoHttpMetadata = Record<string, unknown>;

/** The slice of an R2 bucket the sweep needs. */
export interface PhotoSweepBucket {
  list(options: { cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size: number }>;
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: PhotoHttpMetadata;
    customMetadata?: Record<string, string>;
  } | null>;
  put(
    key: string,
    value: ReadableStream,
    options: { httpMetadata?: PhotoHttpMetadata; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

const LIVE_PHOTO_URLS_SQL = `
SELECT "photoUrl" AS "url" FROM "User" WHERE "photoUrl" LIKE '/photos/%'
UNION
SELECT "s"."photoUrl" FROM "RecipeSpoon" AS "s" JOIN "Recipe" AS "r" ON "r"."id" = "s"."recipeId"
  WHERE "s"."photoUrl" LIKE '/photos/%' AND "s"."deletedAt" IS NULL AND "r"."deletedAt" IS NULL
UNION
SELECT "c"."imageUrl" FROM "RecipeCover" AS "c" JOIN "Recipe" AS "r" ON "r"."id" = "c"."recipeId"
  WHERE "c"."imageUrl" LIKE '/photos/%' AND "c"."archivedAt" IS NULL AND "c"."status" <> 'archived' AND "r"."deletedAt" IS NULL
UNION
SELECT "c"."stylizedImageUrl" FROM "RecipeCover" AS "c" JOIN "Recipe" AS "r" ON "r"."id" = "c"."recipeId"
  WHERE "c"."stylizedImageUrl" LIKE '/photos/%' AND "c"."archivedAt" IS NULL AND "c"."status" <> 'archived' AND "r"."deletedAt" IS NULL
UNION
SELECT "c"."sourceImageUrl" FROM "RecipeCover" AS "c" JOIN "Recipe" AS "r" ON "r"."id" = "c"."recipeId"
  WHERE "c"."sourceImageUrl" LIKE '/photos/%' AND "c"."archivedAt" IS NULL AND "c"."status" <> 'archived' AND "r"."deletedAt" IS NULL
`;

/** Every R2 key that a live row references. */
export async function collectLivePhotoKeys(db: PhotoSweepDatabase): Promise<Set<string>> {
  const rows = await db.all(LIVE_PHOTO_URLS_SQL);
  const keys = new Set<string>();
  for (const row of rows) {
    const key = photoKeyFromStoredUrl(typeof row.url === "string" ? row.url : null);
    if (key) keys.add(key);
  }
  return keys;
}

/** Whether a live row references `key` right now; checked again just before a move. */
export async function isPhotoKeyLive(db: PhotoSweepDatabase, key: string): Promise<boolean> {
  const url = `${PHOTO_URL_PREFIX}${key}`;
  const rows = await db.all(
    `SELECT 1 AS "live" FROM (${LIVE_PHOTO_URLS_SQL}) WHERE "url" = ? OR substr("url", 1, ?) IN (? || '?', ? || '#') LIMIT 1`,
    url,
    url.length + 1,
    url,
    url,
  );
  return rows.length > 0;
}

/**
 * One statement that asks the sweep to remove the photos behind the stored URLs `urlsSql`
 * selects (as a column named `url`), once nothing references them, eligible from `eligibleAt`.
 * Only `/photos/` URLs are queued. An existing row keeps its first-seen time and takes the earlier
 * eligibility; a quarantined row is left alone. Account deletion runs it inside its own atomic
 * batch, before the rows that hold the URLs are deleted.
 */
export function photoCleanupRequestStatement(
  urlsSql: string,
  urlValues: readonly unknown[],
  reason: PhotoCleanupReason,
  now: Date,
  eligibleAt: Date,
): readonly [string, ...unknown[]] {
  return [
    `INSERT INTO "PhotoCleanup" ("key", "reason", "firstUnreferencedAt", "eligibleAt", "updatedAt")
     SELECT DISTINCT substr("url", ${PHOTO_URL_PREFIX.length + 1}), ?, ?, ?, ?
     FROM (${urlsSql}) WHERE "url" LIKE '${PHOTO_URL_PREFIX}_%'
     ON CONFLICT("key") DO UPDATE SET
       "reason" = excluded."reason",
       "eligibleAt" = MIN("PhotoCleanup"."eligibleAt", excluded."eligibleAt"),
       "updatedAt" = excluded."updatedAt"
     WHERE "PhotoCleanup"."quarantinedAt" IS NULL`,
    reason,
    now.toISOString(),
    eligibleAt.toISOString(),
    now.toISOString(),
    ...urlValues,
  ];
}

export interface PhotoSweepReport {
  id: string;
  mode: PhotoSweepMode;
  startedAt: string;
  finishedAt: string;
  /** Originals in the bucket (not variants, not quarantined objects). */
  objectsScanned: number;
  referencedObjects: number;
  unreferencedObjects: number;
  unreferencedBytes: number;
  /** Variants whose original is unreferenced or gone. */
  orphanVariants: number;
  /** Unreferenced originals whose grace period has passed. */
  eligibleObjects: number;
  quarantined: number;
  purged: number;
  failures: number;
  /** True when the per-run change limit stopped the run before every eligible change was made. */
  truncated: boolean;
  note: string | null;
}

/** The step of an apply run that a failed change belongs to. */
export type PhotoSweepFailurePhase = "quarantine" | "purge" | "variant_cleanup";

export interface PhotoSweepFailure {
  phase: PhotoSweepFailurePhase;
  error: unknown;
}

export interface RunPhotoSweepOptions {
  db: PhotoSweepDatabase;
  bucket: PhotoSweepBucket;
  mode: PhotoSweepMode;
  now?: () => Date;
  newId?: () => string;
  maxChanges?: number;
  /** Told about each change that failed; the run counts it and carries on either way. */
  onFailure?: (failure: PhotoSweepFailure) => void | Promise<void>;
}

interface CleanupRow {
  key: string;
  eligibleAt: Date;
  quarantinedAt: Date | null;
  purgedAt: Date | null;
}

function parseTime(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(typeof value === "bigint" ? Number(value) : (value as string | number));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readCleanupRows(db: PhotoSweepDatabase): Promise<Map<string, CleanupRow>> {
  const rows = await db.all(`SELECT "key", "eligibleAt", "quarantinedAt", "purgedAt" FROM "PhotoCleanup"`);
  const byKey = new Map<string, CleanupRow>();
  for (const row of rows) {
    byKey.set(String(row.key), {
      key: String(row.key),
      // A malformed time is treated as "not yet", which only ever delays a removal.
      eligibleAt: parseTime(row.eligibleAt) ?? new Date(8.64e15),
      quarantinedAt: parseTime(row.quarantinedAt),
      purgedAt: parseTime(row.purgedAt),
    });
  }
  return byKey;
}

async function listBucket(bucket: PhotoSweepBucket) {
  const objects: Array<{ key: string; size: number }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ cursor, limit: 1000 });
    objects.push(...page.objects.map(({ key, size }) => ({ key, size })));
    if (!page.truncated || !page.cursor) return objects;
    cursor = page.cursor;
  }
}

async function moveToQuarantine(bucket: PhotoSweepBucket, key: string, variants: string[], now: Date): Promise<boolean> {
  const object = await bucket.get(key);
  if (!object) return false;
  await bucket.put(`${PHOTO_QUARANTINE_PREFIX}${key}`, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: { ...object.customMetadata, originalKey: key, quarantinedAt: now.toISOString() },
  });
  await bucket.delete([key, ...variants]);
  return true;
}

/** One run of the photo sweep. See the module comment for what each mode does. */
export async function runPhotoSweep(options: RunPhotoSweepOptions): Promise<PhotoSweepReport> {
  const now = options.now ?? (() => new Date());
  const maxChanges = options.maxChanges ?? PHOTO_SWEEP_MAX_CHANGES_PER_RUN;
  const startedAt = now();
  const report: PhotoSweepReport = {
    id: options.newId?.() ?? crypto.randomUUID(),
    mode: options.mode,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    objectsScanned: 0,
    referencedObjects: 0,
    unreferencedObjects: 0,
    unreferencedBytes: 0,
    orphanVariants: 0,
    eligibleObjects: 0,
    quarantined: 0,
    purged: 0,
    failures: 0,
    truncated: false,
    note: null,
  };
  if (options.mode === "off") {
    report.note = "sweep is off";
    return report;
  }

  const { db, bucket } = options;
  const live = await collectLivePhotoKeys(db);
  const objects = await listBucket(bucket);
  const cleanup = await readCleanupRows(db);

  const originals = new Map<string, number>();
  const variantsByOriginal = new Map<string, string[]>();
  for (const object of objects) {
    if (object.key.startsWith(PHOTO_QUARANTINE_PREFIX)) continue;
    const original = originalKeyOfVariant(object.key);
    if (original !== null) {
      variantsByOriginal.set(original, [...(variantsByOriginal.get(original) ?? []), object.key]);
    } else if (!object.key.startsWith(PHOTO_VARIANT_PREFIX)) {
      originals.set(object.key, object.size);
    }
  }

  const unreferenced: string[] = [];
  for (const [key, size] of originals) {
    report.objectsScanned += 1;
    if (live.has(key)) {
      report.referencedObjects += 1;
    } else {
      report.unreferencedObjects += 1;
      report.unreferencedBytes += size;
      unreferenced.push(key);
    }
  }
  const orphanVariantGroups: string[][] = [];
  for (const [original, variants] of variantsByOriginal) {
    if (live.has(original)) continue;
    report.orphanVariants += variants.length;
    if (!originals.has(original)) orphanVariantGroups.push(variants);
  }

  // Bookkeeping, in every mode that runs: forget keys that are live again (or gone without a
  // move), and record when each newly unreferenced key was first seen.
  const at = startedAt.toISOString();
  for (const row of cleanup.values()) {
    if (row.quarantinedAt) continue;
    if (live.has(row.key) || !originals.has(row.key)) {
      await db.run(`DELETE FROM "PhotoCleanup" WHERE "key" = ? AND "quarantinedAt" IS NULL`, row.key);
      cleanup.delete(row.key);
    }
  }
  for (const key of unreferenced) {
    if (cleanup.has(key)) continue;
    const eligibleAt = new Date(startedAt.getTime() + PHOTO_SWEEP_GRACE_MS);
    await db.run(
      `INSERT INTO "PhotoCleanup" ("key", "reason", "firstUnreferencedAt", "eligibleAt", "sizeBytes", "updatedAt")
       VALUES (?, 'unreferenced', ?, ?, ?, ?) ON CONFLICT("key") DO NOTHING`,
      key,
      at,
      eligibleAt.toISOString(),
      originals.get(key),
      at,
    );
    cleanup.set(key, { key, eligibleAt, quarantinedAt: null, purgedAt: null });
  }

  const eligible = unreferenced.filter((key) => cleanup.get(key)!.eligibleAt.getTime() <= startedAt.getTime());
  report.eligibleObjects = eligible.length;
  const purgeable = [...cleanup.values()].filter(
    (row) => row.quarantinedAt && !row.purgedAt && row.quarantinedAt.getTime() + PHOTO_QUARANTINE_RETENTION_MS <= startedAt.getTime(),
  );

  if (options.mode === "apply" && live.size === 0 && originals.size > 0) {
    // An empty reference set with photos in the bucket means the reference query is wrong, not
    // that every photo is unused. Refuse to move anything.
    report.note = "no live photo references found; refusing to apply";
  } else if (options.mode === "apply") {
    let changes = 0;
    for (const key of eligible) {
      if (changes >= maxChanges) {
        report.truncated = true;
        break;
      }
      changes += 1;
      try {
        if (await isPhotoKeyLive(db, key)) continue;
        if (await moveToQuarantine(bucket, key, variantsByOriginal.get(key) ?? [], startedAt)) {
          await db.run(
            `UPDATE "PhotoCleanup" SET "quarantinedAt" = ?, "updatedAt" = ? WHERE "key" = ?`,
            at,
            at,
            key,
          );
          report.quarantined += 1;
        }
      } catch (error) {
        report.failures += 1;
        await options.onFailure?.({ phase: "quarantine", error });
      }
    }
    for (const row of purgeable) {
      if (changes >= maxChanges) {
        report.truncated = true;
        break;
      }
      changes += 1;
      try {
        await bucket.delete(`${PHOTO_QUARANTINE_PREFIX}${row.key}`);
        await db.run(`UPDATE "PhotoCleanup" SET "purgedAt" = ?, "updatedAt" = ? WHERE "key" = ?`, at, at, row.key);
        report.purged += 1;
      } catch (error) {
        report.failures += 1;
        await options.onFailure?.({ phase: "purge", error });
      }
    }
    for (const variants of orphanVariantGroups) {
      try {
        await bucket.delete(variants);
      } catch (error) {
        report.failures += 1;
        await options.onFailure?.({ phase: "variant_cleanup", error });
      }
    }
  }

  report.finishedAt = now().toISOString();
  await db.run(
    `INSERT INTO "PhotoSweepRun" ("id", "mode", "startedAt", "finishedAt", "objectsScanned", "referencedObjects",
       "unreferencedObjects", "unreferencedBytes", "orphanVariants", "eligibleObjects", "quarantined", "purged",
       "failures", "truncated", "note")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    report.id,
    report.mode,
    report.startedAt,
    report.finishedAt,
    report.objectsScanned,
    report.referencedObjects,
    report.unreferencedObjects,
    report.unreferencedBytes,
    report.orphanVariants,
    report.eligibleObjects,
    report.quarantined,
    report.purged,
    report.failures,
    report.truncated ? 1 : 0,
    report.note,
  );
  return report;
}

export interface ScheduledPhotoSweepEnv extends PostHogServerEnv {
  DB?: D1Database;
  PHOTOS?: R2Bucket;
  PHOTO_SWEEP_MODE?: string;
}

/**
 * The cron entry point: runs the sweep in the configured mode and logs its report. Without a
 * database or a bucket (local tools) there is nothing to sweep.
 */
export async function runScheduledPhotoSweep(
  env: ScheduledPhotoSweepEnv,
  log: (line: string) => void = console.log,
): Promise<PhotoSweepReport | null> {
  if (!env.DB || !env.PHOTOS) return null;
  const mode = resolvePhotoSweepMode(env.PHOTO_SWEEP_MODE);
  const telemetry = resolvePostHogServerConfig(env);
  const capture = (phase: PhotoSweepFailurePhase | "run", error: unknown) =>
    captureException(telemetry, {
      error,
      distinctId: "server",
      route: "cron:photo_sweep",
      extras: { operation: "photo_sweep", phase, mode },
    });
  let report: PhotoSweepReport;
  try {
    report = await runPhotoSweep({
      db: photoSweepD1Database(env.DB as unknown as D1Like),
      bucket: env.PHOTOS as unknown as PhotoSweepBucket,
      mode,
      onFailure: ({ phase, error }) => capture(phase, error),
    });
  } catch (error) {
    await capture("run", error);
    throw error;
  }
  log(JSON.stringify({ event: "spoonjoy.photo_sweep", ...report }));
  return report;
}
