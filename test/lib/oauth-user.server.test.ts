import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";
import { createTestUser } from "../utils";

// These imports will fail until implementation exists (TDD)
import {
  createOAuthUser,
  generateUsername,
  findExistingOAuthAccount,
  linkOAuthAccount,
  unlinkOAuthAccount,
} from "~/lib/oauth-user.server";

describe("oauth-user.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("generateUsername", () => {
    it("should generate username from full name", async () => {
      const username = await generateUsername(db, "John Smith", null);
      expect(username).toBe("john-smith");
    });

    it("should generate username from first name only", async () => {
      const username = await generateUsername(db, "Alice", null);
      expect(username).toBe("alice");
    });

    it("should generate username from email if name is null", async () => {
      const username = await generateUsername(db, null, "bob@example.com");
      expect(username).toBe("bob");
    });

    it("should generate username from email if name is empty string", async () => {
      const username = await generateUsername(db, "", "charlie@example.com");
      expect(username).toBe("charlie");
    });

    it("should handle email with dots before @", async () => {
      const username = await generateUsername(db, null, "john.doe@example.com");
      expect(username).toBe("john-doe");
    });

    it("should handle email with plus sign", async () => {
      const username = await generateUsername(db, null, "user+tag@example.com");
      expect(username).toBe("user");
    });

    it("should lowercase and replace spaces with hyphens", async () => {
      const username = await generateUsername(db, "Jane Doe Smith", null);
      expect(username).toBe("jane-doe-smith");
    });

    it("should remove special characters from name", async () => {
      const username = await generateUsername(db, "O'Brien-Jones!", null);
      expect(username).toBe("obrien-jones");
    });

    it("should handle username collision by appending number", async () => {
      // Create existing user with username "john-smith"
      const testUser = createTestUser();
      await db.user.create({
        data: {
          ...testUser,
          username: "john-smith",
        },
      });

      const username = await generateUsername(db, "John Smith", null);
      expect(username).toBe("john-smith-1");
    });

    it("should handle multiple username collisions", async () => {
      // Create existing users with username "alice" and "alice-1"
      const testUser1 = createTestUser();
      const testUser2 = createTestUser();
      await db.user.create({
        data: {
          ...testUser1,
          username: "alice",
        },
      });
      await db.user.create({
        data: {
          ...testUser2,
          username: "alice-1",
        },
      });

      const username = await generateUsername(db, "Alice", null);
      expect(username).toBe("alice-2");
    });

    it("should generate random fallback if no name or email", async () => {
      const username = await generateUsername(db, null, null);
      expect(username).toMatch(/^user-[a-z0-9]+$/);
    });

    it("should handle whitespace-only name", async () => {
      const username = await generateUsername(db, "   ", "test@example.com");
      expect(username).toBe("test");
    });
  });

  describe("createOAuthUser", () => {
    it("should create a new user from OAuth data with name", async () => {
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "John Smith",
        email: faker.internet.email().toLowerCase(),
        name: "John Smith",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.email).toBe(oauthData.email);
      expect(result.user?.username).toBe("john-smith");

      // Verify OAuth link was created
      const oauthRecord = await db.oAuth.findFirst({
        where: {
          provider: oauthData.provider,
          providerUserId: oauthData.providerUserId,
        },
      });
      expect(oauthRecord).toBeDefined();
      expect(oauthRecord?.userId).toBe(result.user?.id);
    });

    it("should create a new user from OAuth data with email only", async () => {
      const email = faker.internet.email().toLowerCase();
      const oauthData = {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: email,
        email,
        name: null,
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.email).toBe(email);
      // Username should be derived from email
      expect(result.user?.username).toBeDefined();
    });

    it("should create user without password (OAuth-only user)", async () => {
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Test User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);

      // Verify user has no password
      const user = await db.user.findUnique({
        where: { id: result.user?.id },
        select: { hashedPassword: true, salt: true },
      });
      expect(user?.hashedPassword).toBeNull();
      expect(user?.salt).toBeNull();
    });

    it("should return error when email already exists and user not logged in", async () => {
      // Create existing user with email
      const existingEmail = faker.internet.email().toLowerCase();
      const testUser = createTestUser();
      await db.user.create({
        data: {
          ...testUser,
          email: existingEmail,
        },
      });

      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Existing User",
        email: existingEmail,
        name: "Existing User",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("account_exists");
      expect(result.message).toContain("log in");
      expect(result.user).toBeUndefined();
    });

    it("should be case-insensitive for email collision check", async () => {
      // Create existing user with lowercase email
      const existingEmail = "test@example.com";
      const testUser = createTestUser();
      await db.user.create({
        data: {
          ...testUser,
          email: existingEmail,
        },
      });

      const oauthData = {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Test User",
        email: "TEST@EXAMPLE.COM",
        name: "Test User",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("account_exists");
    });

    it("should handle username collision when creating OAuth user", async () => {
      // Create existing user with username "alice"
      const testUser = createTestUser();
      await db.user.create({
        data: {
          ...testUser,
          username: "alice",
        },
      });

      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Alice",
        email: faker.internet.email().toLowerCase(),
        name: "Alice",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);
      expect(result.user?.username).toBe("alice-1");
    });

    it("should store provider username in OAuth record", async () => {
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "google_user_display_name",
        email: faker.internet.email().toLowerCase(),
        name: "Display Name",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);

      const oauthRecord = await db.oAuth.findFirst({
        where: { userId: result.user?.id },
      });
      expect(oauthRecord?.providerUsername).toBe("google_user_display_name");
    });

    it("should lowercase email when creating user", async () => {
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Test User",
        email: "TEST@EXAMPLE.COM",
        name: "Test User",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);
      expect(result.user?.email).toBe("test@example.com");
    });

    it("should handle special characters in provider username", async () => {
      const oauthData = {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Héllo Wörld! 🌍",
        email: faker.internet.email().toLowerCase(),
        name: "Héllo Wörld! 🌍",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      // Username should be sanitized
      expect(result.user?.username).toMatch(/^[a-z0-9-]+$/);
    });

    it("should return error when email is null (provider hides email)", async () => {
      const oauthData = {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Apple User",
        email: null,
        name: "Apple User",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("email_required");
      expect(result.message).toContain("email");
      expect(result.user).toBeUndefined();
    });

    it("should return error when email is empty string", async () => {
      const oauthData = {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Apple User",
        email: "",
        name: "Apple User",
      };

      const result = await createOAuthUser(db, oauthData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("email_required");
      expect(result.message).toContain("email");
      expect(result.user).toBeUndefined();
    });
  });

  describe("findExistingOAuthAccount", () => {
    it("should return null when no OAuth account exists", async () => {
      const result = await findExistingOAuthAccount(
        db,
        "google",
        faker.string.uuid()
      );
      expect(result).toBeNull();
    });

    it("should find existing OAuth account by provider and providerUserId", async () => {
      // First create an OAuth user
      const providerUserId = faker.string.uuid();
      const oauthData = {
        provider: "google",
        providerUserId,
        providerUsername: "Test User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };

      const createResult = await createOAuthUser(db, oauthData);
      expect(createResult.success).toBe(true);

      // Now find the account
      const result = await findExistingOAuthAccount(db, "google", providerUserId);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(createResult.user?.id);
      expect(result?.email).toBe(oauthData.email);
      expect(result?.username).toBe(createResult.user?.username);
      expect(result?.provider).toBe("google");
      expect(result?.providerUserId).toBe(providerUserId);
      expect(result?.providerUsername).toBe("Test User");
    });

    it("should not find account with different provider", async () => {
      // Create an OAuth user with Google
      const providerUserId = faker.string.uuid();
      const oauthData = {
        provider: "google",
        providerUserId,
        providerUsername: "Test User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };

      await createOAuthUser(db, oauthData);

      // Try to find with Apple provider
      const result = await findExistingOAuthAccount(db, "apple", providerUserId);
      expect(result).toBeNull();
    });

    it("should not find account with different providerUserId", async () => {
      // Create an OAuth user
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Test User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };

      await createOAuthUser(db, oauthData);

      // Try to find with different providerUserId
      const result = await findExistingOAuthAccount(
        db,
        "google",
        faker.string.uuid()
      );
      expect(result).toBeNull();
    });
  });

  describe("linkOAuthAccount", () => {
    it("should link a new OAuth provider to an existing user", async () => {
      // Create a regular user (no OAuth)
      const testUser = createTestUser();
      const user = await db.user.create({
        data: testUser,
      });

      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
      };

      const result = await linkOAuthAccount(db, user.id, oauthData);

      expect(result.success).toBe(true);
      expect(result.oauthRecord).toBeDefined();
      expect(result.oauthRecord?.provider).toBe("google");
      expect(result.oauthRecord?.providerUserId).toBe(oauthData.providerUserId);
      expect(result.oauthRecord?.providerUsername).toBe("Google User");

      // Verify OAuth record was created in database
      const oauthRecord = await db.oAuth.findFirst({
        where: {
          userId: user.id,
          provider: "google",
        },
      });
      expect(oauthRecord).toBeDefined();
      expect(oauthRecord?.providerUserId).toBe(oauthData.providerUserId);
    });

    it("should link Apple provider to existing user with Google", async () => {
      // Create a user with Google OAuth
      const googleOAuthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };
      const googleResult = await createOAuthUser(db, googleOAuthData);
      expect(googleResult.success).toBe(true);

      // Now link Apple
      const appleOAuthData = {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Apple User",
      };

      const result = await linkOAuthAccount(
        db,
        googleResult.user!.id,
        appleOAuthData
      );

      expect(result.success).toBe(true);
      expect(result.oauthRecord?.provider).toBe("apple");

      // Verify user now has both providers
      const oauthRecords = await db.oAuth.findMany({
        where: { userId: googleResult.user!.id },
      });
      expect(oauthRecords).toHaveLength(2);
      expect(oauthRecords.map((r) => r.provider).sort()).toEqual([
        "apple",
        "google",
      ]);
    });

    it("should return error when same provider already linked to this user", async () => {
      // Create a user with Google OAuth
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };
      const createResult = await createOAuthUser(db, oauthData);
      expect(createResult.success).toBe(true);

      // Try to link another Google account to the same user
      const anotherGoogleData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Another Google User",
      };

      const result = await linkOAuthAccount(
        db,
        createResult.user!.id,
        anotherGoogleData
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("provider_already_linked");
      expect(result.message).toContain("already linked");
      expect(result.oauthRecord).toBeUndefined();
    });

    it("should return error when provider account already linked to different user", async () => {
      // Create first user with Google OAuth
      const firstUserOAuthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "First User Google",
        email: faker.internet.email().toLowerCase(),
        name: "First User",
      };
      await createOAuthUser(db, firstUserOAuthData);

      // Create second user without OAuth
      const secondUser = await db.user.create({
        data: createTestUser(),
      });

      // Try to link the same Google provider account to second user
      const result = await linkOAuthAccount(db, secondUser.id, {
        provider: "google",
        providerUserId: firstUserOAuthData.providerUserId,
        providerUsername: "First User Google",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("provider_account_taken");
      expect(result.message).toContain("different account");
      expect(result.oauthRecord).toBeUndefined();
    });

    it("should return error when user does not exist", async () => {
      const nonExistentUserId = faker.string.uuid();

      const result = await linkOAuthAccount(db, nonExistentUserId, {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("user_not_found");
      expect(result.message).toContain("not found");
      expect(result.oauthRecord).toBeUndefined();
    });

    it("should store provider username correctly", async () => {
      const testUser = createTestUser();
      const user = await db.user.create({
        data: testUser,
      });

      const providerUsername = "my_google_display_name";
      const result = await linkOAuthAccount(db, user.id, {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername,
      });

      expect(result.success).toBe(true);
      expect(result.oauthRecord?.providerUsername).toBe(providerUsername);
    });

    it("should handle special characters in provider username", async () => {
      const testUser = createTestUser();
      const user = await db.user.create({
        data: testUser,
      });

      const providerUsername = "Héllo Wörld! 🌍";
      const result = await linkOAuthAccount(db, user.id, {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername,
      });

      expect(result.success).toBe(true);
      expect(result.oauthRecord?.providerUsername).toBe(providerUsername);
    });
  });

  describe("unlinkOAuthAccount", () => {
    it("should unlink OAuth provider when user has a password", async () => {
      // Create a user with password and OAuth
      const testUser = createTestUser();
      const user = await db.user.create({
        data: {
          ...testUser,
          hashedPassword: "hashed_password_value",
          salt: "salt_value",
        },
      });

      // Link Google OAuth
      await linkOAuthAccount(db, user.id, {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
      });

      const result = await unlinkOAuthAccount(db, user.id, "google");

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify OAuth record was deleted
      const oauthRecords = await db.oAuth.findMany({
        where: { userId: user.id },
      });
      expect(oauthRecords).toHaveLength(0);
    });

    it("should unlink one OAuth provider when user has multiple OAuth providers", async () => {
      // Create OAuth-only user with Google
      const googleOAuthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };
      const createResult = await createOAuthUser(db, googleOAuthData);
      expect(createResult.success).toBe(true);

      // Link Apple as second OAuth provider
      await linkOAuthAccount(db, createResult.user!.id, {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Apple User",
      });

      // Now unlink Google (should succeed because Apple remains)
      const result = await unlinkOAuthAccount(
        db,
        createResult.user!.id,
        "google"
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify only Apple remains
      const oauthRecords = await db.oAuth.findMany({
        where: { userId: createResult.user!.id },
      });
      expect(oauthRecords).toHaveLength(1);
      expect(oauthRecords[0].provider).toBe("apple");
    });

    it("should return error when unlinking only auth method (no password, single OAuth)", async () => {
      // Create OAuth-only user (no password)
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };
      const createResult = await createOAuthUser(db, oauthData);
      expect(createResult.success).toBe(true);

      // Try to unlink the only OAuth provider (no password exists)
      const result = await unlinkOAuthAccount(
        db,
        createResult.user!.id,
        "google"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("only_auth_method");
      expect(result.message).toContain("only way to log in");

      // Verify OAuth record was NOT deleted
      const oauthRecords = await db.oAuth.findMany({
        where: { userId: createResult.user!.id },
      });
      expect(oauthRecords).toHaveLength(1);
    });

    it("should allow unlinking the only OAuth provider when a passkey remains", async () => {
      // OAuth-only user (no password) who has also enrolled a passkey.
      const oauthData = {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
        email: faker.internet.email().toLowerCase(),
        name: "Test User",
      };
      const createResult = await createOAuthUser(db, oauthData);
      expect(createResult.success).toBe(true);
      await db.userCredential.create({
        data: {
          id: faker.string.uuid(),
          userId: createResult.user!.id,
          publicKey: new Uint8Array([1]),
          counter: 0n,
        },
      });

      const result = await unlinkOAuthAccount(db, createResult.user!.id, "google");

      expect(result.success).toBe(true);
      // The OAuth record is gone; the passkey keeps the account reachable.
      const oauthRecords = await db.oAuth.findMany({
        where: { userId: createResult.user!.id },
      });
      expect(oauthRecords).toHaveLength(0);
    });

    it("should return error when provider is not linked to user", async () => {
      // Create user with password only (no OAuth)
      const testUser = createTestUser();
      const user = await db.user.create({
        data: {
          ...testUser,
          hashedPassword: "hashed_password_value",
          salt: "salt_value",
        },
      });

      const result = await unlinkOAuthAccount(db, user.id, "google");

      expect(result.success).toBe(false);
      expect(result.error).toBe("provider_not_linked");
      expect(result.message).toContain("not linked");
    });

    it("should return error when user does not exist", async () => {
      const nonExistentUserId = faker.string.uuid();

      const result = await unlinkOAuthAccount(db, nonExistentUserId, "google");

      expect(result.success).toBe(false);
      expect(result.error).toBe("user_not_found");
      expect(result.message).toContain("not found");
    });

    it("should unlink correct provider when user has multiple OAuth providers and password", async () => {
      // Create user with password
      const testUser = createTestUser();
      const user = await db.user.create({
        data: {
          ...testUser,
          hashedPassword: "hashed_password_value",
          salt: "salt_value",
        },
      });

      // Link both Google and Apple
      await linkOAuthAccount(db, user.id, {
        provider: "google",
        providerUserId: faker.string.uuid(),
        providerUsername: "Google User",
      });
      await linkOAuthAccount(db, user.id, {
        provider: "apple",
        providerUserId: faker.string.uuid(),
        providerUsername: "Apple User",
      });

      // Unlink Apple specifically
      const result = await unlinkOAuthAccount(db, user.id, "apple");

      expect(result.success).toBe(true);

      // Verify only Google remains
      const oauthRecords = await db.oAuth.findMany({
        where: { userId: user.id },
      });
      expect(oauthRecords).toHaveLength(1);
      expect(oauthRecords[0].provider).toBe("google");
    });

    it("should return unlinked provider info on success", async () => {
      // Create user with password
      const testUser = createTestUser();
      const user = await db.user.create({
        data: {
          ...testUser,
          hashedPassword: "hashed_password_value",
          salt: "salt_value",
        },
      });

      const providerUserId = faker.string.uuid();
      const providerUsername = "My Google Account";

      // Link Google
      await linkOAuthAccount(db, user.id, {
        provider: "google",
        providerUserId,
        providerUsername,
      });

      const result = await unlinkOAuthAccount(db, user.id, "google");

      expect(result.success).toBe(true);
      expect(result.unlinkedProvider).toBeDefined();
      expect(result.unlinkedProvider?.provider).toBe("google");
      expect(result.unlinkedProvider?.providerUserId).toBe(providerUserId);
      expect(result.unlinkedProvider?.providerUsername).toBe(providerUsername);
    });
  });
});
