import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  serverBuildFile: "_worker.js",
  serverModuleFormat: "esm",
  routeDiscovery: {
    mode: "initial",
  },
  // Cloudflare can preserve the internal Worker host in request.url while the
  // browser correctly posts from Spoonjoy's canonical public origin.
  allowedActionOrigins: ["appleid.apple.com", "spoonjoy.app"],
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
