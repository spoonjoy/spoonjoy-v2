/**
 * The per-run QA Worker's error log line.
 *
 * `handleError` (app/entry.server.tsx) replaces React Router's default `console.error` for loader
 * and action errors, so a loader or action 500 leaves no trace in the Worker's logs. A per-run QA
 * Worker, and only that, sets `SPOONJOY_QA_ERROR_LOGS=1` (scripts/qa-run-scope.mjs adds it when it
 * rewrites the shared QA config to the run's identity). With it, `handleError` writes one
 * console.error line per error, reduced to the exception class, a scrubbed message and at most 5
 * scrubbed stack frames, which the Journeys tail summary (scripts/summarize-worker-tail.jq) then
 * attaches to the failing request. Production and shared QA never set the variable.
 *
 * `scrubText` repeats the jq program's `scrub` rules exactly, so the line is already scrubbed
 * when it reaches Cloudflare's logs. test/lib/qa-error-logs.server.test.ts runs the same fake
 * secrets through both scrubbers so they cannot drift apart.
 */

export const QA_ERROR_LOGS_VAR = "SPOONJOY_QA_ERROR_LOGS" as const;

export function qaErrorLogsEnabled(env: { readonly [QA_ERROR_LOGS_VAR]?: unknown } | null | undefined): boolean {
  return env?.[QA_ERROR_LOGS_VAR] === "1";
}

const TOKEN_PREFIX = "(?:sj|sjdc|oac|ocn|ort|oct|conn)_";

// The same rules, in the same order, as `scrub` in scripts/summarize-worker-tail.jq.
const SCRUB_RULES: Array<[RegExp, string]> = [
  [/"[^"]+"/g, '"[redacted]"'],
  [/'[^']{4,}'/g, "'[redacted]'"],
  [/\b((?:set-)?cookie):[^\n]*/gi, "$1: [cookie]"],
  [/\bauthorization:\s*(?!bearer\b)(?:[A-Za-z]+\s+)?[^\s"',;]+/gi, "Authorization: [token]"],
  [/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s@"'<>]*@/g, "$1[userinfo]@"],
  [/\?[^\s"'<>)]*/g, "?[query]"],
  [/(?<=[A-Za-z0-9/._~-])#[^\s"'<>)]+/g, "#[fragment]"],
  [/\bbearer\s+[^\s"',;]+/gi, "Bearer [token]"],
  [new RegExp(`\\b${TOKEN_PREFIX}[A-Za-z0-9_-]+`, "g"), "[token]"],
  [/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_.-]*/g, "[token]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[A-Za-z0-9_.-]+=[^;\s,]*;/g, "[cookie];"],
  [/\b__[A-Za-z][A-Za-z0-9_]*=[^;\s,]*/g, "[cookie]"],
  [/[A-Za-z0-9+/_-]{24,}={0,2}/g, "[token]"],
  [/\s*\n\s*/g, " "],
];

/** Scrubs credentials, request data and personal data from text, then caps it at `cap` characters. */
export function scrubText(text: string, cap: number): string {
  const scrubbed = SCRUB_RULES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
  // jq slices by code point, so this does too.
  return Array.from(scrubbed).slice(0, cap).join("");
}

const ERROR_CLASS = /^[A-Za-z_$][A-Za-z0-9_$.]{0,80}(?:Error|Exception)$/;
const TOKEN_LIKE_CLASS = new RegExp(`^${TOKEN_PREFIX}|^eyJ`);

function errorClass(name: string): string {
  return ERROR_CLASS.test(name) && !TOKEN_LIKE_CLASS.test(name) ? name : scrubText(name, 100);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export type QaErrorSummary = { name: string | null; message: string; stack: string[] };

/** The exception class, the scrubbed message (500 characters at most) and at most 5 scrubbed frames. */
export function reduceQaError(error: unknown): QaErrorSummary {
  if (error instanceof Error) {
    const frames = (error.stack ?? "")
      .split("\n")
      .filter((line) => /^\s*at\s/.test(line))
      .slice(0, 5)
      .map((line) => scrubText(line.replace(/^\s+/, ""), 200));
    return { name: errorClass(error.name), message: scrubText(error.message, 500), stack: frames };
  }
  return { name: null, message: scrubText(describeValue(error), 500), stack: [] };
}

/**
 * One JSON line the tail summary parses back into the same class, message and frames: the frames
 * travel as stack text, which is where the summary looks for them.
 */
export function formatQaErrorLog(error: unknown): string {
  const { name, message, stack } = reduceQaError(error);
  return JSON.stringify({ event: "qa_error_log", name, message, stack: stack.join("\n") });
}
