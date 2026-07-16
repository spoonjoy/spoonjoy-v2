import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { faker } from "@faker-js/faker";
import {
  ArcticFetchError,
  UnexpectedErrorResponseBodyError,
  UnexpectedResponseError,
} from "arctic";
import type { GoogleOAuthConfig } from "~/lib/env.server";

// Use vi.hoisted to create mock state that's available at mock time
const { googleMock, mockGoogleState } = vi.hoisted(() => {
  return {
    googleMock: {
      validateAuthorizationCode: vi.fn(),
    },
    mockGoogleState: {
      googleUserId: "default-user-id",
      email: "default@example.com",
      emailVerified: true,
      name: "Default User",
      givenName: "Default",
      familyName: "User",
      picture: "https://lh3.googleusercontent.com/a-/default",
    },
  };
});

// Mock arctic at module level using a class for Google
// Use importOriginal to get the real implementations for generateCodeVerifier and Google.createAuthorizationURL
vi.mock("arctic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("arctic")>();

  // Mock Google class that extends the real Google but mocks validateAuthorizationCode
  class MockGoogle extends actual.Google {
    async validateAuthorizationCode(
      code: string,
      codeVerifier: string
    ): Promise<{ accessToken: () => string }> {
      return googleMock.validateAuthorizationCode(code, codeVerifier);
    }
  }

  // Mock OAuth2RequestError class
  class MockOAuth2RequestError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "OAuth2RequestError";
    }
  }

  return {
    ...actual,
    Google: MockGoogle,
    OAuth2RequestError: MockOAuth2RequestError,
  };
});

// Mock global fetch for userinfo endpoint
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import functions that don't exist yet (TDD - tests first)
import {
  generateCodeVerifier,
  createGoogleAuthorizationURL,
  verifyGoogleCallback,
  type GoogleCallbackData,
  type GoogleCallbackResult,
  type GoogleUser,
} from "~/lib/google-oauth.server";

describe("google-oauth.server", () => {
  const mockConfig: GoogleOAuthConfig = {
    clientId: "123456789.apps.googleusercontent.com",
    clientSecret: "GOCSPX-test-secret-key",
  };
  const mockRedirectUri = "https://spoonjoy.app/auth/google/callback";

  describe("generateCodeVerifier", () => {
    it("should generate a random code verifier string", () => {
      const verifier = generateCodeVerifier();

      expect(typeof verifier).toBe("string");
      expect(verifier.length).toBeGreaterThan(0);
    });

    it("should generate unique code verifier values on each call", () => {
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();

      expect(verifier1).not.toBe(verifier2);
    });

    it("should generate URL-safe code verifier values", () => {
      const verifier = generateCodeVerifier();

      // PKCE code verifier must be URL-safe (alphanumeric, hyphen, underscore, tilde, period)
      // RFC 7636: unreserved characters only [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
      expect(verifier).toMatch(/^[a-zA-Z0-9._~-]+$/);
    });

    it("should generate code verifier with sufficient length for security", () => {
      const verifier = generateCodeVerifier();

      // RFC 7636: code_verifier must be between 43 and 128 characters
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });
  });

  describe("createGoogleAuthorizationURL", () => {
    it("should return a valid Google authorization URL", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url).toBeInstanceOf(URL);
      expect(url.hostname).toBe("accounts.google.com");
      expect(url.pathname).toBe("/o/oauth2/v2/auth");
    });

    it("should include client_id parameter", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url.searchParams.get("client_id")).toBe(mockConfig.clientId);
    });

    it("should include redirect_uri parameter", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url.searchParams.get("redirect_uri")).toBe(mockRedirectUri);
    });

    it("should include state parameter for CSRF protection", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url.searchParams.get("state")).toBe(state);
    });

    it("should include response_type=code", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url.searchParams.get("response_type")).toBe("code");
    });

    it("should include code_challenge parameter for PKCE", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      // code_challenge should be present (derived from code_verifier)
      const codeChallenge = url.searchParams.get("code_challenge");
      expect(codeChallenge).toBeDefined();
      expect(codeChallenge).not.toBe("");
      // code_challenge is base64url encoded SHA-256 hash, so it should be URL-safe
      expect(codeChallenge).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it("should include code_challenge_method=S256 for PKCE", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    });

    it("should request openid scope", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      const scope = url.searchParams.get("scope");
      expect(scope).toContain("openid");
    });

    it("should request email scope", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      const scope = url.searchParams.get("scope");
      expect(scope).toContain("email");
    });

    it("should request profile scope", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      const scope = url.searchParams.get("scope");
      expect(scope).toContain("profile");
    });

    it("should include all required scopes (openid, email, profile)", () => {
      const state = "test-state-123";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      const scope = url.searchParams.get("scope");
      // Scopes should be space-separated
      expect(scope).toMatch(/\bopenid\b/);
      expect(scope).toMatch(/\bemail\b/);
      expect(scope).toMatch(/\bprofile\b/);
    });

    it("should properly encode special characters in state", () => {
      const state = "state&with=special+chars";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      // URLSearchParams should handle encoding
      expect(url.searchParams.get("state")).toBe(state);
      // The raw URL string should have the encoded value
      expect(url.toString()).toContain("state=state%26with%3Dspecial%2Bchars");
    });

    it("should properly encode redirect_uri with query parameters", () => {
      const state = "test-state";
      const codeVerifier = "test-code-verifier-43-chars-long-minimum-length";
      const redirectWithQuery =
        "https://spoonjoy.app/auth/google/callback?foo=bar&baz=qux";
      const url = createGoogleAuthorizationURL(
        mockConfig,
        redirectWithQuery,
        state,
        codeVerifier
      );

      // Should properly encode the redirect_uri
      expect(url.searchParams.get("redirect_uri")).toBe(redirectWithQuery);
    });

    it("should generate different code_challenge for different code_verifier", () => {
      const state = "test-state-123";
      const verifier1 = "test-code-verifier-one-43-chars-long-minimum";
      const verifier2 = "test-code-verifier-two-43-chars-long-minimum";

      const url1 = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        verifier1
      );
      const url2 = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        verifier2
      );

      expect(url1.searchParams.get("code_challenge")).not.toBe(
        url2.searchParams.get("code_challenge")
      );
    });

    it("should generate correct code_challenge per RFC 7636 test vector", () => {
      const state = "test-state";
      // RFC 7636 Appendix B test vector
      const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      // Expected code_challenge from RFC 7636 Appendix B
      const expectedCodeChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

      const url = createGoogleAuthorizationURL(
        mockConfig,
        mockRedirectUri,
        state,
        codeVerifier
      );

      expect(url.searchParams.get("code_challenge")).toBe(expectedCodeChallenge);
    });
  });

  describe("verifyGoogleCallback", () => {
    const mockRedirectUri = "https://spoonjoy.app/auth/google/callback";

    // Helper to generate unique Google user IDs
    function generateGoogleUserId(): string {
      return faker.string.numeric(21);
    }

    // Helper to set up mock fetch response for userinfo
    function setupMockUserinfo(userinfo: {
      sub: string;
      email: string;
      email_verified: boolean;
      name?: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
    }) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(userinfo),
      });
    }

    // Helper to set up mock fetch error
    function setupMockUserinfoError(status: number = 401, message: string = "Unauthorized") {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: message,
      });
    }

    // Helper to set up mock fetch network error
    function setupMockNetworkError() {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    }

    beforeEach(() => {
      mockFetch.mockReset();
      googleMock.validateAuthorizationCode.mockReset();
      googleMock.validateAuthorizationCode.mockImplementation(async (code: string, codeVerifier: string) => {
        if (code === "invalid-code") {
          throw new Error("Invalid authorization code");
        }
        if (code === "code-that-triggers-oauth-error") {
          const error = new Error("OAuth error");
          error.name = "OAuth2RequestError";
          throw error;
        }
        if (code === "code-that-triggers-oauth-error-no-message") {
          const error = new Error("");
          error.name = "OAuth2RequestError";
          throw error;
        }
        if (code === "code-that-triggers-network-error") {
          throw new TypeError("fetch failed");
        }
        if (code.startsWith("unexpected-response")) {
          const error = new Error("Unexpected error response");
          error.name = code.endsWith("body")
            ? "UnexpectedErrorResponseBodyError"
            : "UnexpectedResponseError";
          if (code.endsWith("503")) Object.assign(error, { status: 503 });
          if (code.endsWith("string-status")) Object.assign(error, { status: "503" });
          throw error;
        }
        if (!codeVerifier) {
          throw new Error("PKCE code verifier required");
        }
        return {
          accessToken: () => "mock-access-token",
        };
      });
      // Reset mock state
      mockGoogleState.googleUserId = generateGoogleUserId();
      mockGoogleState.email = faker.internet.email().toLowerCase();
      mockGoogleState.emailVerified = true;
      mockGoogleState.name = faker.person.fullName();
      mockGoogleState.givenName = faker.person.firstName();
      mockGoogleState.familyName = faker.person.lastName();
      mockGoogleState.picture = `https://lh3.googleusercontent.com/a-/${faker.string.alphanumeric(28)}`;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("token verification with PKCE", () => {
      it("should return error for invalid authorization code", async () => {
        const callbackData: GoogleCallbackData = {
          code: "invalid-code",
          state: "test-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_code");
        expect(result.message).toContain("authorization code");
      });

      it("should return error when state is missing", async () => {
        const callbackData: GoogleCallbackData = {
          code: "valid-code",
          state: "",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_state");
        expect(result.message).toContain("state");
      });

      it("should return error when code is missing", async () => {
        const callbackData: GoogleCallbackData = {
          code: "",
          state: "test-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_code");
        expect(result.message).toContain("code");
      });

      it("should return error when codeVerifier is missing", async () => {
        const callbackData: GoogleCallbackData = {
          code: "valid-code",
          state: "test-state",
          codeVerifier: "",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_code_verifier");
        expect(result.message).toContain("verifier");
      });

      it("should handle Google OAuth2RequestError", async () => {
        const callbackData: GoogleCallbackData = {
          code: "code-that-triggers-oauth-error",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("oauth_error");
      });

      it("should handle OAuth2RequestError with empty message", async () => {
        const callbackData: GoogleCallbackData = {
          code: "code-that-triggers-oauth-error-no-message",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("oauth_error");
        expect(result.message).toBe("OAuth error occurred");
      });

      it("should handle network/fetch errors during token exchange", async () => {
        const callbackData: GoogleCallbackData = {
          code: "code-that-triggers-network-error",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("network_error");
        expect(result.retryable).toBe(true);
        expect(result.failureKind).toBe("network");
      });

      it("classifies Arctic token transport failures as retryable network errors", async () => {
        googleMock.validateAuthorizationCode.mockRejectedValueOnce(
          new ArcticFetchError(new TypeError("fetch failed")),
        );

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          {
            code: "valid-auth-code",
            state: "valid-state",
            codeVerifier: "valid-code-verifier-at-least-43-characters-long",
          },
        );

        expect(result).toMatchObject({
          success: false,
          error: "network_error",
          retryable: true,
          failureKind: "network",
        });
      });

      it("bounds a stalled token exchange and preserves the outgoing SDK arguments", async () => {
        vi.useFakeTimers();
        googleMock.validateAuthorizationCode.mockReturnValueOnce(new Promise(() => {}));
        const callbackData: GoogleCallbackData = {
          code: "stalled-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const resultPromise = verifyGoogleCallback(mockConfig, mockRedirectUri, callbackData);
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
        expect(googleMock.validateAuthorizationCode).toHaveBeenCalledWith(
          callbackData.code,
          callbackData.codeVerifier,
        );
      });

      it.each([
        ["unexpected-response-503", true],
        ["unexpected-response", true],
        ["unexpected-response-string-status", true],
        ["unexpected-response-body", true],
      ])("classifies %s as a retryable token upstream failure", async (code, retryable) => {
        const result = await verifyGoogleCallback(mockConfig, mockRedirectUri, {
          code,
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        });

        expect(result).toMatchObject({
          success: false,
          error: "upstream_error",
          retryable,
          failureKind: "upstream",
        });
      });

      it("classifies Arctic token protocol errors as upstream failures", async () => {
        for (const error of [
          new UnexpectedResponseError(503),
          new UnexpectedErrorResponseBodyError(502, { invalid: "body" }),
        ]) {
          googleMock.validateAuthorizationCode.mockRejectedValueOnce(error);

          const result = await verifyGoogleCallback(
            mockConfig,
            mockRedirectUri,
            {
              code: "valid-auth-code",
              state: "valid-state",
              codeVerifier: "valid-code-verifier-at-least-43-characters-long",
            },
          );

          expect(result).toMatchObject({
            success: false,
            error: "upstream_error",
            retryable: true,
            failureKind: "upstream",
          });
        }
      });
    });

    describe("user info fetch from Google", () => {
      it("should extract user ID from userinfo response", async () => {
        const testGoogleUserId = generateGoogleUserId();
        const testEmail = faker.internet.email().toLowerCase();

        setupMockUserinfo({
          sub: testGoogleUserId,
          email: testEmail,
          email_verified: true,
          name: "Test User",
          given_name: "Test",
          family_name: "User",
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.id).toBe(testGoogleUserId);
      });

      it("should extract email from userinfo response", async () => {
        const testEmail = faker.internet.email().toLowerCase();

        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: testEmail,
          email_verified: true,
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.email).toBe(testEmail);
      });

      it("should extract full name from userinfo response", async () => {
        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: true,
          name: "Jane Smith",
          given_name: "Jane",
          family_name: "Smith",
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.name).toBe("Jane Smith");
        expect(result.googleUser?.givenName).toBe("Jane");
        expect(result.googleUser?.familyName).toBe("Smith");
      });

      it("should handle missing name fields gracefully", async () => {
        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: true,
          // No name fields
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.name).toBeNull();
        expect(result.googleUser?.givenName).toBeNull();
        expect(result.googleUser?.familyName).toBeNull();
      });

      it("should extract profile picture URL", async () => {
        const pictureUrl = "https://lh3.googleusercontent.com/a-/abc123";

        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: true,
          picture: pictureUrl,
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.picture).toBe(pictureUrl);
      });

      it("should handle missing picture gracefully", async () => {
        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: true,
          // No picture
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.picture).toBeNull();
      });

      it("should extract email_verified boolean", async () => {
        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: true,
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.emailVerified).toBe(true);
      });

      it("should handle email_verified as false", async () => {
        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: false,
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser?.emailVerified).toBe(false);
      });

      it("classifies retryable and non-retryable userinfo responses as upstream failures", async () => {
        setupMockUserinfoError(503, "Unavailable");

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result).toMatchObject({
          error: "upstream_error",
          retryable: true,
          failureKind: "upstream",
        });

        setupMockUserinfoError(401, "Unauthorized");
        const nonRetryable = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData,
        );
        expect(nonRetryable).toMatchObject({
          error: "upstream_error",
          retryable: false,
          failureKind: "upstream",
        });
      });

      it("treats a statusless non-success userinfo response as retryable upstream failure", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: undefined,
        });

        const result = await verifyGoogleCallback(mockConfig, mockRedirectUri, {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        });

        expect(result).toMatchObject({
          error: "upstream_error",
          retryable: true,
          failureKind: "upstream",
        });
      });

      it("should handle network error during userinfo fetch", async () => {
        setupMockNetworkError();

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("network_error");
        expect(result.retryable).toBe(true);
        expect(result.failureKind).toBe("network");
      });

      it("classifies unexpected fetch rejections as retryable network errors", async () => {
        // Fetch transport failures are network errors regardless of the thrown
        // error's message or name.
        const unexpectedError = new Error("Unexpected internal error");
        unexpectedError.name = "InternalError";
        mockFetch.mockRejectedValueOnce(unexpectedError);

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result).toMatchObject({
          error: "network_error",
          retryable: true,
          failureKind: "network",
        });
      });

      it("classifies malformed successful userinfo responses as retryable upstream failures", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError("invalid JSON")),
        });

        const result = await verifyGoogleCallback(mockConfig, mockRedirectUri, {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        });

        expect(result).toMatchObject({
          success: false,
          error: "upstream_error",
          retryable: true,
          failureKind: "upstream",
        });
      });

      it("bounds a stalled userinfo request and sends the exact authenticated request", async () => {
        vi.useFakeTimers();
        mockFetch.mockReturnValueOnce(new Promise(() => {}));
        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const resultPromise = verifyGoogleCallback(mockConfig, mockRedirectUri, callbackData);
        await vi.advanceTimersByTimeAsync(8_000);
        const unsettled = Symbol("unsettled");
        const result = await Promise.race([resultPromise, Promise.resolve(unsettled)]);

        expect(result).not.toBe(unsettled);
        expect(result).toMatchObject({
          error: "provider_timeout",
          retryable: true,
          failureKind: "timeout",
        });
        expect(mockFetch).toHaveBeenCalledWith(
          "https://openidconnect.googleapis.com/v1/userinfo",
          {
            headers: { Authorization: "Bearer mock-access-token" },
            signal: expect.any(AbortSignal),
          },
        );
      });

      it("bounds and aborts a stalled userinfo response body", async () => {
        vi.useFakeTimers();
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
        });

        const resultPromise = verifyGoogleCallback(mockConfig, mockRedirectUri, {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        });
        await vi.advanceTimersByTimeAsync(8_000);
        const unsettled = Symbol("unsettled");
        const result = await Promise.race([resultPromise, Promise.resolve(unsettled)]);

        expect(result).not.toBe(unsettled);
        expect(result).toMatchObject({
          error: "provider_timeout",
          retryable: true,
          failureKind: "timeout",
        });
        expect((mockFetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
      });

      it("normalizes an abort rejection racing the timeout as provider_timeout", async () => {
        vi.useFakeTimers();
        mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }));

        const resultPromise = verifyGoogleCallback(mockConfig, mockRedirectUri, {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        });
        await vi.advanceTimersByTimeAsync(8_000);

        await expect(resultPromise).resolves.toMatchObject({
          error: "provider_timeout",
          retryable: true,
          failureKind: "timeout",
        });
      });
    });

    describe("result structure", () => {
      it("should return GoogleUser with all required fields on success", async () => {
        const testGoogleUserId = generateGoogleUserId();
        const testEmail = faker.internet.email().toLowerCase();

        setupMockUserinfo({
          sub: testGoogleUserId,
          email: testEmail,
          email_verified: true,
          name: "Test User",
          given_name: "Test",
          family_name: "User",
          picture: "https://lh3.googleusercontent.com/a-/test",
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser).toEqual(
          expect.objectContaining({
            id: testGoogleUserId,
            email: testEmail,
            emailVerified: true,
            name: "Test User",
            givenName: "Test",
            familyName: "User",
            picture: "https://lh3.googleusercontent.com/a-/test",
          })
        );
      });

      it("should not include googleUser on error", async () => {
        const callbackData: GoogleCallbackData = {
          code: "",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.googleUser).toBeUndefined();
      });

      it("should return GoogleUser with null fields when not provided", async () => {
        const testGoogleUserId = generateGoogleUserId();
        const testEmail = faker.internet.email().toLowerCase();

        setupMockUserinfo({
          sub: testGoogleUserId,
          email: testEmail,
          email_verified: true,
          // No optional fields
        });

        const callbackData: GoogleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          codeVerifier: "valid-code-verifier-at-least-43-characters-long",
        };

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.googleUser).toEqual({
          id: testGoogleUserId,
          email: testEmail,
          emailVerified: true,
          name: null,
          givenName: null,
          familyName: null,
          picture: null,
        });
      });
    });

    // The telemetry-coverage allowlist categorizes google-oauth.server.ts as
    // "delegated": the file emits no capture call of its own, but every failure
    // path invokes the threaded `capture` callback so the auth-telemetry sink
    // records it (with provider+phase[+httpStatus]). These tests pin that
    // delegation so a refactor dropping a `capture?.()` call regresses here
    // rather than silently turning the file into an uninstrumented gap.
    describe("delegated capture callback", () => {
      const validCallback: GoogleCallbackData = {
        code: "valid-auth-code",
        state: "valid-state",
        codeVerifier: "valid-code-verifier-at-least-43-characters-long",
      };

      it("captures a userinfo non-2xx with the upstream status under the userinfo phase", async () => {
        const capture = vi.fn();
        setupMockUserinfoError(401, "Unauthorized");

        const result = await verifyGoogleCallback(mockConfig, mockRedirectUri, validCallback, capture);

        expect(result.error).toBe("upstream_error");
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "userinfo",
            httpStatus: 401,
            retryable: false,
            failureKind: "upstream",
          }),
        );
        expect(capture.mock.calls[0][0].error).toBeInstanceOf(Error);
      });

      it("captures a userinfo network error under the userinfo phase", async () => {
        const capture = vi.fn();
        setupMockNetworkError();

        const result = await verifyGoogleCallback(mockConfig, mockRedirectUri, validCallback, capture);

        expect(result.error).toBe("network_error");
        expect(capture).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "userinfo", retryable: true, failureKind: "network" }),
        );
      });

      it("captures an OAuth provider error under the token_exchange phase", async () => {
        const capture = vi.fn();

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          { ...validCallback, code: "code-that-triggers-oauth-error" },
          capture,
        );

        expect(result.error).toBe("oauth_error");
        expect(capture).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "token_exchange" }),
        );
      });

      it("captures a token-exchange network error under the token_exchange phase", async () => {
        const capture = vi.fn();

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          { ...validCallback, code: "code-that-triggers-network-error" },
          capture,
        );

        expect(result.error).toBe("network_error");
        expect(capture).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "token_exchange" }),
        );
      });

      it("captures a flattened-to-invalid_code failure under the token_exchange phase", async () => {
        const capture = vi.fn();

        const result = await verifyGoogleCallback(
          mockConfig,
          mockRedirectUri,
          { ...validCallback, code: "invalid-code" },
          capture,
        );

        expect(result.error).toBe("invalid_code");
        expect(capture).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "token_exchange" }),
        );
      });

      it("does NOT capture on the happy path", async () => {
        const capture = vi.fn();
        setupMockUserinfo({
          sub: generateGoogleUserId(),
          email: faker.internet.email().toLowerCase(),
          email_verified: true,
        });

        const result = await verifyGoogleCallback(mockConfig, mockRedirectUri, validCallback, capture);

        expect(result.success).toBe(true);
        expect(capture).not.toHaveBeenCalled();
      });
    });
  });
});
