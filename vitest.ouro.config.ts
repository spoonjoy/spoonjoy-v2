import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { ouroTestProjects } from "./app/lib/ouro/testing/vitest.ts";

// Registry tests run only in CI browsers, with Spoonjoy's real theme and pinned Vitest 4.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app/components", import.meta.url)),
    },
  },
  optimizeDeps: {
    include: [
      "@base-ui/react/alert-dialog",
      "@base-ui/react/autocomplete",
      "@base-ui/react/button",
      "@base-ui/react/checkbox",
      "@base-ui/react/checkbox-group",
      "@base-ui/react/combobox",
      "@base-ui/react/dialog",
      "@base-ui/react/drawer",
      "@base-ui/react/field",
      "@base-ui/react/fieldset",
      "@base-ui/react/form",
      "@base-ui/react/radio",
      "@base-ui/react/radio-group",
      "@base-ui/react/select",
      "@base-ui/react/switch",
      "@base-ui/react/tooltip",
    ],
  },
  test: {
    projects: ouroTestProjects({
      css: "./app/styles/tailwind.css",
      // Released test-kit option: Vitest 4 must not scale the test iframe.
      page: { width: 1600, height: 1200 },
      include: [
        "app/components/ouro/**/*.test.{ts,tsx}",
        "app/lib/ouro/**/*.test.{ts,tsx}",
        "test/ouro/**/*.test.{ts,tsx}",
      ],
    }),
    coverage: {
      provider: "istanbul",
      include: ["app/components/ouro/**/*.{ts,tsx}", "app/lib/ouro/**/*.{ts,tsx}"],
      exclude: [
        "**/*.stories.tsx",
        "**/*.test.{ts,tsx}",
        "**/*.test-d.ts",
        "**/*.d.ts",
        "app/lib/ouro/testing/**",
      ],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
