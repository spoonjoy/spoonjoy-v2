// @vitest-environment node
// Passkey writes when D1's connection drops: storing a sign-in or registration challenge, saving a
// new passkey and clearing its challenge, completing a sign-in, and removing or renaming a
// passkey. After each outcome (the write never ran, it committed but its answer was lost, or it
// committed late) the rows are what one successful write leaves and the caller gets the answer
// that write would have given; when every try is lost, the write gives up with a retryable error,
// which the WebAuthn routes answer as a 503.
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

import type { PrismaClient, User } from "@prisma/client";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  credentialFromRegistration,
  verifyAuthentication,
  verifyRegistration,
} from "~/lib/webauthn.server";
import {
  finishAuthentication,
  finishRegistration,
  removeUserPasskey,
  renameUserPasskey,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  webAuthnErrorResponse,
} from "~/lib/webauthn-route.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

const config = { rpName: "Spoonjoy", rpID: "spoonjoy.app", origin: "https://spoonjoy.app" };
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];

let db: PrismaClient;
let user: User;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  vi.clearAllMocks();
  user = await db.user.create({ data: createTestUser() });
});

afterEach(async () => {
  await cleanupDatabase();
});

const challengeOf = async () => (await db.user.findUniqueOrThrow({ where: { id: user.id } })).webAuthnChallenge;

describe("storing a challenge", () => {
  it.each(OUTCOMES)("stores the registration challenge after a %s write", async (outcome) => {
    vi.mocked(buildRegistrationOptions).mockResolvedValue({ challenge: "reg_chal" } as never);
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "update", outcome);

    await expect(startRegistration(flaky.db, user.id, config)).resolves.toEqual({ challenge: "reg_chal" });
    expect(flaky.failures()).toBe(1);
    expect(await challengeOf()).toBe("reg_chal");
  });

  it.each(OUTCOMES)("stores the sign-in challenge after a %s write", async (outcome) => {
    vi.mocked(buildAuthenticationOptions).mockResolvedValue({ challenge: "auth_chal" } as never);
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "update", outcome);

    await expect(startAuthentication(flaky.db, user.email, config)).resolves.toEqual({ challenge: "auth_chal" });
    expect(flaky.failures()).toBe(1);
    expect(await challengeOf()).toBe("auth_chal");
  });

  it("gives up with a retryable error when every try is lost", async () => {
    vi.mocked(buildAuthenticationOptions).mockResolvedValue({ challenge: "auth_chal" } as never);
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "update", ...GIVE_UP);

    await expect(startAuthentication(flaky.db, user.email, config)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });
});

describe("saving a new passkey", () => {
  beforeEach(async () => {
    await db.user.update({ where: { id: user.id }, data: { webAuthnChallenge: "reg_chal" } });
    vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
    vi.mocked(credentialFromRegistration).mockReturnValue({
      id: "cred_1", publicKey: new Uint8Array([1, 2, 3]), counter: 0n, transports: "internal",
    });
  });

  it.each([
    ["userCredential", "upsert"],
    ["user", "update"],
  ] as const)("saves one passkey and clears the challenge, writing %s.%s through each outcome", async (model, method) => {
    for (const outcome of OUTCOMES) {
      await db.userCredential.deleteMany({ where: { userId: user.id } });
      await db.user.update({ where: { id: user.id }, data: { webAuthnChallenge: "reg_chal" } });
      const flaky = flakyPrisma(db);
      flaky.failNext(model, method, outcome);

      await expect(finishRegistration(flaky.db, user.id, config, { id: "cred_1" } as never, " Laptop "))
        .resolves.toEqual({ verified: true, credentialId: "cred_1" });
      expect(flaky.failures()).toBe(1);
      const rows = await db.userCredential.findMany({ where: { userId: user.id } });
      expect(rows.map((row) => [row.id, row.name])).toEqual([["cred_1", "Laptop"]]);
      expect(await challengeOf()).toBeNull();
    }
  });

  it("gives up with a retryable error, which the route answers as a 503, when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("userCredential", "upsert", ...GIVE_UP);

    const error = await finishRegistration(flaky.db, user.id, config, { id: "cred_1" } as never).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(D1WriteUnavailableError);
    const response = webAuthnErrorResponse(error, "Registration failed");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({ errorCode: "temporarily_unavailable", retryable: true });
  });
});

describe("completing a sign-in on D1", () => {
  let d1: SqliteD1;
  const ROTATE = /UPDATE "UserCredential" SET "counter"/;

  beforeEach(async () => {
    await db.user.update({ where: { id: user.id }, data: { webAuthnChallenge: "auth_chal" } });
    await db.userCredential.create({ data: { id: "auth_cred", userId: user.id, publicKey: new Uint8Array([1]), counter: 2n } });
    vi.mocked(verifyAuthentication).mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 7 } } as never);
    d1 = sqliteD1();
  });

  afterEach(() => {
    d1.close();
  });

  const signIn = (binding: SqliteD1["binding"]) => finishAuthentication(db, user.email, config, { id: "auth_cred" } as never, undefined, binding);

  it.each(OUTCOMES)("signs in once after a %s batch", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATE, outcome);

    await expect(signIn(flaky.binding)).resolves.toEqual({ verified: true, userId: user.id, sessionVersion: 0 });
    expect(flaky.failures()).toBe(1);
    expect(await challengeOf()).toBeNull();
    expect((await db.userCredential.findUniqueOrThrow({ where: { id: "auth_cred" } })).counter).toBe(7n);
  });

  it("still refuses a sign-in another submission completed first", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATE, "lost");
    // Another submission consumes the challenge while this one's first try is lost.
    const racing = {
      ...flaky.binding,
      prepare: flaky.binding.prepare,
      batch: async (statements: never[]) => {
        try {
          return await flaky.binding.batch(statements);
        } catch (error) {
          await db.user.update({ where: { id: user.id }, data: { webAuthnChallenge: null } });
          throw error;
        }
      },
    } as SqliteD1["binding"];

    await expect(signIn(racing)).rejects.toMatchObject({ name: "WebAuthnError", status: 400 });
    expect((await db.userCredential.findUniqueOrThrow({ where: { id: "auth_cred" } })).counter).toBe(2n);
  });

  it("gives up with a retryable error, leaving the sign-in unfinished, when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATE, ...GIVE_UP);

    await expect(signIn(flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await challengeOf()).toBe("auth_chal");
  });
});

describe("removing and renaming a passkey", () => {
  beforeEach(async () => {
    await db.userCredential.create({ data: { id: "cred_1", userId: user.id, publicKey: new Uint8Array([1]), counter: 0n } });
  });

  it.each(OUTCOMES)("removes the passkey and says so after a %s delete", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("userCredential", "deleteMany", outcome);

    await expect(removeUserPasskey(flaky.db, user.id, "cred_1")).resolves.toEqual({ removed: true });
    expect(flaky.failures()).toBe(1);
    expect(await db.userCredential.count({ where: { userId: user.id } })).toBe(0);
  });

  it("says nothing was removed when the passkey was already gone", async () => {
    await expect(removeUserPasskey(db, user.id, "missing")).resolves.toEqual({ removed: false });
  });

  it("says nothing was removed when another change brought the passkey back before the retry", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("userCredential", "deleteMany", "lost");
    const racing = new Proxy(flaky.db, {
      get: (target, prop) => prop === "userCredential"
        ? new Proxy(target.userCredential, {
          get: (rows, method) => method === "deleteMany"
            ? async (args: never) => {
              const result = await target.userCredential.deleteMany(args).catch((error: unknown) => error);
              if (result instanceof Error) throw result;
              // The retry deleted it; a late re-registration of the same authenticator lands.
              await db.userCredential.create({ data: { id: "cred_1", userId: user.id, publicKey: new Uint8Array([2]), counter: 0n } });
              return { count: 0 };
            }
            : Reflect.get(rows, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(removeUserPasskey(racing, user.id, "cred_1")).resolves.toEqual({ removed: false });
  });

  it("gives up removing with a retryable error when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("userCredential", "deleteMany", ...GIVE_UP);

    await expect(removeUserPasskey(flaky.db, user.id, "cred_1")).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.userCredential.count({ where: { userId: user.id } })).toBe(1);
  });

  it.each(OUTCOMES)("renames the passkey after a %s write", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("userCredential", "updateMany", outcome);

    await expect(renameUserPasskey(flaky.db, user.id, "cred_1", " Phone ")).resolves.toEqual({ renamed: true });
    expect((await db.userCredential.findUniqueOrThrow({ where: { id: "cred_1" } })).name).toBe("Phone");
  });

  it("gives up renaming with a retryable error when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("userCredential", "updateMany", ...GIVE_UP);

    await expect(renameUserPasskey(flaky.db, user.id, "cred_1", "Phone")).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });
});

describe("the WebAuthn routes' error answer", () => {
  it("answers a WebAuthnError with its own status and message", async () => {
    const response = webAuthnErrorResponse(new WebAuthnError("User not found", 404), "fallback");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "User not found" });
  });

  it("answers any other error as a 400 with its message", async () => {
    const response = webAuthnErrorResponse(new Error("bad"), "fallback");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad" });
  });

  it("answers a thrown value that is not an error with the fallback message", async () => {
    const response = webAuthnErrorResponse("nope", "fallback");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "fallback" });
  });
});
