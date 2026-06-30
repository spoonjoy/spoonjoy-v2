import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import { shouldLogRollupBuildMessage } from "./scripts/build-output-hygiene";

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;
const prismaWasmClient = new URL("./node_modules/.prisma/client/wasm.js", import.meta.url).pathname;

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    reactRouter(),
  ],
  optimizeDeps: command === "build" ? { noDiscovery: true, include: [] } : undefined,
  build: {
    rollupOptions: {
      onLog(level, log, defaultHandler) {
        if (shouldLogRollupBuildMessage(level, log)) {
          defaultHandler(level, log);
        }
      },
    },
  },
  resolve: {
    alias: {
      "@": componentsDirectory,
      "~": appDirectory,
      // Prisma edge runtime alias for Cloudflare Workers
      ".prisma/client/default": prismaWasmClient,
    },
  },
}));
