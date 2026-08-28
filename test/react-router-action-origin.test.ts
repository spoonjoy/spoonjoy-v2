// @vitest-environment node

import { createRequestHandler, type ServerBuild } from "react-router";
import { describe, expect, it, vi } from "vitest";

import config from "../react-router.config";

function createOriginGuardHarness() {
  const action = vi.fn(() => Response.json({ reached: true }));
  const build = {
    entry: {
      module: {
        default: () => new Response("action rendered"),
        handleError: () => undefined,
      },
    },
    routes: {
      root: {
        id: "root",
        path: "",
        module: {
          action,
          default: () => null,
        },
      },
    },
    assets: {
      version: "origin-guard-test",
      url: "/assets-manifest.js",
      entry: { module: "/entry.js", imports: [] },
      routes: {
        root: {
          id: "root",
          path: "",
          hasAction: true,
          hasLoader: false,
          hasClientAction: false,
          hasClientLoader: false,
          hasClientMiddleware: false,
          hasErrorBoundary: false,
          module: "/root.js",
          clientActionModule: undefined,
          clientLoaderModule: undefined,
          clientMiddlewareModule: undefined,
          hydrateFallbackModule: undefined,
        },
      },
    },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
    allowedActionOrigins: config.allowedActionOrigins,
  } as unknown as ServerBuild;

  return {
    action,
    handle: createRequestHandler(build, "production"),
  };
}

describe("React Router action origin guard", () => {
  it.each(["https://spoonjoy.app", "http://spoonjoy.app", "https://appleid.apple.com"])(
    "reaches an action for the allowed host pattern %s",
    async (origin) => {
      const harness = createOriginGuardHarness();
      const response = await harness.handle(new Request("https://spoonjoy-internal.workers.dev/", {
        method: "POST",
        headers: { Origin: origin },
      }));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("action rendered");
      expect(harness.action).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "https://www.spoonjoy.app",
    "https://spoonjoy-v2.mendelow-studio.workers.dev",
    "https://spoonjoy.app.evil.example",
    "https://attacker.example",
    "not a url",
  ])("rejects the unapproved origin %s before the action", async (origin) => {
    const harness = createOriginGuardHarness();
    const response = await harness.handle(new Request("https://spoonjoy-internal.workers.dev/", {
      method: "POST",
      headers: { Origin: origin },
    }));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Bad Request");
    expect(harness.action).not.toHaveBeenCalled();
  });

  it("preserves ordinary same-origin actions without an allowlist exception", async () => {
    const harness = createOriginGuardHarness();
    const response = await harness.handle(new Request("https://spoonjoy-v2-qa.mendelow-studio.workers.dev/", {
      method: "POST",
      headers: { Origin: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev" },
    }));

    expect(response.status).toBe(200);
    expect(harness.action).toHaveBeenCalledOnce();
  });
});
