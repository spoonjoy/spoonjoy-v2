import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";
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
  it("provides an automatic context-wide console and page-error fixture", () => {
    const fixture = readFileSync("e2e/fixtures.ts", "utf8");

    expect(fixture).toContain("base.extend");
    expect(fixture).toContain("auto: true");
    expect(fixture).toContain('context.on("page"');
    expect(fixture).toContain('page.on("console"');
    expect(fixture).toContain('page.on("pageerror"');
    expect(fixture).toContain('message.type() === "warning"');
    expect(fixture).toContain('message.type() === "error"');
    expect(fixture).toContain("Browser emitted warning/error diagnostics");
  });

  it("makes every Playwright spec and setup use the local fixture", () => {
    const testFiles = filesBelow("e2e").filter((path) => /\.(spec|setup)\.ts$/.test(path));
    const offenders = testFiles
      .filter((path) => /\b(test|expect)\b/.test(readFileSync(path, "utf8")))
      .filter((path) => readFileSync(path, "utf8").split("\n").some((line) =>
        line.includes("@playwright/test") && !line.trimStart().startsWith("import type ")))
      .map((path) => relative(process.cwd(), path))
      .sort();

    expect(offenders).toEqual([]);
  });
});
