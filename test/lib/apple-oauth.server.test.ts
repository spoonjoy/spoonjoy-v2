import { describe, it, expect, vi, beforeEach } from "vitest";
import { faker } from "@faker-js/faker";
import type { AppleOAuthConfig } from "~/lib/env.server";

// Use vi.hoisted to create mock state that's available at mock time
const { mockArcticState } = vi.hoisted(() => {
  return {
    mockArcticState: {
      appleUserId: "default-user-id",
      email: "default@example.com",
      emailVerified: "true" as string | boolean,
      isPrivateEmail: false,
      lastPrivateKey: null as Uint8Array | null,
    },
  };
});

// Mock arctic at module level using a class for Apple
vi.mock("arctic", () => {
  // Mock Apple class
  class MockApple {
    private clientId: string;

    constructor(
      clientId: string,
      _teamId: string,
      _keyId: string,
      privateKey: Uint8Array
    ) {
      this.clientId = clientId;
      mockArcticState.lastPrivateKey = privateKey;
    }

    createAuthorizationURL(state: string, scopes: string[]): URL {
      // Create a mock URL that matches Arctic's behavior
      const url = new URL("https://appleid.apple.com/auth/authorize");
      url.searchParams.set("client_id", this.clientId);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes.join(" "));
      return url;
    }

    async validateAuthorizationCode(
      code: string,
      _redirectUri: string
    ): Promise<{ idToken: () => string }> {
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
        const error = new TypeError("fetch failed");
        throw error;
      }
      return {
        idToken: () => "mock-id-token",
      };
    }
  }

  // Mock OAuth2RequestError class
  class MockOAuth2RequestError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "OAuth2RequestError";
    }
  }

  // Counter for generating unique state values
  let stateCounter = 0;

  return {
    Apple: MockApple,
    decodeIdToken: () => ({
      sub: mockArcticState.appleUserId,
      email: mockArcticState.email,
      email_verified: mockArcticState.emailVerified,
      is_private_email: mockArcticState.isPrivateEmail,
    }),
    OAuth2RequestError: MockOAuth2RequestError,
    generateState: () => {
      // Generate unique URL-safe state values
      stateCounter++;
      return `mock-state-${stateCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    },
  };
});

import {
  createAppleAuthorizationURL,
  generateOAuthState,
  serializeAppleAuthorizationURL,
  verifyAppleCallback,
  type AppleCallbackData,
  type AppleCallbackResult,
} from "~/lib/apple-oauth.server";

describe("apple-oauth.server", () => {
  const mockConfig: AppleOAuthConfig = {
    clientId: "com.spoonjoy.app",
    teamId: "TEAM123456",
    keyId: "KEY123456",
    privateKey: `-----BEGIN PRIVATE KEY-----
dGVzdA==
-----END PRIVATE KEY-----`,
  };
  const mockRedirectUri = "https://spoonjoy.app/auth/apple/callback";

  describe("generateOAuthState", () => {
    it("should generate a random state string", () => {
      const state = generateOAuthState();

      expect(typeof state).toBe("string");
      expect(state.length).toBeGreaterThan(0);
    });

    it("should generate unique state values on each call", () => {
      const state1 = generateOAuthState();
      const state2 = generateOAuthState();

      expect(state1).not.toBe(state2);
    });

    it("should generate URL-safe state values", () => {
      const state = generateOAuthState();

      // State should be URL-safe (alphanumeric, no special chars that need encoding)
      expect(state).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it("should generate state with sufficient length for security", () => {
      const state = generateOAuthState();

      // 32 bytes of randomness in base64url = ~43 characters
      // Should be at least 32 chars for adequate entropy
      expect(state.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe("createAppleAuthorizationURL", () => {
    it("should return a valid Apple authorization URL", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      expect(url).toBeInstanceOf(URL);
      expect(url.hostname).toBe("appleid.apple.com");
      expect(url.pathname).toBe("/auth/authorize");
    });

    it("should include client_id parameter", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      expect(url.searchParams.get("client_id")).toBe(mockConfig.clientId);
    });

    it("should include redirect_uri parameter", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      expect(url.searchParams.get("redirect_uri")).toBe(mockRedirectUri);
    });

    it("should accept decodable PEM private keys", () => {
      const state = "test-state-123";
      const configWithDecodableKey: AppleOAuthConfig = {
        ...mockConfig,
        privateKey: `-----BEGIN PRIVATE KEY-----
dGVzdA==
-----END PRIVATE KEY-----`,
      };

      const url = createAppleAuthorizationURL(configWithDecodableKey, mockRedirectUri, state);

      expect(url.searchParams.get("client_id")).toBe(mockConfig.clientId);
    });

    it("should accept quoted PEM private keys with escaped newlines", () => {
      const state = "test-state-123";
      const configWithEscapedKey: AppleOAuthConfig = {
        ...mockConfig,
        privateKey: `"-----BEGIN PRIVATE KEY-----\\ndGVzdA==\\n-----END PRIVATE KEY-----"`,
      };

      const url = createAppleAuthorizationURL(configWithEscapedKey, mockRedirectUri, state);

      expect(url.searchParams.get("client_id")).toBe(mockConfig.clientId);
      expect(new TextDecoder().decode(mockArcticState.lastPrivateKey ?? new Uint8Array())).toBe("test");
    });

    it("should keep fake non-PEM keys usable for tests", () => {
      const state = "test-state-123";
      const configWithFakeKey: AppleOAuthConfig = {
        ...mockConfig,
        privateKey: " fake-private-key ",
      };

      const url = createAppleAuthorizationURL(configWithFakeKey, mockRedirectUri, state);

      expect(url.searchParams.get("client_id")).toBe(mockConfig.clientId);
      expect(new TextDecoder().decode(mockArcticState.lastPrivateKey ?? new Uint8Array())).toBe("fake-private-key");
    });

    it("should reject malformed PEM private keys", () => {
      const state = "test-state-123";
      const configWithMalformedKey: AppleOAuthConfig = {
        ...mockConfig,
        privateKey: `-----BEGIN PRIVATE KEY-----
not-base64-@@@
-----END PRIVATE KEY-----`,
      };

      expect(() => createAppleAuthorizationURL(configWithMalformedKey, mockRedirectUri, state)).toThrow(
        "Apple private key must be a valid PKCS8 PEM private key"
      );
    });

    it("should include state parameter for CSRF protection", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      expect(url.searchParams.get("state")).toBe(state);
    });

    it("should include response_type=code", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      expect(url.searchParams.get("response_type")).toBe("code");
    });

    it("should include response_mode=form_post (required by Apple for scopes)", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      // Apple requires response_mode=form_post when requesting scopes
      expect(url.searchParams.get("response_mode")).toBe("form_post");
    });

    it("should request email scope", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      const scope = url.searchParams.get("scope");
      expect(scope).toContain("email");
    });

    it("should request name scope", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      const scope = url.searchParams.get("scope");
      expect(scope).toContain("name");
    });

    it("should include both email and name in scope parameter", () => {
      const state = "test-state-123";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      const scope = url.searchParams.get("scope");
      // Scope should include both email and name (space-separated)
      expect(scope).toMatch(/\bemail\b/);
      expect(scope).toMatch(/\bname\b/);
    });

    it("should properly encode special characters in state", () => {
      const state = "state&with=special+chars";
      const url = createAppleAuthorizationURL(mockConfig, mockRedirectUri, state);

      // URLSearchParams should handle encoding
      expect(url.searchParams.get("state")).toBe(state);
      // The raw URL string should have the encoded value
      expect(url.toString()).toContain("state=state%26with%3Dspecial%2Bchars");
    });

    it("should properly encode redirect_uri with query parameters", () => {
      const state = "test-state";
      const redirectWithQuery =
        "https://spoonjoy.app/auth/apple/callback?foo=bar&baz=qux";
      const url = createAppleAuthorizationURL(
        mockConfig,
        redirectWithQuery,
        state
      );

      // Should properly encode the redirect_uri
      expect(url.searchParams.get("redirect_uri")).toBe(redirectWithQuery);
    });
  });

  describe("serializeAppleAuthorizationURL", () => {
    it("re-encodes the scope space as %20 instead of +", () => {
      const url = new URL("https://appleid.apple.com/auth/authorize?client_id=x&state=s");
      url.searchParams.set("scope", "email name");
      expect(url.toString()).toContain("scope=email+name"); // URL serializes space as +

      const serialized = serializeAppleAuthorizationURL(url);
      expect(serialized).toContain("scope=email%20name");
      expect(serialized).not.toContain("scope=email+name");
      // other params are left intact
      expect(serialized).toContain("client_id=x");
      expect(serialized).toContain("state=s");
    });

    it("leaves a single-token scope unchanged", () => {
      const url = new URL("https://appleid.apple.com/auth/authorize?scope=email&state=s");
      expect(serializeAppleAuthorizationURL(url)).toContain("scope=email&");
    });

    it("is a no-op when there is no scope param", () => {
      const url = new URL("https://appleid.apple.com/auth/authorize?state=s");
      expect(serializeAppleAuthorizationURL(url)).toBe(
        "https://appleid.apple.com/auth/authorize?state=s",
      );
    });
  });

  describe("verifyAppleCallback", () => {
    const mockConfig: AppleOAuthConfig = {
      clientId: "com.spoonjoy.app",
      teamId: "TEAM123456",
      keyId: "KEY123456",
      privateKey: `-----BEGIN PRIVATE KEY-----
dGVzdA==
-----END PRIVATE KEY-----`,
    };
    const mockRedirectUri = "https://spoonjoy.app/auth/apple/callback";

    // Helper to generate unique Apple user IDs
    function generateAppleUserId(): string {
      return faker.string.alphanumeric(44);
    }

    describe("token verification", () => {
      it("should return error for invalid authorization code", async () => {
        const callbackData: AppleCallbackData = {
          code: "invalid-code",
          state: "test-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_code");
        expect(result.message).toContain("authorization code");
      });

      it("should return error when state is missing", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-code",
          state: "",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_state");
        expect(result.message).toContain("state");
      });

      it("should return error when code is missing", async () => {
        const callbackData: AppleCallbackData = {
          code: "",
          state: "test-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_code");
        expect(result.message).toContain("code");
      });

      it("should extract user ID (sub) from valid ID token", async () => {
        // This test will use mocked Arctic to verify token decoding
        const testAppleUserId = generateAppleUserId();
        const testEmail = faker.internet.email().toLowerCase();

        // Set mock state for this test
        mockArcticState.appleUserId = testAppleUserId;
        mockArcticState.email = testEmail;
        mockArcticState.emailVerified = "true";

        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.id).toBe(testAppleUserId);
      });

      it("should extract email from ID token", async () => {
        const testAppleUserId = generateAppleUserId();
        const testEmail = faker.internet.email().toLowerCase();

        // Set mock state for this test
        mockArcticState.appleUserId = testAppleUserId;
        mockArcticState.email = testEmail;

        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
        };

        // Result should contain email from token
        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.email).toBeDefined();
      });

      it("should handle Apple OAuth2RequestError", async () => {
        const callbackData: AppleCallbackData = {
          code: "code-that-triggers-oauth-error",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("oauth_error");
      });

      it("should handle OAuth2RequestError with empty message", async () => {
        const callbackData: AppleCallbackData = {
          code: "code-that-triggers-oauth-error-no-message",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("oauth_error");
        expect(result.message).toBe("OAuth error occurred");
      });

      it("should handle network/fetch errors gracefully", async () => {
        const callbackData: AppleCallbackData = {
          code: "code-that-triggers-network-error",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("network_error");
      });

      it("should report malformed PEM keys as OAuth configuration errors", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          {
            ...mockConfig,
            privateKey: `-----BEGIN PRIVATE KEY-----
not-base64-@@@
-----END PRIVATE KEY-----`,
          },
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("oauth_unconfigured");
      });
    });

    describe("user data extraction", () => {
      beforeEach(() => {
        // Reset mock state before each user data extraction test
        mockArcticState.appleUserId = generateAppleUserId();
        mockArcticState.email = faker.internet.email().toLowerCase();
        mockArcticState.emailVerified = "true";
        mockArcticState.isPrivateEmail = false;
      });

      it("should extract name from user parameter on first sign-in", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: JSON.stringify({
            name: {
              firstName: "John",
              lastName: "Doe",
            },
            email: "john.doe@example.com",
          }),
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.firstName).toBe("John");
        expect(result.appleUser?.lastName).toBe("Doe");
      });

      it("should handle missing name in user parameter", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: JSON.stringify({
            email: "anonymous@example.com",
          }),
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.firstName).toBeNull();
        expect(result.appleUser?.lastName).toBeNull();
      });

      it("should handle no user parameter (returning user)", async () => {
        // Apple only sends user info on first sign-in
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          // No user parameter
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.firstName).toBeNull();
        expect(result.appleUser?.lastName).toBeNull();
      });

      it("should handle invalid JSON in user parameter", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: "not-valid-json{{{",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        // Should still succeed but without name data
        expect(result.success).toBe(true);
        expect(result.appleUser?.firstName).toBeNull();
        expect(result.appleUser?.lastName).toBeNull();
      });

      it("should handle private email (Hide My Email)", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
        };

        // When is_private_email is true in the token, the email is a relay address
        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        // The email should still be present (it's the relay email)
        expect(result.appleUser?.email).toBeDefined();
        // Should indicate if it's a private relay email
        expect(result.appleUser).toHaveProperty("isPrivateEmail");
      });

      it("should handle email_verified as string true (Apple quirk)", async () => {
        // Apple returns email_verified as "true" (string) not true (boolean)
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.emailVerified).toBe(true);
      });

      it("should construct full name from firstName and lastName", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: JSON.stringify({
            name: {
              firstName: "Jane",
              lastName: "Smith",
            },
          }),
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.fullName).toBe("Jane Smith");
      });

      it("should handle firstName only", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: JSON.stringify({
            name: {
              firstName: "Jane",
            },
          }),
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.fullName).toBe("Jane");
      });

      it("should handle lastName only", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: JSON.stringify({
            name: {
              lastName: "Smith",
            },
          }),
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser?.fullName).toBe("Smith");
      });
    });

    describe("result structure", () => {
      beforeEach(() => {
        // Reset mock state before each result structure test
        mockArcticState.appleUserId = generateAppleUserId();
        mockArcticState.email = faker.internet.email().toLowerCase();
        mockArcticState.emailVerified = "true";
        mockArcticState.isPrivateEmail = false;
      });

      it("should return AppleUser with all required fields on success", async () => {
        const callbackData: AppleCallbackData = {
          code: "valid-auth-code",
          state: "valid-state",
          user: JSON.stringify({
            name: {
              firstName: "Test",
              lastName: "User",
            },
            email: "test@example.com",
          }),
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(true);
        expect(result.appleUser).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            email: expect.any(String),
            emailVerified: expect.any(Boolean),
            isPrivateEmail: expect.any(Boolean),
            firstName: expect.any(String),
            lastName: expect.any(String),
            fullName: expect.any(String),
          })
        );
      });

      it("should not include appleUser on error", async () => {
        const callbackData: AppleCallbackData = {
          code: "",
          state: "valid-state",
        };

        const result = await verifyAppleCallback(
          mockConfig,
          mockRedirectUri,
          callbackData
        );

        expect(result.success).toBe(false);
        expect(result.appleUser).toBeUndefined();
      });
    });
  });
});
