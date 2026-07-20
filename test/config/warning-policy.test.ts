import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const wrapper = "scripts/run-with-warning-policy.mjs";

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
  writeFileSync(path, `import { test, vi } from "vitest";\n${body}\n`);
  try {
    return spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
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

describe("warning command policy", () => {
  it.each([
    "console.error('Warning: node diagnostic')",
    "console.error('(node:123) ExperimentalWarning: sqlite diagnostic')",
    "console.error('WARN command diagnostic')",
    "console.error('▲ [WARNING] build diagnostic')",
    "console.log('warning: stdout diagnostic')",
  ])("fails a successful child for an actual diagnostic: %s", (code) => {
    const result = runWrapped(code);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("warning-policy: rejected diagnostic output");
  });

  it("allows ordinary prose containing the word warning", () => {
    const result = runWrapped(
      "console.log('test name: warning policy'); console.log('No warnings were emitted')",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test name: warning policy");
    expect(result.stdout).toContain("No warnings were emitted");
  });

  it("preserves a child failure without replacing its exit code", () => {
    const result = runWrapped("console.error('ordinary failure'); process.exit(7)");

    expect(result.status).toBe(7);
    expect(result.stderr).toContain("ordinary failure");
    expect(result.stderr).not.toContain("warning-policy: rejected diagnostic output");
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
  });

  it.each(["app", "workers"] as const)(
    "permits an exactly owned console.error through the installed %s hook",
    (lane) => {
      const result = runVitestSentinel(
        lane,
        'test("sentinel", () => { const owned = vi.spyOn(console, "error").mockImplementation(() => {}); console.error("owned"); owned.mockRestore(); });',
      );

      expect(result.status).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain("Unexpected warning/error output");
    },
  );

  it("rejects unowned console warnings/errors and process warnings but permits owned output", async () => {
    const { createWarningCollector } = await import("../warning-policy");

    const unowned = createWarningCollector();
    unowned.captureConsole("warn", ["warning one"], false);
    unowned.captureConsole("error", ["error two"], false);
    unowned.captureProcessWarning(new Error("process three"));
    expect(() => unowned.assertClean()).toThrowError(
      /console\.warn: warning one[\s\S]*console\.error: error two[\s\S]*process warning: Error: process three/,
    );

    const owned = createWarningCollector();
    owned.captureConsole("error", ["expected owned output"], true);
    expect(() => owned.assertClean()).not.toThrow();
  });

  it("clears captured diagnostics between tests", async () => {
    const { createWarningCollector } = await import("../warning-policy");
    const collector = createWarningCollector();

    collector.captureConsole("warn", ["first test"], false);
    expect(() => collector.assertClean()).toThrowError("Unexpected warning/error output");
    collector.reset();
    expect(() => collector.assertClean()).not.toThrow();
  });

  it("installs the same fail-after-test gate in app and Workers Vitest", () => {
    const appSetup = readFileSync("test/setup.ts", "utf8");
    const workersSetup = readFileSync("vitest.workers.setup.ts", "utf8");
    const warningGate = readFileSync("test/warning-policy.ts", "utf8");

    expect(appSetup).toContain('import "./warning-policy"');
    expect(workersSetup).toContain('import "./test/warning-policy"');
    expect(warningGate).toContain("beforeEach");
    expect(warningGate).toContain("afterEach");
    expect(warningGate).toContain("console.warn");
    expect(warningGate).toContain("console.error");
    expect(warningGate).toContain('process.on("warning"');
    expect(warningGate).toContain("Unexpected warning/error output");
    expect(appSetup).not.toContain("removeAllListeners('warning')");
    expect(appSetup).not.toContain("message.includes('not wrapped in act(')");
  });

  it("routes clean verification commands through the warning wrapper", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(packageJson.scripts?.["verify:clean:typecheck"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run typecheck",
    );
    expect(packageJson.scripts?.["verify:clean:build"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run build",
    );
    expect(packageJson.scripts?.["verify:clean:migrations"]).toContain(
      "run-with-warning-policy.mjs",
    );
    expect(workflow).toContain("pnpm run verify:clean:typecheck");
    expect(workflow).toContain("pnpm run verify:clean:build");
    expect(workflow).toContain("pnpm run verify:clean:migrations");
  });
});

describe("Playwright warning policy", () => {
  it("wires context/page events into browser diagnostic enforcement", async () => {
    const {
      createBrowserDiagnosticCollector,
      observeBrowserContext,
    } = await import("../../e2e/warning-policy");

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

    page.emit("console", { type: () => "warning", text: () => "wired warning" });
    page.emit("pageerror", new Error("wired page error"));
    expect(() => collector.assertClean()).toThrowError(
      /console\.warning: wired warning[\s\S]*pageerror: Error: wired page error/,
    );

    const laterPage = new FakeEmitter();
    context.emit("page", laterPage);
    laterPage.emit("console", { type: () => "error", text: () => "later error" });
    expect(() => collector.assertClean()).toThrowError(/console\.error: later error/);
  });

  it("rejects browser warning/error/page-error diagnostics", async () => {
    const { createBrowserDiagnosticCollector } = await import("../../e2e/warning-policy");
    const collector = createBrowserDiagnosticCollector();

    collector.captureConsole("log", "ordinary log");
    collector.captureConsole("warning", "browser warning");
    collector.captureConsole("error", "browser error");
    collector.capturePageError(new Error("page exploded"));
    expect(() => collector.assertClean()).toThrowError(
      /console\.warning: browser warning[\s\S]*console\.error: browser error[\s\S]*pageerror: Error: page exploded/,
    );
  });

  it("provides an automatic context-wide console and page-error fixture", () => {
    const fixture = readFileSync("e2e/fixtures.ts", "utf8");

    expect(fixture).toContain("base.extend");
    expect(fixture).toContain("auto: true");
    expect(fixture).toContain("observeBrowserContext");
    expect(fixture).toContain("Browser emitted warning/error diagnostics");
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
        return !fixtureRuntimeNames.some((name) => name === "test" || name === "expect") ||
          officialRuntimeNames.length > 0;
      })
      .map((path) => relative(process.cwd(), path))
      .sort();

    expect(offenders).toEqual([]);
  });
});
