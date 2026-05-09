import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  serverBuildFile: "_worker.js",
  serverModuleFormat: "esm",
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
