// SQLite storage for one CookSession Durable Object: one (user, recipe) pair, one active attempt.
// The Durable Object is the server of record for cook progress; D1 never stores progress.
//
// Every read-modify-write here is synchronous `sql.exec` with no await in between, so it runs
// atomically inside the object's single-threaded event loop; the only awaited call (the retention
// alarm) happens after the write it follows.
import type { CookProgress, CookProgressChanges, CookState } from "./cook-session-protocol";

/** Idle sessions are deleted after this long without a write. */
export const COOK_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type SqlValue = string | number | ArrayBuffer | null;

export interface CookSessionSqlStorage {
  sql: {
    exec<T extends Record<string, SqlValue> = Record<string, SqlValue>>(
      query: string,
      ...bindings: SqlValue[]
    ): { toArray(): T[] };
  };
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

interface SessionRow extends Record<string, SqlValue> {
  recipe_id: string;
  attempt_id: string;
  revision: number;
  active_step_index: number;
  scale_factor: number;
  checked_ingredient_ids_json: string;
  checked_step_output_ids_json: string;
  started_at: number;
  updated_at: number;
}

// Column names follow the frozen protocol-v1 `session` table. Snapshot pinning, terminal states,
// mutation receipts, and purge scheduling are not part of this slice; their columns are added
// when those features land.
const CREATE_SESSION_TABLE = `CREATE TABLE IF NOT EXISTS session (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
  version INTEGER NOT NULL CHECK(version=1),
  recipe_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),
  revision INTEGER NOT NULL CHECK(revision>=0),
  active_step_index INTEGER NOT NULL CHECK(active_step_index>=0),
  scale_factor REAL NOT NULL CHECK(scale_factor>=0.25 AND scale_factor<=50),
  checked_ingredient_ids_json TEXT NOT NULL,
  checked_step_output_ids_json TEXT NOT NULL,
  started_at INTEGER NOT NULL CHECK(started_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=started_at)
)`;

function hasSessionTable(storage: CookSessionSqlStorage): boolean {
  return storage.sql.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'",
  ).toArray().length > 0;
}

function readRow(storage: CookSessionSqlStorage): SessionRow | undefined {
  // Reading must never create the table: a signed-in visit to a recipe the user has not cooked
  // reads its (empty) object and must leave no storage behind.
  if (!hasSessionTable(storage)) return undefined;
  // The table is only ever created together with its single row.
  return storage.sql.exec<SessionRow>(
    "SELECT recipe_id, attempt_id, revision, active_step_index, scale_factor, checked_ingredient_ids_json, checked_step_output_ids_json, started_at, updated_at FROM session WHERE singleton = 1",
  ).toArray()[0];
}

function stateFromRow(row: SessionRow): CookState {
  return {
    version: 1,
    recipeId: row.recipe_id,
    attemptId: row.attempt_id,
    status: "active",
    revision: row.revision,
    progress: {
      activeStepIndex: row.active_step_index,
      scaleFactor: row.scale_factor,
      checkedIngredientIds: JSON.parse(row.checked_ingredient_ids_json) as string[],
      checkedStepOutputIds: JSON.parse(row.checked_step_output_ids_json) as string[],
    },
    startedAt: new Date(row.started_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    terminalAt: null,
  };
}

export function readCookSession(storage: CookSessionSqlStorage): CookState | null {
  const row = readRow(storage);
  return row ? stateFromRow(row) : null;
}

/** Returns the active session, creating it at revision 0 with default progress when absent. */
export async function startCookSession(
  storage: CookSessionSqlStorage,
  recipeId: string,
  attemptId: string,
  now: number,
): Promise<{ created: boolean; state: CookState }> {
  const existing = readCookSession(storage);
  if (existing) return { created: false, state: existing };

  storage.sql.exec(CREATE_SESSION_TABLE);
  storage.sql.exec(
    "INSERT INTO session (singleton, version, recipe_id, attempt_id, status, revision, active_step_index, scale_factor, checked_ingredient_ids_json, checked_step_output_ids_json, started_at, updated_at) VALUES (1, 1, ?, ?, 'active', 0, 0, 1, '[]', '[]', ?, ?)",
    recipeId,
    attemptId,
    now,
    now,
  );
  await storage.setAlarm(now + COOK_SESSION_RETENTION_MS);
  return { created: true, state: readCookSession(storage)! };
}

export function applyCookProgressChanges(progress: CookProgress, changes: CookProgressChanges): CookProgress {
  return {
    activeStepIndex: changes.activeStepIndex ?? progress.activeStepIndex,
    scaleFactor: changes.scaleFactor ?? progress.scaleFactor,
    checkedIngredientIds: changes.checkedIngredientIds ?? progress.checkedIngredientIds,
    checkedStepOutputIds: changes.checkedStepOutputIds ?? progress.checkedStepOutputIds,
  };
}

/** Writes `changes` over `current` as the next revision. The caller has already checked attempt and revision. */
export async function writeCookProgress(
  storage: CookSessionSqlStorage,
  current: CookState,
  changes: CookProgressChanges,
  now: number,
): Promise<CookState> {
  const next = applyCookProgressChanges(current.progress, changes);
  const updatedAt = Math.max(now, Date.parse(current.startedAt));
  storage.sql.exec(
    "UPDATE session SET revision = ?, active_step_index = ?, scale_factor = ?, checked_ingredient_ids_json = ?, checked_step_output_ids_json = ?, updated_at = ? WHERE singleton = 1",
    current.revision + 1,
    next.activeStepIndex,
    next.scaleFactor,
    JSON.stringify(next.checkedIngredientIds),
    JSON.stringify(next.checkedStepOutputIds),
    updatedAt,
  );
  await storage.setAlarm(updatedAt + COOK_SESSION_RETENTION_MS);
  return readCookSession(storage)!;
}

/**
 * Retention alarm: deletes the whole object once it has been idle for the retention period, or
 * reschedules itself for the current session's expiry.
 */
export async function expireIdleCookSession(storage: CookSessionSqlStorage, now: number): Promise<void> {
  const row = readRow(storage);
  if (row && row.updated_at + COOK_SESSION_RETENTION_MS > now) {
    await storage.setAlarm(row.updated_at + COOK_SESSION_RETENTION_MS);
    return;
  }
  storage.sql.exec("DROP TABLE IF EXISTS session");
  try {
    await storage.deleteAll();
  } finally {
    await storage.deleteAlarm();
  }
}
