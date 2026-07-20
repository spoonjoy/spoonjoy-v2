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
    if (/^    if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/mi.test(job)) return [];
    const stepsStart = job.search(/^    steps:\s*$/m);
    if (stepsStart === -1) return [];
    const stepsRemainder = job.slice(stepsStart).split("\n").slice(1).join("\n");
    const nextJobProperty = stepsRemainder.search(/^    [a-z][a-z0-9-]*:/m);
    const steps = nextJobProperty === -1
      ? stepsRemainder
      : stepsRemainder.slice(0, nextJobProperty);
    return steps.split(/(?=^      - )/m).flatMap((step) => {
      if (/^        if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/mi.test(step)) return [];
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
  it.each([
    "console.error('Warning: node diagnostic')",
    "console.error('(node:123) ExperimentalWarning: sqlite diagnostic')",
    "console.error('WARN command diagnostic')",
    "console.error('▲ [WARNING] build diagnostic')",
    "console.error('(!) circular dependency')",
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
    const commands = workflowRunCommands(workflow);

    expect(packageJson.scripts?.["verify:clean:typecheck"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run typecheck",
    );
    expect(packageJson.scripts?.["verify:clean:build"]).toBe(
      "node scripts/run-with-warning-policy.mjs -- pnpm run build",
    );
    expect(packageJson.scripts?.["verify:clean:migrations"]).toContain(
      "run-with-warning-policy.mjs",
    );
    expect(packageJson.scripts?.["verify:clean:generated-contract"]).toContain(
      "run-with-warning-policy.mjs",
    );
    expect(commands).toContain("pnpm run verify:clean:typecheck");
    expect(commands).toContain("pnpm run verify:clean:build");
    expect(commands).toContain("pnpm run verify:clean:migrations");
    expect(commands).toContain("pnpm run verify:clean:generated-contract");
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
    laterPage.emit("pageerror", new Error("later page error"));
    expect(() => collector.assertClean()).toThrowError(
      /console\.error: later error[\s\S]*pageerror: Error: later page error/,
    );
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

  it("provides an executable automatic context-wide diagnostic fixture", async () => {
    const fixture = readFileSync("e2e/fixtures.ts", "utf8");
    const exported = await import("../../e2e/fixtures");

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
      use: () => Promise<void>,
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
