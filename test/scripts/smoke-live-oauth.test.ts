import { describe, expect, it, vi } from "vitest";

import { runAppleOAuthNavigationCheck } from "../../scripts/smoke-live-oauth.mjs";

const safeResult = {
  provider: "apple",
  appOrigin: "https://spoonjoy.app",
  controllerPath: "/sw.js",
  documentPath: "/auth/apple",
  providerHost: "appleid.apple.com",
  clientIdMatches: true,
  redirectUriMatches: true,
  responseModeMatches: true,
  redirectToPreserved: true,
  publicSignInMarkerPresent: true,
  publicErrorSentinelAbsent: true,
  cspViolations: [],
};

describe("live Apple OAuth orchestrator", () => {
  it("uses a fresh pinned-English context and returns only canary evidence", async () => {
    const page = { id: "fresh-page" };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = { newContext: vi.fn(async () => context) };
    const runCanary = vi.fn(async () => safeResult);

    await expect(runAppleOAuthNavigationCheck({ browser, runCanary })).resolves.toEqual(safeResult);
    expect(browser.newContext).toHaveBeenCalledWith({
      locale: "en-US",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    expect(runCanary).toHaveBeenCalledWith(expect.objectContaining({
      page,
      provider: "apple",
      appOrigin: "https://spoonjoy.app",
      expectedProviderHost: "appleid.apple.com",
      expectedProviderPath: "/auth/authorize",
      expectedClientId: "app.spoonjoy.client",
      expectedRedirectUri: "https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple",
      expectedResponseMode: "form_post",
      publicSignInMarker: "Sign in to Apple",
      publicErrorSentinel: "invalid_request",
    }));
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("closes the fresh context and propagates canary failures", async () => {
    const failure = new Error("Apple handoff failed");
    const context = {
      newPage: vi.fn(async () => ({})),
      close: vi.fn(async () => undefined),
    };
    const browser = { newContext: vi.fn(async () => context) };

    await expect(runAppleOAuthNavigationCheck({
      browser,
      runCanary: async () => { throw failure; },
    })).rejects.toBe(failure);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("propagates context creation failures without attempting work", async () => {
    const failure = new Error("Chromium context failed");
    const runCanary = vi.fn();
    const browser = { newContext: vi.fn(async () => { throw failure; }) };

    await expect(runAppleOAuthNavigationCheck({ browser, runCanary })).rejects.toBe(failure);
    expect(runCanary).not.toHaveBeenCalled();
  });
});
