/**
 * Tests for Apple OAuth callback handling.
 *
 * This tests the full callback flow including:
 * - Token verification (delegated to verifyAppleCallback)
 * - User creation (new OAuth user)
 * - Account linking (existing user)
 * - Session creation
 * - Redirect logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import {
  handleAppleOAuthCallback,
  type AppleOAuthCallbackParams,
  type AppleOAuthCallbackResult,
} from "~/lib/apple-oauth-callback.server";
import type { AppleUser } from "~/lib/apple-oauth.server";
import { createTestUser } from "../utils";

describe("apple-oauth-callback.server", () => {
  // Helper to generate unique Apple user IDs
  function generateAppleUserId(): string {
    return faker.string.alphanumeric(44);
  }

  // Helper to create mock Apple user data
  function createMockAppleUser(overrides?: Partial<AppleUser>): AppleUser {
    return {
      id: generateAppleUserId(),
      email: faker.internet.email().toLowerCase(),
      emailVerified: true,
      isPrivateEmail: false,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      fullName: `${faker.person.firstName()} ${faker.person.lastName()}`,
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

  describe("handleAppleOAuthCallback", () => {
    describe("new user creation", () => {
      it("should create a new user when Apple user does not exist", async () => {
        const mockAppleUser = createMockAppleUser();

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null, // Not logged in
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);

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
        expect(user?.email).toBe(mockAppleUser.email);
        expect(user?.hashedPassword).toBeNull();
        expect(user?.OAuth).toHaveLength(1);
        expect(user?.OAuth[0].provider).toBe("apple");
        expect(user?.OAuth[0].providerUserId).toBe(mockAppleUser.id);
        // Apple verified this address, so the new account starts verified.
        expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
      });

      it("should create an unverified account when Apple does not vouch for the email", async () => {
        const result = await handleAppleOAuthCallback({
          db,
          appleUser: createMockAppleUser({ emailVerified: false }),
          currentUserId: null,
          redirectTo: null,
        });
        if (result.userId) testUserIds.push(result.userId);

        expect(result.action).toBe("user_created");
        expect((await db.user.findUniqueOrThrow({ where: { id: result.userId! } })).emailVerifiedAt).toBeNull();
      });

      it("should generate username from Apple user name", async () => {
        const mockAppleUser = createMockAppleUser({
          firstName: "John",
          lastName: "Doe",
          fullName: "John Doe",
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);

        const user = await db.user.findUnique({
          where: { id: result.userId },
        });
        // Username should be derived from name
        expect(user?.username.toLowerCase()).toContain("john");
      });

      it("should handle user creation when name is not provided", async () => {
        const mockAppleUser = createMockAppleUser({
          firstName: null,
          lastName: null,
          fullName: null,
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);
        expect(result.action).toBe("user_created");

        // Username should be derived from email
        const user = await db.user.findUnique({
          where: { id: result.userId },
        });
        expect(user?.username).toBeDefined();
      });

      it("should store providerUsername as fullName or email", async () => {
        const mockAppleUser = createMockAppleUser({
          firstName: "Jane",
          lastName: "Smith",
          fullName: "Jane Smith",
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        const user = await db.user.findUnique({
          where: { id: result.userId },
          include: { OAuth: true },
        });

        // providerUsername should be the full name
        expect(user?.OAuth[0].providerUsername).toBe("Jane Smith");
      });

      it("should use email as providerUsername when name not available", async () => {
        const mockAppleUser = createMockAppleUser({
          firstName: null,
          lastName: null,
          fullName: null,
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        const user = await db.user.findUnique({
          where: { id: result.userId },
          include: { OAuth: true },
        });

        // providerUsername should fall back to email
        expect(user?.OAuth[0].providerUsername).toBe(mockAppleUser.email);
      });
    });

    describe("returning user login", () => {
      it("should log in existing Apple OAuth user", async () => {
        // First, create a user with Apple OAuth
        const mockAppleUser = createMockAppleUser();
        const createParams: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };
        const createResult = await handleAppleOAuthCallback(createParams);
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Now simulate the same Apple user returning
        const loginParams: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const loginResult = await handleAppleOAuthCallback(loginParams);

        expect(loginResult.success).toBe(true);
        expect(loginResult.action).toBe("user_logged_in");
        expect(loginResult.userId).toBe(createResult.userId);
      });

      it("should return existing user even without name (subsequent logins)", async () => {
        // First sign-in with name
        const mockAppleUserWithName = createMockAppleUser({
          firstName: "Test",
          lastName: "User",
          fullName: "Test User",
        });
        const createResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUserWithName,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Subsequent sign-in without name (Apple only sends name on first sign-in)
        const mockAppleUserNoName: AppleUser = {
          ...mockAppleUserWithName,
          firstName: null,
          lastName: null,
          fullName: null,
        };

        const loginResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUserNoName,
          currentUserId: null,
          redirectTo: null,
        });

        expect(loginResult.success).toBe(true);
        expect(loginResult.action).toBe("user_logged_in");
        expect(loginResult.userId).toBe(createResult.userId);
      });
    });

    describe("account linking", () => {
      it("should link Apple OAuth to existing logged-in user", async () => {
        // Create a user with password auth (no OAuth)
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        const mockAppleUser = createMockAppleUser({
          email: testUserData.email.toLowerCase(),
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: existingUser.id, // User is logged in
          redirectTo: "/settings",
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");
        expect(result.userId).toBe(existingUser.id);

        // Verify OAuth record was created
        const oauth = await db.oAuth.findUnique({
          where: {
            userId_provider: {
              userId: existingUser.id,
              provider: "apple",
            },
          },
        });
        expect(oauth).not.toBeNull();
        expect(oauth?.providerUserId).toBe(mockAppleUser.id);
        // Apple vouched for the account's own address, so linking it verifies the account.
        expect((await db.user.findUniqueOrThrow({ where: { id: existingUser.id } })).emailVerifiedAt).toBeInstanceOf(Date);
      });

      it("should link Apple OAuth even when email differs from existing user", async () => {
        // Create a user with a different email
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Apple user has different email (but user is logged in, so we trust them)
        const mockAppleUser = createMockAppleUser({
          email: faker.internet.email().toLowerCase(),
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings",
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");
        // A different address proves nothing about the account's own email.
        expect((await db.user.findUniqueOrThrow({ where: { id: existingUser.id } })).emailVerifiedAt).toBeNull();
      });

      it("should use email as providerUsername when linking without fullName", async () => {
        // Create a user with password auth (no OAuth)
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Apple user without name (returning user scenario)
        const mockAppleUser = createMockAppleUser({
          firstName: null,
          lastName: null,
          fullName: null,
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings",
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.action).toBe("account_linked");

        // Verify providerUsername is the email
        const oauth = await db.oAuth.findUnique({
          where: {
            userId_provider: {
              userId: existingUser.id,
              provider: "apple",
            },
          },
        });
        expect(oauth?.providerUsername).toBe(mockAppleUser.email);
      });

      it("should return error when Apple account already linked to different user", async () => {
        // Create first user with Apple OAuth
        const mockAppleUser = createMockAppleUser();
        const firstUserResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
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

        // Try to link same Apple account to second user
        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: secondUser.id,
          redirectTo: "/settings",
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("provider_account_taken");
        expect(result.message).toContain("already linked");
      });

      it("should return error when user already has Apple linked", async () => {
        // Create user with Apple OAuth
        const mockAppleUser = createMockAppleUser();
        const createResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Try to link a different Apple account to same user
        const differentAppleUser = createMockAppleUser();

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: differentAppleUser,
          currentUserId: createResult.userId!,
          redirectTo: "/settings",
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("provider_already_linked");
        expect(result.message).toContain("already linked");
      });
    });

    describe("createOAuthUser error handling", () => {
      it("should propagate createOAuthUser errors when user creation fails", async () => {
        // This edge case tests when createOAuthUser fails for reasons other than
        // email collision (which is already checked separately).
        // The most likely case is when Apple returns a user with no email
        // (which shouldn't happen, but the code handles it defensively).

        // We need to mock createOAuthUser to return an error
        // Since we can't easily mock it without changing the implementation,
        // we'll test the scenario where email is required but missing
        // by using a mock that returns email_required error.

        // Note: In practice, this path is defensive - Apple always returns email
        // when the scope is requested. But we test it for complete coverage.
        const { createOAuthUser } = await import("~/lib/oauth-user.server");
        const originalCreateOAuthUser = createOAuthUser;

        // Mock createOAuthUser at the module level
        const oauthUserModule = await import("~/lib/oauth-user.server");
        const createOAuthUserSpy = vi.spyOn(oauthUserModule, "createOAuthUser");
        createOAuthUserSpy.mockResolvedValueOnce({
          success: false,
          error: "email_required",
          message: "Email is required but was not provided",
        });

        const mockAppleUser = createMockAppleUser();

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("email_required");
        expect(result.message).toContain("Email");

        createOAuthUserSpy.mockRestore();
      });
    });

    describe("email collision handling", () => {
      it("should return error when email exists but user not logged in", async () => {
        // Create existing user with email
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Apple user has same email but user is not logged in
        const mockAppleUser = createMockAppleUser({
          email: testUserData.email.toLowerCase(),
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null, // Not logged in
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("account_exists");
        expect(result.message).toContain("log in");
      });

      it("should handle case-insensitive email collision", async () => {
        // Create existing user with email
        const testUserData = createTestUser();
        testUserData.email = "Test@Example.COM";
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Apple user has same email but different case
        const mockAppleUser = createMockAppleUser({
          email: "test@example.com",
        });

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(false);
        expect(result.error).toBe("account_exists");
      });
    });

    describe("session creation", () => {
      it("should include userId in result for session creation", async () => {
        const mockAppleUser = createMockAppleUser();

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        };

        const result = await handleAppleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);
        expect(result.userId).toBeDefined();
        expect(typeof result.userId).toBe("string");
      });

      it("should return userId on successful login for session", async () => {
        // Create user first
        const mockAppleUser = createMockAppleUser();
        const createResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        // Login again
        const loginResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(loginResult.success).toBe(true);
        expect(loginResult.userId).toBe(createResult.userId);
      });

      it("should not return userId on error", async () => {
        // Create user with email
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        // Try to create with same email (not logged in)
        const mockAppleUser = createMockAppleUser({
          email: testUserData.email.toLowerCase(),
        });

        const result = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(result.success).toBe(false);
        expect(result.userId).toBeUndefined();
      });
    });

    describe("redirect logic", () => {
      it("should return default redirect for new user signup", async () => {
        const mockAppleUser = createMockAppleUser();

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null, // No specific redirect
        };

        const result = await handleAppleOAuthCallback(params);
        if (result.userId) testUserIds.push(result.userId);

        expect(result.success).toBe(true);
        expect(result.redirectTo).toBe("/"); // Default to home
      });

      it("should return default redirect for returning user login", async () => {
        const mockAppleUser = createMockAppleUser();
        const createResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        const loginResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
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

        const mockAppleUser = createMockAppleUser();

        const params: AppleOAuthCallbackParams = {
          db,
          appleUser: mockAppleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings", // Linking from settings
        };

        const result = await handleAppleOAuthCallback(params);

        expect(result.success).toBe(true);
        expect(result.redirectTo).toBe("/settings");
      });

      it("should honor custom redirectTo for login", async () => {
        const mockAppleUser = createMockAppleUser();
        const createResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        const loginResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: "/recipes",
        });

        expect(loginResult.redirectTo).toBe("/recipes");
      });

      it("should honor custom redirectTo for signup", async () => {
        const mockAppleUser = createMockAppleUser();

        const result = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: "/onboarding",
        });
        if (result.userId) testUserIds.push(result.userId);

        expect(result.redirectTo).toBe("/onboarding");
      });

      it("should include redirectTo in error results for retry flow", async () => {
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        const mockAppleUser = createMockAppleUser({
          email: testUserData.email.toLowerCase(),
        });

        const result = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
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
        const mockAppleUser = createMockAppleUser();

        const result = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (result.userId) testUserIds.push(result.userId);

        expect(result.action).toBe("user_created");
      });

      it("should return action=user_logged_in for returning users", async () => {
        const mockAppleUser = createMockAppleUser();
        const createResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });
        if (createResult.userId) testUserIds.push(createResult.userId);

        const loginResult = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
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

        const mockAppleUser = createMockAppleUser();

        const result = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: existingUser.id,
          redirectTo: "/settings",
        });

        expect(result.action).toBe("account_linked");
      });

      it("should not include action on error", async () => {
        const testUserData = createTestUser();
        const existingUser = await db.user.create({
          data: testUserData,
        });
        testUserIds.push(existingUser.id);

        const mockAppleUser = createMockAppleUser({
          email: testUserData.email.toLowerCase(),
        });

        const result = await handleAppleOAuthCallback({
          db,
          appleUser: mockAppleUser,
          currentUserId: null,
          redirectTo: null,
        });

        expect(result.success).toBe(false);
        expect(result.action).toBeUndefined();
      });
    });
  });
  // Accounts made before email verification existed become verified when they sign in again
  // through a provider that vouches for the account's own address, and only then.
  it("verifies a returning apple account whose email the provider vouches for", async () => {
    const existingUser = await db.user.create({ data: { ...createTestUser(), email: "returning.apple@example.com" } });
    testUserIds.push(existingUser.id);
    const providerUserId = faker.string.numeric(10);
    await db.oAuth.create({
      data: { userId: existingUser.id, provider: "apple", providerUserId, providerUsername: "returning" },
    });
    const signIn = (email: string, emailVerified: boolean) =>
      handleAppleOAuthCallback({
        db,
        appleUser: createMockAppleUser({ id: providerUserId, email, emailVerified }),
        currentUserId: null,
        redirectTo: null,
      });
    const verifiedAt = async () => (await db.user.findUniqueOrThrow({ where: { id: existingUser.id } })).emailVerifiedAt;

    await expect(signIn("returning.apple@example.com", false)).resolves.toMatchObject({ action: "user_logged_in" });
    await expect(signIn("someone.else@example.com", true)).resolves.toMatchObject({ action: "user_logged_in" });
    expect(await verifiedAt()).toBeNull();

    await expect(signIn("Returning.apple@Example.com", true)).resolves.toMatchObject({ action: "user_logged_in" });
    expect(await verifiedAt()).toBeInstanceOf(Date);
  });
});
