import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetRetryNote, loadRetryNote } from "../../e2e/journeys/support/app-ready";
import {
  EXPECTED_PRISMA_D1_TRANSACTION_WARNING,
  JOURNEYS_RETRY_NOTE_PATTERN,
  OURO_SLOW_TOUCH_TRACE_PATTERN,
  PNPM_SLOW_TARBALL_PATTERN,
  PNPM_TRANSIENT_FETCH_RETRY_PATTERN,
  findUnexpectedDiagnosticOutput,
  findUnexpectedWarnings,
  main,
  parseWarningGateCommands,
  resolveSpawnedCommandClose,
  runSpawnedCommand,
  runWarningGate,
} from "../../scripts/warning-gate";

describe("warning gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses sequential command segments after --", () => {
    expect(parseWarningGateCommands([
      "--",
      "pnpm",
      "run",
      "api:playground:generate",
      "--then",
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--coverage",
    ])).toEqual([
      ["pnpm", "run", "api:playground:generate"],
      ["pnpm", "exec", "vitest", "run", "--coverage"],
    ]);
  });

  it("rejects missing separators and empty command segments", () => {
    expect(() => parseWarningGateCommands([])).toThrow(/-- separator/);
    expect(() => parseWarningGateCommands(["--"])).toThrow(/at least one command/);
    expect(() => parseWarningGateCommands(["--", "--then", "pnpm"])).toThrow(/empty command/);
    expect(() => parseWarningGateCommands(["--", "pnpm", "--then"])).toThrow(/empty command/);
  });

  it("detects real warning tokens without self-matching coverage table filenames", () => {
    const prismaWarning = `prisma:warn ${EXPECTED_PRISMA_D1_TRANSACTION_WARNING}`;
    expect(findUnexpectedWarnings(`ok\n${prismaWarning}\n`)).toEqual([prismaWarning]);
    expect(findUnexpectedWarnings("\u001b[33mprisma:warn Something else happened\u001b[39m")).toEqual([
      "prisma:warn Something else happened",
    ]);
    expect(findUnexpectedWarnings("warning-gate.ts  |   59.09 |    62.06 |")).toEqual([]);
    expect(findUnexpectedWarnings("PASS scripts: scripts/warning-gate.ts, scripts/production-readiness.ts")).toEqual([]);
    expect(findUnexpectedWarnings("warnings-summary.log")).toEqual([]);
    // A row of Vite's built-file table whose chunk is named after a module called use-dev-warnings.
    expect(findUnexpectedWarnings("build/client/assets/use-dev-warnings-DRRKi67r.js                          27.77 kB │ gzip:  8.72 kB")).toEqual([]);
    expect(findUnexpectedWarnings("build/server/assets/use-dev-warnings-DRRKi67r.js  27.77 kB")).toEqual([]);
    expect(findUnexpectedWarnings("build/client/assets/app-DRRKi67r.js  27.77 kB │ gzip:  8.72 kB warning: chunk is large")).toEqual([
      "build/client/assets/app-DRRKi67r.js  27.77 kB │ gzip:  8.72 kB warning: chunk is large",
    ]);
    expect(findUnexpectedWarnings("build/client/assets/warning: something 27.77 kB")).toEqual([
      "build/client/assets/warning: something 27.77 kB",
    ]);
    expect(findUnexpectedWarnings("2 warnings")).toEqual(["2 warnings"]);
    expect(findUnexpectedWarnings("Found 2 warnings")).toEqual(["Found 2 warnings"]);
    expect(findUnexpectedWarnings("Found 2 warnings.")).toEqual(["Found 2 warnings."]);
    expect(findUnexpectedWarnings("2 warnings, 0 errors")).toEqual(["2 warnings, 0 errors"]);
    expect(findUnexpectedWarnings("Warnings.")).toEqual(["Warnings."]);
    expect(findUnexpectedWarnings("warnings; build continued")).toEqual([
      "warnings; build continued",
    ]);
    expect(findUnexpectedWarnings("WARNINGS: 2")).toEqual(["WARNINGS: 2"]);
    expect(findUnexpectedWarnings("ExperimentalWarnings: surprise")).toEqual([
      "ExperimentalWarnings: surprise",
    ]);
    expect(findUnexpectedWarnings("[warnings] generated fallback output")).toEqual([
      "[warnings] generated fallback output",
    ]);
    expect(findUnexpectedWarnings("✓ [warnings] hidden behind a status prefix")).toEqual([
      "✓ [warnings] hidden behind a status prefix",
    ]);
    expect(findUnexpectedWarnings("✓ should preserve warnings copy")).toEqual([]);
    expect(findUnexpectedWarnings("warnings-summary.log: Warnings: build failed")).toEqual([
      "warnings-summary.log: Warnings: build failed",
    ]);
    expect(findUnexpectedWarnings("✓ should display appropriate UI warning for one auth method")).toEqual([]);
    expect(findUnexpectedWarnings("✓ omits the broad-scope warning for narrow scopes  1111ms")).toEqual([]);
    expect(findUnexpectedWarnings("✓ Warning: emitted by the test process  1111ms")).toEqual([
      "✓ Warning: emitted by the test process  1111ms",
    ]);
    expect(findUnexpectedWarnings("✓ warning dependency fallback used  1111ms")).toEqual([
      "✓ warning dependency fallback used  1111ms",
    ]);
    expect(findUnexpectedWarnings("✓ test/scripts/warning-gate.test.ts (14 tests) 194ms")).toEqual([]);
    expect(findUnexpectedWarnings("✓ app/lib/warning-copy.test.tsx (1 test) 2.4s")).toEqual([]);
    expect(findUnexpectedWarnings("✓ warning dependency fallback used")).toEqual([
      "✓ warning dependency fallback used",
    ]);
    expect(findUnexpectedWarnings("✓ should keep warning copy in a passing test name")).toEqual([]);
    expect(findUnexpectedWarnings("✓ requires warning-clean CI workflow setup 333ms")).toEqual([]);
    expect(findUnexpectedWarnings("✓ accepts a single-job warning-clean Storybook deploy workflow  512ms")).toEqual([]);
    expect(findUnexpectedWarnings("× surfaces remote-migration auth errors as warnings only 401ms")).toEqual([]);
    expect(findUnexpectedWarnings("✓ DeprecationWarning: emitted by a dependency")).toEqual([
      "✓ DeprecationWarning: emitted by a dependency",
    ]);
    expect(findUnexpectedWarnings("✓ warning-gates every command 400ms")).toEqual([
      "✓ warning-gates every command 400ms",
    ]);
    expect(findUnexpectedWarnings("✓ checks output (warn: leaked)")).toEqual([
      "✓ checks output (warn: leaked)",
    ]);

    expect(findUnexpectedWarnings("▲ [WARNING] bundle contains dynamic import")).toEqual([
      "▲ [WARNING] bundle contains dynamic import",
    ]);
    expect(findUnexpectedWarnings("⚠️ Warning: browser console noise")).toEqual([
      "⚠️ Warning: browser console noise",
    ]);
    expect(findUnexpectedWarnings("[vite] warning: env replacement skipped")).toEqual([
      "[vite] warning: env replacement skipped",
    ]);
    expect(findUnexpectedWarnings("(node:123) ExperimentalWarning: surprise")).toEqual([
      "(node:123) ExperimentalWarning: surprise",
    ]);
    expect(findUnexpectedWarnings("WARNING: browser console noise")).toEqual([
      "WARNING: browser console noise",
    ]);
    expect(findUnexpectedWarnings("⚠️ Missing unit for imported ingredient")).toEqual([
      "⚠️ Missing unit for imported ingredient",
    ]);
    expect(findUnexpectedWarnings("WARN[build] generated chunk is oversized")).toEqual([
      "WARN[build] generated chunk is oversized",
    ]);
    expect(findUnexpectedWarnings("warning(build) generated chunk is oversized")).toEqual([
      "warning(build) generated chunk is oversized",
    ]);
    expect(findUnexpectedWarnings("foo-warning: generated chunk is oversized")).toEqual([
      "foo-warning: generated chunk is oversized",
    ]);
    expect(findUnexpectedWarnings("[warn] hidden on stdout")).toEqual([
      "[warn] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("[WARN] hidden on stdout")).toEqual([
      "[WARN] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("[ warning ] hidden on stdout")).toEqual([
      "[ warning ] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("✓ [warn] hidden behind a status prefix")).toEqual([
      "✓ [warn] hidden behind a status prefix",
    ]);
    expect(findUnexpectedWarnings("\u001b[33mWarning: hidden behind color\u001b[39m")).toEqual([
      "Warning: hidden behind color",
    ]);
    expect(findUnexpectedWarnings("warniX\u001b[1Dng")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: warniXng",
    ]);
    expect(findUnexpectedWarnings("warnin\bng")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: warninng",
    ]);
    expect(findUnexpectedWarnings("\u001b[2K\u001b[1GWarning: hidden after cursor controls")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: Warning: hidden after cursor controls",
    ]);
    expect(findUnexpectedWarnings("\u001b(Bordinary charset switch")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: ordinary charset switch",
    ]);
    expect(findUnexpectedWarnings("\u001b]0;build title\u0007Warning: hidden after OSC title\n")).toEqual([
      "Warning: hidden after OSC title",
    ]);
    expect(findUnexpectedWarnings("\u001b]0;build title\u001b\\Warning: hidden after OSC ST\n")).toEqual([
      "Warning: hidden after OSC ST",
    ]);
    expect(findUnexpectedWarnings("✓ ordinary passing test")).toEqual([]);
    expect(findUnexpectedWarnings("\u001b[2K\u001b[1G✓ ordinary passing test")).toEqual([
      "warning-gate rejected cursor-editing terminal control output: ✓ ordinary passing test",
    ]);
    expect(findUnexpectedWarnings("[warn:build] hidden on stdout")).toEqual([
      "[warn:build] hidden on stdout",
    ]);
    expect(findUnexpectedWarnings("Warning! hidden failure")).toEqual([
      "Warning! hidden failure",
    ]);
    expect(findUnexpectedWarnings("WARNING-hidden failure")).toEqual([
      "WARNING-hidden failure",
    ]);
    expect(findUnexpectedWarnings("WARNING-gated bypass")).toEqual([
      "WARNING-gated bypass",
    ]);
    expect(findUnexpectedWarnings("WARN=hidden failure")).toEqual([
      "WARN=hidden failure",
    ]);
    expect(findUnexpectedWarnings(`${prismaWarning} Warning: appended bypass`)).toEqual([
      `${prismaWarning} Warning: appended bypass`,
    ]);
  });

  it("uses one channel-aware classifier for stdout warnings and every stderr diagnostic", () => {
    expect(findUnexpectedDiagnosticOutput(
      "ordinary stdout\nWarning: stdout diagnostic\n",
      "ordinary stderr diagnostic\n",
    )).toEqual(["Warning: stdout diagnostic", "ordinary stderr diagnostic"]);
    expect(findUnexpectedDiagnosticOutput("ordinary stdout\n", "\n\r\n")).toEqual([]);
  });

  it("streams spawned command output and reports child exit states", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await runSpawnedCommand([
      process.execPath,
      "-e",
      "process.stdout.write('out'); process.stderr.write('err');",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
    expect(result.warningOutput).toBe("err");
    expect(stdout).toHaveBeenCalledWith("out");
    expect(stderr).toHaveBeenCalledWith("err");
  });

  it("rejects empty or unspawnable commands and records signal exits", async () => {
    expect(() => runSpawnedCommand([])).toThrow(/empty command/);
    await expect(runSpawnedCommand(["/definitely/not/a/spoonjoy-command"])).rejects.toThrow();
    expect(resolveSpawnedCommandClose(null, null, "partial")).toEqual({
      exitCode: 1,
      output: "partial",
    });
    expect(resolveSpawnedCommandClose(3, "SIGTERM", "partial")).toEqual({
      exitCode: 1,
      output: "partialwarning-gate child terminated by SIGTERM\n",
    });

    const result = await runSpawnedCommand([
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');",
    ]);

    expect(result).toEqual({
      exitCode: 1,
      output: "warning-gate child terminated by SIGTERM\n",
    });
  });

  it("runs every command and fails unexpected warning output even when commands exit cleanly", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        output: "generated\n",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        output: "Warning: leaked warning\n",
      });

    const result = await runWarningGate([
      "--",
      "pnpm",
      "run",
      "api:playground:generate",
      "--then",
      "pnpm",
      "exec",
      "vitest",
    ], { runCommand });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(1);
    expect(result.unexpectedWarnings).toEqual(["Warning: leaked warning"]);
  });

  describe("pnpm transient registry retries", () => {
    // Captured from a real CI install (PR #382, 2026-10-09) that hit a registry 502, retried and succeeded.
    const capturedInstall = readFileSync(
      path.join(process.cwd(), "test/fixtures/warning-gate/pnpm-install-fetch-retry.txt"),
      "utf8",
    );
    // pnpm pads WARN with thin spaces (U+2009); the captured line keeps them.
    const retryLine =
      "\u2009WARN\u2009 GET https://registry.npmjs.org/ansi-escapes/-/ansi-escapes-7.2.0.tgz error (ERR_PNPM_FETCH_502). Will retry in 10 seconds. 2 retries left.";

    it("passes the captured install whose only warning is a registry retry, on either channel", async () => {
      expect(capturedInstall).toContain(retryLine);
      for (const result of [
        { exitCode: 0, output: capturedInstall },
        { exitCode: 0, output: capturedInstall, warningOutput: `${retryLine}\n` },
      ]) {
        await expect(runWarningGate(["--", "pnpm", "install", "--frozen-lockfile"], {
          runCommand: vi.fn().mockResolvedValue(result),
        })).resolves.toEqual({ exitCode: 0, unexpectedWarnings: [] });
      }
    });

    it("still fails the same install when it also prints a real warning", async () => {
      const realWarning = " WARN  deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported";
      const result = await runWarningGate(["--", "pnpm", "install", "--frozen-lockfile"], {
        runCommand: vi.fn().mockResolvedValue({
          exitCode: 0,
          output: capturedInstall.replace("Done in 22.7s", `${realWarning}\nDone in 22.7s`),
          warningOutput: `${retryLine}\nWARN  Issues with peer dependencies found\n`,
        }),
      });
      expect(result).toEqual({
        exitCode: 1,
        unexpectedWarnings: [realWarning.trim(), "WARN  Issues with peer dependencies found"],
      });
    });

    it("keeps the install's own failure when the retries run out", async () => {
      const result = await runWarningGate(["--", "pnpm", "install"], {
        runCommand: vi.fn().mockResolvedValue({ exitCode: 1, output: `${retryLine}\n` }),
      });
      expect(result).toEqual({ exitCode: 1, unexpectedWarnings: [] });
    });

    it.each([
      ["a retry notice from another registry host", "WARN  GET https://registry.example.com/a/-/a-1.0.0.tgz error (ERR_PNPM_FETCH_502). Will retry in 10 seconds. 2 retries left."],
      ["a client error that retrying cannot fix", "WARN  GET https://registry.npmjs.org/a/-/a-1.0.0.tgz error (ERR_PNPM_FETCH_404). Will retry in 10 seconds. 2 retries left."],
      ["an authentication failure", "WARN  GET https://registry.npmjs.org/a/-/a-1.0.0.tgz error (ERR_PNPM_FETCH_401). Will retry in 10 seconds. 2 retries left."],
      ["extra text after the notice", "WARN  GET https://registry.npmjs.org/a/-/a-1.0.0.tgz error (ERR_PNPM_FETCH_502). Will retry in 10 seconds. 2 retries left. Also: integrity mismatch"],
      ["a notice that does not say it will retry", "WARN  GET https://registry.npmjs.org/a/-/a-1.0.0.tgz error (ERR_PNPM_FETCH_502)."],
      ["a different warning that mentions retrying", "WARN  Request took 12s, will retry in 10 seconds. 2 retries left."],
    ])("fails %s", (_label, line) => {
      expect(PNPM_TRANSIENT_FETCH_RETRY_PATTERN.test(line)).toBe(false);
      expect(findUnexpectedWarnings(`${line}\n`)).toEqual([line]);
      expect(findUnexpectedDiagnosticOutput("", `${line}\n`)).toEqual([line]);
    });

    it.each([
      "WARN  GET https://registry.npmjs.org/@prisma/engines/-/engines-6.19.2.tgz error (ECONNRESET). Will retry in 10 seconds. 2 retries left.",
      "WARN  GET https://registry.npmjs.org/a/-/a-1.0.0.tgz error (ERR_PNPM_FETCH_429). Will retry in 59.9 seconds. 1 retry left.",
      "WARN  GET https://registry.npmjs.org/%40scope%2fpkg error (ETIMEDOUT). Will retry in 1 second. 4 retries left.",
    ].map((line, index) => [index + 1, line] as const))("tolerates transient retry notice %i", (_case, line) => {
      expect(findUnexpectedWarnings(`${line}\n`)).toEqual([]);
      expect(findUnexpectedDiagnosticOutput("", `${line}\n`)).toEqual([]);
    });
  });

  describe("pnpm's slow download note", () => {
    // The line Journeys run 40631270668's install printed, with pnpm's thin spaces around WARN.
    const slow = "\u2009WARN\u2009 Tarball download average speed 40 KiB/s (size 44 KiB) is below 50 KiB/s: https://registry.npmjs.org/@floating-ui/core/-/core-1.8.0.tgz (GET)";

    it("tolerates the note on either channel", () => {
      expect(findUnexpectedWarnings(`${slow}\n`)).toEqual([]);
      expect(findUnexpectedDiagnosticOutput("", `${slow}\n`)).toEqual([]);
      const larger = "WARN  Tarball download average speed 1.5 MiB/s (size 12.3 MiB) is below 2 MiB/s: https://registry.npmjs.org/a/-/a-1.0.0.tgz (GET)";
      expect(PNPM_SLOW_TARBALL_PATTERN.test(larger)).toBe(true);
    });

    it.each([
      ["another registry host", "WARN  Tarball download average speed 40 KiB/s (size 44 KiB) is below 50 KiB/s: https://registry.example.com/a/-/a-1.0.0.tgz (GET)"],
      ["extra text after the note", "WARN  Tarball download average speed 40 KiB/s (size 44 KiB) is below 50 KiB/s: https://registry.npmjs.org/a/-/a-1.0.0.tgz (GET) integrity mismatch"],
      ["a different warning about tarballs", "WARN  Tarball integrity check failed: https://registry.npmjs.org/a/-/a-1.0.0.tgz (GET)"],
    ])("fails %s", (_label, line) => {
      expect(PNPM_SLOW_TARBALL_PATTERN.test(line)).toBe(false);
      expect(findUnexpectedWarnings(`${line}\n`)).toEqual([line]);
    });
  });

  describe("the journeys' notes about a load or file they asked for again", () => {
    // The notes app-ready.ts prints, for the resets Journeys runs 40592921397 and 40634883359 met
    // and a static file answered 502 or 504.
    const notes = [
      loadRetryNote(new Error("page.goto: net::ERR_CONNECTION_RESET at https://spoonjoy-v2-qa-run-40634883359-1.mendelow-studio.workers.dev/login\nCall log:\n  - navigating")),
      loadRetryNote(new Error("page.reload: net::ERR_CONNECTION_CLOSED at https://spoonjoy-v2-qa-run-1-1.mendelow-studio.workers.dev/recipes?q=a")),
      loadRetryNote(new Error("page.goto: Error receiving data: Connection reset by peer")),
      loadRetryNote(new Error("page.goto: Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer")),
      assetRetryNote("/assets/heading-BIJmUf4w.js", 502, 2),
      loadRetryNote(new Error("page.reload: net::ERR_SSL_PROTOCOL_ERROR at https://spoonjoy-v2-qa-run-1-1.mendelow-studio.workers.dev/search?q=(rice)")),
      assetRetryNote("/assets/root-Dx_9a.css", 504, 3),
      assetRetryNote("/assets/_user$id-Ab3_x.js", 503, 2),
      assetRetryNote("/assets/logo@2x-Q1w2.png", 502, 3),
    ];

    it.each(notes)("tolerates %s", (line) => {
      expect(JOURNEYS_RETRY_NOTE_PATTERN.test(line)).toBe(true);
      expect(findUnexpectedDiagnosticOutput("", `${line}\n`)).toEqual([]);
    });

    it.each([
      ["a load that timed out", loadRetryNote(new Error("page.goto: Timeout 60000ms exceeded."))],
      ["a load that failed another way", loadRetryNote(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.com/"))],
      ["a file answered with another status", assetRetryNote("/assets/a.js", 500, 2)],
      ["a file outside the built files", assetRetryNote("/photos/covers/a.jpg", 502, 2)],
      ["a fourth try", assetRetryNote("/assets/a.js", 502, 4)],
      ["extra text after a note", `${assetRetryNote("/assets/a.js", 502, 2)} and a page error`],
      ["another note from the journeys", "Journeys: the page never hydrated"],
    ])("still fails %s", (_label, line) => {
      expect(JOURNEYS_RETRY_NOTE_PATTERN.test(line)).toBe(false);
      expect(findUnexpectedDiagnosticOutput("", `${line}\n`)).toEqual([line]);
    });
  });

  describe("Ouro HX's slow-touch trace", () => {
    // The shape of the line Storybook run 39763027229's test:ouro printed when a cold browser's first touch took 1.8s.
    const trace =
      "touchStep: the touchStart at (100, 100) took 1831ms. Steps: +828ms asked Chromium: layout 256ms, hit test 61ms, node 243ms, watcher 81ms, frame id 0ms, released 185ms; +828ms the frame at the point: true, http://localhost:63316/?sessionId=1; +1831ms handled. Watches: http://localhost:63316/?sessionId=1 answered at +828ms. Node's event loop ran up to 46ms late.";

    it.each([
      trace,
      "touchDrag: the touchEnd at (260, 100) took 1204ms. Steps: +3ms sent. Watches: about:srcdoc had not answered. Node's event loop ran up to 12ms late.",
    ])("tolerates the kit's trace of a touch that succeeded slowly: %s", (line) => {
      expect(OURO_SLOW_TOUCH_TRACE_PATTERN.test(line)).toBe(true);
      expect(findUnexpectedDiagnosticOutput("", `${line}\n`)).toEqual([]);
    });

    it.each([
      ["another command's line", trace.replace(/^touchStep/, "pointerPress")],
      ["a touch that did not finish", "touchStep: the page did not handle the touchEnd at (260, 100) within 5000ms."],
      ["extra text after the trace", `${trace} Also: something broke`],
      ["a warning that mentions a slow touch", "Warning: touchStep: the touchStart at (100, 100) took 1831ms."],
    ])("still fails %s", (_label, line) => {
      expect(OURO_SLOW_TOUCH_TRACE_PATTERN.test(line)).toBe(false);
      expect(findUnexpectedDiagnosticOutput("", `${line}\n`)).toEqual([line]);
    });
  });

  it("fails successful commands that write otherwise unmarked output to the warning channel", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "ordinary stdout\n",
      warningOutput: "Missing unit fallback was used\n",
    });

    const result = await runWarningGate(["--", "pnpm", "run", "build"], { runCommand });

    expect(result).toEqual({
      exitCode: 1,
      unexpectedWarnings: ["Missing unit fallback was used"],
    });
  });

  it("still rejects Prisma's CI update banner when it reaches stderr", async () => {
    const updateBanner = "Update available 6.19.2 -> 7.8.0\n";
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: updateBanner,
      warningOutput: updateBanner,
    });

    const result = await runWarningGate(["--", "pnpm", "prisma:generate"], { runCommand });

    expect(result).toEqual({
      exitCode: 1,
      unexpectedWarnings: ["Update available 6.19.2 -> 7.8.0"],
    });
  });

  it("fails cursor-editing terminal controls on the warning channel even without text", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "ordinary stdout\n",
      warningOutput: "\u001b[1D\n",
    });

    const result = await runWarningGate(["--", "pnpm", "run", "build"], { runCommand });

    expect(result).toEqual({
      exitCode: 1,
      unexpectedWarnings: ["warning-gate rejected cursor-editing terminal control output"],
    });
  });

  it("preserves a non-zero command exit after scanning warning output", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 7,
      output: "ordinary failure details\n",
    });

    const result = await runWarningGate(["--", "pnpm", "exec", "playwright", "test"], {
      runCommand,
    });

    expect(result.exitCode).toBe(7);
    expect(result.unexpectedWarnings).toEqual([]);
  });

  it("uses the spawned command runner when no test runner is injected", async () => {
    const result = await runWarningGate([
      "--",
      process.execPath,
      "-e",
      "process.exit(0);",
    ], {});

    expect(result).toEqual({
      exitCode: 0,
      unexpectedWarnings: [],
    });
  });

  it("prints CLI warning details and records the selected exit code", async () => {
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "Warning: leaked warning\n",
    });

    const result = await main(["--", "pnpm", "exec", "vitest"], {
      runCommand,
      writeStderr,
      setExitCode,
    });

    expect(result.exitCode).toBe(1);
    expect(writeStderr).toHaveBeenCalledWith(expect.stringContaining("Warning: leaked warning"));
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("keeps quiet CLI output quiet while preserving command failures", async () => {
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 4,
      output: "ordinary failure details\n",
    });

    const result = await main(["--", "pnpm", "exec", "playwright", "test"], {
      runCommand,
      writeStderr,
      setExitCode,
    });

    expect(result.exitCode).toBe(4);
    expect(result.unexpectedWarnings).toEqual([]);
    expect(writeStderr).not.toHaveBeenCalled();
    expect(setExitCode).toHaveBeenCalledWith(4);
  });

  it("uses process stderr and process exitCode by default at the CLI seam", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "Warning: default CLI path\n",
    });

    process.exitCode = undefined;
    const result = await main(["--", "pnpm", "exec", "vitest"], { runCommand });

    expect(result.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Warning: default CLI path"));
    expect(process.exitCode).toBe(1);
  });
});

describe("repository test titles", () => {
  // vitest prints a slow test as "✓ <title>  <n>ms". If a title reads as a warning, CI then fails
  // only when that test happens to run slowly, so every title must pass the gate in that form.
  it("never trip the warning gate when vitest reports them as slow", () => {
    const roots = ["test", "app"].map((dir) => path.resolve(__dirname, "../..", dir));
    const titlePattern = /\b(?:it|test)(?:\.each\([^)]*\))?\(\s*(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
    const flagged: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(full);
        } else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
          for (const match of readFileSync(full, "utf8").matchAll(titlePattern)) {
            if (findUnexpectedWarnings(`✓ ${match[2]}  333ms`).length > 0) {
              flagged.push(`${path.relative(process.cwd(), full)}: ${match[2]}`);
            }
          }
        }
      }
    };
    roots.forEach(visit);
    expect(flagged).toEqual([]);
  });
});
