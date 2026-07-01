import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "~/lib/db.server";
import {
  hashPassword,
  verifyPassword,
  createUser,
  authenticateUser,
  authenticateUserByEmailOrUsername,
  getUserById,
  emailExists,
  usernameExists,
} from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

describe("auth.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("hashPassword", () => {
    it("should return a hashed password and salt", async () => {
      const password = "testPassword123";
      const result = await hashPassword(password);

      expect(result).toHaveProperty("hashedPassword");
      expect(result).toHaveProperty("salt");
      expect(result.hashedPassword).not.toBe(password);
      expect(result.hashedPassword.length).toBeGreaterThan(0);
      expect(result.salt.length).toBeGreaterThan(0);
    });

    it("should generate different hashes for the same password", async () => {
      const password = "testPassword123";
      const result1 = await hashPassword(password);
      const result2 = await hashPassword(password);

      expect(result1.hashedPassword).not.toBe(result2.hashedPassword);
      expect(result1.salt).not.toBe(result2.salt);
    });
  });

  describe("verifyPassword", () => {
    it("should return true for correct password", async () => {
      const password = "testPassword123";
      const { hashedPassword } = await hashPassword(password);

      const isValid = await verifyPassword(password, hashedPassword);
      expect(isValid).toBe(true);
    });

    it("should return false for incorrect password", async () => {
      const password = "testPassword123";
      const { hashedPassword } = await hashPassword(password);

      const isValid = await verifyPassword("wrongPassword", hashedPassword);
      expect(isValid).toBe(false);
    });
  });

  describe("createUser", () => {
    it("should create a new user with hashed password", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      const user = await createUser(db, email, username, password);

      expect(user).toHaveProperty("id");
      expect(user.email).toBe(email.toLowerCase());
      expect(user.username).toBe(username);
      expect(user).not.toHaveProperty("hashedPassword");
    });

    it("should lowercase email when creating user", async () => {
      const email = "TEST@EXAMPLE.COM";
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      const user = await createUser(db, email, username, password);

      expect(user.email).toBe("test@example.com");
    });
  });

  describe("authenticateUser", () => {
    it("should return user for valid credentials", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const user = await authenticateUser(db, email, password);

      expect(user).not.toBeNull();
      expect(user?.email).toBe(email.toLowerCase());
      expect(user?.username).toBe(username);
    });

    it("should return null for wrong password", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const user = await authenticateUser(db, email, "wrongPassword");

      expect(user).toBeNull();
    });

    it("should return null for non-existent email", async () => {
      const user = await authenticateUser(db, "nonexistent@example.com", "password");

      expect(user).toBeNull();
    });

    it("should be case-insensitive for email", async () => {
      const email = "Test@Example.com";
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const user = await authenticateUser(db, "TEST@EXAMPLE.COM", password);

      expect(user).not.toBeNull();
      expect(user?.email).toBe("test@example.com");
    });

    it("returns null for an account without a password (OAuth-only user), still running the decoy compare", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      // OAuth-only accounts have no password credential (hashedPassword is null).
      await db.user.create({
        data: { email: email.toLowerCase(), username },
      });
      const compareSpy = vi.spyOn(bcrypt, "compare");

      const user = await authenticateUser(db, email, "anyPassword");

      expect(user).toBeNull();
      // A passwordless account must still incur the decoy compare, so its login
      // latency matches a password account's (anti-enumeration).
      expect(compareSpy).toHaveBeenCalledTimes(1);
      expect(compareSpy).toHaveBeenCalledWith("anyPassword", expect.stringMatching(/^\$2[ab]\$10\$/));

      compareSpy.mockRestore();
    });

    it("runs a bcrypt comparison even for an unknown email (constant-time, prevents user enumeration)", async () => {
      const compareSpy = vi.spyOn(bcrypt, "compare");

      const user = await authenticateUser(
        db,
        "definitely-not-registered@example.com",
        "anyPassword"
      );

      expect(user).toBeNull();
      // The comparison must still run when no account matches, so login latency
      // doesn't reveal whether the email is registered — and against the cost-10
      // decoy hash. Pinning the cost factor here means a future change that drops
      // the constant-time property fails this test instead of passing silently.
      expect(compareSpy).toHaveBeenCalledTimes(1);
      expect(compareSpy).toHaveBeenCalledWith("anyPassword", expect.stringMatching(/^\$2[ab]\$10\$/));

      compareSpy.mockRestore();
    });
  });

  describe("authenticateUserByEmailOrUsername", () => {
    it("returns a user for a valid username/password pair", async () => {
      const email = faker.internet.email();
      const username = `chef_${faker.string.alphanumeric(8)}`;
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const user = await authenticateUserByEmailOrUsername(db, username, password);

      expect(user).toMatchObject({
        email: email.toLowerCase(),
        username,
      });
    });

    it("returns a user for a valid case-insensitive email/password pair", async () => {
      const email = "NativeChef@Example.com";
      const username = `chef_${faker.string.alphanumeric(8)}`;
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const user = await authenticateUserByEmailOrUsername(db, "NATIVECHEF@EXAMPLE.COM", password);

      expect(user).toMatchObject({
        email: "nativechef@example.com",
        username,
      });
    });

    it("runs a bcrypt comparison for unknown username/email identifiers", async () => {
      const compareSpy = vi.spyOn(bcrypt, "compare");

      const user = await authenticateUserByEmailOrUsername(db, "missing_native_chef", "anyPassword");

      expect(user).toBeNull();
      expect(compareSpy).toHaveBeenCalledTimes(1);
      expect(compareSpy).toHaveBeenCalledWith("anyPassword", expect.stringMatching(/^\$2[ab]\$10\$/));

      compareSpy.mockRestore();
    });
  });

  describe("getUserById", () => {
    it("should return user for valid id", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      const createdUser = await createUser(db, email, username, password);

      const user = await getUserById(db, createdUser.id);

      expect(user).not.toBeNull();
      expect(user?.id).toBe(createdUser.id);
      expect(user?.email).toBe(email.toLowerCase());
      expect(user?.username).toBe(username);
      expect(user).toHaveProperty("createdAt");
    });

    it("should return null for non-existent id", async () => {
      const user = await getUserById(db, "non-existent-id");

      expect(user).toBeNull();
    });
  });

  describe("emailExists", () => {
    it("should return true if email exists", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const exists = await emailExists(db, email);

      expect(exists).toBe(true);
    });

    it("should return false if email does not exist", async () => {
      const exists = await emailExists(db, "nonexistent@example.com");

      expect(exists).toBe(false);
    });

    it("should be case-insensitive", async () => {
      const email = "Test@Example.com";
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const exists = await emailExists(db, "TEST@EXAMPLE.COM");

      expect(exists).toBe(true);
    });
  });

  describe("usernameExists", () => {
    it("should return true if username exists", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const password = "testPassword123";

      await createUser(db, email, username, password);

      const exists = await usernameExists(db, username);

      expect(exists).toBe(true);
    });

    it("should return false if username does not exist", async () => {
      const exists = await usernameExists(db, "nonexistentuser");

      expect(exists).toBe(false);
    });
  });
});
