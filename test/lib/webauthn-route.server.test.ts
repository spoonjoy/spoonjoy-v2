import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/webauthn.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/webauthn.server")>();
  return {
    ...actual,
    buildRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    credentialFromRegistration: vi.fn(),
    buildAuthenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
  };
});

import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  credentialFromRegistration,
  verifyAuthentication,
  verifyRegistration,
} from "~/lib/webauthn.server";
import {
  configFromRequest,
  finishAuthentication,
  finishRegistration,
  listUserPasskeys,
  removeUserPasskey,
  renameUserPasskey,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "~/lib/webauthn-route.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

const config = { rpName: "Spoonjoy", rpID: "spoonjoy.app", origin: "https://spoonjoy.app" };

describe("webauthn-route orchestration", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("startRegistration", () => {
    it("returns options and persists the challenge", async () => {
      const user = await db.user.create({ data: createTestUser() });
      vi.mocked(buildRegistrationOptions).mockResolvedValue({ challenge: "reg_chal" } as never);

      const options = await startRegistration(db, user.id, config);

      expect(options).toEqual({ challenge: "reg_chal" });
      const refreshed = await db.user.findUnique({ where: { id: user.id } });
      expect(refreshed?.webAuthnChallenge).toBe("reg_chal");
      // existing credentials are passed (empty here)
      expect(vi.mocked(buildRegistrationOptions).mock.calls[0][2]).toEqual([]);
    });

    it("throws 404 when user is missing", async () => {
      await expect(startRegistration(db, "missing", config)).rejects.toMatchObject({
        name: "WebAuthnError",
        status: 404,
      });
    });
  });

  describe("finishRegistration", () => {
    it("verifies, persists the credential, and clears the challenge", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue({
        id: "cred_1",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0n,
        transports: "internal",
      });

      const result = await finishRegistration(db, user.id, config, { id: "cred_1" } as never);
      expect(result).toEqual({ verified: true, credentialId: "cred_1" });

      const stored = await db.userCredential.findUnique({ where: { id: "cred_1" } });
      expect(stored?.userId).toBe(user.id);
      expect(Array.from(stored!.publicKey)).toEqual([1, 2, 3]);
      expect(stored?.counter).toBe(0n);
      expect(stored?.transports).toBe("internal");

      const refreshed = await db.user.findUnique({ where: { id: user.id } });
      expect(refreshed?.webAuthnChallenge).toBeNull();
    });

    it("is idempotent when re-registering the same authenticator", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      await db.userCredential.create({
        data: { id: "cred_1", userId: user.id, publicKey: new Uint8Array([0]), counter: 9n },
      });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue({
        id: "cred_1",
        publicKey: new Uint8Array([4, 5]),
        counter: 0n,
        transports: null,
      });

      await finishRegistration(db, user.id, config, { id: "cred_1" } as never);

      const all = await db.userCredential.findMany({ where: { userId: user.id } });
      expect(all).toHaveLength(1);
      expect(Array.from(all[0].publicKey)).toEqual([4, 5]);
    });

    it("throws 404 when the user is missing", async () => {
      await expect(
        finishRegistration(db, "missing", config, {} as never),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("throws 400 when no challenge is in progress", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await expect(
        finishRegistration(db, user.id, config, {} as never),
      ).rejects.toMatchObject({ status: 400, message: "No registration in progress" });
    });

    it("wraps verification errors as 400", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      vi.mocked(verifyRegistration).mockRejectedValue(new Error("bad attestation"));
      await expect(
        finishRegistration(db, user.id, config, {} as never),
      ).rejects.toMatchObject({ status: 400, message: "bad attestation" });
    });

    it("wraps non-Error verification throws with a default message", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      vi.mocked(verifyRegistration).mockRejectedValue("string failure");
      await expect(
        finishRegistration(db, user.id, config, {} as never),
      ).rejects.toMatchObject({ status: 400, message: "Registration verification failed" });
    });

    it("throws 400 when the credential cannot be mapped", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: false } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue(null);
      await expect(
        finishRegistration(db, user.id, config, {} as never),
      ).rejects.toMatchObject({ status: 400, message: "Registration could not be verified" });
    });

    it("stores a trimmed name and createdAt when a label is provided", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue({
        id: "named_cred",
        publicKey: new Uint8Array([1]),
        counter: 0n,
        transports: "internal",
      });

      await finishRegistration(db, user.id, config, { id: "named_cred" } as never, "  MacBook  ");

      const stored = await db.userCredential.findUnique({ where: { id: "named_cred" } });
      expect(stored?.name).toBe("MacBook");
      expect(stored?.createdAt).toBeInstanceOf(Date);
    });

    it("stores a null name when the label is blank", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "reg_chal" },
      });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue({
        id: "blank_cred",
        publicKey: new Uint8Array([1]),
        counter: 0n,
        transports: null,
      });

      await finishRegistration(db, user.id, config, { id: "blank_cred" } as never, "   ");

      const stored = await db.userCredential.findUnique({ where: { id: "blank_cred" } });
      expect(stored?.name).toBeNull();
    });
  });

  describe("listUserPasskeys", () => {
    it("returns a user's passkeys newest-first with name/transports/createdAt", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: {
          id: "older",
          userId: user.id,
          publicKey: new Uint8Array([1]),
          counter: 0n,
          transports: "internal",
          name: "Old key",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await db.userCredential.create({
        data: {
          id: "newer",
          userId: user.id,
          publicKey: new Uint8Array([2]),
          counter: 0n,
          transports: null,
          name: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      });
      // A pre-migration credential with no enrollment metadata sorts last.
      await db.userCredential.create({
        data: { id: "legacy", userId: user.id, publicKey: new Uint8Array([3]), counter: 0n },
      });

      const passkeys = await listUserPasskeys(db, user.id);
      expect(passkeys).toEqual([
        { id: "newer", name: null, transports: null, createdAt: new Date("2026-05-01T00:00:00.000Z") },
        {
          id: "older",
          name: "Old key",
          transports: "internal",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        { id: "legacy", name: null, transports: null, createdAt: null },
      ]);
    });

    it("returns an empty list for a user with no passkeys", async () => {
      const user = await db.user.create({ data: createTestUser() });
      expect(await listUserPasskeys(db, user.id)).toEqual([]);
    });

    it("does not return another user's passkeys", async () => {
      const user = await db.user.create({ data: createTestUser() });
      const other = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "theirs", userId: other.id, publicKey: new Uint8Array([1]), counter: 0n },
      });

      expect(await listUserPasskeys(db, user.id)).toEqual([]);
    });
  });

  describe("removeUserPasskey", () => {
    it("removes the user's own passkey", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "mine", userId: user.id, publicKey: new Uint8Array([1]), counter: 0n },
      });

      const result = await removeUserPasskey(db, user.id, "mine");
      expect(result).toEqual({ removed: true });
      expect(await db.userCredential.findUnique({ where: { id: "mine" } })).toBeNull();
    });

    it("reports nothing removed for an unknown credential", async () => {
      const user = await db.user.create({ data: createTestUser() });
      expect(await removeUserPasskey(db, user.id, "missing")).toEqual({ removed: false });
    });

    it("will not remove another user's passkey", async () => {
      const user = await db.user.create({ data: createTestUser() });
      const other = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "theirs", userId: other.id, publicKey: new Uint8Array([1]), counter: 0n },
      });

      const result = await removeUserPasskey(db, user.id, "theirs");
      expect(result).toEqual({ removed: false });
      // the credential is untouched
      expect(await db.userCredential.findUnique({ where: { id: "theirs" } })).not.toBeNull();
    });
  });

  describe("renameUserPasskey", () => {
    it("sets a trimmed name on the user's own passkey", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "mine", userId: user.id, publicKey: new Uint8Array([1]), counter: 0n },
      });

      const result = await renameUserPasskey(db, user.id, "mine", "  Work laptop  ");
      expect(result).toEqual({ renamed: true });
      const stored = await db.userCredential.findUnique({ where: { id: "mine" } });
      expect(stored?.name).toBe("Work laptop");
    });

    it("clears the name when given a blank label", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "mine", userId: user.id, publicKey: new Uint8Array([1]), counter: 0n, name: "Old" },
      });

      const result = await renameUserPasskey(db, user.id, "mine", "   ");
      expect(result).toEqual({ renamed: true });
      const stored = await db.userCredential.findUnique({ where: { id: "mine" } });
      expect(stored?.name).toBeNull();
    });

    it("reports nothing renamed for an unknown credential", async () => {
      const user = await db.user.create({ data: createTestUser() });
      expect(await renameUserPasskey(db, user.id, "missing", "x")).toEqual({ renamed: false });
    });

    it("will not rename another user's passkey", async () => {
      const user = await db.user.create({ data: createTestUser() });
      const other = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "theirs", userId: other.id, publicKey: new Uint8Array([1]), counter: 0n, name: "Theirs" },
      });

      const result = await renameUserPasskey(db, user.id, "theirs", "Hijacked");
      expect(result).toEqual({ renamed: false });
      const stored = await db.userCredential.findUnique({ where: { id: "theirs" } });
      expect(stored?.name).toBe("Theirs");
    });
  });

  describe("startAuthentication", () => {
    it("returns options and persists the challenge for a user with credentials", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await db.userCredential.create({
        data: { id: "c1", userId: user.id, publicKey: new Uint8Array([1]), counter: 0n },
      });
      vi.mocked(buildAuthenticationOptions).mockResolvedValue({ challenge: "auth_chal" } as never);

      const options = await startAuthentication(db, user.email, config);
      expect(options).toEqual({ challenge: "auth_chal" });

      const refreshed = await db.user.findUnique({ where: { id: user.id } });
      expect(refreshed?.webAuthnChallenge).toBe("auth_chal");
      expect(vi.mocked(buildAuthenticationOptions).mock.calls[0][1]).toHaveLength(1);
    });

    it("returns options with an empty allowlist for an unknown email (no enumeration)", async () => {
      vi.mocked(buildAuthenticationOptions).mockResolvedValue({ challenge: "x" } as never);
      const options = await startAuthentication(db, "nobody@example.com", config);
      expect(options).toEqual({ challenge: "x" });
      expect(vi.mocked(buildAuthenticationOptions).mock.calls[0][1]).toEqual([]);
    });

    it("does not persist a challenge for an unknown email", async () => {
      vi.mocked(buildAuthenticationOptions).mockResolvedValue({ challenge: "x" } as never);
      await startAuthentication(db, "nobody@example.com", config);
      // No user row exists to carry a challenge — nothing to assert beyond no throw.
      const count = await db.user.count();
      expect(count).toBe(0);
    });
  });

  describe("finishAuthentication", () => {
    async function seedUserWithCredential(challenge: string | null) {
      const user = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: challenge },
      });
      await db.userCredential.create({
        data: { id: "auth_cred", userId: user.id, publicKey: new Uint8Array([1]), counter: 2n },
      });
      return user;
    }

    it("verifies, rotates the counter, clears the challenge, and returns userId", async () => {
      const user = await seedUserWithCredential("auth_chal");
      vi.mocked(verifyAuthentication).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 7 },
      } as never);

      const result = await finishAuthentication(db, user.email, config, { id: "auth_cred" } as never);
      expect(result).toEqual({ verified: true, userId: user.id });

      const stored = await db.userCredential.findUnique({ where: { id: "auth_cred" } });
      expect(stored?.counter).toBe(7n);
      const refreshed = await db.user.findUnique({ where: { id: user.id } });
      expect(refreshed?.webAuthnChallenge).toBeNull();
    });

    it("throws 400 when no challenge is in progress", async () => {
      const user = await seedUserWithCredential(null);
      await expect(
        finishAuthentication(db, user.email, config, { id: "auth_cred" } as never),
      ).rejects.toMatchObject({ status: 400, message: "No authentication in progress" });
    });

    it("throws 400 for an unknown email", async () => {
      await expect(
        finishAuthentication(db, "nobody@example.com", config, { id: "x" } as never),
      ).rejects.toMatchObject({ status: 400, message: "No authentication in progress" });
    });

    it("throws 400 when the credential is unknown", async () => {
      const user = await seedUserWithCredential("auth_chal");
      await expect(
        finishAuthentication(db, user.email, config, { id: "does_not_exist" } as never),
      ).rejects.toMatchObject({ status: 400, message: "Unknown credential" });
    });

    it("rejects a credential that belongs to another user", async () => {
      const owner = await seedUserWithCredential("auth_chal");
      const attacker = await db.user.create({
        data: { ...createTestUser(), webAuthnChallenge: "attacker_chal" },
      });
      // attacker tries to authenticate with the owner's credential id
      await expect(
        finishAuthentication(db, attacker.email, config, { id: "auth_cred" } as never),
      ).rejects.toMatchObject({ status: 400, message: "Unknown credential" });
      expect(owner.id).not.toBe(attacker.id);
    });

    it("wraps verification errors as 400", async () => {
      const user = await seedUserWithCredential("auth_chal");
      vi.mocked(verifyAuthentication).mockRejectedValue(new Error("bad signature"));
      await expect(
        finishAuthentication(db, user.email, config, { id: "auth_cred" } as never),
      ).rejects.toMatchObject({ status: 400, message: "bad signature" });
    });

    it("wraps non-Error verification throws with a default message", async () => {
      const user = await seedUserWithCredential("auth_chal");
      vi.mocked(verifyAuthentication).mockRejectedValue("nope");
      await expect(
        finishAuthentication(db, user.email, config, { id: "auth_cred" } as never),
      ).rejects.toMatchObject({ status: 400, message: "Authentication verification failed" });
    });

    it("throws 400 when verification reports unverified", async () => {
      const user = await seedUserWithCredential("auth_chal");
      vi.mocked(verifyAuthentication).mockResolvedValue({ verified: false } as never);
      await expect(
        finishAuthentication(db, user.email, config, { id: "auth_cred" } as never),
      ).rejects.toMatchObject({ status: 400, message: "Authentication could not be verified" });
    });
  });

  describe("configFromRequest", () => {
    it("derives rpID + origin from the request URL", () => {
      const cfg = configFromRequest(new Request("https://spoonjoy.app/auth/webauthn/x"));
      expect(cfg).toEqual({ rpName: "Spoonjoy", rpID: "spoonjoy.app", origin: "https://spoonjoy.app" });
    });

    it("works for localhost dev origins", () => {
      const cfg = configFromRequest(new Request("http://localhost:5173/auth/webauthn/x"));
      expect(cfg).toEqual({ rpName: "Spoonjoy", rpID: "localhost", origin: "http://localhost:5173" });
    });

    it("uses the forwarded public host, not the worker host (worker fronted by the public domain)", () => {
      // The worker sees its own *.workers.dev host, but the RP ID must be the
      // public domain the browser is on or it rejects it ("RP ID … is invalid").
      const cfg = configFromRequest(
        new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/webauthn/x", {
          headers: { "X-Forwarded-Host": "spoonjoy.app", "X-Forwarded-Proto": "https" },
        }),
      );
      expect(cfg).toEqual({ rpName: "Spoonjoy", rpID: "spoonjoy.app", origin: "https://spoonjoy.app" });
    });
  });

  describe("WebAuthnError", () => {
    it("defaults to status 400", () => {
      expect(new WebAuthnError("oops").status).toBe(400);
    });
  });

  describe("telemetry on infra faults and verification failures", () => {
    interface FakeTelemetry {
      enabled: boolean;
      captureException: ReturnType<typeof vi.fn>;
      captureEvent: ReturnType<typeof vi.fn>;
    }

    function fakeTelemetry(): FakeTelemetry {
      return { enabled: true, captureException: vi.fn(), captureEvent: vi.fn() };
    }

    /**
     * Wrap the real db so a single nested model method rejects, simulating a D1
     * read/write fault. Everything else delegates to the real client.
     */
    function dbFailingAt(
      model: "user" | "userCredential",
      method: string,
      error: Error,
    ): typeof db {
      const real = db as unknown as Record<string, Record<string, unknown>>;
      return new Proxy(db as object, {
        get(target, prop: string) {
          if (prop === model) {
            return new Proxy(real[model], {
              get(modelTarget, modelProp: string) {
                if (modelProp === method) {
                  return () => Promise.reject(error);
                }
                return (modelTarget as Record<string, unknown>)[modelProp];
              },
            });
          }
          return (target as Record<string, unknown>)[prop];
        },
      }) as typeof db;
    }

    it("captures an unexpected DB read fault in startRegistration (not the 404)", async () => {
      const telemetry = fakeTelemetry();
      const boom = new Error("D1 read failed");
      const failing = dbFailingAt("user", "findUnique", boom);

      await expect(startRegistration(failing, "user-1", config, telemetry)).rejects.toBe(boom);
      expect(telemetry.captureException).toHaveBeenCalledWith(
        boom,
        { surface: "webauthn", phase: "register_options", distinct_id: "user-1" },
      );
    });

    it("does NOT capture the expected 404 in startRegistration", async () => {
      const telemetry = fakeTelemetry();
      await expect(startRegistration(db, "missing", config, telemetry)).rejects.toMatchObject({ status: 404 });
      expect(telemetry.captureException).not.toHaveBeenCalled();
    });

    it("captures an unexpected DB read fault in finishRegistration", async () => {
      const telemetry = fakeTelemetry();
      const boom = new Error("D1 read failed");
      const failing = dbFailingAt("user", "findUnique", boom);

      await expect(
        finishRegistration(failing, "user-1", config, { id: "x" } as never, null, telemetry),
      ).rejects.toBe(boom);
      expect(telemetry.captureException).toHaveBeenCalledWith(
        boom,
        { surface: "webauthn", phase: "register_verify", distinct_id: "user-1" },
      );
    });

    it("captures the persist fault after a verified registration", async () => {
      const user = await db.user.create({ data: { ...createTestUser(), webAuthnChallenge: "reg_chal" } });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue({
        id: "persist_fail", publicKey: new Uint8Array([1]), counter: 0n, transports: null,
      });
      const telemetry = fakeTelemetry();
      const boom = new Error("D1 upsert failed");
      const failing = dbFailingAt("userCredential", "upsert", boom);

      await expect(
        finishRegistration(failing, user.id, config, { id: "persist_fail" } as never, null, telemetry),
      ).rejects.toBe(boom);
      expect(telemetry.captureException).toHaveBeenCalledWith(
        boom,
        { surface: "webauthn", phase: "register_verify", distinct_id: user.id },
      );
    });

    it("emits a verify_threw event + captures when registration verification throws", async () => {
      const user = await db.user.create({ data: { ...createTestUser(), webAuthnChallenge: "reg_chal" } });
      const verifyError = new Error("bad attestation");
      vi.mocked(verifyRegistration).mockRejectedValue(verifyError as never);
      const telemetry = fakeTelemetry();

      await expect(
        finishRegistration(db, user.id, config, { id: "x" } as never, null, telemetry),
      ).rejects.toMatchObject({ status: 400, message: "bad attestation" });
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        "spoonjoy.webauthn.failure",
        user.id,
        { surface: "webauthn", phase: "register_verify", outcome: "verify_threw" },
      );
      expect(telemetry.captureException).toHaveBeenCalledWith(
        verifyError,
        { surface: "webauthn", phase: "register_verify", distinct_id: user.id },
      );
    });

    it("emits an unverified event when registration produces no credential", async () => {
      const user = await db.user.create({ data: { ...createTestUser(), webAuthnChallenge: "reg_chal" } });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: false } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue(null);
      const telemetry = fakeTelemetry();

      await expect(
        finishRegistration(db, user.id, config, { id: "x" } as never, null, telemetry),
      ).rejects.toMatchObject({ status: 400, message: "Registration could not be verified" });
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        "spoonjoy.webauthn.failure",
        user.id,
        { surface: "webauthn", phase: "register_verify", outcome: "unverified" },
      );
    });

    it("captures an unexpected DB read fault in startAuthentication keyed by email", async () => {
      const telemetry = fakeTelemetry();
      const boom = new Error("D1 read failed");
      const failing = dbFailingAt("user", "findUnique", boom);

      await expect(startAuthentication(failing, "who@example.com", config, telemetry)).rejects.toBe(boom);
      expect(telemetry.captureException).toHaveBeenCalledWith(
        boom,
        { surface: "webauthn", phase: "authenticate_options", distinct_id: "who@example.com" },
      );
    });

    it("captures an unexpected DB read fault in finishAuthentication keyed by email", async () => {
      const telemetry = fakeTelemetry();
      const boom = new Error("D1 read failed");
      const failing = dbFailingAt("user", "findUnique", boom);

      await expect(
        finishAuthentication(failing, "who@example.com", config, { id: "x" } as never, telemetry),
      ).rejects.toBe(boom);
      expect(telemetry.captureException).toHaveBeenCalledWith(
        boom,
        { surface: "webauthn", phase: "authenticate_verify", distinct_id: "who@example.com" },
      );
    });

    it("emits a verify_threw event + captures when authentication verification throws", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), email: "throw-auth@example.com", webAuthnChallenge: "auth_chal" },
      });
      await db.userCredential.create({ data: { id: "ac1", userId: user.id, publicKey: new Uint8Array([1]), counter: 2n } });
      const verifyError = new Error("signature counter regressed");
      vi.mocked(verifyAuthentication).mockRejectedValue(verifyError as never);
      const telemetry = fakeTelemetry();

      await expect(
        finishAuthentication(db, user.email, config, { id: "ac1" } as never, telemetry),
      ).rejects.toMatchObject({ status: 400, message: "signature counter regressed" });
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        "spoonjoy.webauthn.failure",
        user.id,
        { surface: "webauthn", phase: "authenticate_verify", outcome: "verify_threw" },
      );
      expect(telemetry.captureException).toHaveBeenCalledWith(
        verifyError,
        { surface: "webauthn", phase: "authenticate_verify", distinct_id: user.id },
      );
    });

    it("emits an unverified event when authentication reports not verified", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), email: "unverified-auth@example.com", webAuthnChallenge: "auth_chal" },
      });
      await db.userCredential.create({ data: { id: "ac2", userId: user.id, publicKey: new Uint8Array([1]), counter: 2n } });
      vi.mocked(verifyAuthentication).mockResolvedValue({ verified: false } as never);
      const telemetry = fakeTelemetry();

      await expect(
        finishAuthentication(db, user.email, config, { id: "ac2" } as never, telemetry),
      ).rejects.toMatchObject({ status: 400, message: "Authentication could not be verified" });
      expect(telemetry.captureEvent).toHaveBeenCalledWith(
        "spoonjoy.webauthn.failure",
        user.id,
        { surface: "webauthn", phase: "authenticate_verify", outcome: "unverified" },
      );
    });

    it("captures the counter-rotation fault after a verified authentication", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), email: "rotate-fail@example.com", webAuthnChallenge: "auth_chal" },
      });
      await db.userCredential.create({ data: { id: "ac3", userId: user.id, publicKey: new Uint8Array([1]), counter: 2n } });
      vi.mocked(verifyAuthentication).mockResolvedValue({
        verified: true, authenticationInfo: { newCounter: 7 },
      } as never);
      const telemetry = fakeTelemetry();
      const boom = new Error("D1 counter update failed");
      const failing = dbFailingAt("userCredential", "update", boom);

      await expect(
        finishAuthentication(failing, user.email, config, { id: "ac3" } as never, telemetry),
      ).rejects.toBe(boom);
      expect(telemetry.captureException).toHaveBeenCalledWith(
        boom,
        { surface: "webauthn", phase: "authenticate_verify", distinct_id: user.id },
      );
    });

    it("does nothing when no telemetry sink is provided (back-compat)", async () => {
      const boom = new Error("D1 read failed");
      const failing = dbFailingAt("user", "findUnique", boom);
      // No telemetry arg: the helper must still rethrow, just without capturing.
      await expect(startAuthentication(failing, "who@example.com", config)).rejects.toBe(boom);
    });
  });
});
