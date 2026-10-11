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
  active_step_id: string | null;
  scale_factor: number;
  checked_ingredient_ids_json: string;
  checked_step_output_ids_json: string;
  started_at: number;
  updated_at: number;
}

// Column names follow the frozen protocol-v1 `session` table. Snapshot pinning, terminal states,
// mutation receipts, and purge scheduling are not part of this slice; their columns are added
// when those features land.
//
// `active_step_id` and `active_step_id_index` were added after the table first shipped (the
// current step kept by id). New tables are created with them; an older table gets them from
// `ADD_STEP_ID_COLUMNS` at its next write, never at a read. Both are nullable and every older
// query names its columns, so code from before them ignores them and rolling back needs no
// change to stored data. `active_step_id_index` is the index the id was stored with: code from
// before the id moves only `active_step_index`, so after a rollback and a roll forward an id whose
// index no longer matches is read as null rather than naming a step the cook has left. To remove
// them by hand: `ALTER TABLE session DROP COLUMN active_step_id_index` and
// `ALTER TABLE session DROP COLUMN active_step_id`.
const CREATE_SESSION_TABLE = `CREATE TABLE IF NOT EXISTS session (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
  version INTEGER NOT NULL CHECK(version=1),
  recipe_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),
  revision INTEGER NOT NULL CHECK(revision>=0),
  active_step_index INTEGER NOT NULL CHECK(active_step_index>=0),
  active_step_id TEXT,
  active_step_id_index INTEGER,
  scale_factor REAL NOT NULL CHECK(scale_factor>=0.25 AND scale_factor<=50),
  checked_ingredient_ids_json TEXT NOT NULL,
  checked_step_output_ids_json TEXT NOT NULL,
  started_at INTEGER NOT NULL CHECK(started_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=started_at)
)`;

const ADD_STEP_ID_COLUMNS = [
  "ALTER TABLE session ADD COLUMN active_step_id TEXT",
  "ALTER TABLE session ADD COLUMN active_step_id_index INTEGER",
];
// The stored id, only while it was stored with the current index.
const STEP_ID_COLUMN = "CASE WHEN active_step_id_index = active_step_index THEN active_step_id END AS active_step_id";

/** The session table's CREATE statement, or null when there is no table. */
function sessionTableSql(storage: CookSessionSqlStorage): string | null {
  const [row] = storage.sql.exec<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session'",
  ).toArray();
  return row ? row.sql : null;
}

function readRow(storage: CookSessionSqlStorage): SessionRow | undefined {
  // Reading must never create or change the table: a signed-in visit to a recipe the user has not
  // cooked reads its (empty) object and must leave no storage behind.
  const tableSql = sessionTableSql(storage);
  if (tableSql === null) return undefined;
  const stepId = tableSql.includes("active_step_id_index") ? STEP_ID_COLUMN : "NULL AS active_step_id";
  // The table is only ever created together with its single row.
  return storage.sql.exec<SessionRow>(
    `SELECT recipe_id, attempt_id, revision, active_step_index, ${stepId}, scale_factor, checked_ingredient_ids_json, checked_step_output_ids_json, started_at, updated_at FROM session WHERE singleton = 1`,
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
      activeStepId: row.active_step_id,
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
    // A new index without an id no longer names the stored step.
    activeStepId: changes.activeStepId !== undefined
      ? changes.activeStepId
      : changes.activeStepIndex !== undefined ? null : progress.activeStepId,
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
  if (!sessionTableSql(storage)!.includes("active_step_id_index")) {
    for (const statement of ADD_STEP_ID_COLUMNS) storage.sql.exec(statement);
  }
  storage.sql.exec(
    "UPDATE session SET revision = ?, active_step_index = ?, active_step_id = ?, active_step_id_index = ?, scale_factor = ?, checked_ingredient_ids_json = ?, checked_step_output_ids_json = ?, updated_at = ? WHERE singleton = 1",
    current.revision + 1,
    next.activeStepIndex,
    next.activeStepId,
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
