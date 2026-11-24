import { qaErrorLogsEnabled } from "./qa-error-logs.server";
import { consoleSlowCallReporter, firstTable, watchSlowCall, type SlowCallReporter } from "./slow-call.server";

/**
 * Retries D1 reads that fail with a transient D1 error.
 *
 * D1 sometimes fails a statement with an error that says nothing about the statement: "Network
 * connection lost", "D1 DB storage caused object to be reset", "D1 DB reset because its code was
 * updated", "Internal error while starting up D1 DB storage", or a bare "D1_ERROR: internal
 * error". Cloudflare's guidance (developers.cloudflare.com/d1/observability/debug-d1/) is to retry
 * the operation, and only when the query is idempotent, because a failed write may already have
 * been applied. D1 itself retries a read-only query up to two more times at once; when the
 * failure outlasts those, the request's loader threw and the visitor saw a 500.
 *
 * `withD1TransientRetry` wraps the Worker's `DB` binding once per request (workers/app.ts), so
 * Prisma's D1 adapter, the raw D1 read paths and the session check all go through it. It retries,
 * with a short backoff, only:
 *
 * - a read-only statement (SELECT, or WITH or VALUES with no write keyword anywhere in it), or a
 *   batch made only of such statements, on any transient error;
 * - a single write statement whose second run changes nothing and answers the same
 *   (`isIdempotentWriteSql`), on any transient error;
 * - any statement or batch, write or not, when D1 says its storage failed to start, because then
 *   the statement never ran.
 *
 * No other write is retried here: whether it was applied is unknown, and only the operation
 * itself can make a second attempt safe. Its error still reaches the caller unchanged, and the
 * operations that know they are safe to run again do so through `retryD1Write`
 * (d1-write-retry.server.ts).
 *
 * The backoff spans 3.5 s. A shorter one (50, 150 and 400 ms) ran out in Journeys runs: each
 * page that answered 500 with "D1_ERROR: internal error" had failed all four of its tries within
 * about 650 ms (runs 45248636426 and 45311924069).
 *
 * A read can also stall without failing: in Journeys runs on QA, single D1 calls have waited 1 to
 * 5 seconds on no CPU while other D1 calls of the same moment answered in milliseconds (run
 * 40241845409's cookbook page waited 5.4 s and its journey failed). So a read-only try that has
 * not settled after `readReissueMs` is sent once more, and whichever answer arrives first is used;
 * the other is ignored. A write is never sent again this way, because the first may still apply.
 * A wrapped binding re-issues at most `maxReadReissues` reads, so when D1 is slow because it is
 * busy, a request adds only a little load to it. Each re-issue is reported to `onReadReissue`.
 *
 * Each transient failure, retried or not, is reported to `onTransientError` with no SQL and no
 * bound values, so the per-run QA Worker can log it for the Journeys tail summary. Each try that
 * waits longer than a second is reported to `onSlowCall` (slow-call.server.ts) with the first table
 * its SQL names, for the same summary.
 */

export type D1TransientOperation = "read" | "write";

export interface D1TransientErrorReport {
  event: "d1_transient_error";
  /** Whether every statement involved was read-only. */
  operation: D1TransientOperation;
  /** The D1 call that failed: first, all, raw, run or batch. */
  call: string;
  /** 1 for the first try. */
  attempt: number;
  /** Whether another attempt follows. */
  willRetry: boolean;
  /** Which transient error it was, as a fixed label, never the raw message. */
  kind: D1TransientKind;
  /** The route that made the call, from `d1RouteLabel`, when the wrapper was given one. */
  route?: string;
}

/**
 * The static path segments of app/routes (and of the cook-session API in workers/app.ts). Any
 * other segment is a recipe slug, an id or a name, which `d1RouteLabel` never logs.
 */
const STATIC_SEGMENTS = new Set([
  "account", "agent", "api", "apple", "apple-app-site-association", "auth", "authenticate", "authorize",
  "calendar", "callback", "categories", "chefs", "connect", "cook-sessions", "cookbooks", "cooking-now",
  "csp-report", "deleted", "developer", "developers", "devtools-well-known", "docs", "edit", "export",
  "fellow-chefs", "forgot-password", "fork", "github", "google", "health", "households", "join", "json",
  "kitchen-visitors", "lists", "login", "logout", "mcp", "moderation", "move-in", "my-recipes", "new", "oauth",
  "oauth-authorization-server", "oauth-protected-resource", "og", "oidc", "openapi", "openapi-json",
  "openapi-spec", "options", "organize", "pages", "photo-uploads", "photos", "plan", "playground", "png",
  "preferences", "privacy", "public-key", "push", "ready", "recipes", "redwood-functions-auth-oauth",
  "register", "reset-password", "revoke", "roadmap", "robots", "saved-recipes", "search", "server-backups",
  "server-settings", "settings", "shopping-list", "signup", "sitemap", "spoonjoy-release-readiness", "steps",
  "subscriptions", "support", "tags", "terms", "test-kitchen", "token", "tools", "try", "txt", "users", "v1",
  "verify", "webauthn", "well-known", "xml",
]);

/**
 * A request path as a route, safe to log: each static segment kept, every other one ":id", and a
 * React Router data request's ".data" kept, so /recipes/lemon-rice.data becomes /recipes/:id.data.
 */
export function d1RouteLabel(pathname: string): string {
  const data = pathname.endsWith(".data");
  const path = data ? pathname.slice(0, -".data".length) : pathname;
  const segments = path.split("/").filter(Boolean).map((segment) => (STATIC_SEGMENTS.has(segment) ? segment : ":id"));
  return `/${segments.join("/")}${data ? ".data" : ""}`;
}

export type D1TransientKind =
  | "network_connection_lost"
  | "storage_reset"
  | "code_updated_reset"
  | "storage_startup_failed"
  | "replica_disconnected"
  | "remote_node_unresolved"
  | "internal_error";

export interface D1TransientRetryOptions {
  /** Delays before each retry, in milliseconds. Its length is the number of retries. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onTransientError?: (report: D1TransientErrorReport) => void;
  onSlowCall?: SlowCallReporter;
  /** How long a read-only try may wait before it is sent once more; 0 turns re-issuing off. */
  readReissueMs?: number;
  /** How many reads one wrapped binding (one request) may re-issue in all. */
  maxReadReissues?: number;
  onReadReissue?: (report: D1ReadReissueReport) => void;
}

export interface D1ReadReissueReport {
  event: "d1_read_reissue";
  /** The D1 call: first, all, raw, run or batch. */
  call: string;
  /** For a statement, the first table its SQL names; for a batch, its first statement's. */
  table: string | null;
  attempt: number;
  /** Which try answered first, or "neither" when both failed. */
  answeredBy: "original" | "reissue" | "neither";
}

export const DEFAULT_D1_RETRY_DELAYS_MS: readonly number[] = [50, 150, 400];

/**
 * The binding's own backoff: the operation-level one, then 1 s and 1.9 s more, 3.5 s in all, so a
 * page waits at most about that much longer on a failing database, well under a journey's 15 s wait
 * (playwright.journeys.config.ts).
 */
export const DEFAULT_D1_BINDING_RETRY_DELAYS_MS: readonly number[] = [...DEFAULT_D1_RETRY_DELAYS_MS, 1000, 1900];

/**
 * Longer than the slow D1 calls that still answer (about 1.0 to 1.2 s in Journeys runs), well
 * under a journey's 15 s wait (playwright.journeys.config.ts).
 */
export const DEFAULT_D1_READ_REISSUE_MS = 1500;

/** Enough for the single stalled reads seen in Journeys runs, without doubling a busy database's load. */
export const DEFAULT_D1_MAX_READ_REISSUES = 2;

/** The re-issues a wrapped binding has left. */
interface ReissueBudget {
  left: number;
}

const TRANSIENT_KINDS: ReadonlyArray<[RegExp, D1TransientKind]> = [
  [/Network connection lost/i, "network_connection_lost"],
  [/storage caused object to be reset/i, "storage_reset"],
  [/reset because its code was updated/i, "code_updated_reset"],
  [/Internal error while starting up D1 DB storage/i, "storage_startup_failed"],
  [/Replica disconnected from primary/i, "replica_disconnected"],
  [/Cannot resolve D1 DB due to transient issue on remote node/i, "remote_node_unresolved"],
  [/D1_ERROR: internal error\b/i, "internal_error"],
];

/** The transient D1 error this is, or null when it is any other error. */
export function d1TransientKind(error: unknown): D1TransientKind | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  for (const [pattern, kind] of TRANSIENT_KINDS) {
    if (pattern.test(message)) return kind;
  }
  return null;
}

const WRITE_KEYWORD = /\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i;

/**
 * Whether a statement only reads. Conservative: a WITH statement counts as a read only when no
 * write keyword appears anywhere in it, even inside a string literal.
 */
export function isReadOnlySql(sql: string): boolean {
  const text = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (/^SELECT\b/i.test(text)) return true;
  return /^(?:WITH|VALUES)\b/i.test(text) && !WRITE_KEYWORD.test(text);
}

/** A statement with its comments removed and its string literals emptied. */
function withoutComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .replace(/;\s*$/, "");
}

/** A name, quoted or not. */
const NAME = String.raw`(?:"(?:[^"]|"")*"|\w+)`;

/** A bound value or a literal: the same on every run. */
const CONSTANT = String.raw`(?:\?\d*|''|-?\d+(?:\.\d+)?|NULL|TRUE|FALSE)`;

/** Anything whose value can differ between two runs of the same statement. */
const VARIES = /\b(?:SELECT|RANDOM|RANDOMBLOB|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|DATE|TIME|DATETIME|JULIANDAY|STRFTIME|UNIXEPOCH|CHANGES|TOTAL_CHANGES|LAST_INSERT_ROWID|LIMIT)\b/i;

/** A column name without its table or quotes, in lower case. */
function columnName(target: string): string {
  const last = target.trim().replace(new RegExp(`^(?:${NAME}\\.)*`), "");
  return last.replace(/^"|"$/g, "").replace(/""/g, '"').toLowerCase();
}

/** The columns a SET list assigns, or null when any value is not a constant (or excluded.<column>). */
function assignedColumns(list: string, allowExcluded: boolean): string[] | null {
  const value = allowExcluded ? `(?:${CONSTANT}|excluded\\.${NAME})` : CONSTANT;
  const assignment = new RegExp(`^\\s*((?:${NAME}\\.)*${NAME})\\s*=\\s*${value}\\s*$`, "i");
  const columns: string[] = [];
  for (const part of list.split(",")) {
    const match = assignment.exec(part);
    if (!match) return null;
    columns.push(columnName(match[1]));
  }
  return columns;
}

/**
 * Whether running this single write statement a second time, after a first run that may have
 * applied, leaves the same rows and gives the same answer (rows changed, and any RETURNING rows).
 * Conservative, so anything it does not recognise counts as not idempotent:
 *
 * - an UPDATE that sets each column to a bound value or literal, whose WHERE names none of the
 *   columns it sets (so a second run matches exactly the same rows), with no subquery, LIMIT or
 *   function whose value can change between runs;
 * - an INSERT with a conflict target and ON CONFLICT DO UPDATE that sets each column to a bound
 *   value, a literal or excluded.<column>, with no WHERE (a second run updates the row the first
 *   inserted to the same values);
 * - nothing else. A DELETE, an INSERT OR IGNORE or ON CONFLICT DO NOTHING leaves the same rows but
 *   reports no changes the second time, which a caller can read as "not found".
 *
 * The schema's triggers all run AFTER DELETE (migrations/), so none of these fire one.
 */
export function isIdempotentWriteSql(sql: string): boolean {
  const text = withoutComments(sql);
  const unquoted = text.replace(/"(?:[^"]|"")*"/g, '""');
  if (!text || unquoted.includes(";") || VARIES.test(unquoted)) return false;
  const update = /^UPDATE\s+(?:OR\s+(?:ABORT|FAIL|ROLLBACK)\s+)?[\s\S]+?\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+RETURNING\s+[\s\S]+)?$/i.exec(text);
  if (update) {
    const columns = assignedColumns(update[1], false);
    if (!columns) return false;
    const whereNames = (update[2]?.match(new RegExp(NAME, "g")) ?? []).map(columnName);
    return !columns.some((column) => whereNames.includes(column));
  }
  const upsert = /^INSERT\s+INTO\s+[\s\S]+?\s+ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+?)(?:\s+RETURNING\s+[\s\S]+)?$/i.exec(text);
  return Boolean(upsert && !/\bWHERE\b/i.test(upsert[1]) && assignedColumns(upsert[1], true));
}

function mayRetry(kind: D1TransientKind, operation: D1TransientOperation, idempotent: boolean): boolean {
  return operation === "read" || idempotent || kind === "storage_startup_failed";
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function start<T>(run: () => Promise<T>): Promise<T> {
  try {
    return run();
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Runs a read, sending it once more if it has not settled after `afterMs` and the budget allows,
 * and settles with the first answer. A failure settles it only when no other try is still waiting;
 * when both fail, the first failure is the one reported.
 */
function reissueStalledRead<T>(
  run: () => Promise<T>,
  afterMs: number,
  budget: ReissueBudget,
  onReissueSettled: (answeredBy: D1ReadReissueReport["answeredBy"]) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let waiting = 0;
    let reissued = false;
    let firstError: { error: unknown } | null = null;
    const settle = (which: D1ReadReissueReport["answeredBy"]) => (value: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
      if (reissued) onReissueSettled(which);
    };
    const fail = (error: unknown) => {
      waiting -= 1;
      if (done) return;
      firstError ??= { error };
      if (waiting > 0) return;
      done = true;
      clearTimeout(timer);
      reject(firstError.error);
      if (reissued) onReissueSettled("neither");
    };
    const launch = (which: D1ReadReissueReport["answeredBy"]) => {
      waiting += 1;
      start(run).then(settle(which), fail);
    };
    // Cleared as soon as the read settles, so it fires only while the original is still waiting.
    const timer = setTimeout(() => {
      if (budget.left <= 0) return;
      budget.left -= 1;
      reissued = true;
      launch("reissue");
    }, afterMs);
    launch("original");
  });
}

async function withRetry<T>(
  options: D1TransientRetryOptions,
  budget: ReissueBudget,
  operation: D1TransientOperation,
  idempotent: boolean,
  call: string,
  table: string | null,
  run: () => Promise<T>,
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_D1_BINDING_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? realSleep;
  const reissueMs = options.readReissueMs ?? DEFAULT_D1_READ_REISSUE_MS;
  for (let attempt = 1; ; attempt += 1) {
    const tryOnce = operation === "read" && reissueMs > 0
      ? () => reissueStalledRead(run, reissueMs, budget, (answeredBy) => {
        try {
          options.onReadReissue?.({ event: "d1_read_reissue", call, table, attempt, answeredBy });
        } catch {
          // Reporting is evidence only; it must never change the query's outcome.
        }
      })
      : run;
    try {
      return await watchSlowCall({ call: `d1.${call}`, operation, table, attempt }, tryOnce, options.onSlowCall);
    } catch (error) {
      const kind = d1TransientKind(error);
      if (!kind) throw error;
      const willRetry = attempt <= delays.length && mayRetry(kind, operation, idempotent);
      try {
        options.onTransientError?.({ event: "d1_transient_error", operation, call, attempt, willRetry, kind });
      } catch {
        // Reporting is evidence only; it must never change the query's outcome.
      }
      if (!willRetry) throw error;
      await sleep(delays[attempt - 1]);
    }
  }
}

const WRAPPED = Symbol("d1TransientRetry");

type AsyncCall = (...args: unknown[]) => Promise<unknown>;

/** The slice of a D1 prepared statement this wrapper forwards. */
export interface RetryableD1Statement {
  bind(...values: unknown[]): RetryableD1Statement;
  first: AsyncCall;
  all: AsyncCall;
  raw: AsyncCall;
  run: AsyncCall;
}

/** The slice of a D1 binding this wrapper intercepts; every other member is passed through. */
export interface RetryableD1Database {
  prepare(sql: string): RetryableD1Statement;
  batch(statements: RetryableD1Statement[]): Promise<unknown[]>;
}

type WrappedStatement = RetryableD1Statement & { [WRAPPED]: { inner: RetryableD1Statement; sql: string } };

function unwrap(statement: RetryableD1Statement): { inner: RetryableD1Statement; sql: string | null } {
  return (statement as Partial<WrappedStatement>)[WRAPPED] ?? { inner: statement, sql: null };
}

function wrapStatement(
  inner: RetryableD1Statement,
  sql: string,
  options: D1TransientRetryOptions,
  budget: ReissueBudget,
): WrappedStatement {
  const operation: D1TransientOperation = isReadOnlySql(sql) ? "read" : "write";
  const idempotent = operation === "write" && isIdempotentWriteSql(sql);
  const table = firstTable(sql);
  const forward = (call: "first" | "all" | "raw" | "run") =>
    (...args: unknown[]) => withRetry(options, budget, operation, idempotent, call, table, () => inner[call](...args));
  return {
    [WRAPPED]: { inner, sql },
    bind: (...values: unknown[]) => wrapStatement(inner.bind(...values), sql, options, budget),
    first: forward("first"),
    all: forward("all"),
    raw: forward("raw"),
    run: forward("run"),
  };
}

/** The binding, with transient failures of reads (and of storage startup) retried. */
export function withD1TransientRetry<T>(db: T, options: D1TransientRetryOptions = {}): T {
  const target = db as unknown as RetryableD1Database & Record<PropertyKey, unknown>;
  // Anything that is not a binding (a test double, a missing binding) is left as it is, so code
  // that checks for a binding still sees none.
  if (!target || typeof target.prepare !== "function" || typeof target.batch !== "function") return db;
  if (target[WRAPPED]) return db;
  const budget: ReissueBudget = { left: options.maxReadReissues ?? DEFAULT_D1_MAX_READ_REISSUES };
  return new Proxy(target, {
    get(binding, property) {
      if (property === WRAPPED) return true;
      if (property === "prepare") {
        return (sql: string) => wrapStatement(binding.prepare(sql), sql, options, budget);
      }
      if (property === "batch") {
        return (statements: RetryableD1Statement[]) => {
          const parts = statements.map(unwrap);
          const readOnly = parts.every((part) => part.sql !== null && isReadOnlySql(part.sql));
          const table = parts[0]?.sql ? firstTable(parts[0].sql) : null;
          return withRetry(options, budget, readOnly ? "read" : "write", false, "batch", table, () =>
            binding.batch(parts.map((part) => part.inner)));
        };
      }
      const value = Reflect.get(binding, property);
      return typeof value === "function" ? value.bind(binding) : value;
    },
  }) as unknown as T;
}

/**
 * The Worker's environment with its D1 binding wrapped, for workers/app.ts to use for the whole
 * request, so every consumer of `env.DB`, React Router's load context included, retries. Every
 * Worker logs each transient failure as one JSON line with no SQL and no values, naming the route
 * and whether a retry follows, so production's Workers logs can count them by route as the Journeys
 * tail summary does. A per-run QA Worker
 * (SPOONJOY_QA_ERROR_LOGS=1) also logs each try that waits over a second and each re-issued read;
 * elsewhere those are not logged and the only timer is the re-issue's.
 */
export function withTransientD1Retry<E extends { DB?: unknown; SPOONJOY_QA_ERROR_LOGS?: string }>(
  env: E,
  { route, ...options }: Omit<D1TransientRetryOptions, "onTransientError" | "onSlowCall" | "onReadReissue"> & {
    /** The request's route from `d1RouteLabel`, or what ran ("scheduled", "queue"), for the transient error line. */
    route?: string;
  } = {},
): E {
  if (!env.DB) return env;
  const qaLogs = qaErrorLogsEnabled(env);
  const log = (report: object) => console.warn(JSON.stringify(report));
  const onTransientError = (report: D1TransientErrorReport) => log(route === undefined ? report : { ...report, route });
  const onSlowCall = qaLogs ? consoleSlowCallReporter() : undefined;
  const onReadReissue = qaLogs ? log : undefined;
  const DB = withD1TransientRetry(env.DB, { ...options, onTransientError, onSlowCall, onReadReissue });
  return DB === env.DB ? env : { ...env, DB };
}
