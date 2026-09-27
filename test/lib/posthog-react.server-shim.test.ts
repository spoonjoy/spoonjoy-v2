// @vitest-environment node
import { describe, expect, it } from "vitest";
import { usePostHog } from "~/lib/posthog-react.server-shim";
import { serverPostHogReactShimPlugin } from "../../vite.config";

describe("server stand-in for @posthog/react", () => {
  it("has no PostHog client on the server", () => {
    expect(usePostHog()).toBeUndefined();
  });

  it("replaces @posthog/react in the Worker build only, leaving the browser build the real package", () => {
    const plugin = serverPostHogReactShimPlugin();
    const applies = plugin.applyToEnvironment as (environment: { name: string }) => boolean;
    expect(applies({ name: "ssr" })).toBe(true);
    expect(applies({ name: "client" })).toBe(false);

    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId("@posthog/react")).toMatch(/app\/lib\/posthog-react\.server-shim\.ts$/);
    expect(resolveId("posthog-js")).toBeNull();
    expect(resolveId("react")).toBeNull();
  });
});
