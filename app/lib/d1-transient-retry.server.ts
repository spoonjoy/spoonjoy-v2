import { qaErrorLogsEnabled } from "./qa-error-logs.server";

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
 * - any statement or batch, write or not, when D1 says its storage failed to start, because then
 *   the statement never ran.
 *
 * No other write is retried here: whether it was applied is unknown, and only the operation
 * itself can make a second attempt safe. Its error still reaches the caller unchanged, and the
 * operations that know they are safe to run again do so through `retryD1Write`
 * (d1-write-retry.server.ts).
 *
 * Each transient failure, retried or not, is reported to `onTransientError` with no SQL and no
 * bound values, so the per-run QA Worker can log it for the Journeys tail summary.
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
}

export type D1TransientKind =
  | "network_connection_lost"
  | "storage_reset"
  | "code_updated_reset"
  | "storage_startup_failed"
  | "internal_error";

export interface D1TransientRetryOptions {
  /** Delays before each retry, in milliseconds. Its length is the number of retries. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onTransientError?: (report: D1TransientErrorReport) => void;
}

export const DEFAULT_D1_RETRY_DELAYS_MS: readonly number[] = [50, 150, 400];

const TRANSIENT_KINDS: ReadonlyArray<[RegExp, D1TransientKind]> = [
  [/Network connection lost/i, "network_connection_lost"],
  [/storage caused object to be reset/i, "storage_reset"],
  [/reset because its code was updated/i, "code_updated_reset"],
  [/Internal error while starting up D1 DB storage/i, "storage_startup_failed"],
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

function mayRetry(kind: D1TransientKind, operation: D1TransientOperation): boolean {
  return operation === "read" || kind === "storage_startup_failed";
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(
  options: D1TransientRetryOptions,
  operation: D1TransientOperation,
  call: string,
  run: () => Promise<T>,
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_D1_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const kind = d1TransientKind(error);
      if (!kind) throw error;
      const willRetry = attempt <= delays.length && mayRetry(kind, operation);
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

function wrapStatement(inner: RetryableD1Statement, sql: string, options: D1TransientRetryOptions): WrappedStatement {
  const operation: D1TransientOperation = isReadOnlySql(sql) ? "read" : "write";
  const forward = (call: "first" | "all" | "raw" | "run") =>
    (...args: unknown[]) => withRetry(options, operation, call, () => inner[call](...args));
  return {
    [WRAPPED]: { inner, sql },
    bind: (...values: unknown[]) => wrapStatement(inner.bind(...values), sql, options),
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
  return new Proxy(target, {
    get(binding, property) {
      if (property === WRAPPED) return true;
      if (property === "prepare") {
        return (sql: string) => wrapStatement(binding.prepare(sql), sql, options);
      }
      if (property === "batch") {
        return (statements: RetryableD1Statement[]) => {
          const parts = statements.map(unwrap);
          const readOnly = parts.every((part) => part.sql !== null && isReadOnlySql(part.sql));
          return withRetry(options, readOnly ? "read" : "write", "batch", () =>
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
 * request, so every consumer of `env.DB`, React Router's load context included, retries. A
 * per-run QA Worker (SPOONJOY_QA_ERROR_LOGS=1) logs each transient failure as one JSON line with
 * no SQL and no values, which the Journeys tail summary counts; nothing is logged elsewhere.
 */
export function withTransientD1Retry<E extends { DB?: unknown; SPOONJOY_QA_ERROR_LOGS?: string }>(
  env: E,
  options: Omit<D1TransientRetryOptions, "onTransientError"> = {},
): E {
  if (!env.DB) return env;
  const onTransientError = qaErrorLogsEnabled(env)
    ? (report: D1TransientErrorReport) => console.warn(JSON.stringify(report))
    : undefined;
  const DB = withD1TransientRetry(env.DB, { ...options, onTransientError });
  return DB === env.DB ? env : { ...env, DB };
}
