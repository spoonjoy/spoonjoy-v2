import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { ouroTestProjects } from "./app/lib/ouro/testing/vitest.ts";

// Ouro UI's own tests, installed from its shadcn registry beside each component in
// app/components/ouro and app/lib/ouro. They run in real browsers (Chromium and WebKit, plus a
// 390x844 touch phone) through the projects Ouro UI ships for apps (ouroTestProjects), with
// Spoonjoy's stylesheet, so components render with Spoonjoy's theme mapping. The main suite
// (vitest.config.ts, happy-dom) leaves these files out and this run covers them to 100%.
//
// It stays on Spoonjoy's Vitest 4: the registry asks for Vitest 5, but
// @cloudflare/vitest-pool-workers (the Workers test lane) supports only Vitest 4.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app/components", import.meta.url)),
    },
  },
  // Pre-bundle Base UI's entry points up front, as Ouro UI's own repository does: a dependency
  // Vite discovers mid-run triggers a re-optimization and reload, which can load React twice.
  optimizeDeps: {
    include: ["@base-ui/react/button", "@base-ui/react/dialog", "@base-ui/react/drawer"],
  },
  test: {
    projects: ouroTestProjects({
      css: "./app/styles/tailwind.css",
      include: [
        "app/components/ouro/**/*.test.{ts,tsx}",
        "app/lib/ouro/**/*.test.{ts,tsx}",
        // Spoonjoy's own browser checks of how its stylesheet treats Ouro UI.
        "test/ouro/**/*.test.{ts,tsx}",
      ],
    }),
    coverage: {
      provider: "istanbul",
      include: ["app/components/ouro/**/*.{ts,tsx}", "app/lib/ouro/**/*.{ts,tsx}"],
      // The same exclusions as Ouro UI's repository: stories, tests and the test kit itself.
      exclude: [
        "**/*.stories.tsx",
        "**/*.test.{ts,tsx}",
        "**/*.test-d.ts",
        "**/*.d.ts",
        "app/lib/ouro/testing/**",
      ],
      // Only files below 100% are listed, so a passing run prints no file table.
      reporter: [["text", { skipFull: true }], "text-summary"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
