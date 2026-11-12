import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  authenticateUser,
  authenticateUserByEmailOrUsername,
  authenticateUserByEmailOrUsernameOnD1,
} from "~/lib/auth.server";
import { redwoodPasswordFormat, verifyRedwoodPassword } from "~/lib/legacy-password.server";
import { verifyAccountOwnerProof } from "~/lib/account-reauthentication.server";
import { expectConsoleWarning } from "../warning-policy";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// Made with @redwoodjs/auth-dbauth-api 8.2.0's own algorithms for this throwaway password:
// legacyHashPassword = pbkdf2Sync(text, salt, 1, 32, "SHA1"), a 32-hex-char CryptoJS-style salt;
// hashPassword = scryptSync(text.normalize("NFC"), salt, 32, { cost: 2^14, blockSize: 8, parallelization: 1 }).
const PASSWORD = "legacy-fixture-password-1";
const REDWOOD_LEGACY = {
  hashedPassword: "6aabd4c8297e401731e8465ae0ee07fb12c5c4293336a1990e72161bc79c2f9b",
  salt: "cb0f339208c1fa86c59de334a45942fc",
};
const REDWOOD_SCRYPT = {
  hashedPassword: "be8fc12a164f74027a009cdf9ee2ded19553c24fd522a9ee56baefc3cbc10db3|16384|8|1",
  salt: "d8290982c4830090797b7ad1f5b890d68e9c7ee9c7ecab6722c137241f041bee",
};

let db: PrismaClient;
let d1: SqliteD1;

describe("Redwood-era password hashes", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("recognizes both Redwood formats and nothing else", () => {
    expect(redwoodPasswordFormat(REDWOOD_LEGACY.hashedPassword)).toBe("redwood_pbkdf2_sha1");
    expect(redwoodPasswordFormat(REDWOOD_SCRYPT.hashedPassword)).toBe("redwood_scrypt");
    expect(redwoodPasswordFormat(bcrypt.hashSync(PASSWORD, 4))).toBeNull();
    expect(redwoodPasswordFormat("")).toBeNull();
  });

  it("matches Redwood's own hashes for the right password only", async () => {
    await expect(verifyRedwoodPassword(PASSWORD, REDWOOD_LEGACY.hashedPassword, REDWOOD_LEGACY.salt)).resolves.toBe(true);
    await expect(verifyRedwoodPassword(PASSWORD, REDWOOD_SCRYPT.hashedPassword, REDWOOD_SCRYPT.salt)).resolves.toBe(true);
    await expect(verifyRedwoodPassword(`${PASSWORD}x`, REDWOOD_LEGACY.hashedPassword, REDWOOD_LEGACY.salt)).resolves.toBe(false);
    await expect(verifyRedwoodPassword(`${PASSWORD}x`, REDWOOD_SCRYPT.hashedPassword, REDWOOD_SCRYPT.salt)).resolves.toBe(false);
    await expect(verifyRedwoodPassword(PASSWORD, REDWOOD_LEGACY.hashedPassword, null)).resolves.toBe(false);
    await expect(verifyRedwoodPassword(PASSWORD, REDWOOD_LEGACY.hashedPassword, REDWOOD_SCRYPT.salt)).resolves.toBe(false);
  });

  it("refuses a stored scrypt work factor outside Redwood's", async () => {
    const [hash] = REDWOOD_SCRYPT.hashedPassword.split("|");
    await expect(verifyRedwoodPassword(PASSWORD, `${hash}|1048576|8|1`, REDWOOD_SCRYPT.salt)).resolves.toBe(false);
    await expect(verifyRedwoodPassword(PASSWORD, `${hash}|16383|8|1`, REDWOOD_SCRYPT.salt)).resolves.toBe(false);
  });

  for (const [format, stored] of [["legacy PBKDF2", REDWOOD_LEGACY], ["scrypt", REDWOOD_SCRYPT]] as const) {
    it(`signs a ${format} chef in by email or username and upgrades the hash to bcrypt`, async () => {
      const chef = await db.user.create({ data: { email: "redwood-chef@example.com", username: "redwood_chef", ...stored } });

      await expect(authenticateUserByEmailOrUsername(db, "Redwood-Chef@Example.com", `${PASSWORD}x`)).resolves.toBeNull();
      await expect(db.user.findUnique({ where: { id: chef.id } })).resolves.toMatchObject(stored);

      await expect(authenticateUserByEmailOrUsername(db, "Redwood-Chef@Example.com", PASSWORD)).resolves.toEqual({
        id: chef.id,
        email: "redwood-chef@example.com",
        username: "redwood_chef",
        sessionVersion: 0,
      });
      const upgraded = await db.user.findUniqueOrThrow({ where: { id: chef.id } });
      expect(upgraded.hashedPassword).toMatch(/^\$2[aby]\$10\$/);
      expect(bcrypt.compareSync(PASSWORD, upgraded.hashedPassword!)).toBe(true);
      expect(upgraded.sessionVersion).toBe(0);

      // The upgraded bcrypt hash keeps signing in, on every login path.
      await expect(authenticateUserByEmailOrUsername(db, "redwood_chef", PASSWORD)).resolves.toMatchObject({ id: chef.id });
      await expect(authenticateUser(db, "redwood-chef@example.com", PASSWORD)).resolves.toMatchObject({ id: chef.id });
      await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, "redwood_chef", PASSWORD)).resolves.toMatchObject({ id: chef.id });
    });

    it(`signs a ${format} chef in on the D1 path and upgrades the hash there`, async () => {
      const chef = await db.user.create({ data: { email: "redwood-d1@example.com", username: "redwood_d1", ...stored } });

      await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, "redwood_d1", `${PASSWORD}x`)).resolves.toBeNull();
      await expect(authenticateUserByEmailOrUsernameOnD1(d1.binding, "redwood_d1", PASSWORD)).resolves.toMatchObject({ id: chef.id });

      const upgraded = await db.user.findUniqueOrThrow({ where: { id: chef.id } });
      expect(bcrypt.compareSync(PASSWORD, upgraded.hashedPassword!)).toBe(true);
      await expect(authenticateUserByEmailOrUsername(db, "redwood-d1@example.com", PASSWORD)).resolves.toMatchObject({ id: chef.id });
    });
  }

  it("still pays for a bcrypt comparison on a Redwood-era account, so it answers like any other", async () => {
    await db.user.create({ data: { email: "redwood-timing@example.com", username: "redwood_timing", ...REDWOOD_LEGACY } });
    const compare = vi.spyOn(bcrypt, "compareSync");

    await expect(authenticateUserByEmailOrUsername(db, "redwood_timing", "wrong")).resolves.toBeNull();

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("still signs in when the upgrade write fails, and keeps the old hash", async () => {
    const chef = await db.user.create({ data: { email: "redwood-upgrade@example.com", username: "redwood_upgrade", ...REDWOOD_LEGACY } });
    vi.spyOn(db.user, "updateMany").mockRejectedValue(new TypeError("write refused"));
    expectConsoleWarning("password.upgrade_failed", { userId: chef.id, error: "TypeError" });

    await expect(authenticateUserByEmailOrUsername(db, "redwood_upgrade", PASSWORD)).resolves.toMatchObject({ id: chef.id });
    await expect(db.user.findUnique({ where: { id: chef.id } })).resolves.toMatchObject(REDWOOD_LEGACY);
  });

  it("accepts a Redwood-era password when a signed-in chef confirms it's them", async () => {
    const chef = await db.user.create({ data: { email: "redwood-proof@example.com", username: "redwood_proof", ...REDWOOD_SCRYPT } });

    await expect(verifyAccountOwnerProof(db, chef.id, { password: PASSWORD })).resolves.toEqual({ ok: true, method: "password" });
    await expect(verifyAccountOwnerProof(db, chef.id, { password: `${PASSWORD}x` })).resolves.toMatchObject({ ok: false, reason: "password_incorrect" });
  });
});
