import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const wrapper = "scripts/run-with-warning-policy.mjs";

const playwrightMockState = vi.hoisted(() => ({ extension: undefined as unknown }));

vi.mock("@playwright/test", () => {
  const base = Object.assign(() => undefined, {
    extend: (extension: unknown) => {
      playwrightMockState.extension = extension;
      return () => undefined;
    },
  });
  return {
    test: base,
    expect: () => undefined,
  };
});

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function runWrapped(code: string) {
  return spawnSync(process.execPath, [wrapper, "--", process.execPath, "-e", code], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runVitestSentinel(
  lane: "app" | "workers",
  body: string,
) {
  const path = lane === "app"
    ? "test/__warning-sentinel-generated.test.ts"
    : "test/workers/__warning-sentinel-generated.test.ts";
  const args = ["node_modules/vitest/vitest.mjs", "run", path];
  if (lane === "workers") {
    args.push(
      "--config",
      "vitest.workers.config.ts",
      "--maxWorkers=1",
      "--no-isolate",
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  const warningPolicyImport = lane === "app" ? "./warning-policy" : "../warning-policy";
  writeFileSync(
    path,
    `import { afterAll, beforeAll, test, vi } from "vitest";\nimport { expectConsoleError } from "${warningPolicyImport}";\n${body}\n`,
  );
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === "VITEST" || key.startsWith("VITEST_")) delete env[key];
    }
    return spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
      timeout: 60_000,
    });
  } finally {
    unlinkSync(path);
  }
}

function runtimeImportNames(source: string, moduleName: string) {
  const sourceFile = ts.createSourceFile(
    "inventory.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName) {
      return [];
    }
    if (!statement.importClause) return ["side-effect"];
    if (statement.importClause.isTypeOnly) return [];

    const names: string[] = [];
    if (statement.importClause.name) names.push("default");
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
      }
    }
    return names;
  });
}

function hasRuntimeModuleAcquisition(source: string, moduleName: string) {
  const sourceFile = ts.createSourceFile(
    "inventory.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === moduleName) {
      found = true;
    }
    if (ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === moduleName &&
      !node.isTypeOnly) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function workflowRunCommands(source: string) {
  const jobsStart = source.search(/^jobs:\s*$/m);
  if (jobsStart === -1) return [];
  const jobsRemainder = source.slice(jobsStart).split("\n").slice(1).join("\n");
  const nextTopLevel = jobsRemainder.search(/^[^\s#][^:]*:/m);
  const jobs = nextTopLevel === -1
    ? jobsRemainder
    : jobsRemainder.slice(0, nextTopLevel);
  return jobs.split(/(?=^  [a-z][a-z0-9-]*:\s*$)/m).flatMap((job) => {
    if (/^    if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*(?:#.*)?$/mi.test(job) ||
      /^    continue-on-error:\s*(?:true|\$\{\{\s*true\s*\}\})\s*(?:#.*)?$/mi.test(job)) {
      return [];
    }
    const stepsStart = job.search(/^    steps:\s*$/m);
    if (stepsStart === -1) return [];
    const stepsRemainder = job.slice(stepsStart).split("\n").slice(1).join("\n");
    const nextJobProperty = stepsRemainder.search(/^    [a-z][a-z0-9-]*:/m);
    const steps = nextJobProperty === -1
      ? stepsRemainder
      : stepsRemainder.slice(0, nextJobProperty);
    return steps.split(/(?=^      - )/m).flatMap((step) => {
      if (/^(?:      - |        )if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*(?:#.*)?$/mi.test(step) ||
        /^(?:      - |        )continue-on-error:\s*(?:true|\$\{\{\s*true\s*\}\})\s*(?:#.*)?$/mi.test(step)) {
        return [];
      }
      const firstLine = step.match(/^      - run:\s+([^#]+?)\s*$/m);
      const nested = step.match(/^        run:\s+([^#]+?)\s*$/m);
      const command = firstLine?.[1] ?? nested?.[1];
      return command ? [command] : [];
    });
  });
}

function hasAutomaticDiagnosticFixture(source: string) {
  const sourceFile = ts.createSourceFile(
    "fixtures.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const testDeclaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .find((statement) =>
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === "test"));
  const declaration = testDeclaration?.declarationList.declarations.find((candidate) =>
    ts.isIdentifier(candidate.name) && candidate.name.text === "test");
  const initializer = declaration?.initializer;
  if (!initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isPropertyAccessExpression(initializer.expression) ||
    !ts.isIdentifier(initializer.expression.expression) ||
    initializer.expression.expression.text !== "base" ||
    initializer.expression.name.text !== "extend" ||
    !ts.isObjectLiteralExpression(initializer.arguments[0])) {
    return false;
  }

  return initializer.arguments[0].properties.some((fixtureProperty) => {
    if (!ts.isPropertyAssignment(fixtureProperty) ||
      !ts.isArrayLiteralExpression(fixtureProperty.initializer) ||
      fixtureProperty.initializer.elements.length !== 2) {
      return false;
    }
    const [fixtureFunction, options] = fixtureProperty.initializer.elements;
    if ((!ts.isArrowFunction(fixtureFunction) && !ts.isFunctionExpression(fixtureFunction)) ||
      !ts.isObjectLiteralExpression(options) ||
      !options.properties.some((candidate) =>
        ts.isPropertyAssignment(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === "auto" &&
        candidate.initializer.kind === ts.SyntaxKind.TrueKeyword)) {
      return false;
    }

    if (!ts.isArrowFunction(fixtureFunction) || fixtureFunction.parameters.length !== 2) {
      return false;
    }
    const [contextParameter, useParameter] = fixtureFunction.parameters;
    const receivesContext = ts.isObjectBindingPattern(contextParameter.name) &&
      contextParameter.name.elements.some((element) =>
        ts.isIdentifier(element.name) &&
        element.name.text === "context" &&
        (!element.propertyName ||
          (ts.isIdentifier(element.propertyName) && element.propertyName.text === "context")));
    if (!receivesContext || !ts.isIdentifier(useParameter.name) || useParameter.name.text !== "use") {
      return false;
    }
    const delegatedCall = ts.isCallExpression(fixtureFunction.body)
      ? fixtureFunction.body
      : ts.isBlock(fixtureFunction.body) && fixtureFunction.body.statements.length === 1 &&
          ts.isReturnStatement(fixtureFunction.body.statements[0]) &&
          fixtureFunction.body.statements[0].expression &&
          ts.isCallExpression(fixtureFunction.body.statements[0].expression)
        ? fixtureFunction.body.statements[0].expression
        : undefined;
    return Boolean(
      delegatedCall &&
      ts.isIdentifier(delegatedCall.expression) &&
      delegatedCall.expression.text === "runBrowserDiagnosticFixture" &&
      delegatedCall.arguments.length === 2 &&
      ts.isIdentifier(delegatedCall.arguments[0]) &&
      delegatedCall.arguments[0].text === "context" &&
      ts.isIdentifier(delegatedCall.arguments[1]) &&
      delegatedCall.arguments[1].text === "use",
    );
  });
}

describe("warning command policy", () => {
  it("exercises the exported wrapper with a real clean child", async () => {
    const warningWrapper = await vi.importActual<{
      containsWarningDiagnostic(output: string): boolean;
      runWithWarningPolicy(argv: string[]): Promise<number>;
    }>("../../scripts/run-with-warning-policy.mjs");

    expect(warningWrapper.containsWarningDiagnostic("\u001b[33mWARN colored diagnostic\u001b[0m"))
      .toBe(true);
    expect(warningWrapper.containsWarningDiagnostic("ordinary child output")).toBe(false);
    await expect(warningWrapper.runWithWarningPolicy([
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('direct clean child\\n')",
    ])).resolves.toBe(0);
  });

  it("covers wrapper child lifecycle and termination boundaries in process", async () => {
    const { runWithWarningPolicy } = await vi.importActual<{
      runWithWarningPolicy(argv: string[], runtime?: Record<string, unknown>): Promise<number>;
    }>("../../scripts/run-with-warning-policy.mjs");

    class FakeChild extends EventEmitter {
      stdout: EventEmitter | undefined = new EventEmitter();
      stderr: EventEmitter | undefined = new EventEmitter();
      pid: number | undefined;
      kill = vi.fn();
    }
    const output = () => {
      const chunks: string[] = [];
      return {
        chunks,
        stream: { write: (chunk: unknown) => chunks.push(String(chunk)) },
      };
    };
    const runFake = (child: FakeChild, runtime: Record<string, unknown> = {}) => {
      const stdout = output();
      const stderr = output();
      const spawn = vi.fn(() => child);
      const result = runWithWarningPolicy(["--", "fake-command", "argument"], {
        stdout: stdout.stream,
        stderr: stderr.stream,
        spawn,
        ...runtime,
      });
      return { child, result, spawn, stderr, stdout };
    };

    const cleanChild = new FakeChild();
    const clean = runFake(cleanChild, { env: { EXACT_ENV: "yes" }, platform: "win32" });
    cleanChild.stdout!.emit("data", "ordinary stdout\n");
    cleanChild.emit("close", 0);
    await expect(clean.result).resolves.toBe(0);
    expect(clean.spawn).toHaveBeenCalledWith("fake-command", ["argument"], {
      detached: false,
      env: { EXACT_ENV: "yes" },
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(clean.stdout.chunks).toEqual(["ordinary stdout\n"]);
    expect(clean.stderr.chunks).toEqual([]);

    const stderrChild = new FakeChild();
    const stderrRun = runFake(stderrChild, { platform: "win32" });
    stderrChild.stderr!.emit("data", "ordinary stderr diagnostic\n");
    stderrChild.emit("close", 0);
    await expect(stderrRun.result).resolves.toBe(1);
    expect(stderrChild.kill).toHaveBeenCalledWith("SIGTERM");

    const signaledChild = new FakeChild();
    signaledChild.pid = 777;
    const signalSource = new EventEmitter();
    const signalKill = vi.fn();
    const signaled = runFake(signaledChild, {
      killProcess: signalKill,
      platform: "darwin",
      signalSource,
    });
    signalSource.emit("SIGINT");
    signalSource.emit("SIGTERM");
    expect(signalKill).toHaveBeenCalledWith(-777, "SIGINT");
    expect(signalKill).toHaveBeenCalledOnce();
    signaledChild.emit("close", null, "SIGINT");
    await expect(signaled.result).resolves.toBe(130);
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);

    const groupChild = new FakeChild();
    groupChild.pid = 321;
    const killProcess = vi.fn();
    const group = runFake(groupChild, { killProcess, platform: "darwin" });
    groupChild.stderr!.emit("data", "WARN fail-fast diagnostic\n");
    groupChild.stdout!.emit("data", "WARN ignored after detection\n");
    groupChild.emit("close", 0);
    await expect(group.result).resolves.toBe(1);
    expect(killProcess).toHaveBeenCalledWith(-321, "SIGTERM");
    expect(groupChild.kill).not.toHaveBeenCalled();

    const fallbackChild = new FakeChild();
    fallbackChild.pid = 654;
    const fallback = runFake(fallbackChild, {
      killProcess: () => {
        throw new Error("already exited");
      },
      platform: "darwin",
    });
    fallbackChild.stderr!.emit("data", "Warning: fallback termination\n");
    fallbackChild.emit("close", 0);
    await expect(fallback.result).resolves.toBe(1);
    expect(fallbackChild.kill).toHaveBeenCalledWith("SIGTERM");

    const windowsChild = new FakeChild();
    const windows = runFake(windowsChild, { platform: "win32" });
    windowsChild.stderr!.emit("data", "Warning: windows termination\n");
    windowsChild.emit("close", 0);
    await expect(windows.result).resolves.toBe(1);
    expect(windowsChild.kill).toHaveBeenCalledWith("SIGTERM");

    const unterminatedChild = new FakeChild();
    const unterminated = runFake(unterminatedChild);
    unterminatedChild.stdout!.emit("data", "Warning: unterminated diagnostic");
    unterminatedChild.emit("close", 0);
    await expect(unterminated.result).resolves.toBe(1);
    expect(unterminatedChild.kill).not.toHaveBeenCalled();

    const noKillChild = new FakeChild();
    noKillChild.kill = undefined as unknown as FakeChild["kill"];
    const noKill = runFake(noKillChild, { platform: "darwin" });
    noKillChild.stdout!.emit("data", "Warning: no kill handle\n");
    noKillChild.emit("close", 0);
    await expect(noKill.result).resolves.toBe(1);

    for (const [code, expected] of [[7, 7], [null, 1]] as const) {
      const failedChild = new FakeChild();
      const failed = runFake(failedChild);
      failedChild.emit("close", code);
      await expect(failed.result).resolves.toBe(expected);
    }

    const erroredChild = new FakeChild();
    erroredChild.stdout = undefined;
    erroredChild.stderr = undefined;
    const errored = runFake(erroredChild);
    erroredChild.emit("error", { message: "spawn failed" });
    erroredChild.emit("close", 0);
    await expect(errored.result).resolves.toBe(1);
    expect(errored.stderr.chunks.join("")).toContain("spawn failed");
  });

  it("covers direct CLI invocation matching without mutating the test exit status", async () => {
    const { runCliIfInvoked } = await vi.importActual<{
      runCliIfInvoked(
        moduleUrl: string,
        argv: string[],
        runtime?: Record<string, unknown>,
      ): Promise<boolean>;
    }>("../../scripts/run-with-warning-policy.mjs");
    const virtualPath = "scripts/virtual-warning-wrapper.mjs";
    const moduleUrl = pathToFileURL(resolve(virtualPath)).href;
    const exitCodes: number[] = [];

    await expect(runCliIfInvoked(moduleUrl, ["node"])).resolves.toBe(false);
    await expect(runCliIfInvoked(moduleUrl, ["node", "scripts/not-the-wrapper.mjs"]))
      .resolves.toBe(false);
    await expect(runCliIfInvoked(
      moduleUrl,
      ["node", virtualPath],
      {
        setExitCode: (status: number) => exitCodes.push(status),
        stderr: { write: () => undefined },
      },
    )).resolves.toBe(true);
    expect(exitCodes).toEqual([2]);

    const previousExitCode = process.exitCode;
    try {
      await expect(runCliIfInvoked(
        moduleUrl,
        ["node", virtualPath],
        { stderr: { write: () => undefined } },
      )).resolves.toBe(true);
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it.each([
    "console.error('Warning: node diagnostic')",
    "console.error('(node:123) ExperimentalWarning: sqlite diagnostic')",
    "console.error('WARN command diagnostic')",
    "console.error('  DeprecationWarning: direct diagnostic')",
    "console.error('  WARN  deprecated pnpm option')",
    "console.error('  ⚠️ Warnings for the current datasource:')",
    "console.error('  ▲ [WARNING] wrangler diagnostic')",
    "console.error('npm warn deprecated package')",
    "console.error('warning TS6385: declaration is deprecated')",
    "console.error('▲ [WARNING] build diagnostic')",
    "console.error('(!) circular dependency')",
    "console.log('warning: stdout diagnostic')",
  ])("fails a successful child for an actual diagnostic: %s", (code) => {
    const result = runWrapped(code);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("warning-policy: rejected diagnostic output");
  });

  it("allows ordinary prose that contains no diagnostic token", () => {
    const result = runWrapped(
      "console.log('test name: output policy'); console.log('Clean diagnostics')",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test name: output policy");
    expect(result.stdout).toContain("Clean diagnostics");
  });

  it("rejects otherwise unmarked stderr through the shared channel policy", () => {
    const result = runWrapped("console.error('ordinary stderr diagnostic')");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ordinary stderr diagnostic");
    expect(result.stderr).toContain("warning-policy: rejected diagnostic output");
  });

  it("allows a non-token word that merely starts with warning", () => {
    const message = "warningly successful";
    const result = runWrapped(`console.log(${JSON.stringify(message)})`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(message);
    expect(result.stderr).not.toContain("warning-policy: rejected diagnostic output");
  });

  it("terminates a long-running child as soon as a diagnostic is emitted", () => {
    const result = spawnSync(
      process.execPath,
      [wrapper, "--", process.execPath, "-e", "console.error('WARN server diagnostic'); setInterval(() => {}, 60_000)"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5_000,
      },
    );

    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("warning-policy: rejected diagnostic output");
  });

  it("forwards SIGTERM to the detached child group and waits for closure", async () => {
    const tempDir = mkdtempSync(`${tmpdir()}/spoonjoy-warning-signal-`);
    const pidPath = `${tempDir}/child.pid`;
    const signalPath = `${tempDir}/child.signal`;
    const childCode = [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid))`,
      `process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(signalPath)}, 'SIGTERM'); process.exit(0) })`,
      "setInterval(() => {}, 60_000)",
    ].join(";");
    const wrapped = spawn(
      process.execPath,
      [wrapper, "--", process.execPath, "-e", childCode],
      { cwd: process.cwd(), stdio: "ignore" },
    );

    let childPid: number | undefined;
    try {
      await vi.waitFor(() => {
        expect(existsSync(pidPath)).toBe(true);
      }, { timeout: 2_000, interval: 20 });
      childPid = Number(readFileSync(pidPath, "utf8"));
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        wrapped.once("close", (code, signal) => resolve({ code, signal }));
      });
      wrapped.kill("SIGTERM");
      const result = await closed;

      expect(result).toEqual({ code: 143, signal: null });
      expect(readFileSync(signalPath, "utf8")).toBe("SIGTERM");
    } finally {
      wrapped.kill("SIGKILL");
      if (childPid) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects stderr diagnostics even when the child also exits non-zero", () => {
    const result = runWrapped("console.error('ordinary failure'); process.exit(7)");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ordinary failure");
    expect(result.stderr).toContain("warning-policy: rejected diagnostic output");
  });

  it("requires an explicit command boundary", () => {
    const result = spawnSync(process.execPath, [wrapper, process.execPath, "-e", "0"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: run-with-warning-policy -- <command> [args...]");
  });
});

describe("in-process warning policy", () => {
  it("ignores disabled and tolerated clean-command workflow decoys", () => {
    const workflow = `
jobs:
  disabled-expression:
    if: \${{ false }} # disabled
    steps:
      - run: pnpm run verify:clean:typecheck
  disabled-bare:
    if: false
    steps:
      - run: pnpm run verify:clean:typecheck
  tolerated-expression:
    continue-on-error: \${{ true }} # tolerated
    steps:
      - run: pnpm run verify:clean:build
  tolerated-bare:
    continue-on-error: true
    steps:
      - run: pnpm run verify:clean:build
  enabled:
    steps:
      - if: false # disabled
        run: pnpm run verify:clean:migrations
      - if: \${{ false }}
        run: pnpm run verify:clean:migrations
      - continue-on-error: true # tolerated
        run: pnpm run verify:clean:generated-contract
      - continue-on-error: \${{ true }}
        run: pnpm run verify:clean:generated-contract
      - run: pnpm run verify:clean:typecheck
`;

    expect(workflowRunCommands(workflow)).toEqual([
      "pnpm run verify:clean:typecheck",
    ]);
  });

  it.each([
    [
      "app console.warn",
      "app",
      "console.warn: app warning sentinel",
      'test("sentinel", () => console.warn("app warning sentinel"));',
    ],
    [
      "app console.error",
      "app",
      "console.error: app error sentinel",
      'test("sentinel", () => console.error("app error sentinel"));',
    ],
    [
      "app process warning",
      "app",
      "process warning: Warning: process warning sentinel",
      'test("sentinel", async () => { process.emitWarning("process warning sentinel"); await new Promise((resolve) => setTimeout(resolve, 0)); });',
    ],
    [
      "Workers console.warn",
      "workers",
      "console.warn: Workers warning sentinel",
      'test("sentinel", () => console.warn("Workers warning sentinel"));',
    ],
    [
      "Workers console.error",
      "workers",
      "console.error: Workers error sentinel",
      'test("sentinel", () => console.error("Workers error sentinel"));',
    ],
    [
      "Workers process warning",
      "workers",
      "process warning: Warning: Workers process warning sentinel",
      'test("sentinel", async () => { process.emitWarning("Workers process warning sentinel"); await new Promise((resolve) => setTimeout(resolve, 0)); });',
    ],
  ] as const)("rejects an actual %s through its installed hook", (
    _label,
    lane,
    expectedDiagnostic,
    body,
  ) => {
    const result = runVitestSentinel(lane, body);

    expect(result.status).toBe(1);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("Unexpected warning/error output");
    expect(output).toContain(expectedDiagnostic);
  }, 15_000);

  it.each(["app", "workers"] as const)(
    "rejects top-level, beforeAll, and afterAll diagnostics in the %s lane",
    (lane) => {
      const sentinels = [
        'console.error("top-level lifecycle diagnostic"); test("sentinel", () => {});',
        'beforeAll(() => console.error("beforeAll lifecycle diagnostic")); test("sentinel", () => {});',
        'test("sentinel", () => {}); afterAll(() => console.error("afterAll lifecycle diagnostic"));',
      ];

      for (const body of sentinels) {
        const result = runVitestSentinel(lane, body);
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain("Unexpected warning/error output");
      }
    },
    45_000,
  );

  it.each(["app", "workers"] as const)(
    "permits an exactly owned console.error through the installed %s hook",
    (lane) => {
      const result = runVitestSentinel(
        lane,
        'test("sentinel", () => { expectConsoleError("owned"); console.error("owned"); });',
      );

      expect(result.status).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain("Unexpected warning/error output");
    },
    15_000,
  );

  it.each(["app", "workers"] as const)(
    "rejects missing, duplicate, and expected-plus-unexpected diagnostics in the %s lane",
    (lane) => {
      const sentinels = [
        'test("sentinel", () => { expectConsoleError("missing"); });',
        'test("sentinel", () => { expectConsoleError("once"); console.error("once"); console.error("once"); });',
        'test("sentinel", () => { expectConsoleError("expected"); console.error("expected"); console.error("unexpected"); });',
      ];

      for (const body of sentinels) {
        const result = runVitestSentinel(lane, body);
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain("Unexpected warning/error output");
      }
    },
    45_000,
  );

  it("rejects unowned console warnings/errors and process warnings but permits owned output", async () => {
    const { createWarningCollector } = await vi.importActual<
      typeof import("../warning-policy")
    >("../warning-policy");

    const unowned = createWarningCollector();
    unowned.captureConsole("warn", ["warning one"]);
    unowned.captureConsole("error", ["error two"]);
    unowned.captureProcessWarning(new Error("process three"));
    expect(() => unowned.assertClean()).toThrowError(
      /console\.warn: warning one[\s\S]*console\.error: error two[\s\S]*process warning: Error: process three/,
    );

    const owned = createWarningCollector();
    owned.expectConsole("error", ["expected owned output"]);
    owned.captureConsole("error", ["expected owned output"]);
    owned.expectConsole("error", ["structured output", { requestId: "req_owned", status: 500 }]);
    owned.captureConsole("error", ["structured output", { requestId: "req_owned", status: 500 }]);
    expect(() => owned.assertClean()).not.toThrow();

    const missing = createWarningCollector();
    missing.expectConsole("error", ["required output"]);
    expect(() => missing.assertClean()).toThrowError(/expected console\.error not observed: required output/);

    const formatting = createWarningCollector();
    const stacklessError = new Error("stackless");
    stacklessError.stack = undefined;
    const circular: { self?: unknown } = {};
    circular.self = circular;
    formatting.captureConsole("warn", [undefined, { answer: 42 }, stacklessError, circular]);
    expect(() => formatting.assertClean()).toThrowError(
      /console\.warn: undefined {"answer":42} Error: stackless \[object Object\]/,
    );
  });

  it("forwards only unowned console diagnostics through a standalone wrapper", async () => {
    const warningPolicy = await vi.importActual<typeof import("../warning-policy")>(
      "../warning-policy",
    ) as typeof import("../warning-policy") & {
      createConsoleDiagnosticWrapper?: (
        method: "warn" | "error",
        capture: (method: "warn" | "error", args: unknown[]) => boolean,
        original: (...args: unknown[]) => void,
      ) => (...args: unknown[]) => void;
    };
    const capture = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const original = vi.fn();

    expect(typeof warningPolicy.createConsoleDiagnosticWrapper).toBe("function");
    const wrapper = warningPolicy.createConsoleDiagnosticWrapper!("warn", capture, original);
    wrapper("forwarded", { source: "test" });
    wrapper("owned");

    expect(capture).toHaveBeenNthCalledWith(1, "warn", ["forwarded", { source: "test" }]);
    expect(capture).toHaveBeenNthCalledWith(2, "warn", ["owned"]);
    expect(original).toHaveBeenCalledOnce();
    expect(original).toHaveBeenCalledWith("forwarded", { source: "test" });
  });

  it("clears captured diagnostics between tests", async () => {
    const { createWarningCollector } = await vi.importActual<
      typeof import("../warning-policy")
    >("../warning-policy");
    const collector = createWarningCollector();

    collector.captureConsole("warn", ["first test"]);
    expect(() => collector.assertClean()).toThrowError("Unexpected warning/error output");
    collector.reset();
    expect(() => collector.assertClean()).not.toThrow();
  });

  it("uses a stable SQLite test driver without process-warning suppression", () => {
    const warningPolicySource = readFileSync("test/warning-policy.ts", "utf8");
    const sqliteTestSources = filesBelow("test/scripts")
      .filter((file) => file.endsWith(".test.ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      devDependencies?: Record<string, string>;
    };

    expect(warningPolicySource).not.toContain("installNodeSqliteWarningException");
    expect(warningPolicySource).not.toContain("processLike.emitWarning =");
    expect(sqliteTestSources).not.toContain('from "node:sqlite"');
    expect(sqliteTestSources).not.toContain('nodeRequire("node:sqlite")');
    expect(packageJson.devDependencies?.["better-sqlite3"]).toBeTruthy();
  });

  it("runs exact owned diagnostics through the installed global wrappers", async () => {
    const warningPolicy = await vi.importActual<typeof import("../warning-policy")>(
      "../warning-policy",
    );

    warningPolicy.expectConsoleWarning("owned global warning", { lane: "app" });
    console.warn("owned global warning", { lane: "app" });
    warningPolicy.expectConsoleError("owned global error");
    console.error("owned global error");
  });

  it.each(["app", "workers"] as const)(
    "rejects an unrelated ExperimentalWarning in the %s lane",
    (lane) => {
      const result = runVitestSentinel(
        lane,
        'test("sentinel", async () => { process.emitWarning("unrelated experimental sentinel", "ExperimentalWarning"); await new Promise((resolve) => setTimeout(resolve, 0)); });',
      );

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "process warning: ExperimentalWarning: unrelated experimental sentinel",
      );
    },
    15_000,
  );

  it("installs the same fail-after-test gate in app and Workers Vitest", () => {
    const appSetup = readFileSync("test/setup.ts", "utf8");
    const workersSetup = readFileSync("vitest.workers.setup.ts", "utf8");
    const warningGate = readFileSync("test/warning-policy.ts", "utf8");

    expect(appSetup).toContain('import "./warning-policy"');
    expect(workersSetup).toContain('import "./test/warning-policy"');
    expect(warningGate).not.toContain("beforeEach");
    expect(warningGate).toContain("afterEach");
    expect(warningGate).toContain("afterAll");
    expect(warningGate).toContain("console.warn");
    expect(warningGate).toContain("console.error");
    expect(warningGate).toContain('process.on("warning"');
    expect(warningGate).toContain("Unexpected warning/error output");
    expect(appSetup).not.toContain("removeAllListeners('warning')");
    expect(appSetup).not.toContain("message.includes('not wrapped in act(')");
  });

  it("prohibits test-local console warning/error overrides", () => {
    const offenders = filesBelow("test")
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .filter((path) => ![
        "test/config/warning-policy.test.ts",
        "test/warning-policy.ts",
      ].includes(path))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return /spyOn\(console,\s*["'](?:warn|error)["']\)|console\.(?:warn|error)\s*=/.test(source);
      });

    expect(offenders).toEqual([]);
  });

  it("routes clean verification commands through the warning wrapper", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const commands = workflowRunCommands(workflow);

    expect(packageJson.scripts?.["verify:clean:typecheck"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run typecheck",
    );
    expect(packageJson.scripts?.["verify:clean:build"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run build",
    );
    expect(packageJson.scripts?.["verify:clean:migrations"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm exec wrangler d1 migrations apply DB --local",
    );
    expect(packageJson.scripts?.["verify:clean:migrations:qa"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm exec wrangler d1 migrations apply DB --local --env qa",
    );
    expect(packageJson.scripts?.["verify:clean:generated-contract"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- sh -c 'pnpm run api:playground:generate && git diff --exit-code -- app/lib/generated/api-v1-playground.ts'",
    );
    expect(packageJson.scripts?.["verify:clean:test:coverage"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run test:coverage",
    );
    expect(packageJson.scripts?.["verify:clean:test:workers:coverage"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run test:workers:coverage",
    );
    expect(packageJson.scripts?.["verify:clean:test:e2e"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run test:e2e",
    );
    expect(packageJson.scripts?.test).not.toContain("--disable-warning=ExperimentalWarning");
    expect(packageJson.scripts?.["test:ui"]).not.toContain("--disable-warning=ExperimentalWarning");
    expect(packageJson.scripts?.["test:coverage"]).not.toContain(
      "--disable-warning=ExperimentalWarning",
    );
    expect(commands).toContain("pnpm run verify:clean:typecheck");
    expect(commands).toContain("pnpm run verify:clean:build");
    expect(commands).toContain("pnpm run verify:clean:migrations");
    expect(commands).toContain("pnpm run verify:clean:migrations:qa");
    expect(commands).toContain("pnpm run verify:clean:generated-contract");
    expect(commands).toContain("pnpm run verify:clean:test:coverage");
    expect(commands).toContain("pnpm run verify:clean:test:workers:coverage");
    expect(commands).toContain("pnpm run verify:clean:test:e2e");
    expect(commands).not.toContain("pnpm run test:coverage");
    expect(commands).not.toContain("pnpm run test:workers:coverage");
    expect(commands).not.toContain("pnpm test:e2e");
  });

  it("includes every production-like warning module in full coverage", () => {
    const config = readFileSync("vitest.config.ts", "utf8");

    expect(config).toContain('"app/entry.server.tsx"');
    expect(config).toContain('"scripts/run-with-warning-policy.mjs"');
    expect(config).toContain('"test/warning-policy.ts"');
    expect(config).toContain('"e2e/warning-policy.ts"');
    expect(config).toContain('"e2e/fixtures.ts"');
    expect(config).toContain('"scripts/e2e-run-cleanup.mjs"');
    expect(config).toContain('"e2e/support/global-teardown.ts"');
    expect(config).toContain('"e2e/support/start-ephemeral-wrangler.mjs"');
    expect(config).not.toContain('exclude: ["node_modules/**", "test/**"');
  });
});

describe("Playwright warning policy", () => {
  it("runs browser tests against a deterministic production Worker build", () => {
    const config = readFileSync("playwright.config.ts", "utf8");

    expect(config).toContain(
      "pnpm run verify:clean:build && node e2e/support/start-ephemeral-wrangler.mjs --run-id ${e2eRunId}",
    );
    expect(config).not.toMatch(/command:\s*process\.env\.CI\s*\?\s*['\"]pnpm dev/);
    expect(config).toContain("timeout: 180_000");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("http://localhost:5197");
    expect(config).toContain("reporter: [['html', { open: 'never' }]]");
  });

  it("wires context/page events into browser diagnostic enforcement", async () => {
    const {
      createBrowserDiagnosticCollector,
      observeBrowserContext,
    } = await vi.importActual<typeof import("../../e2e/warning-policy")>(
      "../../e2e/warning-policy",
    );

    class FakeEmitter {
      listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      }
      emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) listener(...args);
      }
    }

    const page = new FakeEmitter();
    const context = new FakeEmitter() as FakeEmitter & { pages(): FakeEmitter[] };
    context.pages = () => [page];
    const collector = createBrowserDiagnosticCollector();
    observeBrowserContext(context, collector);

    page.emit("console", {
      type: () => "warning",
      text: () => "wired warning",
      location: () => ({ url: "http://localhost/wired.ts", lineNumber: 7, columnNumber: 9 }),
    });
    page.emit("console", {
      type: () => "error",
      text: () => "location defaults",
      location: () => ({ url: "http://localhost/defaults.ts" }),
    });
    page.emit("pageerror", new Error("wired page error"));
    expect(() => collector.assertClean()).toThrowError(
      /console\.warning: wired warning \(http:\/\/localhost\/wired\.ts:7:9\)[\s\S]*pageerror: Error: wired page error/,
    );

    const laterPage = new FakeEmitter();
    context.emit("page", page);
    context.emit("page", laterPage);
    laterPage.emit("console", { type: () => "error", text: () => "later error" });
    laterPage.emit("pageerror", new Error("later page error"));
    expect(() => collector.assertClean()).toThrowError(
      /console\.error: later error[\s\S]*pageerror: Error: later page error/,
    );
  });

  it("rejects browser warning/error/page-error diagnostics", async () => {
    const { createBrowserDiagnosticCollector } = await vi.importActual<
      typeof import("../../e2e/warning-policy")
    >("../../e2e/warning-policy");
    const collector = createBrowserDiagnosticCollector();

    collector.captureConsole("log", "ordinary log");
    collector.captureConsole("warning", "browser warning");
    collector.captureConsole("error", "browser error");
    collector.capturePageError(new Error("page exploded"));
    const blankPageError = new Error("");
    blankPageError.stack = "";
    collector.capturePageError(blankPageError);
    expect(() => collector.assertClean()).toThrowError(
      /console\.warning: browser warning[\s\S]*console\.error: browser error[\s\S]*pageerror: Error: page exploded[\s\S]*pageerror: Error: \(no message\)/,
    );
  });

  it("requires explicitly owned browser diagnostics to occur exactly once", async () => {
    const { createBrowserDiagnosticCollector } = await vi.importActual<
      typeof import("../../e2e/warning-policy")
    >("../../e2e/warning-policy");
    const owned = createBrowserDiagnosticCollector();
    owned.expectDiagnostic(/status of 401 .*login\.data/);
    owned.captureConsole(
      "error",
      "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
      { url: "http://localhost:5173/login.data", lineNumber: 0, columnNumber: 0 },
    );
    expect(() => owned.assertClean()).not.toThrow();

    const missing = createBrowserDiagnosticCollector();
    missing.expectDiagnostic(/required diagnostic/);
    expect(() => missing.assertClean()).toThrowError(
      /expected diagnostic not observed: \/required diagnostic\//,
    );

    const duplicate = createBrowserDiagnosticCollector();
    duplicate.expectDiagnostic(/owned once/);
    duplicate.captureConsole("error", "owned once");
    duplicate.captureConsole("error", "owned once");
    expect(() => duplicate.assertClean()).toThrowError(/console\.error: owned once/);
  });

  it("provides an executable automatic context-wide diagnostic fixture", async () => {
    const fixture = readFileSync("e2e/fixtures.ts", "utf8");
    const exported = await vi.importActual<typeof import("../../e2e/fixtures")>(
      "../../e2e/fixtures",
    );

    class FakeEmitter {
      listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      }
      emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) listener(...args);
      }
    }

    const page = new FakeEmitter();
    const fakeContext = new FakeEmitter() as FakeEmitter & { pages(): FakeEmitter[] };
    fakeContext.pages = () => [page];
    const runFixture = exported.runBrowserDiagnosticFixture as (
      context: typeof fakeContext,
      use: (diagnostics: { expect(pattern: RegExp): void }) => Promise<void>,
    ) => Promise<void>;

    expect(hasAutomaticDiagnosticFixture(fixture)).toBe(true);
    expect(typeof exported.test).toBe("function");
    expect(typeof exported.expect).toBe("function");
    await expect(runFixture(fakeContext, async () => {})).resolves.toBeUndefined();
    await expect(runFixture(fakeContext, async () => {
      page.emit("console", { type: () => "warning", text: () => "fixture warning" });
    })).rejects.toThrowError(
      /Browser emitted warning\/error diagnostics[\s\S]*console\.warning: fixture warning/,
    );
    await expect(runFixture(fakeContext, async (diagnostics) => {
      diagnostics.expect(/fixture-owned warning/);
      page.emit("console", { type: () => "warning", text: () => "fixture-owned warning" });
    })).resolves.toBeUndefined();

    const automaticContext = new FakeEmitter() as FakeEmitter & { pages(): FakeEmitter[] };
    automaticContext.pages = () => [];
    const automaticFixture = (
      playwrightMockState.extension as {
        warningDiagnostics: [
          (
            fixtures: { context: typeof automaticContext },
            use: (diagnostics: { expect(pattern: RegExp): void }) => Promise<void>,
          ) => Promise<void>,
          { auto: true },
        ];
      }
    ).warningDiagnostics[0];
    await expect(automaticFixture({ context: automaticContext }, async () => {}))
      .resolves.toBeUndefined();
  });

  it("makes every Playwright spec and setup use the local fixture", () => {
    const testFiles = filesBelow("e2e").filter((path) => /\.(spec|setup)\.ts$/.test(path));
    const offenders = testFiles
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        const fixtureRelativePath = relative(dirname(path), "e2e/fixtures");
        const fixtureImport = fixtureRelativePath.startsWith(".")
          ? fixtureRelativePath
          : `./${fixtureRelativePath}`;
        const fixtureRuntimeNames = runtimeImportNames(source, fixtureImport);
        const officialRuntimeNames = runtimeImportNames(source, "@playwright/test");
        const importsTestApi = [...fixtureRuntimeNames, ...officialRuntimeNames]
          .some((name) => name === "test" || name === "expect");
        const importsFixtureTestApi = fixtureRuntimeNames
          .some((name) => name === "test" || name === "expect");
        const unsafeOfficialImport = officialRuntimeNames
          .some((name) => ["test", "expect", "default", "*"].includes(name)) ||
          hasRuntimeModuleAcquisition(source, "@playwright/test");
        return unsafeOfficialImport || (importsTestApi && !importsFixtureTestApi);
      })
      .map((path) => relative(process.cwd(), path))
      .sort();

    expect(offenders).toEqual([]);
  });
});
