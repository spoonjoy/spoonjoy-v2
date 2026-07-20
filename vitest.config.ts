import { defineConfig } from "vitest/config";

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;
const coverageInclude = [
  "app/lib/**/*.ts",
  "app/routes/**/*.ts",
  "app/routes/**/*.tsx",
  "app/components/**/*.tsx",
  "app/hooks/**/*.ts",
  "scripts/advisory-scan.ts",
  "scripts/script-environment.mjs",
  "scripts/cleanup-local-qa-data.mjs",
  "scripts/smoke-live-helpers.mjs",
  "scripts/smoke-image-cover-live.mjs",
  "scripts/smoke-api-live.mjs",
  "scripts/qa-preflight.ts",
  "scripts/deployment-preflight.ts",
  "scripts/deploy-production-canary.ts",
  "scripts/run-with-warning-policy.mjs",
  "scripts/e2e-run-cleanup.mjs",
  "test/warning-policy.ts",
  "e2e/warning-policy.ts",
  "e2e/fixtures.ts",
  "e2e/support/global-teardown.ts",
  "e2e/support/start-ephemeral-wrangler.mjs",
] as const;

const hasCoverageFlag = process.argv.some((arg) =>
  arg === "--coverage" || arg.startsWith("--coverage."),
);
const hasFocusedTestFilter = process.argv.some((arg) =>
  !arg.startsWith("-") &&
  (
    arg.startsWith("test/") ||
    arg.startsWith("app/") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(arg)
  ),
);
// Full coverage gates keep repo-wide thresholds; focused unit coverage reports
// should not fail because unrelated imported helpers are partially covered.
const isFocusedCoverageRun = hasCoverageFlag && hasFocusedTestFilter;

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    pool: "forks",
    // DB-backed route/model tests share test.db and destructive cleanup helpers.
    // Keep files serial until the suite has per-worker database isolation.
    maxWorkers: 1,
    fileParallelism: false,
    sequence: {
      shuffle: false,
    },
    exclude: ["**/node_modules/**", "**/e2e/**", "**/.claude/**", "test/workers/**"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      include: isFocusedCoverageRun ? undefined : [...coverageInclude],
      exclude: [
        "node_modules/**",
        "test/**/*.{test,spec}.{ts,tsx}",
        "test/setup.ts",
        "**/*.config.ts",
        "**/*.d.ts",
        "**/types/**",
      ],
      thresholds: isFocusedCoverageRun ? undefined : {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      "~": appDirectory,
      "@": componentsDirectory,
    }
  }
});
