/**
 * The two telemetry-coverage rules, as pure functions over scanned data.
 *
 * Rule 1: ERROR-CONTEXT — every low-level telemetry call carries at least one
 *         diagnostic context key (route/method/extras/properties). Adapts
 *         ouroboros Rule 3 (error events must have non-empty meta).
 *
 * Rule 2: NO-NEW-GAP RATCHET — every server file with a `catch` block either
 *         contains a telemetry call or is on the documented allowlist. Adapts
 *         ouroboros `file-completeness`.
 */

import { IDENTITY_KEYS, type TelemetryCall } from "./contract";

export interface ErrorContextViolation {
  file: string;
  line: number;
  fn: string;
  keys: string[];
}

export interface ErrorContextResult {
  status: "pass" | "fail";
  violations: ErrorContextViolation[];
}

export interface FileCoverageResult {
  status: "pass" | "fail";
  /** Catch-bearing server files with no telemetry and no allowlist entry. */
  newGaps: string[];
  /** Allowlist entries that are now instrumented (or no longer present). */
  staleAllowlist: string[];
  /** Allowlisted gaps that are still uninstrumented (carried, for backfill). */
  carriedGaps: string[];
}

/** True if a scanned call carries at least one diagnostic context key. */
export function callHasContext(call: TelemetryCall): boolean {
  if (call.contextSafeByConstruction) return true;
  return call.keys.some((key) => !IDENTITY_KEYS.has(key));
}

/**
 * Rule 1: every low-level telemetry call must carry diagnostic context.
 *
 * @param callsByFile - map of file path -> telemetry calls found in that file
 */
export function checkErrorContext(
  callsByFile: Map<string, TelemetryCall[]>,
): ErrorContextResult {
  const violations: ErrorContextViolation[] = [];

  for (const [file, calls] of callsByFile) {
    for (const call of calls) {
      if (callHasContext(call)) continue;
      violations.push({ file, line: call.line, fn: call.fn, keys: call.keys });
    }
  }

  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );

  return { status: violations.length === 0 ? "pass" : "fail", violations };
}

/**
 * Rule 2: ratchet over catch-bearing server files.
 *
 * @param catchFiles   - all server files that contain at least one catch block
 * @param instrumented - subset of `catchFiles` that contain a telemetry call
 * @param allowlist    - documented current gaps (file path -> reason)
 */
export function checkFileCoverage(
  catchFiles: string[],
  instrumented: Set<string>,
  allowlist: Map<string, string>,
): FileCoverageResult {
  const newGaps: string[] = [];
  const carriedGaps: string[] = [];

  for (const file of catchFiles) {
    if (instrumented.has(file)) continue;
    if (allowlist.has(file)) {
      carriedGaps.push(file);
      continue;
    }
    newGaps.push(file);
  }

  // An allowlist entry is stale once the file is instrumented or no longer a
  // catch-bearing server file. Keeping the allowlist tight keeps the gap report
  // honest and forces backfilled entries to be removed.
  const catchSet = new Set(catchFiles);
  const staleAllowlist: string[] = [];
  for (const file of allowlist.keys()) {
    if (instrumented.has(file) || !catchSet.has(file)) staleAllowlist.push(file);
  }

  return {
    status: newGaps.length === 0 && staleAllowlist.length === 0 ? "pass" : "fail",
    newGaps: newGaps.sort(),
    staleAllowlist: staleAllowlist.sort(),
    carriedGaps: carriedGaps.sort(),
  };
}
