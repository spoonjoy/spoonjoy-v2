// @vitest-environment node
// Sign-up, provider sign-in, bearer authentication, agent connections and the iPhone app's OAuth
// client when D1's connection drops. After each outcome (the write never ran, it committed but
// its answer was lost, or it committed late) the rows are what one successful write leaves and
// the caller gets the answer that write would have given; when every try is lost, the write gives
// up with a retryable error (or, for a write that only records something, is skipped).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import {
  createOAuthUser,
  linkOAuthAccount,
  markEmailVerifiedByProvider,
  unlinkOAuthAccount,
} from "~/lib/oauth-user.server";
import { authenticateApiRequest, authenticateApiToken, createApiCredential } from "~/lib/api-auth.server";
import {
  approveAgentConnectionRequest,
  denyAgentConnectionRequest,
  getAgentConnectionRequest,
  pollAgentConnection,
  startAgentConnection,
} from "~/lib/agent-connection.server";
import { ensureNativeAppleOAuthClient, nativeAppleOAuthClientId } from "~/lib/apple-native-auth.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestUser } from "../utils";

const ISSUER = "https://spoonjoy.app";
const NOW = new Date("2026-10-11T12:00:00.000Z");
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];

let db: PrismaClient;
let d1: SqliteD1;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  d1 = sqliteD1();
});

afterEach(async () => {
  d1.close();
  vi.restoreAllMocks();
  await cleanupDatabase();
});

const newUser = (data: Partial<ReturnType<typeof createTestUser>> & { emailVerifiedAt?: Date | null } = {}) =>
  db.user.create({ data: { ...createTestUser(), ...data } });

describe("signing up with a password", () => {
  const signUp = (client: PrismaClient) => createUser(client, "New.Chef@Example.com", "new_chef", "a-long-password");

  it.each(OUTCOMES)("makes one account and answers it after a %s create", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "create", outcome);

    const user = await signUp(flaky.db);

    expect(flaky.failures()).toBe(1);
    expect(user).toMatchObject({ email: "new.chef@example.com", username: "new_chef" });
    const rows = await db.user.findMany({ where: { email: "new.chef@example.com" } });
    expect(rows.map((row) => row.id)).toEqual([user.id]);
  });

  it("gives up with a retryable error, making no account, when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "create", ...GIVE_UP);

    await expect(signUp(flaky.db)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.user.count({ where: { email: "new.chef@example.com" } })).toBe(0);
  });

  it("still refuses an email another account holds", async () => {
    await newUser({ email: "new.chef@example.com" });
    await expect(signUp(db)).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("a first sign-in with a provider on D1", () => {
  const GOOGLE = { provider: "google", providerUserId: "g-123", providerUsername: "chef@gmail.com", email: "Chef@Gmail.com", name: "Chef Cook", emailVerified: true };
  const BATCH = /INSERT INTO "User"/;

  it.each(OUTCOMES)("makes one account with its link and signs in to it after a %s batch", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(BATCH, outcome);

    const result = await createOAuthUser(db, GOOGLE, flaky.binding);

    expect(flaky.failures()).toBe(1);
    expect(result).toMatchObject({ success: true, user: { email: "chef@gmail.com" } });
    const users = await db.user.findMany({ where: { email: "chef@gmail.com" }, include: { OAuth: true } });
    expect(users.map((user) => user.id)).toEqual([result.user!.id]);
    expect(users[0]!.OAuth).toMatchObject([{ provider: "google", providerUserId: "g-123" }]);
  });

  it("gives up with a retryable error, making no account, when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(BATCH, ...GIVE_UP);

    await expect(createOAuthUser(db, GOOGLE, flaky.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.user.count({ where: { email: "chef@gmail.com" } })).toBe(0);
  });
});

describe("marking an email verified by a provider", () => {
  it.each(OUTCOMES)("verifies the account and answers true after a %s write", async (outcome) => {
    const user = await newUser({ email: "cook@example.com" });
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "updateMany", outcome);

    await expect(markEmailVerifiedByProvider(flaky.db, user.id, "COOK@example.com", true)).resolves.toBe(true);
    expect(flaky.failures()).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
  });

  it("answers false when another write verified the account first", async () => {
    const user = await newUser({ email: "cook@example.com" });
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "updateMany", "lost");
    const racing = new Proxy(flaky.db, {
      get: (target, prop) => prop === "user"
        ? new Proxy(target.user, {
          get: (users, method) => method === "updateMany"
            ? async (args: never) => {
              await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: NOW } });
              return target.user.updateMany(args);
            }
            : Reflect.get(users, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(markEmailVerifiedByProvider(racing, user.id, "cook@example.com", true)).resolves.toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toEqual(NOW);
  });

  it("gives up with a retryable error when every try is lost", async () => {
    const user = await newUser({ email: "cook@example.com" });
    const flaky = flakyPrisma(db);
    flaky.failNext("user", "updateMany", ...GIVE_UP);

    await expect(markEmailVerifiedByProvider(flaky.db, user.id, "cook@example.com", true)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });
});

describe("linking and unlinking a provider", () => {
  const GITHUB = { provider: "github", providerUserId: "gh-9", providerUsername: "chefcook" };

  it.each(OUTCOMES)("links once and answers the link after a %s create", async (outcome) => {
    const user = await newUser();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuth", "create", outcome);

    await expect(linkOAuthAccount(flaky.db, user.id, GITHUB)).resolves.toEqual({ success: true, oauthRecord: GITHUB });
    expect(flaky.failures()).toBe(1);
    expect(await db.oAuth.findMany({ where: { userId: user.id }, select: { provider: true } })).toEqual([{ provider: "github" }]);
  });

  it("gives up linking with a retryable error when every try is lost", async () => {
    const user = await newUser();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuth", "create", ...GIVE_UP);

    await expect(linkOAuthAccount(flaky.db, user.id, GITHUB)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.oAuth.count({ where: { userId: user.id } })).toBe(0);
  });

  it.each(OUTCOMES)("unlinks and answers the unlinked provider after a %s delete", async (outcome) => {
    const user = await newUser();
    await db.oAuth.create({ data: { userId: user.id, ...GITHUB } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuth", "delete", outcome);

    await expect(unlinkOAuthAccount(flaky.db, user.id, "github")).resolves.toEqual({ success: true, unlinkedProvider: GITHUB });
    expect(flaky.failures()).toBe(1);
    expect(await db.oAuth.count({ where: { userId: user.id } })).toBe(0);
  });

  it("gives up unlinking with a retryable error when every try is lost", async () => {
    const user = await newUser();
    await db.oAuth.create({ data: { userId: user.id, ...GITHUB } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuth", "delete", ...GIVE_UP);

    await expect(unlinkOAuthAccount(flaky.db, user.id, "github")).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.oAuth.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("authenticating a bearer token", () => {
  /** A legacy OAuth access token whose client and credential have no issuer yet. */
  async function legacyOAuthToken() {
    const user = await newUser();
    const client = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: "https://example.com/cb", issuer: null } });
    const created = await createApiCredential(db, user.id, "Legacy (OAuth)", { oauthClientId: client.id, oauthIssuer: null });
    return { user, client, created };
  }

  it.each([
    ["oAuthClient", "the client's issuer"],
    ["apiCredential", "the credential's issuer"],
  ] as const)("binds %s (%s) once and authenticates after each outcome", async (model) => {
    for (const outcome of OUTCOMES) {
      await cleanupDatabase();
      const { user, client, created } = await legacyOAuthToken();
      const flaky = flakyPrisma(db);
      flaky.failNext(model, "updateMany", outcome);

      await expect(authenticateApiToken(flaky.db, created.token, ISSUER)).resolves.toMatchObject({ id: user.id });
      expect(flaky.failures()).toBe(1);
      expect((await db.oAuthClient.findUniqueOrThrow({ where: { id: client.id } })).issuer).toBe(ISSUER);
      expect((await db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } })).oauthIssuer).toBe(ISSUER);
    }
  });

  it("gives up binding an issuer with a retryable error when every try is lost", async () => {
    const { created } = await legacyOAuthToken();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "updateMany", ...GIVE_UP);

    await expect(authenticateApiToken(flaky.db, created.token, ISSUER)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });

  it.each(OUTCOMES)("records when the token was used after a %s touch", async (outcome) => {
    const user = await newUser();
    const created = await createApiCredential(db, user.id, "Script");
    const flaky = flakyPrisma(db);
    flaky.failNext("apiCredential", "update", outcome);

    await expect(authenticateApiToken(flaky.db, created.token, ISSUER)).resolves.toMatchObject({ id: user.id });
    expect((await db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } })).lastUsedAt).not.toBeNull();
  });

  it("still authenticates, without recording the use, when every touch is lost", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = await newUser();
    const created = await createApiCredential(db, user.id, "Script");
    const flaky = flakyPrisma(db);
    flaky.failNext("apiCredential", "update", ...GIVE_UP);

    await expect(authenticateApiToken(flaky.db, created.token, ISSUER)).resolves.toMatchObject({ id: user.id });
    expect((await db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } })).lastUsedAt).toBeNull();
    expect(warn).toHaveBeenCalledWith("[api-auth] lastUsedAt update skipped: the database was briefly unavailable");
  });

  describe("on D1", () => {
    const TOUCH = /SET "lastUsedAt"/;
    const bearer = (token: string) => new Request("https://spoonjoy.app/api/v1/me", { headers: { Authorization: `Bearer ${token}` } });

    it.each(OUTCOMES)("records when the token was used after a %s touch", async (outcome) => {
      const user = await newUser();
      const created = await createApiCredential(db, user.id, "Script");
      const flaky = flakyD1(d1.binding);
      flaky.failNext(TOUCH, outcome);

      await expect(authenticateApiRequest(db, bearer(created.token), null, { d1: flaky.binding })).resolves.toMatchObject({ id: user.id });
      expect(flaky.failures()).toBe(1);
      expect((await db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } })).lastUsedAt).not.toBeNull();
    });

    it("still authenticates, without recording the use, when every touch is lost", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const user = await newUser();
      const created = await createApiCredential(db, user.id, "Script");
      const flaky = flakyD1(d1.binding);
      flaky.failNext(TOUCH, ...GIVE_UP);

      await expect(authenticateApiRequest(db, bearer(created.token), null, { d1: flaky.binding })).resolves.toMatchObject({ id: user.id });
      expect((await db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } })).lastUsedAt).toBeNull();
    });

    it("passes on a touch failure that is not the database being unavailable", async () => {
      const user = await newUser();
      const created = await createApiCredential(db, user.id, "Script");
      const failing = {
        prepare: (sql: string) => d1.binding.prepare(sql),
        batch: async (statements: never[]) => {
          if (TOUCH.test(String((statements[0] as { sql?: string }).sql))) throw new Error("disk full");
          return d1.binding.batch(statements);
        },
      };

      await expect(authenticateApiRequest(db, bearer(created.token), null, { d1: failing as never })).rejects.toThrow("disk full");
    });
  });
});

describe("agent connection requests", () => {
  const start = (client: PrismaClient) => startAgentConnection(client, { agentName: "slugger", baseUrl: "https://spoonjoy.app", now: NOW });

  it.each(OUTCOMES)("starts one request and answers it after a %s create", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "create", outcome);

    const started = await start(flaky.db);

    expect(flaky.failures()).toBe(1);
    const rows = await db.agentConnectionRequest.findMany();
    expect(rows.map((row) => [row.id, row.userCode])).toEqual([[started.request.id, started.request.userCode]]);
    await expect(pollAgentConnection(db, { deviceCode: started.deviceCode, now: NOW })).resolves.toMatchObject({ status: "pending" });
  });

  it("gives up starting with a retryable error when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "create", ...GIVE_UP);

    await expect(start(flaky.db)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.agentConnectionRequest.count()).toBe(0);
  });

  it.each(OUTCOMES)("records an expired request once after a %s write", async (outcome) => {
    const started = await start(db);
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "update", outcome);

    await expect(getAgentConnectionRequest(flaky.db, started.request.id, later)).resolves.toMatchObject({ status: "expired" });
    expect((await db.agentConnectionRequest.findUniqueOrThrow({ where: { id: started.request.id } })).status).toBe("expired");
  });

  it("answers an expired request as expired, recording it later, when every try is lost", async () => {
    const started = await start(db);
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "update", ...GIVE_UP);

    await expect(getAgentConnectionRequest(flaky.db, started.request.id, later)).resolves.toMatchObject({ status: "expired" });
    expect((await db.agentConnectionRequest.findUniqueOrThrow({ where: { id: started.request.id } })).status).toBe("pending");
  });

  it("passes on an expiry failure that is not the database being unavailable", async () => {
    const started = await start(db);
    const failing = new Proxy(db, {
      get: (target, prop) => prop === "agentConnectionRequest"
        ? new Proxy(target.agentConnectionRequest, {
          get: (requests, method) => method === "update" ? async () => { throw new Error("disk full"); } : Reflect.get(requests, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(getAgentConnectionRequest(failing, started.request.id, new Date(NOW.getTime() + 60 * 60 * 1000))).rejects.toThrow("disk full");
  });

  it.each(OUTCOMES)("approves once after a %s write", async (outcome) => {
    const user = await newUser();
    const started = await start(db);
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "updateMany", outcome);

    await expect(approveAgentConnectionRequest(flaky.db, started.request.id, { userId: user.id, sessionVersion: 0 }, NOW))
      .resolves.toMatchObject({ status: "approved", approvedById: user.id });
    expect(flaky.failures()).toBe(1);
  });

  it.each(OUTCOMES)("undoes an approval the session fence refuses after a %s write", async (outcome) => {
    const user = await newUser();
    const started = await start(db);
    const flaky = flakyPrisma(db);
    // The approval succeeds; the undo is the second updateMany.
    flaky.failNext("agentConnectionRequest", "updateMany", "lost-answer", outcome);

    await expect(approveAgentConnectionRequest(flaky.db, started.request.id, { userId: user.id, sessionVersion: 1 }, NOW))
      .resolves.toMatchObject({ status: "denied" });
    expect(flaky.failures()).toBe(2);
  });

  it("gives up approving with a retryable error when every try is lost", async () => {
    const user = await newUser();
    const started = await start(db);
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "updateMany", ...GIVE_UP);

    await expect(approveAgentConnectionRequest(flaky.db, started.request.id, { userId: user.id, sessionVersion: 0 }, NOW))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect((await db.agentConnectionRequest.findUniqueOrThrow({ where: { id: started.request.id } })).status).toBe("pending");
  });

  it.each(OUTCOMES)("denies once after a %s write", async (outcome) => {
    const started = await start(db);
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "update", outcome);

    await expect(denyAgentConnectionRequest(flaky.db, started.request.id, NOW)).resolves.toMatchObject({ status: "denied" });
    expect(flaky.failures()).toBe(1);
  });

  it("gives up denying with a retryable error when every try is lost", async () => {
    const started = await start(db);
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "update", ...GIVE_UP);

    await expect(denyAgentConnectionRequest(flaky.db, started.request.id, NOW)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });

  it.each(OUTCOMES)("expires an approval for account scopes after a %s write, minting nothing", async (outcome) => {
    const user = await newUser();
    const started = await start(db);
    await db.agentConnectionRequest.update({
      where: { id: started.request.id },
      data: { status: "approved", approvedById: user.id, approvedAt: NOW, scopes: "kitchen:read account:write" },
    });
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "updateMany", outcome);

    await expect(pollAgentConnection(flaky.db, { deviceCode: started.deviceCode, now: NOW })).resolves.toMatchObject({ status: "expired" });
    expect((await db.agentConnectionRequest.findUniqueOrThrow({ where: { id: started.request.id } })).status).toBe("expired");
    expect(await db.apiCredential.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("the iPhone app's OAuth client", () => {
  it.each(OUTCOMES)("is registered once after a %s upsert", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "upsert", outcome);

    const clientId = await ensureNativeAppleOAuthClient(flaky.db, ISSUER);

    expect(clientId).toBe(await nativeAppleOAuthClientId(ISSUER));
    expect(await db.oAuthClient.count({ where: { id: clientId } })).toBe(1);
  });

  it("gives up with a retryable error when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "upsert", ...GIVE_UP);

    await expect(ensureNativeAppleOAuthClient(flaky.db, ISSUER)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });
});
