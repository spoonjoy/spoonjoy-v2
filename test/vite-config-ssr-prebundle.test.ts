// @vitest-environment node
import type { UserConfig } from "vite";
import { describe, expect, it } from "vitest";
import config from "../vite.config";

const resolved = (command: "build" | "serve") =>
  (config as (env: { command: "build" | "serve"; mode: string }) => UserConfig)({ command, mode: "production" });

describe("the Worker's dependency optimizer (spoonjoy-v2#739)", () => {
  it("bundles lucide-react up front in both the build and the dev server, so it can't find it mid-build", () => {
    for (const command of ["build", "serve"] as const) {
      expect(resolved(command).environments?.ssr?.optimizeDeps?.include).toContain("lucide-react");
    }
  });
});
