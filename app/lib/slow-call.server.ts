/**
 * Evidence for requests that wait on Cloudflare instead of working.
 *
 * Journeys runs on QA have requests that wait seconds on about 1 ms of CPU, so the time goes to a
 * D1 call or the cook-session Durable Object, and the tail summary alone cannot say which.
 * `watchSlowCall` starts a timer when such a call starts. When the call is still waiting after
 * `SLOW_CALL_THRESHOLD_MS`, it reports `settled: false` at once, so the report exists even when the
 * call never settles and the request is cancelled. When a slow call does settle, it reports again
 * with the whole wait and the outcome.
 *
 * Only a per-run QA Worker (SPOONJOY_QA_ERROR_LOGS=1) passes a reporter. Without one the call runs
 * as it is, with no timer, so production and shared QA are unchanged. A report never carries SQL,
 * bound values or a request body: only the fixed fields below, which
 * scripts/summarize-worker-tail.jq reads one by one.
 */

export const SLOW_CALL_THRESHOLD_MS = 1000;

export interface SlowCallReport {
  event: "slow_call";
  /** The call, as a fixed label: `d1.first`, `d1.batch`, `cook_session.fetch` and the like. */
  call: string;
  /** Whether the call only reads. */
  operation: "read" | "write";
  /** For a D1 call, the first table its SQL names; null when there is none or it is a batch of several. */
  table: string | null;
  /** 1 for the first try. */
  attempt: number;
  /** How long the call had waited when this report was made, in milliseconds. */
  waitedMs: number;
  /** False when the call was still waiting; true once it settled. */
  settled: boolean;
  /** How it settled; null while it is still waiting. */
  outcome: "ok" | "error" | null;
}

export type SlowCallReporter = (report: SlowCallReport) => void;

export interface SlowCallLabel {
  call: string;
  operation: "read" | "write";
  table?: string | null;
  attempt?: number;
}

export interface SlowCallClock {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

const realClock: SlowCallClock = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function safeReport(report: SlowCallReporter, value: SlowCallReport) {
  try {
    report(value);
  } catch {
    // Reporting is evidence only; it must never change the call's outcome.
  }
}

/** Runs the call, reporting it when it waits longer than the threshold. */
export function watchSlowCall<T>(
  label: SlowCallLabel,
  run: () => Promise<T>,
  report: SlowCallReporter | undefined,
  clock: SlowCallClock = realClock,
  thresholdMs: number = SLOW_CALL_THRESHOLD_MS,
): Promise<T> {
  if (!report) return run();
  const base = {
    event: "slow_call" as const,
    call: label.call,
    operation: label.operation,
    table: label.table ?? null,
    attempt: label.attempt ?? 1,
  };
  const startedAt = clock.now();
  let slow = false;
  const timer = clock.setTimer(() => {
    slow = true;
    safeReport(report, { ...base, waitedMs: clock.now() - startedAt, settled: false, outcome: null });
  }, thresholdMs);
  const settle = (outcome: "ok" | "error") => {
    clock.clearTimer(timer);
    if (slow) safeReport(report, { ...base, waitedMs: clock.now() - startedAt, settled: true, outcome });
  };
  let pending: Promise<T>;
  try {
    pending = run();
  } catch (error) {
    clock.clearTimer(timer);
    throw error;
  }
  return pending.then(
    (value) => {
      settle("ok");
      return value;
    },
    (error: unknown) => {
      settle("error");
      throw error;
    },
  );
}

/** A reporter that writes each report as one JSON line, for the Worker tail. */
export function consoleSlowCallReporter(): SlowCallReporter {
  return (report) => console.warn(JSON.stringify(report));
}

const TABLE = /\b(?:FROM|INTO|UPDATE|JOIN)\s+[`"[]?([A-Za-z_][A-Za-z0-9_]{0,63})/i;

/** The first table a statement names, or null. Only an identifier ever leaves this function. */
export function firstTable(sql: string): string | null {
  return TABLE.exec(sql)?.[1] ?? null;
}

/**
 * Where a request ran, for a per-run QA Worker's log. Cloudflare adds `cf-placement` only to the
 * response, so the Worker cannot read Smart Placement's choice from its request. Instead each
 * isolate gets a short random id and counts the requests it serves, so the tail summary can tell
 * an isolate's first requests (a cold start, perhaps in a new location) from later ones, and the
 * Worker looks up once per isolate where it actually runs (`isolateColoReport`).
 */
interface IsolateState {
  id: string;
  served: number;
}

let isolate: IsolateState | null = null;

const COLO = /^[A-Z]{3,4}$/;

function colo(value: unknown): string | null {
  return typeof value === "string" && COLO.test(value) ? value : null;
}

export interface IsolateRequestReport {
  event: "isolate_request";
  /** A random id for the isolate serving this request, made when it served its first. */
  isolate: string;
  /** 1 for the isolate's first request. */
  request: number;
  /** The Cloudflare location the request arrived at, from `request.cf.colo`; null when unknown. */
  arrivedAt: string | null;
}

/** Counts this request against the isolate serving it. Random ids cannot be made at startup. */
export function isolateRequestReport(request: Request): IsolateRequestReport {
  isolate ??= { id: crypto.randomUUID().slice(0, 8), served: 0 };
  isolate.served += 1;
  const cf = (request as Request & { cf?: { colo?: unknown } }).cf;
  return { event: "isolate_request", isolate: isolate.id, request: isolate.served, arrivedAt: colo(cf?.colo) };
}

export interface IsolateColoReport {
  event: "isolate_colo";
  isolate: string;
  /** The Cloudflare location this isolate runs in; null when the lookup failed. */
  runsIn: string | null;
}

/**
 * Where this isolate runs, from Cloudflare's public trace page, which reports the location a
 * request reaches it from: for a subrequest, the location the Worker runs in. When it differs from
 * where requests arrive, Smart Placement has moved them. Never throws.
 */
export async function isolateColoReport(
  isolateId: string,
  fetchTrace: () => Promise<Response> = () => fetch("https://www.cloudflare.com/cdn-cgi/trace"),
): Promise<IsolateColoReport> {
  try {
    const text = await (await fetchTrace()).text();
    return { event: "isolate_colo", isolate: isolateId, runsIn: colo(/^colo=(.+)$/m.exec(text)?.[1]) };
  } catch {
    return { event: "isolate_colo", isolate: isolateId, runsIn: null };
  }
}

/** Forgets the isolate's id and count, for tests. */
export function resetIsolateForTests(): void {
  isolate = null;
}
