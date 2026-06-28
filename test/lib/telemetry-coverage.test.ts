/**
 * Telemetry-coverage GATE + unit tests.
 *
 * This file is the CI enforcement: the first test runs the real audit against
 * the repo and FAILS the `pnpm test:coverage` gate if any server error path
 * regresses (a new uninstrumented catch-bearing file, a telemetry call with no
 * diagnostic context, or a stale allowlist entry).
 *
 * The remaining tests pin the behavior of the pure audit pieces (scanner,
 * rules, orchestrator, allowlist, fs adapter) so the gate is trustworthy and
 * the new code is itself fully covered.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  runTelemetryCoverageAudit,
  formatAuditFailure,
  isAuditScopeFile,
  hasCatchBlock,
  type FileSystem,
  type AuditReport,
} from "~/lib/telemetry-coverage/audit";
import { nodeFileSystem } from "~/lib/telemetry-coverage/node-fs";
import {
  scanSourceForTelemetryCalls,
  extractTopLevelKeys,
  extractObjectKeys,
} from "~/lib/telemetry-coverage/source-scanner";
import {
  checkErrorContext,
  checkFileCoverage,
  callHasContext,
} from "~/lib/telemetry-coverage/audit-rules";
import {
  TELEMETRY_GAP_ALLOWLIST,
  allowlistMap,
  type GapCategory,
} from "~/lib/telemetry-coverage/allowlist";
import type { TelemetryCall } from "~/lib/telemetry-coverage/contract";

const REPO_ROOT = resolve(__dirname, "..", "..");

/** Build an in-memory FileSystem from a flat `relPath -> contents` map. */
function fakeFs(files: Record<string, string>, repoRoot = "/repo"): FileSystem {
  const prefix = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  const abs = new Map<string, string>();
  for (const [rel, contents] of Object.entries(files)) {
    abs.set(`${prefix}${rel}`, contents);
  }
  const dirs = new Set<string>([`${prefix}app/lib`, `${prefix}app/routes`]);
  // Collapse duplicate slashes so the fake tolerates the audit joining a
  // trailing-slash repoRoot with a subdir (mirrors real filesystem behavior).
  const norm = (p: string) => p.replace(/\/{2,}/g, "/");
  return {
    listFiles(dir: string): string[] {
      const d = norm(dir);
      return [...abs.keys()].filter((p) => norm(p).startsWith(`${d}/`));
    },
    readFile(path: string): string {
      const v = abs.get(path) ?? abs.get(norm(path));
      if (v === undefined) throw new Error(`fakeFs: missing ${path}`);
      return v;
    },
    exists(path: string): boolean {
      const p = norm(path);
      return abs.has(path) || abs.has(p) || dirs.has(p);
    },
  };
}

// --- THE GATE -------------------------------------------------------------

describe("telemetry coverage gate (real repo)", () => {
  const report = runTelemetryCoverageAudit({ repoRoot: REPO_ROOT, fs: nodeFileSystem });

  it("passes the error-context + no-new-gap ratchet", () => {
    // If this fails, read the message: either instrument the new error path or
    // add a documented allowlist entry. See docs/telemetry-coverage.md.
    expect(report.status, formatAuditFailure(report)).toBe("pass");
  });

  it("scanned a meaningful number of server files and telemetry calls", () => {
    expect(report.filesScanned).toBeGreaterThan(50);
    expect(report.telemetryCalls).toBeGreaterThan(20);
  });

  it("error-context rule reports zero violations", () => {
    expect(report.errorContext.violations).toEqual([]);
  });

  it("ratchet has no new gaps and no stale allowlist entries", () => {
    expect(report.fileCoverage.newGaps).toEqual([]);
    expect(report.fileCoverage.staleAllowlist).toEqual([]);
  });

  it("carries the documented current gaps for backfill", () => {
    expect(report.fileCoverage.carriedGaps.length).toBeGreaterThan(0);
  });
});

// --- ALLOWLIST INTEGRITY --------------------------------------------------

describe("allowlist integrity", () => {
  const VALID_CATEGORIES: GapCategory[] = [
    "swallow",
    "rethrow",
    "expected-4xx",
    "non-request",
    "delegated",
    "backfill",
    "llm-owned",
  ];

  it("has unique, POSIX, repo-relative file paths", () => {
    const seen = new Set<string>();
    for (const entry of TELEMETRY_GAP_ALLOWLIST) {
      expect(entry.file).not.toContain("\\");
      expect(entry.file.startsWith("app/")).toBe(true);
      expect(seen.has(entry.file)).toBe(false);
      seen.add(entry.file);
    }
  });

  it("every entry has a known category and a non-trivial reason", () => {
    for (const entry of TELEMETRY_GAP_ALLOWLIST) {
      expect(VALID_CATEGORIES).toContain(entry.category);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it("allowlistMap prefixes each reason with its category", () => {
    const map = allowlistMap();
    expect(map.size).toBe(TELEMETRY_GAP_ALLOWLIST.length);
    const first = TELEMETRY_GAP_ALLOWLIST[0];
    expect(map.get(first.file)).toBe(`[${first.category}] ${first.reason}`);
  });
});

// --- SOURCE SCANNER -------------------------------------------------------

describe("source scanner: extractTopLevelKeys", () => {
  it("extracts colon keys, quoted keys, and shorthand", () => {
    expect(
      extractTopLevelKeys(`error, distinctId: "x", "route": p, 'method': m, extras`),
    ).toEqual(["error", "distinctId", "route", "method", "extras"]);
  });

  it("ignores keys inside nested objects and arrays", () => {
    expect(extractTopLevelKeys(`a: { b: 1, c: 2 }, d: [e, f], g`)).toEqual(["a", "d", "g"]);
  });

  it("ignores colons inside ternary values", () => {
    expect(extractTopLevelKeys(`a: cond ? x : y, b: 2`)).toEqual(["a", "b"]);
  });

  it("ignores colons and commas inside string values", () => {
    expect(extractTopLevelKeys(`a: "x: y, z", b: 'p,q'`)).toEqual(["a", "b"]);
  });

  it("handles spread by skipping it", () => {
    const keys = extractTopLevelKeys(`...base, scope`);
    expect(keys).toContain("scope");
    expect(keys).not.toContain("base");
  });

  it("handles escaped characters inside string values", () => {
    expect(extractTopLevelKeys(`a: "line\\"quote", b: 2`)).toEqual(["a", "b"]);
  });

  it("returns empty for an empty body", () => {
    expect(extractTopLevelKeys("")).toEqual([]);
  });

  it("drops non-identifier shorthand tokens", () => {
    // A trailing numeric/garbage token must not be treated as a key.
    expect(extractTopLevelKeys(`123, valid`)).toEqual(["valid"]);
  });

  it("handles an escaped char inside a top-level (shorthand-position) string", () => {
    // A string that is not a value-after-colon exercises the main-loop quote
    // path including the escape branch; it contributes no key.
    expect(extractTopLevelKeys(`"a\\nb", real`)).toEqual(["real"]);
  });

  it("resets the shorthand token across top-level brackets", () => {
    // A bracketed group at top level (not following a colon) must not leak a
    // key, and the following shorthand must still register.
    expect(extractTopLevelKeys(`[x][y], kept`)).toContain("kept");
    expect(extractTopLevelKeys(`(a)(b), kept`)).toContain("kept");
    expect(extractTopLevelKeys(`{z}, kept`)).toContain("kept");
  });

  it("tolerates a trailing backslash at the end of an open string", () => {
    // The final backslash has no following char, exercising the `?? ""` guard.
    expect(extractTopLevelKeys(`"open\\`)).toEqual([]);
  });

  it("ignores a colon with no preceding key name", () => {
    // An empty key before `:` exercises the `name && ...` short-circuit.
    expect(extractTopLevelKeys(`: value, real: 1`)).toEqual(["real"]);
  });
});

describe("source scanner: extractObjectKeys", () => {
  it("returns null when there is no top-level object literal", () => {
    expect(extractObjectKeys("config, someVar")).toBeNull();
  });

  it("uses the LAST top-level object literal (the options arg)", () => {
    // First arg is an object too; the options object is the last one.
    expect(extractObjectKeys(`{ a: 1 }, { error, route: r }`)).toEqual(["error", "route"]);
  });

  it("ignores braces inside strings when locating the object", () => {
    expect(extractObjectKeys(`"a { b }", { error, method: m }`)).toEqual(["error", "method"]);
  });

  it("handles escaped quotes inside a leading string arg", () => {
    // The escaped `\"` keeps the string open past the inner brace so the real
    // options object is still located correctly.
    expect(extractObjectKeys(`"a \\" { x }", { error, route: r }`)).toEqual(["error", "route"]);
  });
});

describe("source scanner: scanSourceForTelemetryCalls", () => {
  it("finds a bare captureException and its keys", () => {
    const calls = scanSourceForTelemetryCalls(
      `captureException(config, { error, distinctId: "server" });`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("captureException");
    expect(calls[0].keys).toEqual(["error", "distinctId"]);
    expect(calls[0].contextSafeByConstruction).toBe(false);
    expect(calls[0].line).toBe(1);
  });

  it("finds method-form auth-sink calls and extracts the extras object", () => {
    const calls = scanSourceForTelemetryCalls(
      `\n  telemetry.captureException(error, { provider, phase });`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("captureException");
    expect(calls[0].keys).toEqual(["provider", "phase"]);
    expect(calls[0].line).toBe(2);
  });

  it("does not match an identifier that merely ends with a telemetry name", () => {
    expect(scanSourceForTelemetryCalls(`myCaptureEvent({ a: 1 });`)).toEqual([]);
  });

  it("flags domain wrappers as context-safe without parsing args", () => {
    const calls = scanSourceForTelemetryCalls(
      `await captureLlmCallFailure({ operation: "x", provider: "openai", model: "m" });`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].contextSafeByConstruction).toBe(true);
    expect(calls[0].keys).toEqual([]);
  });

  it("treats a non-literal options arg as context-safe (keys unknown)", () => {
    const calls = scanSourceForTelemetryCalls(`captureEvent(config, payload);`);
    expect(calls).toHaveLength(1);
    expect(calls[0].contextSafeByConstruction).toBe(true);
  });

  it("treats an unbalanced/truncated call as context-safe", () => {
    const calls = scanSourceForTelemetryCalls(`captureException(config, { error `);
    expect(calls).toHaveLength(1);
    expect(calls[0].contextSafeByConstruction).toBe(true);
  });

  it("computes line numbers from preceding newlines", () => {
    const calls = scanSourceForTelemetryCalls(
      `line1\nline2\ncaptureEvent(config, { event: e, scope });`,
    );
    expect(calls[0].line).toBe(3);
  });

  it("ignores telemetry-like text inside strings via balanced parsing", () => {
    // A real call followed by a string mentioning the name: only one call.
    const calls = scanSourceForTelemetryCalls(
      `captureEvent(config, { event: e, scope: "call captureEvent again" });`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].keys).toEqual(["event", "scope"]);
  });

  it("balances parens across escaped quotes and brackets in string args", () => {
    // The escaped quote inside the string exercises the escape branch of the
    // paren matcher; the close paren is still found and keys extracted.
    const calls = scanSourceForTelemetryCalls(
      `captureEvent(config, { event: e, note: "he said \\") ;", scope: s });`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].keys).toEqual(["event", "note", "scope"]);
  });
});

// --- RULES ----------------------------------------------------------------

describe("rule 1: error-context", () => {
  const call = (keys: string[], safe = false): TelemetryCall => ({
    fn: "captureException",
    keys,
    line: 1,
    contextSafeByConstruction: safe,
  });

  it("callHasContext: identity-only keys have no context", () => {
    expect(callHasContext(call(["error", "distinctId"]))).toBe(false);
  });

  it("callHasContext: a non-identity key is context", () => {
    expect(callHasContext(call(["error", "route"]))).toBe(true);
  });

  it("callHasContext: context-safe-by-construction always passes", () => {
    expect(callHasContext(call([], true))).toBe(true);
  });

  it("checkErrorContext passes when all calls carry context", () => {
    const result = checkErrorContext(
      new Map([["f.ts", [call(["error", "route"]), call([], true)]]]),
    );
    expect(result.status).toBe("pass");
    expect(result.violations).toEqual([]);
  });

  it("checkErrorContext fails and reports the bare call", () => {
    const result = checkErrorContext(new Map([["f.ts", [call(["error", "distinctId"])]]]));
    expect(result.status).toBe("fail");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ file: "f.ts", fn: "captureException" });
  });

  it("checkErrorContext sorts violations by file then line (both directions)", () => {
    // Insertion order is intentionally unsorted across three files so the
    // comparator returns -1, 0/line-delta, and 1.
    const result = checkErrorContext(
      new Map([
        ["c.ts", [{ ...call(["error"]), line: 1 }]],
        ["a.ts", [{ ...call(["error"]), line: 9 }, { ...call(["error"]), line: 2 }]],
        ["b.ts", [{ ...call(["error"]), line: 5 }]],
      ]),
    );
    expect(result.violations.map((v) => `${v.file}:${v.line}`)).toEqual([
      "a.ts:2",
      "a.ts:9",
      "b.ts:5",
      "c.ts:1",
    ]);
  });
});

describe("rule 2: no-new-gap ratchet", () => {
  it("passes when every catch file is instrumented or allowlisted", () => {
    const result = checkFileCoverage(
      ["a.server.ts", "b.server.ts"],
      new Set(["a.server.ts"]),
      new Map([["b.server.ts", "[swallow] ok"]]),
    );
    expect(result.status).toBe("pass");
    expect(result.carriedGaps).toEqual(["b.server.ts"]);
  });

  it("fails on a new uninstrumented, unallowlisted catch file", () => {
    const result = checkFileCoverage(["new.server.ts"], new Set(), new Map());
    expect(result.status).toBe("fail");
    expect(result.newGaps).toEqual(["new.server.ts"]);
  });

  it("fails on a stale allowlist entry (now instrumented)", () => {
    const result = checkFileCoverage(
      ["a.server.ts"],
      new Set(["a.server.ts"]),
      new Map([["a.server.ts", "[backfill] x"]]),
    );
    expect(result.status).toBe("fail");
    expect(result.staleAllowlist).toEqual(["a.server.ts"]);
  });

  it("fails on a stale allowlist entry (no longer a catch file)", () => {
    const result = checkFileCoverage([], new Set(), new Map([["gone.server.ts", "x"]]));
    expect(result.status).toBe("fail");
    expect(result.staleAllowlist).toEqual(["gone.server.ts"]);
  });
});

// --- ORCHESTRATOR (fake fs) ----------------------------------------------

describe("isAuditScopeFile", () => {
  it.each([
    ["app/lib/x.server.ts", true],
    ["app/lib/mcp/y.server.tsx", true],
    ["app/lib/x.ts", false],
    ["app/lib/x.server.test.ts", false],
    ["app/lib/x.d.ts", false],
    ["app/routes/r.ts", true],
    ["app/routes/r.tsx", true],
    ["app/routes/r.test.tsx", false],
    ["app/components/c.tsx", false],
  ])("%s -> %s", (path, expected) => {
    expect(isAuditScopeFile(path)).toBe(expected);
  });
});

describe("hasCatchBlock", () => {
  it("matches catch (e) and bare catch {", () => {
    expect(hasCatchBlock("try {} catch (e) {}")).toBe(true);
    expect(hasCatchBlock("try {} catch {}")).toBe(true);
  });

  it("does not match the word catch in prose", () => {
    expect(hasCatchBlock("restart crawls to catch edits")).toBe(false);
  });
});

describe("runTelemetryCoverageAudit (fake fs)", () => {
  // Synthetic trees are judged against an empty allowlist so the real project
  // allowlist never interferes; the allowlist path itself is covered by the
  // real-repo gate and the dedicated injection test below.
  const EMPTY = new Map<string, string>();

  it("passes when a catch file is instrumented with context", () => {
    const fs = fakeFs({
      "app/lib/a.server.ts": `try {} catch (e) { captureException(c, { error: e, route: r }); }`,
      "app/routes/r.tsx": `export const loader = () => null;`,
    });
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs, allowlist: EMPTY });
    expect(report.status).toBe("pass");
    expect(report.filesScanned).toBe(2);
    expect(report.telemetryCalls).toBe(1);
  });

  it("fails when a catch file emits nothing and is not allowlisted", () => {
    const fs = fakeFs({
      "app/lib/silent.server.ts": `try {} catch (e) { return null; }`,
    });
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs, allowlist: EMPTY });
    expect(report.status).toBe("fail");
    expect(report.fileCoverage.newGaps).toEqual(["app/lib/silent.server.ts"]);
  });

  it("passes a catch file that is on the injected allowlist", () => {
    const fs = fakeFs({
      "app/lib/silent.server.ts": `try {} catch (e) { return null; }`,
    });
    const report = runTelemetryCoverageAudit({
      repoRoot: "/repo",
      fs,
      allowlist: new Map([["app/lib/silent.server.ts", "[swallow] documented"]]),
    });
    expect(report.status).toBe("pass");
    expect(report.fileCoverage.carriedGaps).toEqual(["app/lib/silent.server.ts"]);
  });

  it("fails when an instrumented call lacks context", () => {
    const fs = fakeFs({
      "app/lib/a.server.ts": `try {} catch (e) { captureException(c, { error: e, distinctId: "s" }); }`,
    });
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs, allowlist: EMPTY });
    expect(report.status).toBe("fail");
    expect(report.errorContext.violations).toHaveLength(1);
  });

  it("skips out-of-scope files and missing roots", () => {
    const fs = fakeFs({
      "app/routes/r.ts": `export const loader = () => null;`,
      "app/components/ignored.tsx": `try {} catch {}`,
    });
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs, allowlist: EMPTY });
    expect(report.status).toBe("pass");
    expect(report.filesScanned).toBe(1);
  });

  it("treats a non-existent root as empty", () => {
    const fs: FileSystem = {
      listFiles: () => [],
      readFile: () => "",
      exists: () => false,
    };
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs, allowlist: EMPTY });
    expect(report.filesScanned).toBe(0);
    expect(report.status).toBe("pass");
  });

  it("normalizes absolute paths outside the repo root prefix", () => {
    // A path that does not start with repoRoot+"/" is returned as-is, then
    // filtered out of scope (it does not start with app/lib or app/routes).
    const fs: FileSystem = {
      listFiles: (dir) => (dir.endsWith("app/lib") ? ["/elsewhere/app/lib/x.server.ts"] : []),
      readFile: () => "",
      exists: () => true,
    };
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs, allowlist: EMPTY });
    expect(report.filesScanned).toBe(0);
  });

  it("handles a repoRoot that already ends with a slash", () => {
    const fs = fakeFs(
      { "app/lib/a.server.ts": `try {} catch (e) { captureException(c, { error: e, route: r }); }` },
      "/repo/",
    );
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo/", fs, allowlist: EMPTY });
    expect(report.status).toBe("pass");
    expect(report.filesScanned).toBe(1);
  });

  it("uses the real project allowlist when none is injected", () => {
    // Empty tree + default allowlist => every allowlist entry is stale.
    const fs: FileSystem = {
      listFiles: () => [],
      readFile: () => "",
      exists: () => true,
    };
    const report = runTelemetryCoverageAudit({ repoRoot: "/repo", fs });
    expect(report.fileCoverage.staleAllowlist.length).toBe(TELEMETRY_GAP_ALLOWLIST.length);
  });
});

// --- FAILURE FORMATTER ----------------------------------------------------

describe("formatAuditFailure", () => {
  const base: AuditReport = {
    status: "fail",
    errorContext: { status: "pass", violations: [] },
    fileCoverage: { status: "pass", newGaps: [], staleAllowlist: [], carriedGaps: [] },
    filesScanned: 0,
    telemetryCalls: 0,
  };

  it("renders error-context violations with keys", () => {
    const msg = formatAuditFailure({
      ...base,
      errorContext: {
        status: "fail",
        violations: [{ file: "f.ts", line: 3, fn: "captureException", keys: ["error"] }],
      },
    });
    expect(msg).toContain("ERROR-CONTEXT");
    expect(msg).toContain("f.ts:3");
    expect(msg).toContain("keys=[error]");
  });

  it("renders an empty-keys violation", () => {
    const msg = formatAuditFailure({
      ...base,
      errorContext: {
        status: "fail",
        violations: [{ file: "f.ts", line: 1, fn: "captureEvent", keys: [] }],
      },
    });
    expect(msg).toContain("keys=[]");
  });

  it("renders new gaps", () => {
    const msg = formatAuditFailure({
      ...base,
      fileCoverage: { status: "fail", newGaps: ["x.server.ts"], staleAllowlist: [], carriedGaps: [] },
    });
    expect(msg).toContain("NO-NEW-GAP");
    expect(msg).toContain("x.server.ts");
  });

  it("renders stale allowlist entries", () => {
    const msg = formatAuditFailure({
      ...base,
      fileCoverage: { status: "fail", newGaps: [], staleAllowlist: ["y.server.ts"], carriedGaps: [] },
    });
    expect(msg).toContain("STALE ALLOWLIST");
    expect(msg).toContain("y.server.ts");
  });

  it("renders just the header when nothing is populated", () => {
    expect(formatAuditFailure(base)).toBe("Telemetry coverage audit FAILED:");
  });
});

// --- NODE FS ADAPTER ------------------------------------------------------

describe("nodeFileSystem", () => {
  it("lists files recursively, skipping node_modules and dot-dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "telcov-"));
    try {
      mkdirSync(join(root, "sub"));
      mkdirSync(join(root, "node_modules"));
      mkdirSync(join(root, ".hidden"));
      writeFileSync(join(root, "a.ts"), "a");
      writeFileSync(join(root, "sub", "b.ts"), "b");
      writeFileSync(join(root, "node_modules", "c.ts"), "c");
      writeFileSync(join(root, ".hidden", "d.ts"), "d");
      // A symlink entry is neither a directory nor a regular file, so it
      // exercises the branch where both isDirectory() and isFile() are false.
      symlinkSync(join(root, "a.ts"), join(root, "link.ts"));

      const files = nodeFileSystem.listFiles(root).sort();
      expect(files).toEqual([join(root, "a.ts"), join(root, "sub", "b.ts")]);
      expect(nodeFileSystem.readFile(join(root, "a.ts"))).toBe("a");
      expect(nodeFileSystem.exists(join(root, "a.ts"))).toBe(true);
      expect(nodeFileSystem.exists(join(root, "missing.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
