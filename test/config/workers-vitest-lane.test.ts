import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function workflowJob(source: string, name: string) {
  const jobsMarker = "\njobs:\n";
  const jobsStart = source.indexOf(jobsMarker);
  if (jobsStart === -1) return "";
  const jobsRemainder = source.slice(jobsStart + jobsMarker.length);
  const nextTopLevel = jobsRemainder.search(/\n[^\s#][^:]*:/);
  const jobs = nextTopLevel === -1 ? jobsRemainder : jobsRemainder.slice(0, nextTopLevel);
  const marker = `  ${name}:\n`;
  const start = jobs.indexOf(marker);
  if (start === -1) return "";
  const remainder = jobs.slice(start + marker.length);
  const nextJob = remainder.search(/\n  [a-z][a-z0-9-]*:\n/);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function runCommands(job: string) {
  if (/^    if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/mi.test(job) ||
    /^    continue-on-error:\s*true\s*$/mi.test(job)) return [];
  const stepsStart = job.search(/^    steps:\s*$/m);
  if (stepsStart === -1) return [];
  const stepsRemainder = job.slice(stepsStart).split("\n").slice(1).join("\n");
  const nextJobProperty = stepsRemainder.search(/^    [a-z][a-z0-9-]*:/m);
  const steps = nextJobProperty === -1
    ? stepsRemainder
    : stepsRemainder.slice(0, nextJobProperty);
  return steps.split(/(?=^      - )/m).flatMap((step) => {
    if (/^        if:\s*(?:false|\$\{\{\s*false\s*\}\})\s*$/mi.test(step) ||
      /^        continue-on-error:\s*true\s*$/mi.test(step)) return [];
    const firstLine = step.match(/^      - run:\s+([^#]+?)\s*$/m);
    const nested = step.match(/^        run:\s+([^#]+?)\s*$/m);
    const command = firstLine?.[1] ?? nested?.[1];
    return command ? [command] : [];
  });
}

function hasNamedImport(sourceFile: ts.SourceFile, moduleName: string, name: string) {
  return sourceFile.statements.some((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === moduleName &&
    statement.importClause?.namedBindings &&
    ts.isNamedImports(statement.importClause.namedBindings) &&
    statement.importClause.namedBindings.elements.some((element) =>
      !element.isTypeOnly &&
      (element.propertyName ?? element.name).text === name &&
      element.name.text === name));
}

function callsCloudflareTestPlugin(source: string) {
  const sourceFile = ts.createSourceFile(
    "vitest.workers.config.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const importsCloudflareTest = hasNamedImport(
    sourceFile,
    "@cloudflare/vitest-pool-workers",
    "cloudflareTest",
  );
  let pluginCallFound = false;

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === "plugins") ||
        (ts.isStringLiteral(node.name) && node.name.text === "plugins")) &&
      ts.isArrayLiteralExpression(node.initializer) &&
      node.initializer.elements.some((element) =>
        ts.isCallExpression(element) &&
        ts.isIdentifier(element.expression) &&
        element.expression.text === "cloudflareTest")) {
      pluginCallFound = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return importsCloudflareTest && pluginCallFound;
}

function property(object: ts.ObjectLiteralExpression, name: string) {
  return object.properties.find((candidate): candidate is ts.PropertyAssignment =>
    ts.isPropertyAssignment(candidate) &&
    ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
      (ts.isStringLiteral(candidate.name) && candidate.name.text === name)))?.initializer;
}

function workersConfigObject(source: string) {
  const sourceFile = ts.createSourceFile(
    "vitest.workers.config.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (!hasNamedImport(sourceFile, "vitest/config", "defineConfig")) return undefined;
  const exported = sourceFile.statements.find((statement): statement is ts.ExportAssignment =>
    ts.isExportAssignment(statement));
  if (!exported ||
    !ts.isCallExpression(exported.expression) ||
    !ts.isIdentifier(exported.expression.expression) ||
    exported.expression.expression.text !== "defineConfig" ||
    !ts.isObjectLiteralExpression(exported.expression.arguments[0])) {
    return undefined;
  }
  return exported.expression.arguments[0];
}

function cloudflareConfigPath(config: ts.ObjectLiteralExpression) {
  const plugins = property(config, "plugins");
  if (!plugins || !ts.isArrayLiteralExpression(plugins)) return undefined;
  const pluginCall = plugins.elements.find((element): element is ts.CallExpression =>
    ts.isCallExpression(element) &&
    ts.isIdentifier(element.expression) &&
    element.expression.text === "cloudflareTest");
  const options = pluginCall?.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const wrangler = property(options, "wrangler");
  if (!wrangler || !ts.isObjectLiteralExpression(wrangler)) return undefined;
  return literalValue(property(wrangler, "configPath"));
}

function literalValue(expression: ts.Expression | undefined) {
  if (!expression) return undefined;
  if (ts.isStringLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) =>
      ts.isStringLiteral(element) ? element.text : undefined);
  }
  return undefined;
}

describe("Workers Vitest lane", () => {
  it("ignores command decoys outside enabled job steps", () => {
    const workflow = `
coverage:
  steps:
    - run: pnpm run test:coverage
jobs:
  disabled-job:
    if: false
    steps:
      - run: pnpm run test:workers:coverage
  tolerated-job:
    continue-on-error: true
    steps:
      - run: pnpm run test:workers:coverage
  enabled-job:
    steps:
      - name: disabled step
        if: \${{ false }}
        run: pnpm run test:workers:coverage
      - name: tolerated failure
        continue-on-error: true
        run: pnpm run test:workers:coverage
      - name: real step
        run: pnpm run test:coverage
`;

    expect(runCommands(workflowJob(workflow, "disabled-job"))).toEqual([]);
    expect(runCommands(workflowJob(workflow, "tolerated-job"))).toEqual([]);
    expect(runCommands(workflowJob(workflow, "enabled-job"))).toEqual([
      "pnpm run test:coverage",
    ]);
  });

  it("pins one compatible Vitest and Workers pool toolchain", () => {
    const packageJson = readJson("package.json") as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    for (const dependency of [
      "vitest",
      "@vitest/browser-playwright",
      "@vitest/coverage-istanbul",
      "@vitest/coverage-v8",
      "@vitest/ui",
    ]) {
      expect(packageJson.devDependencies?.[dependency]).toBe("4.1.10");
    }
    expect(packageJson.devDependencies?.["@cloudflare/vitest-pool-workers"]).toBe("0.18.6");
    expect(packageJson.scripts?.["test:workers"]).toBe(
      "vitest run --config vitest.workers.config.ts --maxWorkers=1 --no-isolate",
    );
    expect(packageJson.scripts?.["test:workers:coverage"]).toBe(
      "vitest run --config vitest.workers.config.ts --maxWorkers=1 --no-isolate --coverage",
    );
  });

  it("uses the official pool with serialized shared storage and Istanbul thresholds", () => {
    const source = readFileSync("vitest.workers.config.ts", "utf8");
    const config = workersConfigObject(source);
    expect(config).toBeDefined();
    const testConfig = config && property(config, "test");
    expect(testConfig && ts.isObjectLiteralExpression(testConfig)).toBe(true);
    if (!testConfig || !ts.isObjectLiteralExpression(testConfig)) return;
    const coverage = property(testConfig, "coverage");
    expect(coverage && ts.isObjectLiteralExpression(coverage)).toBe(true);
    if (!coverage || !ts.isObjectLiteralExpression(coverage)) return;
    const thresholds = property(coverage, "thresholds");
    expect(thresholds && ts.isObjectLiteralExpression(thresholds)).toBe(true);
    if (!thresholds || !ts.isObjectLiteralExpression(thresholds)) return;

    expect(callsCloudflareTestPlugin(source)).toBe(true);
    expect(source).not.toContain("defineWorkersConfig");
    expect(config && cloudflareConfigPath(config)).toBe("./wrangler.workers-test.json");
    expect(literalValue(property(testConfig, "include"))).toEqual(["test/workers/**/*.test.ts"]);
    expect(literalValue(property(testConfig, "setupFiles"))).toEqual(["./vitest.workers.setup.ts"]);
    expect(literalValue(property(testConfig, "passWithNoTests"))).toBe(true);
    expect(literalValue(property(testConfig, "fileParallelism"))).toBe(false);
    expect(literalValue(property(testConfig, "maxWorkers"))).toBe(1);
    expect(literalValue(property(coverage, "provider"))).toBe("istanbul");
    for (const threshold of ["statements", "branches", "functions", "lines"]) {
      expect(literalValue(property(thresholds, threshold))).toBe(100);
    }
  });

  it("keeps Workers tests out of the app pool and invokes both lanes in CI", () => {
    const appSource = readFileSync("vitest.config.ts", "utf8");
    const appConfig = workersConfigObject(appSource);
    const appTestConfig = appConfig && property(appConfig, "test");
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const appCoverageJob = workflowJob(workflow, "coverage");
    const workersCoverageJob = workflowJob(workflow, "workers-coverage");

    expect(appTestConfig && ts.isObjectLiteralExpression(appTestConfig)).toBe(true);
    if (!appTestConfig || !ts.isObjectLiteralExpression(appTestConfig)) return;
    expect(literalValue(property(appTestConfig, "exclude"))).toContain("test/workers/**");
    expect(runCommands(appCoverageJob)).toContain("pnpm run test:coverage");
    expect(runCommands(appCoverageJob)).not.toContain("pnpm run test:workers:coverage");
    expect(runCommands(workersCoverageJob)).toContain("pnpm run test:workers:coverage");
    expect(runCommands(workersCoverageJob)).not.toContain("pnpm run test:coverage");
  });

  it("provides a dedicated Worker test configuration file", () => {
    const wrangler = readJson("wrangler.workers-test.json") as {
      name?: string;
      main?: string;
      d1_databases?: Array<{ binding?: string }>;
    };

    expect(wrangler.name).toBe("spoonjoy-workers-test");
    expect(wrangler.main).toBe("workers/app.ts");
    expect(wrangler.d1_databases?.map(({ binding }) => binding)).toContain("DB");
  });
});
