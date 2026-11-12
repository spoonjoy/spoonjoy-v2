// @vitest-environment node
// The reset link's whole life: issued only to a real account, stored hashed, single use, short
// lived, rate limited per account, ended by any password change, and on use it sets the password
// and revokes every session and bearer credential.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createUser, verifyStoredPassword } from "~/lib/auth.server";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  PASSWORD_RESET_MAX_PER_WINDOW,
  PASSWORD_RESET_TTL_MS,
  findUsablePasswordResetToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
  invalidatePasswordResetTokens,
  passwordResetAvailable,
  requestPasswordReset,
  resetPasswordWithToken,
  validateNewPassword,
} from "~/lib/password-reset.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyPrisma } from "../helpers/flaky-prisma";

const QA_ENV = { SPOONJOY_EMAIL_MODE: "capture", SPOONJOY_BASE_URL: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev" };
const NEW_PASSWORD = "brand-new-password-1";

describe("password reset", () => {
  let db: PrismaClient;
  let user: { id: string; email: string };

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    const email = `codex_e2e_reset_${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
    const created = await createUser(db, email, `chef_${faker.string.alphanumeric(8)}`, "old-password-1");
    user = { id: created.id, email };
  });

  afterEach(async () => {
    await db.emailOutbox.deleteMany({ where: { toAddress: user.email } });
    await cleanupDatabase();
  });

  /** The link in the newest captured mail to this account, as the person would click it. */
  async function mailedToken(): Promise<string> {
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toAddress: user.email }, orderBy: { createdAt: "desc" } });
    const match = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.textBody);
    return match![1];
  }

  async function issue(now?: Date): Promise<string> {
    expect(await requestPasswordReset(db, QA_ENV, user.email.toUpperCase(), now)).toBe("sent");
    return mailedToken();
  }

  it("is offered only where mail can be sent", () => {
    expect(passwordResetAvailable(QA_ENV)).toBe(true);
    expect(passwordResetAvailable({})).toBe(false);
    expect(passwordResetAvailable(undefined)).toBe(false);
  });

  it("makes random URL-safe tokens and stores only their SHA-256", async () => {
    const token = generatePasswordResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generatePasswordResetToken()).not.toBe(token);
    expect(await hashPasswordResetToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    const mailed = await issue();
    const rows = await db.accountEmailToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "reset_password", email: user.email, usedAt: null, tokenHash: await hashPasswordResetToken(mailed) });
    expect(JSON.stringify(rows)).not.toContain(mailed);
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(PASSWORD_RESET_TTL_MS);
  });

  it("mails the link from the site's own address, defaulting to spoonjoy.app", async () => {
    await issue();
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toAddress: user.email } });
    expect(mail).toMatchObject({ purpose: "reset_password", subject: "Reset your Spoonjoy password" });
    expect(mail.textBody).toContain("https://spoonjoy-v2-qa.mendelow-studio.workers.dev/reset-password?token=");
    expect(mail.textBody).toContain("If you didn't ask for this, ignore this email");

    const send = vi.fn().mockResolvedValue(undefined);
    await db.accountEmailToken.deleteMany({ where: { userId: user.id } });
    expect(await requestPasswordReset(db, { EMAIL: { send }, SPOONJOY_EMAIL_FROM: "hello@spoonjoy.app" }, user.email)).toBe("sent");
    expect(send.mock.calls[0][0].text).toContain("https://spoonjoy.app/reset-password?token=");
  });

  it("does nothing for an address with no account, or one shared by two accounts in different case", async () => {
    expect(await requestPasswordReset(db, QA_ENV, "nobody-here@example.com")).toBe("no_account");
    await db.user.create({ data: { email: user.email.toUpperCase(), username: `chef_${faker.string.alphanumeric(8)}` } });
    expect(await requestPasswordReset(db, QA_ENV, user.email)).toBe("no_account");
    expect(await db.accountEmailToken.count()).toBe(0);
    expect(await db.emailOutbox.count({ where: { toAddress: user.email } })).toBe(0);
    await db.user.deleteMany({ where: { email: user.email.toUpperCase() } });
  });

  it("sends at most a few links an hour to one account", async () => {
    for (let i = 0; i < PASSWORD_RESET_MAX_PER_WINDOW; i += 1) await issue();
    expect(await requestPasswordReset(db, QA_ENV, user.email)).toBe("throttled");
    expect(await requestPasswordReset(db, QA_ENV, user.email, new Date(Date.now() + 61 * 60 * 1000))).toBe("sent");
  });

  it("answers send_failed when mail is refused, and the person can ask again", async () => {
    const send = vi.fn().mockRejectedValue(new Error("refused"));
    expect(await requestPasswordReset(db, { EMAIL: { send }, SPOONJOY_EMAIL_FROM: "hello@spoonjoy.app" }, user.email)).toBe("send_failed");
  });

  it("keeps only the newest link working", async () => {
    const first = await issue();
    const second = await issue();
    expect(await findUsablePasswordResetToken(db, first)).toBeNull();
    expect(await findUsablePasswordResetToken(db, second)).toMatchObject({ userId: user.id, email: user.email });
  });

  it("refuses an empty, unknown, expired, other-purpose or re-addressed token", async () => {
    expect(await findUsablePasswordResetToken(db, "")).toBeNull();
    expect(await findUsablePasswordResetToken(db, "not-a-real-token")).toBeNull();

    const token = await issue();
    expect(await findUsablePasswordResetToken(db, token, new Date(Date.now() + PASSWORD_RESET_TTL_MS + 1000))).toBeNull();

    await db.accountEmailToken.updateMany({ where: { userId: user.id }, data: { purpose: "verify_email" } });
    expect(await findUsablePasswordResetToken(db, token)).toBeNull();
    await db.accountEmailToken.updateMany({ where: { userId: user.id }, data: { purpose: "reset_password" } });
    expect(await findUsablePasswordResetToken(db, token)).not.toBeNull();

    // The account's email changed after the link was sent: the old inbox no longer controls it.
    await db.user.update({ where: { id: user.id }, data: { email: `moved_${user.email}` } });
    expect(await findUsablePasswordResetToken(db, token)).toBeNull();
    await db.user.update({ where: { id: user.id }, data: { email: user.email } });
  });

  it("checks the new password", () => {
    expect(validateNewPassword("", "")).toEqual({ password: "Enter a new password" });
    expect(validateNewPassword("short", "short")).toEqual({ password: "Password must be at least 8 characters" });
    expect(validateNewPassword(NEW_PASSWORD, "different-1")).toEqual({ confirmPassword: "Passwords do not match" });
    expect(validateNewPassword(NEW_PASSWORD, NEW_PASSWORD)).toBeNull();
  });

  it("sets the password, verifies the address and revokes every session and credential, once", async () => {
    await createApiCredential(db, user.id, "Laptop script");
    const token = await issue();

    expect(await resetPasswordWithToken(db, { token, password: NEW_PASSWORD, confirmPassword: "nope-nope-1" }))
      .toEqual({ ok: false, reason: "invalid_password", fieldErrors: { confirmPassword: "Passwords do not match" } });
    // A refused password leaves the link usable.
    expect(await findUsablePasswordResetToken(db, token)).not.toBeNull();

    expect(await resetPasswordWithToken(db, { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({ ok: true, userId: user.id });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionVersion).toBe(1);
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(await verifyStoredPassword(NEW_PASSWORD, after)).toBe(true);
    expect(await verifyStoredPassword("old-password-1", after)).toBe(false);
    expect(await db.apiCredential.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);

    // Single use.
    expect(await resetPasswordWithToken(db, { token, password: "another-password-1", confirmPassword: "another-password-1" }))
      .toEqual({ ok: false, reason: "invalid_token" });
    expect(await verifyStoredPassword(NEW_PASSWORD, await db.user.findUniqueOrThrow({ where: { id: user.id } }))).toBe(true);
  });

  it("keeps an earlier verification time", async () => {
    const verifiedAt = new Date("2026-01-01T00:00:00Z");
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: verifiedAt } });
    const token = await issue();
    await resetPasswordWithToken(db, { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toEqual(verifiedAt);
  });

  it("lets only one of two concurrent uses through", async () => {
    const token = await issue();
    const usable = await findUsablePasswordResetToken(db, token);
    // The other use claimed the token between this one's check and its claim.
    await db.accountEmailToken.update({ where: { id: usable!.id }, data: { usedAt: new Date() } });
    const racing = new Proxy(db, {
      get: (target, prop) => prop === "accountEmailToken"
        ? new Proxy(target.accountEmailToken, {
          get: (tokens, method) => method === "findUnique"
            ? async () => ({ ...usable, purpose: "reset_password", usedAt: null, expiresAt: new Date(Date.now() + 60_000), user: { email: user.email } })
            : Reflect.get(tokens, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;
    expect(await resetPasswordWithToken(racing, { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({ ok: false, reason: "invalid_token" });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(0);
  });

  it("ends unused links when the password changes", async () => {
    const token = await issue();
    await invalidatePasswordResetTokens(db, user.id);
    expect(await findUsablePasswordResetToken(db, token)).toBeNull();
  });

  describe("when D1's connection drops", () => {
    it("creates the link once when the insert committed but its answer was lost", async () => {
      const flaky = flakyPrisma(db);
      flaky.failNext("accountEmailToken", "create", "lost-answer");
      expect(await requestPasswordReset(flaky.db, QA_ENV, user.email)).toBe("sent");
      expect(flaky.failures()).toBe(1);
      expect(await db.accountEmailToken.count({ where: { userId: user.id } })).toBe(1);
    });

    it("inserts again when the insert never reached the database", async () => {
      const flaky = flakyPrisma(db);
      flaky.failNext("accountEmailToken", "create", "lost");
      expect(await requestPasswordReset(flaky.db, QA_ENV, user.email)).toBe("sent");
      expect(await db.accountEmailToken.count({ where: { userId: user.id } })).toBe(1);
    });

    it("counts a claim whose answer was lost as this use, and a claim that never landed as not yet made", async () => {
      const token = await issue();
      const flaky = flakyPrisma(db);
      flaky.failNext("accountEmailToken", "updateMany", "lost-answer");
      expect(await resetPasswordWithToken(flaky.db, { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({ ok: true, userId: user.id });

      const second = await issue(new Date(Date.now() + 1000));
      const flakyAgain = flakyPrisma(db);
      flakyAgain.failNext("accountEmailToken", "updateMany", "lost");
      expect(await resetPasswordWithToken(flakyAgain.db, { token: second, password: "third-password-1", confirmPassword: "third-password-1" }))
        .toEqual({ ok: true, userId: user.id });
      expect(flakyAgain.failures()).toBe(1);
    });
  });
});
