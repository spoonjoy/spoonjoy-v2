// Loader CPU bench on Wrangler's D1 (workerd). Not part of CI; run it by hand to compare
// hot-route loaders before and after a change:
//   pnpm exec vitest run --config scripts/bench/vitest.bench.config.ts --no-isolate --reporter=verbose scripts/bench/loaders.bench.test.ts
//   pnpm exec vitest run --config scripts/bench/vitest.bench.config.ts --reporter=verbose scripts/bench/cold.bench.test.ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { buildKitchenResetSql } from "../seed-qa-kitchen.mjs";

const root = new URL("../../", import.meta.url).pathname;

// The QA kitchen personas and recipes, as CI seeds them. Password hashes are placeholders:
// the bench signs in by minting session cookies, never with a password.
const kitchenSeedSql = buildKitchenResetSql({
  passwords: { chef: "bench", friend: "bench", newbie: "bench" },
  hash: () => "$2a$04$benchbenchbenchbenchbeuHashPlaceholderNotARealHash0",
  now: () => Date.parse("2026-09-01T00:00:00Z"),
});

export default defineConfig({
  root,
  plugins: [cloudflareTest({ wrangler: { configPath: `${root}wrangler.workers-test.json` } })],
  resolve: {
    alias: {
      "~": `${root}app`,
      "@": `${root}app/components`,
      ".prisma/client/default": `${root}node_modules/.prisma/client/wasm.js`,
    },
  },
  test: {
    include: ["scripts/bench/**/*.bench.test.ts"],
    provide: { kitchenSeedSql },
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 600000,
  },
});

declare module "vitest" {
  export interface ProvidedContext {
    kitchenSeedSql: string;
  }
}
