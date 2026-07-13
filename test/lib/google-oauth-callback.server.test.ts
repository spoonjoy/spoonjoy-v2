/**
 * Tests for Google OAuth callback handling.
 *
 * This tests the full callback flow including:
 * - Token verification with PKCE (code exchange)
 * - User info fetch from Google
 * - User creation (new OAuth user)
 * - Account linking (existing user)
 * - Session creation
 * - Redirect logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import {
  handleGoogleOAuthCallback,
  type GoogleOAuthCallbackParams,
  type GoogleOAuthCallbackResult,
} from "~/lib/google-oauth-callback.server";
import type { GoogleUser } from "~/lib/google-oauth.server";
import { createTestUser } from "../utils";

describe("google-oauth-callback.server", () => {
  // Helper to generate unique Google user IDs
  function generateGoogleUserId(): string {
    return faker.string.numeric(21);
  }

  // Helper to create mock Google user data
  function createMockGoogleUser(overrides?: Partial<GoogleUser>): GoogleUser {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
      id: generateGoogleUserId(),
      email: faker.internet.email().toLowerCase(),
      emailVerified: true,
      name: `${firstName} ${lastName}`,
      givenName: firstName,
      familyName: lastName,
      picture: `https://lh3.googleusercontent.com/a-/${faker.string.alphanumeric(28)}`,
      ...overrides,
    };
  }

  // Test users created during tests (for cleanup)
  const testUserIds: string[] = [];

  afterEach(async () => {
    // Clean up test users in reverse order
    for (const userId of testUserIds.reverse()) {
      try {
        await db.oAuth.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      } catch {
        // Ignore errors if already deleted
      }
    }
    testUserIds.length = 0;
    vi.restoreAllMocks();
  });

  describe("handleGoogleOAuthCallback", () => {
    describe("new user creation", () => {
      it("should create a new user when Google user does not exist", async () => {
        const mockGoogleUser = createMockGoogleUser();

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null, // Not logged in
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("user_created");
        expect(result.userId).toBeDefined();

        // Track for cleanup
        if (result.userId) testUserIds.push(result.userId);

        // Verify user was created in database
        const user = await db.user.findUnique({
          where: { id: result.userId },
          include: { OAuth: true },
        });
        expect(user).not.toBeNull();
        expect(user?.email).toBe(mockGoogleUser.email);
        expect(user?.hashedPassword).toBeNull();
        expect(user?.OAuth).toHaveLength(1);
        expect(user?.OAuth[0].provider).toBe("google");
        expect(user?.OAuth[0].providerUserId).toBe(mockGoogleUser.id);
      });

      it("should generate username from Google user name", async () => {
        const mockGoogleUser = createMockGoogleUser({
          givenName: "John",
          familyName: "Doe",
          name: "John Doe",
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);

        const user = await db.user.findUnique({
          where: { id: result.userId },
        });
        // Username should be derived from name
        expect(user?.username.toLowerCase()).toContain("john");
      });

      it("should handle user creation when name is not provided", async () => {
        const mockGoogleUser = createMockGoogleUser({
          givenName: null,
          familyName: null,
          name: null,
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);
        expect(result.action).toBe("user_created");

        // Username should be derived from email
        const user = await db.user.findUnique({
          where: { id: result.userId },
        });
        expect(user?.username).toBeDefined();
      });

      it("should store providerUsername as name or email", async () => {
        const mockGoogleUser = createMockGoogleUser({
          givenName: "Jane",
          familyName: "Smith",
          name: "Jane Smith",
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        const user = await db.user.findUnique({
          where: { id: result.userId },
          include: { OAuth: true },
        });

        // providerUsername should be the full name
        expect(user?.OAuth[0].providerUsername).toBe("Jane Smith");
      });

      it("should use email as providerUsername when name not available", async () => {
        const mockGoogleUser = createMockGoogleUser({
          givenName: null,
          familyName: null,
          name: null,
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        const user = await db.user.findUnique({
          where: { id: result.userId },
          include: { OAuth: true },
        });

        // providerUsername should fall back to email
        expect(user?.OAuth[0].providerUsername).toBe(mockGoogleUser.email);
      });
    });

    describe("returning user login", () => {
      it("should log in existing Google OAuth user", async () => {
        // First, create a user with Google OAuth
        const mockGoogleUser = createMockGoogleUser();
        const createParams: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };
        const createResult = await handleGoogleOAuthCallback(createParams);
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Now simulate the same Google user returning
        const loginParams: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const loginResult = await handleGoogleOAuthCallback(loginParams);

        expect(loginResult.success).toBe(true);
        expect(loginResult.action).toBe("user_logged_in");
        expect(loginResult.userId).toBe(createResult.userId);
      });

      it("should return existing user on subsequent logins", async () => {
        // First sign-in
        const mockGoogleUser = createMockGoogleUser();
        const createResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Second sign-in
        const loginResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(loginResult.success).toBe(true);
        expect(loginResult.action).toBe("user_logged_in");
        expect(loginResult.userId).toBe(createResult.userId);
      });
    });

    describe("account linking", () => {
      it("should link Google OAuth to existing logged-in user", async () => {
        // Create a user with password auth (no OAuth)
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        const mockGoogleUser = createMockGoogleUser({
          email: testUserData.email.toLowerCase(),
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: existingUser.id, // User is logged in
          redirectTo: "/settings",
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");
        expect(result.userId).toBe(existingUser.id);

        // Verify OAuth record was created
        const oauth = await db.oAuth.findUnique({
          where: {
            userId_provider: {
              userId: existingUser.id,
              provider: "google",
            },
          },
        });
        expect(oauth).not.toBeNull();
        expect(oauth?.providerUserId).toBe(mockGoogleUser.id);
      });

      it("should link Google OAuth even when email differs from existing user", async () => {
        // Create a user with a different email
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Google user has different email (but user is logged in, so we trust them)
        const mockGoogleUser = createMockGoogleUser({
          email: faker.internet.email().toLowerCase(),
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings",
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");
      });

      it("should use email as providerUsername when linking without name", async () => {
        // Create a user with password auth (no OAuth)
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Google user without name
        const mockGoogleUser = createMockGoogleUser({
          givenName: null,
          familyName: null,
          name: null,
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings",
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");

        // Verify providerUsername is the email
        const oauth = await db.oAuth.findUnique({
          where: {
            userId_provider: {
              userId: existingUser.id,
              provider: "google",
            },
          },
        });
        expect(oauth?.providerUsername).toBe(mockGoogleUser.email);
      });

      it("should return error when Google account already linked to different user", async () => {
        // Create first user with Google OAuth
        const mockGoogleUser = createMockGoogleUser();
        const firstUserResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (firstUserResult.userId) testUserIds.push(firstUserResult.userId);

        // Create second user
        const secondUserData = createTestUser();
        const secondUser = await db.user.create({
          data: secondUserData,
        });
        testUserIds.push(secondUser.id);

        // Try to link same Google account to second user
        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: secondUser.id,
          redirectTo: "/settings",
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("provider_account_taken");
        expect(result.message).toContain("already linked");
      });

      it("should return error when user already has Google linked", async () => {
        // Create user with Google OAuth
        const mockGoogleUser = createMockGoogleUser();
        const createResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Try to link a different Google account to same user
        const differentGoogleUser = createMockGoogleUser();

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: differentGoogleUser,
          currentUserId: createResult.userId!,
          redirectTo: "/settings",
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("provider_already_linked");
        expect(result.message).toContain("already linked");
      });
    });

    describe("createOAuthUser error handling", () => {
      it("should propagate createOAuthUser errors when user creation fails", async () => {
        // Mock createOAuthUser to return an error
        const oauthUserModule = await import("~/lib/oauth-user.server");
        const createOAuthUserSpy = vi.spyOn(oauthUserModule, "createOAuthUser");
        createOAuthUserSpy.mockResolvedValueOnce({
          success: false,
          error: "email_required",
          message: "Email is required but was not provided",
        });

        const mockGoogleUser = createMockGoogleUser();

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("email_required");
        expect(result.message).toContain("Email");

        createOAuthUserSpy.mockRestore();
      });
    });

    describe("email collision handling", () => {
      it("should restore a missing Google OAuth row when verified email exists", async () => {
        // Create existing user with email
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Google user has same email but user is not logged in
        const mockGoogleUser = createMockGoogleUser({
          email: testUserData.email.toLowerCase(),
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null, // Not logged in
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");
        expect(result.userId).toBe(existingUser.id);

        const oauth = await db.oAuth.findUnique({
          where: { userId_provider: { userId: existingUser.id, provider: "google" } },
        });
        expect(oauth).toMatchObject({
          provider: "google",
          providerUserId: mockGoogleUser.id,
          providerUsername: mockGoogleUser.name,
        });
      });

      it("should restore by verified email case-insensitively", async () => {
        // Create existing user with email
        const testUserData = createTestUser();
        testUserData.email = "Test@Example.COM";
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Google user has same email but different case
        const mockGoogleUser = createMockGoogleUser({
          email: "test@example.com",
        });

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");
        expect(result.userId).toBe(existingUser.id);
      });

      it("should reject unverified Google email before linking or creating", async () => {
        const mockGoogleUser = createMockGoogleUser({
          emailVerified: false,
        });

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(result).toMatchObject({
          success: false,
          error: "email_unverified",
          redirectTo: "/",
        });
        expect(result.userId).toBeUndefined();
      });
    });

    describe("session creation", () => {
      it("should include userId in result for session creation", async () => {
        const mockGoogleUser = createMockGoogleUser();

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleGoogleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);
        expect(result.userId).toBeDefined();
        expect(typeof result.userId).toBe("string");
      });

      it("should return userId on successful login for session", async () => {
        // Create user first
        const mockGoogleUser = createMockGoogleUser();
        const createResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Login again
        const loginResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(loginResult.success).toBe(true);
        expect(loginResult.userId).toBe(createResult.userId);
      });

      it("should not return userId on error", async () => {
        const mockGoogleUser = createMockGoogleUser({
          emailVerified: false,
        });

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(result.success).toBe(false);
        expect(result.userId).toBeUndefined();
      });
    });

    describe("redirect logic", () => {
      it("should return default redirect for new user signup", async () => {
        const mockGoogleUser = createMockGoogleUser();

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null, // No specific redirect
        };

        const result = await handleGoogleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);
        expect(result.redirectTo).toBe("/"); // Default to home
      });

      it("should return default redirect for returning user login", async () => {
        const mockGoogleUser = createMockGoogleUser();
        const createResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        const loginResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(loginResult.redirectTo).toBe("/"); // Default to home
      });

      it("should return settings redirect for account linking", async () => {
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        const mockGoogleUser = createMockGoogleUser();

        const params: GoogleOAuthCallbackParams = {
          db,
          googleUser: mockGoogleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings", // Linking from settings
        };

        const result = await handleGoogleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.redirectTo).toBe("/settings");
      });

      it("should honor custom redirectTo for login", async () => {
        const mockGoogleUser = createMockGoogleUser();
        const createResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        const loginResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: "/recipes",
        });

        expect(loginResult.redirectTo).toBe("/recipes");
      });

      it("should honor custom redirectTo for signup", async () => {
        const mockGoogleUser = createMockGoogleUser();

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: "/onboarding",
        });
        if (result.userId) testUserIds.push(result.userId);

        expect(result.redirectTo).toBe("/onboarding");
      });

      it("should include redirectTo in error results for retry flow", async () => {
        const mockGoogleUser = createMockGoogleUser({
          emailVerified: false,
        });

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: "/login",
        });

        expect(result.success).toBe(false);
        // Error results should still include the original redirectTo for retry
        expect(result.redirectTo).toBe("/login");
      });
    });

    describe("result actions", () => {
      it("should return action=user_created for new signups", async () => {
        const mockGoogleUser = createMockGoogleUser();

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (result.userId) testUserIds.push(result.userId);

        expect(result.action).toBe("user_created");
      });

      it("should return action=user_logged_in for returning users", async () => {
        const mockGoogleUser = createMockGoogleUser();
        const createResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        const loginResult = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(loginResult.action).toBe("user_logged_in");
      });

      it("should return action=account_linked for linking flow", async () => {
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        const mockGoogleUser = createMockGoogleUser();

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings",
        });

        expect(result.action).toBe("account_linked");
      });

      it("should not include action on error", async () => {
        const mockGoogleUser = createMockGoogleUser({
          emailVerified: false,
        });

        const result = await handleGoogleOAuthCallback({
          db,
          googleUser: mockGoogleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(result.success).toBe(false);
        expect(result.action).toBeUndefined();
      });
    });
  });
});
