// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  handleAppleCallback: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/apple" } })),
  handleGitHubCallback: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/github" } })),
  handleGoogleCallback: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/google" } })),
}));

vi.mock("~/lib/oauth-callback-route.server", () => ({
  handleAppleCallback: mocks.handleAppleCallback,
  handleGitHubCallback: mocks.handleGitHubCallback,
  handleGoogleCallback: mocks.handleGoogleCallback,
}));

import { action, loader } from "~/routes/redwood-functions-auth-oauth";
import LegacyDbAuthOAuthRoute from "~/routes/redwood-functions-auth-oauth";

describe("legacy Redwood dbAuth OAuth route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes legacy Apple form_post callbacks to the Apple callback handler", async () => {
    const request = new Request("https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple", {
      method: "POST",
    });

    const response = await action({ request, context: {}, params: {} } as any);

    expect(response.headers.get("Location")).toBe("/apple");
    expect(mocks.handleAppleCallback).toHaveBeenCalledWith(request, {});
  });

  it("rejects unsupported legacy POST callbacks", async () => {
    const request = new Request("https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithGitHub", {
      method: "POST",
    });

    const response = await action({ request, context: {}, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_request");
  });

  it("routes legacy GitHub GET callbacks to the GitHub callback handler", async () => {
    const request = new Request("https://spoonjoy.app/.redwood/functions/auth/oauth?method=signupWithGitHub");

    const response = await loader({ request, context: {}, params: {} } as any);

    expect(response.headers.get("Location")).toBe("/github");
    expect(mocks.handleGitHubCallback).toHaveBeenCalledWith(request, {});
  });

  it("routes legacy Google GET callbacks to the Google callback handler", async () => {
    const request = new Request("https://spoonjoy.app/.redwood/functions/auth/oauth?method=linkGoogleAccount");

    const response = await loader({ request, context: {}, params: {} } as any);

    expect(response.headers.get("Location")).toBe("/google");
    expect(mocks.handleGoogleCallback).toHaveBeenCalledWith(request, {});
  });

  it("rejects unsupported legacy GET callbacks", async () => {
    const request = new Request("https://spoonjoy.app/.redwood/functions/auth/oauth");

    const response = await loader({ request, context: {}, params: {} } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?oauthError=invalid_request");
  });

  it("renders no UI", () => {
    expect(LegacyDbAuthOAuthRoute()).toBeNull();
  });
});
