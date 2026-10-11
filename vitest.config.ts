import { defineConfig } from "vitest/config";
import { claimRunDbDir } from "./test/support/worker-db";

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;
const coverageInclude = [
  "app/entry.server.tsx",
  "app/lib/**/*.ts",
  "app/routes/**/*.ts",
  "app/routes/**/*.tsx",
  "app/components/**/*.tsx",
  "app/hooks/**/*.ts",
  "scripts/advisory-scan.ts",
  "scripts/script-environment.mjs",
  "scripts/cleanup-local-qa-data.mjs",
  "scripts/seed-qa-kitchen.mjs",
  "scripts/generate-photo-variants.mjs",
  "scripts/smoke-live-helpers.mjs",
  "scripts/smoke-live-oauth.mjs",
  "scripts/smoke-live-runtime.mjs",
  "scripts/smoke-image-cover-live.mjs",
  "scripts/smoke-api-live.mjs",
  "scripts/qa-preflight.ts",
  "scripts/deployment-preflight.ts",
  "scripts/deploy-production-canary.ts",
  "scripts/run-with-warning-policy.mjs",
  "scripts/e2e-run-cleanup.mjs",
  "scripts/check-journey-rules.mjs",
  "scripts/sanitize-journey-traces.mjs",
  "scripts/count-cloudflare-requests.mjs",
  "scripts/qa-run-scope.mjs",
  "scripts/test-changed.mjs",
  "scripts/d1-logical-export.mjs",
  "scripts/journeys-scope.mjs",
  "test/warning-policy.ts",
  "e2e/warning-policy.ts",
  "e2e/fixtures.ts",
  "e2e/support/global-teardown.ts",
  "e2e/support/start-ephemeral-wrangler.mjs",
  "scripts/production-readiness.ts",
  "scripts/posthog-build-metadata.ts",
  "scripts/react-router-build-runner.ts",
  "scripts/warning-gate.ts",
  "scripts/workflow-security.mjs",
  "workers/app.ts",
] as const;

// Ouro UI, installed from its shadcn registry: its components, helpers and the tests that ship with
// them. Its tests run in Chromium and WebKit (vitest.ouro.config.ts), not in happy-dom, and so do
// Spoonjoy's own browser checks of it in test/ouro.
const OURO_UI_PATHS = ["app/components/ouro/**", "app/lib/ouro/**"];
const OURO_BROWSER_TESTS = "test/ouro/**";

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

// One temporary directory per run for each worker process's own copy of prisma/test.db
// (test/support/worker-db.ts). Set SPOONJOY_TEST_DB_DIR="" to use prisma/test.db directly; that
// shares one file, so the run is then serial.
const runDbDir = claimRunDbDir();
const requestedDbWorkers = Number(process.env.VITEST_DB_WORKERS ?? 4);
const dbWorkers = runDbDir && Number.isInteger(requestedDbWorkers) && requestedDbWorkers > 0 ? requestedDbWorkers : 1;

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    pool: "forks",
    // DB-backed tests run in parallel: test/setup.ts gives each worker process its own copy of
    // prisma/test.db (test/support/worker-db.ts); the global setup removes the copies afterwards.
    globalSetup: ["./test/support/global-setup.ts"],
    maxWorkers: dbWorkers,
    fileParallelism: dbWorkers > 1,
    sequence: {
      shuffle: false,
    },
    exclude: [
      "**/node_modules/**",
      "**/e2e/**",
      "**/.claude/**",
      "test/workers/cook-session-bootstrap.test.ts",
      "test/workers/cook-session-protocol.test.ts",
      "test/workers/saved-recipe-cutover-d1.test.ts",
      "scripts/bench/**",
      // Ouro UI's shipped tests need a real browser; vitest.ouro.config.ts runs them.
      ...OURO_UI_PATHS,
      OURO_BROWSER_TESTS,
    ],
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
        // Covered to 100% by Ouro UI's own browser tests under vitest.ouro.config.ts instead.
        ...OURO_UI_PATHS,
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
