import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  ArcticFetchError,
  UnexpectedErrorResponseBodyError,
  UnexpectedResponseError,
} from "arctic";
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

  afterEach(() => {
    vi.useRealTimers();
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
    expect(githubMock.validateAuthorizationCode).toHaveBeenCalledWith("valid-code");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/user",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer github-access-token",
          "User-Agent": "Spoonjoy",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: expect.any(AbortSignal),
      },
    );
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
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/user/emails",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer github-access-token",
          "User-Agent": "Spoonjoy",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: expect.any(AbortSignal),
      },
    );
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

  it("classifies userinfo and email endpoint failures without claiming email is missing", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, false));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });

    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ id: 456, login: "x", email: null }))
      .mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, false));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });
  });

  it("marks non-transient provider 4xx responses non-retryable", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "bad token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: false,
      failureKind: "upstream",
    });
  });

  it.each([
    [408, true],
    [425, true],
    [429, true],
    [499, false],
    [500, true],
    [599, true],
  ])("classifies upstream HTTP %i retryability as %s", async (status, retryable) => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "provider" }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable,
      failureKind: "upstream",
    });
  });

  it("classifies malformed successful provider JSON as a retryable upstream failure", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });
  });

  it("bounds a stalled token exchange", async () => {
    vi.useFakeTimers();
    githubMock.validateAuthorizationCode.mockReturnValueOnce(new Promise(() => {}));

    const resultPromise = verifyGitHubCallback(config, redirectUri, callbackData());
    await vi.advanceTimersByTimeAsync(8_000);
    const unsettled = Symbol("unsettled");
    const result = await Promise.race([resultPromise, Promise.resolve(unsettled)]);

    expect(result).not.toBe(unsettled);
    expect(result).toMatchObject({
      success: false,
      error: "provider_timeout",
      retryable: true,
      failureKind: "timeout",
    });
    expect(githubMock.validateAuthorizationCode).toHaveBeenCalledWith("valid-code");
  });

  it("bounds and aborts a stalled profile request", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    }));

    const resultPromise = verifyGitHubCallback(config, redirectUri, callbackData());
    await vi.advanceTimersByTimeAsync(8_000);
    const unsettled = Symbol("unsettled");
    const result = await Promise.race([resultPromise, Promise.resolve(unsettled)]);

    expect(result).not.toBe(unsettled);
    expect(result).toMatchObject({
      success: false,
      error: "provider_timeout",
      retryable: true,
      failureKind: "timeout",
    });
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("bounds and aborts a stalled profile response body", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    });

    const resultPromise = verifyGitHubCallback(config, redirectUri, callbackData());
    await vi.advanceTimersByTimeAsync(8_000);
    const unsettled = Symbol("unsettled");
    const result = await Promise.race([resultPromise, Promise.resolve(unsettled)]);

    expect(result).not.toBe(unsettled);
    expect(result).toMatchObject({
      success: false,
      error: "provider_timeout",
      retryable: true,
      failureKind: "timeout",
    });
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("treats a statusless unexpected token response as retryable upstream failure", async () => {
    const error = new Error("Unexpected error response");
    error.name = "UnexpectedResponseError";
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(error);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });
  });

  it("treats a non-numeric unexpected token status as retryable upstream failure", async () => {
    const error = Object.assign(new Error("Unexpected error response"), {
      name: "UnexpectedResponseError",
      status: "503",
    });
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(error);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });
  });

  it("classifies Arctic token protocol errors as upstream failures", async () => {
    for (const error of [
      new UnexpectedResponseError(503),
      new UnexpectedErrorResponseBodyError(502, { invalid: "body" }),
    ]) {
      githubMock.validateAuthorizationCode.mockRejectedValueOnce(error);

      await expect(
        verifyGitHubCallback(config, redirectUri, callbackData()),
      ).resolves.toMatchObject({
        success: false,
        error: "upstream_error",
        retryable: true,
        failureKind: "upstream",
      });
    }
  });

  it("classifies Arctic token transport failures as retryable network errors", async () => {
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(
      new ArcticFetchError(new TypeError("fetch failed")),
    );

    await expect(
      verifyGitHubCallback(config, redirectUri, callbackData()),
    ).resolves.toMatchObject({
      success: false,
      error: "network_error",
      retryable: true,
      failureKind: "network",
    });
  });

  it("normalizes OAuth provider and network errors", async () => {
    const oauthError = new Error("bad verifier");
    oauthError.name = "OAuth2RequestError";
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(oauthError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "oauth_error",
      retryable: false,
      failureKind: "client",
      message: "bad verifier",
    });

    githubMock.validateAuthorizationCode.mockRejectedValueOnce(new Error("OAuth request error: bad_verification_code"));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "oauth_error",
      message: "OAuth request error: bad_verification_code",
    });

    const unexpectedResponseError = new Error("Unexpected error response");
    unexpectedResponseError.name = "UnexpectedResponseError";
    Object.assign(unexpectedResponseError, { status: 503 });
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(unexpectedResponseError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });

    const unexpectedBodyError = new Error("Unexpected error response body");
    unexpectedBodyError.name = "UnexpectedErrorResponseBodyError";
    Object.assign(unexpectedBodyError, { status: 502 });
    githubMock.validateAuthorizationCode.mockRejectedValueOnce(unexpectedBodyError);

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "upstream_error",
      retryable: true,
      failureKind: "upstream",
    });

    githubMock.validateAuthorizationCode.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(verifyGitHubCallback(config, redirectUri, callbackData())).resolves.toMatchObject({
      success: false,
      error: "network_error",
      retryable: true,
      failureKind: "network",
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

  // The telemetry-coverage allowlist categorizes github-oauth.server.ts as
  // "delegated": the file emits no capture call of its own, but every failure
  // path invokes the threaded `capture` callback so the auth-telemetry sink
  // records it (with provider+phase+httpStatus). These tests pin that
  // delegation so a refactor that drops a `capture?.()` call regresses here
  // rather than silently turning the file into an uninstrumented gap.
  describe("delegated capture callback", () => {
    it("captures a /user non-2xx with the upstream status under the userinfo phase", async () => {
      const capture = vi.fn();
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, false));

      const result = await verifyGitHubCallback(config, redirectUri, callbackData(), capture);

      expect(result.error).toBe("upstream_error");
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "userinfo",
          httpStatus: 500,
          retryable: true,
          failureKind: "upstream",
        }),
      );
      expect(capture.mock.calls[0][0].error).toBeInstanceOf(Error);
    });

    it("captures a /user/emails non-2xx with the upstream status under the userinfo phase", async () => {
      const capture = vi.fn();
      mockFetch
        .mockResolvedValueOnce(mockJsonResponse({ id: 456, login: "x", email: null }))
        .mockResolvedValueOnce(mockJsonResponse({ error: "bad" }, false));

      const result = await verifyGitHubCallback(config, redirectUri, callbackData(), capture);

      expect(result.error).toBe("upstream_error");
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "userinfo",
          httpStatus: 500,
          retryable: true,
          failureKind: "upstream",
        }),
      );
    });

    it("captures an OAuth provider error under the token_exchange phase", async () => {
      const capture = vi.fn();
      const oauthError = new Error("bad verifier");
      oauthError.name = "OAuth2RequestError";
      githubMock.validateAuthorizationCode.mockRejectedValueOnce(oauthError);

      const result = await verifyGitHubCallback(config, redirectUri, callbackData(), capture);

      expect(result.error).toBe("oauth_error");
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({ error: oauthError, phase: "token_exchange" }),
      );
    });

    it("captures a network error under the token_exchange phase", async () => {
      const capture = vi.fn();
      const networkError = new TypeError("fetch failed");
      githubMock.validateAuthorizationCode.mockRejectedValueOnce(networkError);

      const result = await verifyGitHubCallback(config, redirectUri, callbackData(), capture);

      expect(result.error).toBe("network_error");
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          error: networkError,
          phase: "token_exchange",
          retryable: true,
          failureKind: "network",
        }),
      );
    });

    it("does NOT capture on the happy path", async () => {
      const capture = vi.fn();
      mockFetch.mockResolvedValueOnce(mockJsonResponse({
        id: 123,
        login: "spoonfan",
        name: "Spoon Fan",
        email: "spoonfan@example.com",
        avatar_url: null,
      }));

      const result = await verifyGitHubCallback(config, redirectUri, callbackData(), capture);

      expect(result.success).toBe(true);
      expect(capture).not.toHaveBeenCalled();
    });

    it("re-throws (does not capture) a truly unexpected error so the callback route captures it", async () => {
      const capture = vi.fn();
      githubMock.validateAuthorizationCode.mockRejectedValueOnce(new Error("unexpected"));

      await expect(
        verifyGitHubCallback(config, redirectUri, callbackData(), capture),
      ).rejects.toThrow("unexpected");
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
