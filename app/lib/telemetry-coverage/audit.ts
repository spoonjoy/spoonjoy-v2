/**
 * Telemetry-coverage audit orchestrator.
 *
 * Walks the production server source tree, scans each file for telemetry calls,
 * and runs the two rules (error-context + no-new-gap ratchet). Pure with
 * respect to its inputs: the filesystem is injected via a `FileSystem` port so
 * the orchestrator is fully unit-testable without touching disk.
 */

import {
  checkErrorContext,
  checkFileCoverage,
  type ErrorContextResult,
  type FileCoverageResult,
} from "./audit-rules";
import { allowlistMap } from "./allowlist";
import { scanSourceForTelemetryCalls } from "./source-scanner";
import type { TelemetryCall } from "./contract";

/** Minimal filesystem port (a subset of node:fs) the audit depends on. */
export interface FileSystem {
  /** Recursively list absolute file paths under `dir`. */
  listFiles(dir: string): string[];
  /** Read a UTF-8 file. */
  readFile(path: string): string;
  /** True if `path` exists. */
  exists(path: string): boolean;
}

export interface AuditOptions {
  /** Absolute repo root. */
  repoRoot: string;
  fs: FileSystem;
  /**
   * Ratchet allowlist (file path -> reason). Defaults to the documented
   * project allowlist. Injectable so unit tests can drive the orchestrator
   * against a synthetic tree without the real allowlist interfering.
   */
  allowlist?: Map<string, string>;
}

export interface AuditReport {
  status: "pass" | "fail";
  errorContext: ErrorContextResult;
  fileCoverage: FileCoverageResult;
  /** Total server files scanned. */
  filesScanned: number;
  /** Total telemetry calls found across all files. */
  telemetryCalls: number;
}

// Server source roots whose files are subject to the audit. Client-only modules
// (components, hooks, non-`.server` lib utilities) are out of scope: they have
// no PostHog server sink and their failures are surfaced in the browser.
const LIB_DIR = "app/lib";
const ROUTES_DIR = "app/routes";

/**
 * A file is in audit scope if it is a server module on a request path:
 *   - `app/lib/**` server modules (`*.server.ts` / `*.server.tsx`)
 *   - `app/routes/**` route modules (`*.ts` / `*.tsx`) — every route loader/
 *     action runs server-side on Workers.
 * Test files and type declaration files are excluded.
 */
export function isAuditScopeFile(relPath: string): boolean {
  if (relPath.includes(".test.")) return false;
  if (relPath.endsWith(".d.ts")) return false;

  if (relPath.startsWith(`${LIB_DIR}/`)) {
    return relPath.endsWith(".server.ts") || relPath.endsWith(".server.tsx");
  }
  if (relPath.startsWith(`${ROUTES_DIR}/`)) {
    return relPath.endsWith(".ts") || relPath.endsWith(".tsx");
  }
  return false;
}

/**
 * Determine whether a source string contains a `catch` clause. Matches both
 * `catch (e)` and bare `catch {` forms. Comment/string false-positives are
 * acceptable here: the worst case is auditing a file that has no real catch,
 * which only ever HELPS (it can never hide a real gap).
 */
export function hasCatchBlock(source: string): boolean {
  return /\bcatch\s*(\(|\{)/.test(source);
}

function toPosixRel(repoRoot: string, absPath: string): string {
  const root = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  const rel = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
  return rel.split("\\").join("/");
}

/**
 * Run the full telemetry-coverage audit.
 */
export function runTelemetryCoverageAudit(options: AuditOptions): AuditReport {
  const { repoRoot, fs } = options;
  const allowlist = options.allowlist ?? allowlistMap();

  const roots = [`${repoRoot}/${LIB_DIR}`, `${repoRoot}/${ROUTES_DIR}`];
  const relFiles: string[] = [];
  for (const root of roots) {
    if (!fs.exists(root)) continue;
    for (const abs of fs.listFiles(root)) {
      const rel = toPosixRel(repoRoot, abs);
      if (isAuditScopeFile(rel)) relFiles.push(rel);
    }
  }
  relFiles.sort();

  const callsByFile = new Map<string, TelemetryCall[]>();
  const catchFiles: string[] = [];
  const instrumented = new Set<string>();
  let telemetryCalls = 0;

  for (const rel of relFiles) {
    const source = fs.readFile(`${repoRoot}/${rel}`);
    const calls = scanSourceForTelemetryCalls(source);
    if (calls.length > 0) {
      callsByFile.set(rel, calls);
      instrumented.add(rel);
      telemetryCalls += calls.length;
    }
    if (hasCatchBlock(source)) catchFiles.push(rel);
  }

  const errorContext = checkErrorContext(callsByFile);
  const fileCoverage = checkFileCoverage(catchFiles, instrumented, allowlist);

  const status =
    errorContext.status === "pass" && fileCoverage.status === "pass" ? "pass" : "fail";

  return {
    status,
    errorContext,
    fileCoverage,
    filesScanned: relFiles.length,
    telemetryCalls,
  };
}

/**
 * Format a human-readable failure summary for the test assertion message.
 */
export function formatAuditFailure(report: AuditReport): string {
  const lines: string[] = ["Telemetry coverage audit FAILED:"];

  if (report.errorContext.status === "fail") {
    lines.push("");
    lines.push(
      `ERROR-CONTEXT: ${report.errorContext.violations.length} telemetry call(s) carry no diagnostic context beyond identity (error/distinctId/event). Add route/method/extras/properties or provider/phase context:`,
    );
    for (const v of report.errorContext.violations) {
      const keys = v.keys.length ? ` keys=[${v.keys.join(", ")}]` : " keys=[]";
      lines.push(`  - ${v.file}:${v.line} ${v.fn}(...)${keys}`);
    }
  }

  if (report.fileCoverage.newGaps.length > 0) {
    lines.push("");
    lines.push(
      `NO-NEW-GAP: ${report.fileCoverage.newGaps.length} new catch-bearing server file(s) emit no telemetry and are not allowlisted.`,
    );
    lines.push(
      "Instrument the error path (see docs/telemetry-coverage.md), or add a documented allowlist entry in app/lib/telemetry-coverage/allowlist.ts:",
    );
    for (const f of report.fileCoverage.newGaps) lines.push(`  - ${f}`);
  }

  if (report.fileCoverage.staleAllowlist.length > 0) {
    lines.push("");
    lines.push(
      `STALE ALLOWLIST: ${report.fileCoverage.staleAllowlist.length} allowlist entr(ies) are now instrumented or no longer have a catch block. Remove them from app/lib/telemetry-coverage/allowlist.ts:`,
    );
    for (const f of report.fileCoverage.staleAllowlist) lines.push(`  - ${f}`);
  }

  return lines.join("\n");
}
