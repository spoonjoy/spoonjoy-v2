import { AsyncLocalStorage } from "node:async_hooks";
import { data } from "react-router";
import { d1TransientKind, DEFAULT_D1_RETRY_DELAYS_MS, type D1TransientKind } from "./d1-transient-retry.server";
import { qaErrorLogsEnabled } from "./qa-error-logs.server";

/**
 * Retries a whole write operation after a transient D1 error, without ever applying it twice.
 *
 * The binding wrapper (d1-transient-retry.server.ts) retries reads, but not a write that failed
 * with "Network connection lost" or a bare "internal error": D1 may already have applied it, and
 * only the operation knows whether running it again is safe. `retryD1Write` is where an operation
 * says so. Each caller is one of two kinds:
 *
 * - **Idempotent**: running it again leaves the same rows as running it once (an update to fixed
 *   values, a delete by id, a revoke of whatever is still active, an upsert by its natural key).
 *   It passes no `applied` check and is simply run again.
 * - **Creates something**: it inserts a row whose id was chosen before the first try, so a
 *   repeat fails on that id rather than inserting a second row. After an ambiguous failure it
 *   asks `applied` whether the earlier try committed; if so, that answer is used, and if not the
 *   write runs again with the same id.
 *
 * If every try fails with a transient error, it throws `D1WriteUnavailableError`, which the web
 * routes answer with a 503 the page shows next to the user's input, and the API with a retryable
 * error, instead of a 500. Any other error passes through unchanged.
 *
 * Each retry decision is reported, with no SQL and no values, to the request's reporter, which a
 * per-run QA Worker logs for the Journeys tail summary (see `runWithD1WriteRetryReporter`).
 */

export const D1_WRITE_UNAVAILABLE_CODE = "temporarily_unavailable";
export const D1_WRITE_UNAVAILABLE_MESSAGE = "Spoonjoy couldn't save that just now. Please try again in a moment.";
export const D1_WRITE_RETRY_AFTER_SECONDS = 1;

/** Every try of a write failed with a transient D1 error. */
export class D1WriteUnavailableError extends Error {
  readonly scope: string;

  constructor(scope: string, cause: unknown) {
    super(`The database was briefly unavailable, so ${scope} was not saved`, { cause });
    this.name = "D1WriteUnavailableError";
    this.scope = scope;
  }
}

/**
 * Whether the error means the database was briefly unavailable: a write that ran out of tries,
 * or a transient D1 error from a path that does not retry.
 */
export function isD1Unavailable(error: unknown): boolean {
  return error instanceof D1WriteUnavailableError || d1TransientKind(error) !== null;
}

export interface D1WriteRetryReport {
  event: "d1_write_retry";
  /** The operation's fixed label. */
  scope: string;
  /** The try that failed, 1 for the first. */
  attempt: number;
  kind: D1TransientKind;
  /**
   * What the operation did about it: ran again (`retry`), found that the failed try had
   * committed (`applied`), or gave up with a retryable error (`gave_up`).
   */
  outcome: "retry" | "applied" | "gave_up";
}

type D1WriteRetryReporter = (report: D1WriteRetryReport) => void;

const reporters = new AsyncLocalStorage<D1WriteRetryReporter>();

/**
 * Runs a request with its reporter for write retries. A per-run QA Worker
 * (SPOONJOY_QA_ERROR_LOGS=1) logs each one as a JSON line, which the Journeys tail summary
 * counts; anywhere else nothing is reported.
 */
export function runWithD1WriteRetryReporter<T>(
  env: { SPOONJOY_QA_ERROR_LOGS?: string },
  run: () => T,
  log: (line: string) => void = (line) => console.warn(line),
): T {
  if (!qaErrorLogsEnabled(env)) return run();
  return reporters.run((report) => log(JSON.stringify(report)), run);
}

function report(entry: D1WriteRetryReport) {
  try {
    reporters.getStore()?.(entry);
  } catch {
    // Reporting is evidence only; it must never change the write's outcome.
  }
}

export interface D1WriteRetryOptions<T> {
  /** A fixed label naming the write, such as "spoon.create", for logs and the error. Never user data. */
  scope: string;
  /**
   * For a write that creates something: after an ambiguous failure, the answer of the earlier
   * try if it committed, or null if it did not. Omit only for a write that is idempotent.
   */
  applied?: () => Promise<T | null>;
  /** Delays before each retry, in milliseconds. Its length is the number of retries. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `write`, and runs it again after a transient D1 error when that is safe; see the module comment. */
export async function retryD1Write<T>(options: D1WriteRetryOptions<T>, write: () => Promise<T>): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_D1_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? realSleep;
  let ambiguous = false;

  const earlierTry = async (cause: unknown): Promise<{ value: T } | null> => {
    if (!options.applied) return null;
    let value: T | null;
    try {
      value = await options.applied();
    } catch (error) {
      // Not knowing whether the write committed, it must not run again.
      throw d1TransientKind(error) ? new D1WriteUnavailableError(options.scope, cause) : error;
    }
    return value === null ? null : { value };
  };

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      const kind = d1TransientKind(error);
      if (!kind) {
        // A retry can lose to its own earlier try, applied late: it then fails on the row that
        // try wrote, which means the write is in.
        const earlier = ambiguous ? await earlierTry(error) : null;
        if (earlier) return earlier.value;
        throw error;
      }
      ambiguous = true;
      const last = attempt > delays.length;
      if (!last) await sleep(delays[attempt - 1]);
      const earlier = await earlierTry(error);
      report({
        event: "d1_write_retry",
        scope: options.scope,
        attempt,
        kind,
        outcome: earlier ? "applied" : last ? "gave_up" : "retry",
      });
      if (earlier) return earlier.value;
      if (last) throw new D1WriteUnavailableError(options.scope, error);
    }
  }
}

const WRITE_TOKEN = /^[\w-]{8,100}$/;

/** A form's write token (made when the form opened), or null when it sent none or a malformed one. */
export function formWriteToken(value: FormDataEntryValue | null | undefined): string | null {
  return typeof value === "string" && WRITE_TOKEN.test(value) ? value : null;
}

/**
 * The id for the row a form creates, derived from the form's write token, so the same submission
 * always writes the same row: a retry after an ambiguous failure, a double submit or a resubmit
 * after a 503 finds the row the first one wrote instead of adding a second. The user's id is part
 * of it, so no one can aim a token at another user's row. Shaped as a UUID, like the ids the
 * server makes.
 */
export async function idForWriteToken(kind: string, userId: string, token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}\u0000${userId}\u0000${token}`)));
  const hex = Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * What a page's loader throws when the database was briefly unavailable: a retryable 503 whose
 * text the error page shows, instead of a 500. Null for any other error.
 */
export function d1UnavailablePageError(error: unknown): Response | null {
  if (!isD1Unavailable(error)) return null;
  return new Response(D1_WRITE_UNAVAILABLE_MESSAGE, { status: 503, headers: d1UnavailableHeaders() });
}

/** The body of `d1UnavailableWebResponse`. */
export type D1UnavailableWebBody = {
  /** The form's intent, so the page shows the message where the user acted. */
  intent?: string;
  error: string;
  errorCode: typeof D1_WRITE_UNAVAILABLE_CODE;
  retryable: true;
};

/** The headers of a retryable 503 for a write the database could not take just now. */
export function d1UnavailableHeaders(): HeadersInit {
  return {
    "Retry-After": String(D1_WRITE_RETRY_AFTER_SECONDS),
    "Cache-Control": "private, no-store",
  };
}

/**
 * The web answer for a write the database could not take just now: a 503 the route returns as
 * action data, so the page stays as it was, with the user's input, and shows the message. Null
 * for any other error.
 */
export function d1UnavailableWebResponse(error: unknown, intent?: FormDataEntryValue | null) {
  if (!isD1Unavailable(error)) return null;
  const body: D1UnavailableWebBody = {
    ...(typeof intent === "string" ? { intent } : {}),
    error: D1_WRITE_UNAVAILABLE_MESSAGE,
    errorCode: D1_WRITE_UNAVAILABLE_CODE,
    retryable: true,
  };
  return data(body, { status: 503, headers: d1UnavailableHeaders() });
}
