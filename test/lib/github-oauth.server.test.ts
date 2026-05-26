import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GitHubOAuthConfig } from "~/lib/env.server";

const githubMock = vi.hoisted(() => ({
  validateAuthorizationCode: vi.fn(),
}));

vi.mock("arctic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("arctic")>();

  class MockGitHub extends actual.GitHub {
    async validateAuthorizationCode(code: string): Promise<{ accessToken: () => string }> {
      return githubMock.validateAuthorizationCode(code);
    }
  }

  return {
    ...actual,
    GitHub: MockGitHub,
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  createGitHubAuthorizationURL,
  verifyGitHubCallback,
  type GitHubCallbackData,
} from "~/lib/github-oauth.server";

describe("github-oauth.server", () => {
  const config: GitHubOAuthConfig = {
    clientId: "github-client-id",
    clientSecret: "github-client-secret",
  };
  const redirectUri = "https://spoonjoy.app/auth/github/callback";

  beforeEach(() => {
    vi.clearAllMocks();
    githubMock.validateAuthorizationCode.mockResolvedValue({
      accessToken: () => "github-access-token",
    });
  });

  function callbackData(overrides?: Partial<GitHubCallbackData>): GitHubCallbackData {
    return {
      code: "valid-code",
      state: "state",
      ...overrides,
    };
  }

  function mockJsonResponse(body: unknown, ok = true): Response {
    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("creates a GitHub authorization URL with state, redirect, and email scopes", () => {
    const url = createGitHubAuthorizationURL(config, redirectUri, "state-123");

    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")).toContain("read:user");
    expect(url.searchParams.get("scope")).toContain("user:email");
  });

  it("rejects missing state and missing code before contacting GitHub", async () => {
    await expect(verifyGitHubCallback(config, redirectUri, callbackData({ state: "" }))).resolves.toMatchObject({
      success: false,
      error: "invalid_state",
    });

    await expect(verifyGitHubCallback(config, redirectUri, callbackData({ code: "" }))).resolves.toMatchObject({
      success: false,
      error: "invalid_code",
    });

    expect(githubMock.validateAuthorizationCode).not.toHaveBeenCalled();
  });

  it("returns the profile email when GitHub exposes it on /user", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      id: 123,
      login: "spoonfan",
      name: "Spoon Fan",
      email: "spoonfan@example.com",
      avatar_url: "https://avatars.githubusercontent.com/u/123",
    }));

    const result = await verifyGitHubCallback(config, redirectUri, callbackData());

    expect(result).toEqual({
      success: true,
      githubUser: {
        id: "123",
        email: "spoonfan@example.com",
        emailVerified: true,
        login: "spoonfan",
        name: "Spoon Fan",
        avatarUrl: "https://avatars.githubusercontent.com/u/123",
      },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the primary verified email endpoint when profile email is private", async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        id: 456,
        login: "privatechef",
        name: null,
        email: null,
        avatar_url: null,
      }))
      .mockResolvedValueOnce(mockJsonResponse([
        { email: "old@example.com", primary: false, verified: true, visibility: null },
        { email: "primary@example.com", primary: true, verified: true, visibility: "private" },
      ]));

    const result = await verifyGitHubCallback(config, redirectUri, callbackData());

    expect(result.success).toBe(true);
    expect(result.githubUser?.email).toBe("primary@example.com");
    expect(result.githubUser?.emailVerified).toBe(true);
  });

  it("uses a non-primary verified email when no primary verified address exists", async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        id: 456,
        login: "privatechef",
        name: null,
        email: null,
        avatar_url: null,
      }))
      .mockResolvedValueOnce(mockJsonResponse([
        { email: "primary@example.com", primary: true, verified: false, visibility: null },
        { email: "verified@example.com", primary: false, verified: true, visibility: null },
      ]));

    const result = await verifyGitHubCallback(config, redirectUri, callbackData());

    expect(result.success).toBe(true);
    expect(result.githubUser?.email).toBe("verified@example.com");
  });

  it("allows an existing OAuth account to continue when GitHub has no verified email", async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        id: 456,
        login: "privatechef",
        name: null,
        email: null,
        avatar_url: null,
      }))
      .mockResolvedValueOnce(mockJsonResponse([
        { email: "primary@example.com", primary: true, verified: false, visibility: null },
      ]));

    const result = await verifyGitHubCallback(config, redirectUri, callbackData());

    expect(result.success).toBe(true);
    expect(result.githubUser?.email).toBeNull();
    expect(result.githubUser?.emailVerified).toBe(false);
  });

  it("reports userinfo and email endpoint failures", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, false));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "userinfo_error",
    });

    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ id: 456, login: "x", email: null }))
      .mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, false));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "email_required",
    });
  });

  it("normalizes OAuth provider and network errors", async () => {
    const oauthError = new Error("bad verifier");
    oauthError.name = "OAuth2RequestError";
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(oauthError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "oauth_error",
      message: "bad verifier",
    });

    const unexpectedResponseError = new Error("Unexpected error response");
    unexpectedResponseError.name = "UnexpectedResponseError";
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(unexpectedResponseError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "oauth_error",
      message: "Unexpected error response",
    });

    const unexpectedBodyError = new Error("Unexpected error response body");
    unexpectedBodyError.name = "UnexpectedErrorResponseBodyError";
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(unexpectedBodyError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "oauth_error",
      message: "Unexpected error response body",
    });

    githubMock.validateAuthorizationCode.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "network_error",
    });
  });

  it("uses a generic message for OAuth errors without provider detail", async () => {
    const oauthError = new Error("");
    oauthError.name = "OAuth2RequestError";
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(oauthError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "oauth_error",
      message: "OAuth error occurred",
    });
  });

  it("rethrows unexpected errors", async () => {
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(new Error("unexpected"));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).rejects.toThrow("unexpected");
  });
});
