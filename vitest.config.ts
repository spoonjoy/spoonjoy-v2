import { defineConfig } from "vitest/config";

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;

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
    exclude: ["**/node_modules/**", "**/e2e/**"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      include: ["app/lib/**/*.ts", "app/routes/**/*.tsx", "app/components/**/*.tsx", "app/hooks/**/*.ts"],
      exclude: ["node_modules/**", "test/**", "**/*.config.ts", "**/*.d.ts", "**/types/**"],
      thresholds: {
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
