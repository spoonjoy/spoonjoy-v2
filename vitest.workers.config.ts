import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.workers-test.json",
      },
    }),
  ],
  test: {
    include: ["test/workers/**/*.test.ts"],
    setupFiles: ["./vitest.workers.setup.ts"],
    passWithNoTests: true,
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      include: ["workers/**/*.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
