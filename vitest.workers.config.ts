import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// With --no-isolate every file shares one D1 database, and the CookSession bootstrap test must
// run before saved-recipe-cutover-d1.test.ts applies the full repository schema. Vitest's
// default order puts previously slower files first once it has a results cache, which can
// flip that; run the files in path order instead, as a cold CI run does.
class PathOrderSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  }
}

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;
const prismaWasmClient = new URL("./node_modules/.prisma/client/wasm.js", import.meta.url).pathname;
const serverBuildStub = new URL("./test/workers/helpers/server-build-stub.ts", import.meta.url).pathname;

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
      // workers/app.ts imports the server build statically; see the stub.
      "virtual:react-router/server-build": serverBuildStub,
    },
  },
  test: {
    include: ["test/workers/**/*.test.ts"],
    exclude: ["test/workers/app.test.ts"],
    setupFiles: ["./vitest.workers.setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { sequencer: PathOrderSequencer },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
      include: [
        "workers/cook-session.ts",
        "workers/cook-session-api.ts",
        "workers/cook-session-protocol.ts",
        "workers/cook-session-store.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
