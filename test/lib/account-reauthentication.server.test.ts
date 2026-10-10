import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import { hashPassword } from "~/lib/auth.server";
import { RECENT_SIGN_IN_WINDOW_MS, verifyAccountOwnerProof } from "~/lib/account-reauthentication.server";
import { cleanupDatabase } from "../helpers/cleanup";

const NOW = 1_800_000_000_000;
const apple = { identityToken: "a.b.c", rawNonce: "nonce" };

beforeEach(async () => {
  await cleanupDatabase();
});

afterEach(async () => {
  await cleanupDatabase();
});

async function passwordUser() {
  const { hashedPassword, salt } = await hashPassword("correct horse");
  return db.user.create({ data: { email: "pw@example.com", username: "pw_chef", hashedPassword, salt } });
}

async function appleUser() {
  return db.user.create({
    data: {
      email: "apple@example.com",
      username: "apple_chef",
      OAuth: { create: { provider: "apple", providerUserId: "apple-sub", providerUsername: "Apple Chef" } },
    },
  });
}

describe("verifyAccountOwnerProof", () => {
  it("asks an account with a password for that password, whatever else it has", async () => {
    const user = await passwordUser();

    await expect(verifyAccountOwnerProof(db, user.id, { sessionAuthenticatedAt: NOW }, { now: () => NOW }))
      .resolves.toMatchObject({ ok: false, reason: "password_required" });
    await expect(verifyAccountOwnerProof(db, user.id, { password: "wrong" })).resolves.toMatchObject({ ok: false, reason: "password_incorrect" });
    await expect(verifyAccountOwnerProof(db, user.id, { password: "correct horse" })).resolves.toEqual({ ok: true, method: "password" });
  });

  it("accepts a fresh Apple credential for the Apple ID linked to a passwordless account", async () => {
    const user = await appleUser();
    const verifyAppleCredential = vi.fn(async () => "apple-sub");

    await expect(verifyAccountOwnerProof(db, user.id, { apple }, { verifyAppleCredential })).resolves.toEqual({ ok: true, method: "apple" });
    expect(verifyAppleCredential).toHaveBeenCalledWith(apple);
  });

  it("refuses an Apple credential for a different Apple ID, and passes on an invalid one's error", async () => {
    const user = await appleUser();

    await expect(verifyAccountOwnerProof(db, user.id, { apple }, { verifyAppleCredential: async () => "someone-else" }))
      .resolves.toMatchObject({ ok: false, reason: "apple_account_mismatch" });
    await expect(verifyAccountOwnerProof(db, user.id, { apple }, { verifyAppleCredential: async () => { throw new Error("expired"); } }))
      .rejects.toThrow("expired");
  });

  it("accepts a passwordless browser session only within ten minutes of signing in", async () => {
    const user = await appleUser();
    const now = () => NOW;

    await expect(verifyAccountOwnerProof(db, user.id, { sessionAuthenticatedAt: NOW - RECENT_SIGN_IN_WINDOW_MS }, { now }))
      .resolves.toEqual({ ok: true, method: "recent_sign_in" });
    for (const sessionAuthenticatedAt of [NOW - RECENT_SIGN_IN_WINDOW_MS - 1, NOW + 1, null, undefined]) {
      await expect(verifyAccountOwnerProof(db, user.id, { sessionAuthenticatedAt }, { now }))
        .resolves.toMatchObject({ ok: false, reason: "recent_sign_in_required" });
    }
    // An Apple credential without a verifier (a browser request) is no proof.
    await expect(verifyAccountOwnerProof(db, user.id, { apple })).resolves.toMatchObject({ ok: false, reason: "recent_sign_in_required" });
  });

  it("uses the current time by default", async () => {
    const user = await appleUser();
    await expect(verifyAccountOwnerProof(db, user.id, { sessionAuthenticatedAt: Date.now() - 1000 })).resolves.toMatchObject({ ok: true });
  });

  it("reports a missing account", async () => {
    await expect(verifyAccountOwnerProof(db, "nobody", { password: "x" })).resolves.toMatchObject({ ok: false, reason: "account_not_found" });
  });
});
