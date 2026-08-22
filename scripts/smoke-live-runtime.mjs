import {
  buildBrowserEnvironment,
  buildD1CommandEnvironment,
} from "./smoke-live-helpers.mjs";

export function createSmokeLiveRuntime({ chromium, execFile, env = process.env }) {
  return {
    launchBrowser(options) {
      return chromium.launch({ ...options, env: buildBrowserEnvironment(env) });
    },
    executeD1(args) {
      return execFile("pnpm", args, {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 4,
        env: buildD1CommandEnvironment(env),
      });
    },
  };
}
