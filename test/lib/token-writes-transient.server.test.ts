// @vitest-environment node
// Token writes when D1's connection drops: creating an API token, an OAuth sign-in's token pair,
// the authorization code burn, an agent connection's claim and, most carefully, refresh-token
// rotation. After each outcome (the write never ran, it committed but its answer was lost, or it
// committed late) the caller holds the secret of exactly one live token, never none and never a
// second one, and a rotation that gave up leaves the client a way back to the pair that is live.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  ApiAuthError,
  authenticateApiToken,
  createApiCredential,
  createApiCredentialForPrincipal,
  hashApiToken,
} from "~/lib/api-auth.server";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  hashOAuthOpaqueToken,
  issueConnectorTokens,
  OAuthError,
  revokeConnectorRefreshToken,
  rotateConnectorTokens,
  successorTokenSecrets,
  type RotateConnectorTokensInput,
} from "~/lib/oauth-server.server";
import { handleOAuthToken } from "~/lib/oauth-routes.server";
import {
  approveAgentConnectionRequest,
  pollAgentConnection,
  startAgentConnection,
} from "~/lib/agent-connection.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, NETWORK_LOST_MESSAGE, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestUser } from "../utils";

const ISSUER = "https://spoonjoy.app";
const MCP_RESOURCE = `${ISSUER}/mcp`;
const CLIENT_ID = "retry-client";
const REDIRECT_URI = "https://example.com/callback";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const KEY = "test-successor-key";
const NOW = new Date("2026-10-11T12:00:00.000Z");
const ROTATED_AT = new Date(NOW.getTime() + 60_000);
const ROTATION_BATCH = /INSERT INTO "OAuthRefreshToken"/;
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];

async function challengeFor(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(Array.from(digest, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let db: PrismaClient;
let d1: SqliteD1;
let userId: string;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  d1 = sqliteD1();
  userId = (await db.user.create({ data: createTestUser() })).id;
  await db.oAuthClient.create({
    data: { id: CLIENT_ID, clientName: "Retry harness", redirectUris: REDIRECT_URI, issuer: ISSUER },
  });
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

/** The one row a secret names, which must be the only row of its kind the user has. */
async function onlyCredentialFor(token: string) {
  const rows = await db.apiCredential.findMany({ where: { userId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.tokenHash).toBe(await hashApiToken(token));
  return rows[0]!;
}

describe("creating an API token", () => {
  it.each(OUTCOMES)("leaves one token, whose secret is the one answered, after a %s write", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("apiCredential", "create", outcome);

    const created = await createApiCredential(flaky.db, userId, "Laptop script");

    expect(flaky.failures()).toBe(1);
    expect((await onlyCredentialFor(created.token)).id).toBe(created.credential.id);
    await expect(authenticateApiToken(db, created.token, ISSUER)).resolves.toMatchObject({ id: userId });
  });

  it("gives up with a retryable error, writing nothing, when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("apiCredential", "create", "lost", "lost", "lost", "lost");

    await expect(createApiCredential(flaky.db, userId, "Laptop script")).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.apiCredential.count({ where: { userId } })).toBe(0);
  });
});

describe("creating a fenced API token on D1", () => {
  const principal = () => ({ id: userId, sessionVersion: 0 });

  it.each(OUTCOMES)("leaves one token, whose secret is the one answered, after a %s batch", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/INSERT INTO "ApiCredential"/, outcome);

    const created = await createApiCredentialForPrincipal(db, principal(), "Script", { d1: flaky.binding });

    expect(flaky.failures()).toBe(1);
    expect((await onlyCredentialFor(created.token)).id).toBe(created.credential.id);
    await expect(authenticateApiToken(db, created.token, ISSUER)).resolves.toMatchObject({ id: userId });
  });

  it("gives up with a retryable error when every try is lost", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(/INSERT INTO "ApiCredential"/, "lost", "lost", "lost", "lost");

    await expect(createApiCredentialForPrincipal(db, principal(), "Script", { d1: flaky.binding }))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.apiCredential.count({ where: { userId } })).toBe(0);
  });

  it("answers signed out, not a revoked token, when sign out everywhere landed after the lost try", async () => {
    const binding = {
      prepare: (sql: string) => d1.binding.prepare(sql),
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        await d1.binding.batch(statements);
        await db.apiCredential.updateMany({ where: { userId }, data: { revokedAt: NOW } });
        throw new Error(NETWORK_LOST_MESSAGE);
      },
    };

    const error = await createApiCredentialForPrincipal(db, principal(), "Script", { d1: binding }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiAuthError);
    expect(error).toMatchObject({ status: 401 });
  });
});

describe("issuing an OAuth token pair", () => {
  async function mintCode() {
    return createAuthorizationCode(db, {
      clientId: CLIENT_ID,
      userId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: MCP_RESOURCE,
      issuer: ISSUER,
      now: NOW,
    });
  }

  it.each(["lost", "lost-answer"] as const)("burns the code once after a %s burn", async (outcome) => {
    const code = await mintCode();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthAuthCode", "updateMany", outcome);

    await expect(consumeAuthorizationCode(flaky.db, {
      code,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      issuer: ISSUER,
      now: NOW,
    })).resolves.toMatchObject({ userId });
    expect(flaky.failures()).toBe(1);
    await expect(db.oAuthAuthCode.findFirstOrThrow({ where: { userId } })).resolves.toMatchObject({ consumedAt: NOW });
  });

  it.each([
    ["lost-answer", "late", "lost"],
    ["lost", "lost-answer", "lost-answer"],
  ] as const)("writes one grant, access token and refresh token (grant %s, access %s, refresh %s)", async (grant, access, refresh) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthGrant", "create", grant);
    flaky.failNext("apiCredential", "create", access);
    flaky.failNext("oAuthRefreshToken", "create", refresh);

    const tokens = await issueConnectorTokens(flaky.db, {
      sessionVersion: 0,
      userId,
      clientId: CLIENT_ID,
      scope: "kitchen:read",
      resource: MCP_RESOURCE,
      persistentMcpResource: MCP_RESOURCE,
      issuer: ISSUER,
      now: NOW,
    });

    expect(flaky.failures()).toBe(3);
    expect(await db.oAuthGrant.count({ where: { userId } })).toBe(1);
    await onlyCredentialFor(tokens.accessToken);
    const refreshRows = await db.oAuthRefreshToken.findMany({ where: { userId } });
    expect(refreshRows.map((row) => row.tokenHash)).toEqual([await hashOAuthOpaqueToken(tokens.refreshToken)]);
    await expect(rotateConnectorTokens(db, { refreshToken: tokens.refreshToken, clientId: CLIENT_ID, issuer: ISSUER, now: ROTATED_AT }))
      .resolves.toMatchObject({ scope: "kitchen:read" });
  });
});

describe("rotating a refresh token", () => {
  let original: Awaited<ReturnType<typeof issueConnectorTokens>>;
  let parentId: string;

  beforeEach(async () => {
    original = await issueConnectorTokens(db, {
      sessionVersion: 0,
      userId,
      clientId: CLIENT_ID,
      scope: "kitchen:read",
      resource: MCP_RESOURCE,
      persistentMcpResource: MCP_RESOURCE,
      issuer: ISSUER,
      now: NOW,
    });
    parentId = (await db.oAuthRefreshToken.findFirstOrThrow({ where: { userId } })).id;
  });

  const rotateWith = (input: Partial<RotateConnectorTokensInput> = {}, client: PrismaClient = db) => rotateConnectorTokens(client, {
    refreshToken: original.refreshToken,
    clientId: CLIENT_ID,
    issuer: ISSUER,
    legacyMcpResource: MCP_RESOURCE,
    now: ROTATED_AT,
    d1: d1.binding,
    successorKey: KEY,
    ...input,
  });

  /** The connection's live refresh token is exactly `refreshToken`, with its parent revoked. */
  async function expectOneLivePair(tokens: { accessToken: string; refreshToken: string }) {
    const live = await db.oAuthRefreshToken.findMany({ where: { userId, revokedAt: null } });
    expect(live.map((row) => row.tokenHash)).toEqual([await hashOAuthOpaqueToken(tokens.refreshToken)]);
    await expect(db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: parentId } })).resolves.toMatchObject({ revokedAt: ROTATED_AT });
    // The original access token and the new one; the new one authenticates.
    expect(await db.apiCredential.count({ where: { userId } })).toBe(2);
    await expect(authenticateApiToken(db, tokens.accessToken, ISSUER)).resolves.toMatchObject({ id: userId });
  }

  it("rotates as one batch to the pair derived from the presented token", async () => {
    const tokens = await rotateWith();

    expect(tokens).toMatchObject(await successorTokenSecrets(original.refreshToken, parentId, KEY));
    expect(tokens).toMatchObject({ scope: "kitchen:read", resource: MCP_RESOURCE, expiresIn: 90 * 24 * 60 * 60 });
    await expectOneLivePair(tokens);
  });

  it.each(OUTCOMES)("answers the one live pair after a %s batch", async (outcome) => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATION_BATCH, outcome);

    const tokens = await rotateWith({ d1: flaky.binding });

    expect(flaky.failures()).toBe(1);
    await expectOneLivePair(tokens);
    // The pair works: it rotates again.
    await expect(rotateWith({ refreshToken: tokens.refreshToken, now: new Date(ROTATED_AT.getTime() + 1000) }))
      .resolves.toMatchObject({ scope: "kitchen:read" });
  });

  it("answers the one live pair without a key, from the secrets the request holds", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATION_BATCH, "lost-answer");

    const tokens = await rotateWith({ d1: flaky.binding, successorKey: null });

    await expectOneLivePair(tokens);
    expect(tokens).not.toMatchObject(await successorTokenSecrets(original.refreshToken, parentId, KEY));
  });

  it("gives up with a retryable error leaving the presented token valid when nothing committed", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATION_BATCH, "lost", "lost", "lost", "lost");

    await expect(rotateWith({ d1: flaky.binding })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    await expect(db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: parentId } })).resolves.toMatchObject({ revokedAt: null });
    expect(await db.apiCredential.count({ where: { userId } })).toBe(1);

    await expectOneLivePair(await rotateWith());
  });

  it("answers the pair that is live when the client retries after a 503 and the batch then commits late", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATION_BATCH, "lost", "lost", "lost", "late");
    await expect(rotateWith({ d1: flaky.binding })).rejects.toBeInstanceOf(D1WriteUnavailableError);

    // The client presents the same refresh token again; the late batch lands just before this
    // request's own, which then stops on its guard and reads the token again.
    const tokens = await rotateWith({ d1: flaky.binding, now: new Date(ROTATED_AT.getTime() + 2000) });

    expect(tokens).toMatchObject(await successorTokenSecrets(original.refreshToken, parentId, KEY));
    await expectOneLivePair(tokens);
  });

  it("answers the pair that is live when the late batch committed before the client retried", async () => {
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATION_BATCH, "lost", "lost", "lost", "late");
    await expect(rotateWith({ d1: flaky.binding })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    // Something else matching lands it first.
    await flaky.binding.batch([d1.binding.prepare(`SELECT 1 -- INSERT INTO "OAuthRefreshToken"`)] as never);

    const tokens = await rotateWith({ now: new Date(ROTATED_AT.getTime() + 30_000) });

    expect(tokens.expiresIn).toBe(90 * 24 * 60 * 60 - 30);
    await expectOneLivePair(tokens);
  });

  it("answers both of two racing rotations with the same pair", async () => {
    let raced: Awaited<ReturnType<typeof rotateWith>> | null = null;
    const first = await rotateConnectorTokens(db, {
      refreshToken: original.refreshToken,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      legacyMcpResource: MCP_RESOURCE,
      now: ROTATED_AT,
      d1: d1.binding,
      successorKey: KEY,
    }, {
      onPersistenceMutation: async (stage, timing) => {
        if (stage === "parent_revoke" && timing === "before" && !raced) raced = await rotateWith();
      },
    });

    expect(first).toEqual(raced);
    await expectOneLivePair(first);
  });

  it("reports the revoke before and the replacement after the batch", async () => {
    const stages: string[] = [];
    const tokens = await rotateConnectorTokens(db, {
      refreshToken: original.refreshToken,
      clientId: CLIENT_ID,
      issuer: ISSUER,
      legacyMcpResource: MCP_RESOURCE,
      now: ROTATED_AT,
      d1: d1.binding,
      successorKey: KEY,
    }, {
      onPersistenceMutation: async (stage, timing) => {
        stages.push(`${stage}:${timing}`);
      },
    });

    expect(stages).toEqual(["parent_revoke:before", "replacement_insert:after"]);
    await expectOneLivePair(tokens);
  });

  describe("presenting the rotated token again", () => {
    async function rotatedOnce() {
      const flaky = flakyD1(d1.binding);
      flaky.failNext(ROTATION_BATCH, "lost-answer");
      return rotateWith({ d1: flaky.binding });
    }

    const presentAgain = (input: Partial<RotateConnectorTokensInput> = {}) =>
      rotateWith({ now: new Date(ROTATED_AT.getTime() + 5000), ...input });

    it("answers the same unused pair inside the grace", async () => {
      const tokens = await rotatedOnce();
      await expect(presentAgain()).resolves.toEqual({ ...tokens, expiresIn: tokens.expiresIn - 5 });
      await expectOneLivePair(tokens);
    });

    it("is refused, as before, once the pair has been used", async () => {
      const tokens = await rotatedOnce();
      await db.apiCredential.updateMany({ where: { tokenHash: await hashApiToken(tokens.accessToken) }, data: { lastUsedAt: ROTATED_AT } });

      await expect(presentAgain()).rejects.toMatchObject({ code: "invalid_grant", refusal: "grace_replay" });
      await expectOneLivePair(tokens);
    });

    it("is refused once the pair's refresh token has rotated on", async () => {
      const tokens = await rotatedOnce();
      const next = await rotateWith({ refreshToken: tokens.refreshToken, now: new Date(ROTATED_AT.getTime() + 1000) });

      await expect(presentAgain()).rejects.toMatchObject({ refusal: "grace_replay" });
      const live = await db.oAuthRefreshToken.findMany({ where: { userId, revokedAt: null } });
      expect(live.map((row) => row.tokenHash)).toEqual([await hashOAuthOpaqueToken(next.refreshToken)]);
    });

    it("is refused without the key", async () => {
      await rotatedOnce();
      await expect(presentAgain({ successorKey: undefined })).rejects.toMatchObject({ refusal: "grace_replay" });
    });

    it("is refused after the grace, which revokes the connection as before", async () => {
      await rotatedOnce();
      await expect(presentAgain({ now: new Date(ROTATED_AT.getTime() + 61_000) }))
        .rejects.toMatchObject({ refusal: "reuse_revoked" });
      expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    });

    it("is refused once the connection was disconnected", async () => {
      const tokens = await rotatedOnce();
      await revokeConnectorRefreshToken(db, { refreshToken: tokens.refreshToken, clientId: CLIENT_ID, issuer: ISSUER, now: ROTATED_AT });

      await expect(presentAgain()).rejects.toMatchObject({ code: "invalid_grant", reason: "revoked_by_user" });
    });

    it("is refused once the grant is no longer active, though the pair itself is untouched", async () => {
      await rotatedOnce();
      await db.oAuthGrant.updateMany({ where: { userId }, data: { status: "revoked", statusReason: "inactivity_expiry", statusChangedAt: ROTATED_AT } });

      await expect(presentAgain()).rejects.toBeInstanceOf(OAuthError);
    });

    it("is refused when the pair's access token was revoked", async () => {
      const tokens = await rotatedOnce();
      await db.apiCredential.updateMany({ where: { tokenHash: await hashApiToken(tokens.accessToken) }, data: { revokedAt: ROTATED_AT } });

      await expect(presentAgain()).rejects.toBeInstanceOf(OAuthError);
    });
  });
});

describe("the token endpoint", () => {
  it("answers a retryable 503 when the rotation cannot be written, and the same refresh then works", async () => {
    const tokens = await issueConnectorTokens(db, {
      sessionVersion: 0,
      userId,
      clientId: CLIENT_ID,
      scope: "kitchen:read",
      issuer: ISSUER,
      now: NOW,
    });
    const request = () => new Request(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: CLIENT_ID }),
    });
    const flaky = flakyD1(d1.binding);
    flaky.failNext(ROTATION_BATCH, "lost", "lost", "lost", "lost");

    const unavailable = await handleOAuthToken(request(), db, { DB: flaky.binding, SESSION_SECRET: KEY, SPOONJOY_BASE_URL: ISSUER });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Retry-After")).toBe("1");
    await expect(unavailable.json()).resolves.toMatchObject({ error: "temporarily_unavailable" });

    const refreshed = await handleOAuthToken(request(), db, { DB: d1.binding, SESSION_SECRET: KEY, SPOONJOY_BASE_URL: ISSUER });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({ token_type: "Bearer" });
  });
});

describe("claiming an agent connection", () => {
  async function approved() {
    const started = await startAgentConnection(db, { agentName: "slugger", scopes: "shopping_list:read", now: NOW });
    await approveAgentConnectionRequest(db, started.request.id, { userId, sessionVersion: 0 }, NOW);
    return started;
  }

  it.each(["lost", "lost-answer"] as const)("answers the token it minted after a %s claim", async (outcome) => {
    const started = await approved();
    const flaky = flakyPrisma(db);
    flaky.failNext("agentConnectionRequest", "updateMany", outcome);

    const polled = await pollAgentConnection(flaky.db, { deviceCode: started.deviceCode, now: NOW });

    expect(polled.status).toBe("approved");
    const token = (polled as { token: string }).token;
    expect((await onlyCredentialFor(token)).revokedAt).toBeNull();
    await expect(db.agentConnectionRequest.findUniqueOrThrow({ where: { id: started.request.id } }))
      .resolves.toMatchObject({ status: "claimed" });
  });
});
