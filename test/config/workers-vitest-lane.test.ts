import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function workflowJob(source: string, name: string) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  if (start === -1) return "";
  const remainder = source.slice(start + marker.length);
  const nextJob = remainder.search(/\n  [a-z][a-z0-9-]*:\n/);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

describe("Workers Vitest lane", () => {
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
    const config = readFileSync("vitest.workers.config.ts", "utf8");

    expect(config).toContain("cloudflareTest");
    expect(config).toContain("plugins:");
    expect(config).not.toContain("defineWorkersConfig");
    expect(config).toContain('include: ["test/workers/**/*.test.ts"]');
    expect(config).toContain('setupFiles: ["./vitest.workers.setup.ts"]');
    expect(config).toContain("passWithNoTests: true");
    expect(config).toContain("fileParallelism: false");
    expect(config).toContain("maxWorkers: 1");
    expect(config).toContain('configPath: "./wrangler.workers-test.json"');
    expect(config).toContain('provider: "istanbul"');
    for (const threshold of ["statements", "branches", "functions", "lines"]) {
      expect(config).toContain(`${threshold}: 100`);
    }
  });

  it("keeps Workers tests out of the app pool and invokes both lanes in CI", () => {
    const appConfig = readFileSync("vitest.config.ts", "utf8");
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const appCoverageJob = workflowJob(workflow, "coverage");
    const workersCoverageJob = workflowJob(workflow, "workers-coverage");

    expect(appConfig).toContain('"test/workers/**"');
    expect(appCoverageJob).toContain("pnpm run test:coverage");
    expect(appCoverageJob).not.toContain("test:workers");
    expect(workersCoverageJob).toContain("pnpm run test:workers:coverage");
    expect(workersCoverageJob).not.toContain("pnpm run test:coverage");
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
