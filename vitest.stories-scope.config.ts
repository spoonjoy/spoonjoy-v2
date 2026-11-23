import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Not a test run: scripts/storybook-scope.mjs lists, with Vitest's --changed, which stories (or
// Storybook's preview) import a changed file, so a pull request no story can reach skips building
// Storybook. The resolve matches .storybook/vite.config.ts, the config Storybook builds with.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app/components", import.meta.url)),
    },
  },
  test: {
    // The stories .storybook/main.ts loads, and the preview that wraps every one of them.
    include: ["stories/**/*.stories.{js,jsx,mjs,ts,tsx}", "app/components/ouro/**/*.stories.{ts,tsx}", ".storybook/preview.tsx"],
  },
});
