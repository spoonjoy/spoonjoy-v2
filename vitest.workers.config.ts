import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;
const prismaWasmClient = new URL("./node_modules/.prisma/client/wasm.js", import.meta.url).pathname;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.workers-test.json",
      },
    }),
  ],
  resolve: {
    alias: {
      "~": appDirectory,
      "@": componentsDirectory,
      ".prisma/client/default": prismaWasmClient,
    },
  },
  test: {
    include: ["test/workers/**/*.test.ts"],
    exclude: ["test/workers/app.test.ts"],
    setupFiles: ["./vitest.workers.setup.ts"],
    passWithNoTests: true,
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      include: ["workers/cook-session.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
