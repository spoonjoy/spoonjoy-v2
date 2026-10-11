// @vitest-environment node
// The OAuth server's writes when D1's connection drops: registering a client, binding legacy rows
// to an issuer, minting an authorization code, the consent screen, converging a legacy Claude
// connection onto the MCP resource, the session fence's grant revoke, disconnecting a refresh
// token and revoking a whole connection. After each outcome (the write never ran, it committed but
// its answer was lost, or it committed late) the rows are what one successful write leaves and the
// caller gets the answer that write would have given; when every try is lost, the write gives up
// with a retryable error, which the OAuth endpoints answer as a 503.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import {
  CLAUDE_MCP_CLIENT_NAME,
  CLAUDE_MCP_REDIRECT_URI,
  consumeAuthorizationCode,
  createAuthorizationCode,
  getOAuthClient,
  hashOAuthOpaqueToken,
  issueConnectorTokens,
  OAuthError,
  promoteLegacyOAuthIssuerForUser,
  registerOAuthClient,
  revokeConnectorGrantsByConnectionKeys,
  revokeConnectorRefreshToken,
  rotateConnectorTokens,
} from "~/lib/oauth-server.server";
import {
  handleOAuthAuthorizeAction,
  handleOAuthRegister,
  handleOAuthRevoke,
  loadOAuthAuthorize,
} from "~/lib/oauth-routes.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";
import type { FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma } from "../helpers/flaky-prisma";
import { createTestUser } from "../utils";

// happy-dom's global Request strips the Cookie header; undici's keeps it.
const Request = UndiciRequest as unknown as typeof globalThis.Request;

const ISSUER = "https://spoonjoy.app";
const MCP_RESOURCE = `${ISSUER}/mcp`;
const REDIRECT_URI = "https://example.com/callback";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const NOW = new Date("2026-10-11T12:00:00.000Z");
const LATER = new Date(NOW.getTime() + 60_000);
const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];

async function challengeFor(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(Array.from(digest, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let db: PrismaClient;
let userId: string;
let clientId: string;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  userId = (await db.user.create({ data: createTestUser() })).id;
  clientId = (await db.oAuthClient.create({ data: { clientName: "Retry harness", redirectUris: REDIRECT_URI, issuer: ISSUER } })).id;
});

afterEach(async () => {
  await cleanupDatabase();
});

const issue = (input: { resource?: string | null; client?: string } = {}) => issueConnectorTokens(db, {
  sessionVersion: 0,
  userId,
  clientId: input.client ?? clientId,
  scope: "kitchen:read",
  resource: input.resource === undefined ? MCP_RESOURCE : input.resource,
  issuer: ISSUER,
  now: NOW,
});

describe("registering a client", () => {
  const register = (client: PrismaClient) => registerOAuthClient(client, { clientName: "Notes app", redirectUris: [REDIRECT_URI], issuer: ISSUER });

  it.each(OUTCOMES)("makes one client and answers it after a %s create", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "create", outcome);

    const registered = await register(flaky.db);

    expect(flaky.failures()).toBe(1);
    const rows = await db.oAuthClient.findMany({ where: { clientName: "Notes app" } });
    expect(rows.map((row) => row.id)).toEqual([registered.clientId]);
  });

  it("gives up with a retryable error, which the endpoint answers as a 503, when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "create", ...GIVE_UP);
    await expect(register(flaky.db)).rejects.toBeInstanceOf(D1WriteUnavailableError);

    flaky.failNext("oAuthClient", "create", ...GIVE_UP);
    const response = await handleOAuthRegister(new Request(`${ISSUER}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Notes app", redirect_uris: [REDIRECT_URI] }),
    }), flaky.db);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({ error: "temporarily_unavailable" });
    expect(await db.oAuthClient.count({ where: { clientName: "Notes app" } })).toBe(0);
  });
});

describe("binding legacy rows to the issuer", () => {
  it.each(OUTCOMES)("binds a legacy client once after a %s write", async (outcome) => {
    const legacy = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: REDIRECT_URI, issuer: null } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "updateMany", outcome);

    await expect(getOAuthClient(flaky.db, legacy.id, ISSUER)).resolves.toMatchObject({ clientId: legacy.id, issuer: ISSUER });
    expect(flaky.failures()).toBe(1);
  });

  it("gives up binding a legacy client with a retryable error when every try is lost", async () => {
    const legacy = await db.oAuthClient.create({ data: { clientName: "Legacy", redirectUris: REDIRECT_URI, issuer: null } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthClient", "updateMany", ...GIVE_UP);

    await expect(getOAuthClient(flaky.db, legacy.id, ISSUER)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });

  it.each([
    ["oAuthClient"],
    ["oAuthRefreshToken"],
    ["apiCredential"],
  ] as const)("promotes a chef's legacy %s rows after each outcome", async (model) => {
    for (const outcome of OUTCOMES) {
      await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: null } });
      await issue();
      await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { issuer: null } });
      await db.apiCredential.updateMany({ where: { userId }, data: { oauthIssuer: null } });
      const flaky = flakyPrisma(db);
      flaky.failNext(model, "updateMany", outcome);

      await promoteLegacyOAuthIssuerForUser(flaky.db, userId, ISSUER);

      expect(flaky.failures()).toBe(1);
      expect((await db.oAuthClient.findUniqueOrThrow({ where: { id: clientId } })).issuer).toBe(ISSUER);
      expect(await db.oAuthRefreshToken.count({ where: { userId, issuer: null } })).toBe(0);
      expect(await db.apiCredential.count({ where: { userId, oauthIssuer: null } })).toBe(0);
    }
  });

  it("gives up promoting with a retryable error when every try is lost", async () => {
    await issue();
    await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { issuer: null } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthRefreshToken", "updateMany", ...GIVE_UP);

    await expect(promoteLegacyOAuthIssuerForUser(flaky.db, userId, ISSUER)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });

  it.each(OUTCOMES)("binds a legacy authorization code once and exchanges it after a %s write", async (outcome) => {
    const code = await createAuthorizationCode(db, {
      clientId, userId, redirectUri: REDIRECT_URI, codeChallenge: await challengeFor(VERIFIER), scope: "kitchen:read", issuer: ISSUER, now: NOW,
    });
    await db.oAuthAuthCode.updateMany({ where: { userId }, data: { issuer: null } });
    const flaky = flakyPrisma(db);
    // The issuer bind is the first update; the burn after it succeeds.
    flaky.failNext("oAuthAuthCode", "updateMany", outcome);

    await expect(consumeAuthorizationCode(flaky.db, {
      code, clientId, redirectUri: REDIRECT_URI, codeVerifier: VERIFIER, issuer: ISSUER, now: NOW,
    })).resolves.toMatchObject({ userId });
    await expect(db.oAuthAuthCode.findFirstOrThrow({ where: { userId } })).resolves.toMatchObject({ issuer: ISSUER, consumedAt: NOW });
  });

  // A pre-grant refresh token: no issuer, no grant and no connection key.
  const legacyRefreshToken = async () => {
    const tokens = await issue();
    await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { issuer: null, grantId: null, connectionKey: null } });
    return tokens.refreshToken;
  };

  it.each(OUTCOMES)("binds a legacy refresh token once and rotates it after a %s write", async (outcome) => {
    const refreshToken = await legacyRefreshToken();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthRefreshToken", "updateMany", outcome);

    await expect(rotateConnectorTokens(flaky.db, { refreshToken, clientId, issuer: ISSUER, now: LATER }))
      .resolves.toMatchObject({ scope: "kitchen:read" });
    expect(flaky.failures()).toBe(1);
    expect(await db.oAuthRefreshToken.count({ where: { userId, issuer: null } })).toBe(0);
  });

  it.each(OUTCOMES)("binds a legacy refresh token once and disconnects it after a %s write", async (outcome) => {
    const refreshToken = await legacyRefreshToken();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthRefreshToken", "updateMany", outcome);

    await expect(revokeConnectorRefreshToken(flaky.db, { refreshToken, clientId, issuer: ISSUER, now: LATER })).resolves.toBe(true);
    expect(flaky.failures()).toBe(1);
    expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});

describe("minting an authorization code", () => {
  const mint = async (client: PrismaClient) => createAuthorizationCode(client, {
    clientId, userId, redirectUri: REDIRECT_URI, codeChallenge: await challengeFor(VERIFIER), scope: "kitchen:read", issuer: ISSUER, now: NOW,
  });

  it.each(OUTCOMES)("stores one code, the one answered, after a %s create", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthAuthCode", "create", outcome);

    const code = await mint(flaky.db);

    expect(flaky.failures()).toBe(1);
    const rows = await db.oAuthAuthCode.findMany({ where: { userId } });
    expect(rows.map((row) => row.codeHash)).toEqual([await hashOAuthOpaqueToken(code)]);
  });

  it("gives up with a retryable error, storing nothing, when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthAuthCode", "create", ...GIVE_UP);

    await expect(mint(flaky.db)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
  });
});

describe("the consent screen", () => {
  async function cookie(): Promise<string> {
    const session = await sessionStorage.getSession();
    session.set("userId", userId);
    return (await sessionStorage.commitSession(session)).split(";")[0];
  }

  async function open(client: PrismaClient) {
    const url = new URL(`${ISSUER}/oauth/authorize`);
    for (const [key, value] of Object.entries({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: MCP_RESOURCE,
    })) url.searchParams.set(key, value);
    return loadOAuthAuthorize(new Request(url, { headers: { Cookie: await cookie() } }), client, null);
  }

  async function decide(client: PrismaClient, decision: "approve" | "deny", consentToken: string) {
    return handleOAuthAuthorizeAction(new Request(`${ISSUER}/oauth/authorize`, {
      method: "POST",
      headers: { Cookie: await cookie() },
      body: new URLSearchParams({ decision, consent_token: consentToken }),
    }), client, null);
  }

  const consentToken = async () => ((await open(db)) as { consentToken: string }).consentToken;

  it.each(OUTCOMES)("opens one screen after a %s create", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthConsentTransaction", "create", outcome);

    const view = await open(flaky.db);

    expect(view).toMatchObject({ kind: "consent" });
    const rows = await db.oAuthConsentTransaction.findMany({ where: { userId } });
    expect(rows.map((row) => row.tokenHash)).toEqual([await hashOAuthOpaqueToken((view as { consentToken: string }).consentToken)]);
  });

  it.each(OUTCOMES)("drops expired screens after a %s prune", async (outcome) => {
    await db.oAuthConsentTransaction.create({ data: {
      tokenHash: "expired", userId, issuer: ISSUER, clientId, redirectUri: REDIRECT_URI, state: "s", scope: "kitchen:read", codeChallenge: "c", expiresAt: new Date(Date.now() - 1000),
    } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthConsentTransaction", "deleteMany", outcome);

    await expect(open(flaky.db)).resolves.toMatchObject({ kind: "consent" });
    expect(await db.oAuthConsentTransaction.count({ where: { tokenHash: "expired" } })).toBe(0);
  });

  it("says the database is briefly unavailable, with a retryable view, when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthConsentTransaction", "create", ...GIVE_UP);

    await expect(open(flaky.db)).resolves.toMatchObject({ kind: "error", retryable: true });
    expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(0);
  });

  it("passes on a failure that is not the database being unavailable", async () => {
    const failing = new Proxy(db, {
      get: (target, prop) => prop === "oAuthConsentTransaction"
        ? new Proxy(target.oAuthConsentTransaction, {
          get: (rows, method) => method === "create" ? async () => { throw new Error("disk full"); } : Reflect.get(rows, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(open(failing)).rejects.toThrow("disk full");
  });

  it.each(OUTCOMES)("approves once, with one code, after a %s consume", async (outcome) => {
    const token = await consentToken();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthConsentTransaction", "deleteMany", outcome);

    const response = await decide(flaky.db, "approve", token);

    expect(response.status).toBe(302);
    const code = new URL(response.headers.get("Location")!).searchParams.get("code")!;
    const rows = await db.oAuthAuthCode.findMany({ where: { userId } });
    expect(rows.map((row) => row.codeHash)).toEqual([await hashOAuthOpaqueToken(code)]);
    expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(0);
  });

  it.each(OUTCOMES)("denies once after a %s consume", async (outcome) => {
    const token = await consentToken();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthConsentTransaction", "deleteMany", outcome);

    const response = await decide(flaky.db, "deny", token);

    expect(response.headers.get("Location")).toContain("error=access_denied");
  });

  it("answers a 503, and withdraws the code, when every consume is lost", async () => {
    const token = await consentToken();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthConsentTransaction", "deleteMany", ...GIVE_UP);

    const response = await decide(flaky.db, "approve", token);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
    expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(1);
    // The screen still works.
    expect((await decide(db, "approve", token)).status).toBe(302);
  });

  it.each(OUTCOMES)("withdraws a code the session fence refuses after a %s delete", async (outcome) => {
    const token = await consentToken();
    await db.user.update({ where: { id: userId }, data: { sessionVersion: 1 } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthAuthCode", "deleteMany", outcome);

    const response = await decide(flaky.db, "approve", token);

    expect(response.status).toBe(400);
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
  });

  it("passes on a decision failure that is not the database being unavailable", async () => {
    const token = await consentToken();
    const failing = new Proxy(db, {
      get: (target, prop) => prop === "oAuthAuthCode"
        ? new Proxy(target.oAuthAuthCode, {
          get: (rows, method) => method === "create" ? async () => { throw new Error("disk full"); } : Reflect.get(rows, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(decide(failing, "approve", token)).rejects.toThrow("disk full");
  });
});

describe("converging a legacy Claude connection onto the MCP resource", () => {
  let claudeId: string;
  let refreshToken: string;

  beforeEach(async () => {
    claudeId = (await db.oAuthClient.create({
      data: { clientName: CLAUDE_MCP_CLIENT_NAME, redirectUris: CLAUDE_MCP_REDIRECT_URI, issuer: ISSUER },
    })).id;
    refreshToken = (await issue({ resource: null, client: claudeId })).refreshToken;
  });

  const rotate = (client: PrismaClient) => rotateConnectorTokens(client, {
    refreshToken, clientId: claudeId, issuer: ISSUER, legacyMcpResource: MCP_RESOURCE, now: LATER,
  });

  it.each([
    ["oAuthRefreshToken", "the refresh token"],
    ["apiCredential", "the access token"],
    ["oAuthGrant", "the grant"],
  ] as const)("moves %s (%s) onto the resource and rotates after each outcome", async (model) => {
    for (const outcome of OUTCOMES) {
      await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { resource: null, revokedAt: null } });
      await db.apiCredential.updateMany({ where: { userId }, data: { oauthResource: null } });
      await db.oAuthGrant.updateMany({ where: { userId }, data: { resource: null } });
      await db.oAuthRefreshToken.deleteMany({ where: { userId, tokenHash: { not: await hashOAuthOpaqueToken(refreshToken) } } });
      const flaky = flakyPrisma(db);
      flaky.failNext(model, "updateMany", outcome);

      await expect(rotate(flaky.db)).resolves.toMatchObject({ resource: MCP_RESOURCE });
      expect(await db.oAuthGrant.count({ where: { userId, resource: MCP_RESOURCE, status: "active" } })).toBe(1);
    }
  });

  it("gives up with a retryable error when every try is lost", async () => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthGrant", "updateMany", ...GIVE_UP);

    await expect(rotate(flaky.db)).rejects.toBeInstanceOf(D1WriteUnavailableError);
  });

  it("still refuses a grant another change moved off the connection", async () => {
    const grant = await db.oAuthGrant.findFirstOrThrow({ where: { userId } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthGrant", "updateMany", "lost");
    const racing = new Proxy(flaky.db, {
      get: (target, prop) => prop === "oAuthGrant"
        ? new Proxy(target.oAuthGrant, {
          get: (rows, method) => method === "updateMany"
            ? async (args: never) => {
              await db.oAuthGrant.update({ where: { id: grant.id }, data: { status: "revoked", statusReason: "disconnect", statusChangedAt: NOW } });
              return target.oAuthGrant.updateMany(args);
            }
            : Reflect.get(rows, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(rotate(racing)).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("the session fence on a new grant", () => {
  it.each(OUTCOMES)("revokes the grant it just made after a %s write", async (outcome) => {
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthGrant", "updateMany", outcome);

    await expect(issueConnectorTokens(flaky.db, {
      sessionVersion: 1, userId, clientId, scope: "kitchen:read", resource: MCP_RESOURCE, issuer: ISSUER, now: NOW,
    })).rejects.toMatchObject({ reason: "revoked_by_user" });
    expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
  });
});

describe("disconnecting with a refresh token", () => {
  const revoke = (client: PrismaClient, refreshToken: string) => revokeConnectorRefreshToken(client, { refreshToken, clientId, issuer: ISSUER, now: LATER });

  async function expectDisconnected() {
    expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(await db.apiCredential.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
  }

  it.each([
    ["oAuthRefreshToken"],
    ["apiCredential"],
    ["oAuthGrant"],
  ] as const)("revokes everything once, writing %s through each outcome", async (model) => {
    for (const outcome of OUTCOMES) {
      const { refreshToken } = await issue();
      const flaky = flakyPrisma(db);
      flaky.failNext(model, "updateMany", outcome);

      await expect(revoke(flaky.db, refreshToken)).resolves.toBe(true);
      expect(flaky.failures()).toBe(1);
      await expectDisconnected();
    }
  });

  it("gives up with a retryable error, which the endpoint answers as a 503, when every try is lost", async () => {
    const { refreshToken } = await issue();
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthGrant", "updateMany", ...GIVE_UP);
    await expect(revoke(flaky.db, refreshToken)).rejects.toBeInstanceOf(D1WriteUnavailableError);

    flaky.failNext("oAuthRefreshToken", "updateMany", ...GIVE_UP);
    const response = await handleOAuthRevoke(new Request(`${ISSUER}/oauth/revoke`, {
      method: "POST",
      body: new URLSearchParams({ token: refreshToken, client_id: clientId }),
    }), flaky.db);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
  });

  it("still fails when the grant's revoke did not converge", async () => {
    const { refreshToken } = await issue();
    const failing = new Proxy(db, {
      get: (target, prop) => prop === "oAuthGrant"
        ? new Proxy(target.oAuthGrant, {
          get: (rows, method) => method === "updateMany" ? async () => ({ count: 0 }) : Reflect.get(rows, method),
        })
        : Reflect.get(target, prop),
    }) as PrismaClient;

    await expect(revoke(failing, refreshToken)).rejects.toThrow("OAuth grant disconnect did not converge");
  });

  it.each(OUTCOMES)("revokes a connection's grants by key once after a %s write", async (outcome) => {
    await issue();
    const grant = await db.oAuthGrant.findFirstOrThrow({ where: { userId } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthGrant", "updateMany", outcome);

    await revokeConnectorGrantsByConnectionKeys(flaky.db, {
      userId, clientId, issuer: ISSUER, resource: MCP_RESOURCE, connectionKeys: [grant.connectionKey], now: LATER,
    });

    expect(flaky.failures()).toBe(1);
    expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
  });
});

describe("revoking a whole connection", () => {
  it.each([
    ["oAuthRefreshToken"],
    ["apiCredential"],
    ["oAuthGrant"],
  ] as const)("ends an expired connection, writing %s through each outcome", async (model) => {
    for (const outcome of OUTCOMES) {
      const { refreshToken } = await issue();
      await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { expiresAt: NOW } });
      const flaky = flakyPrisma(db);
      flaky.failNext(model, "updateMany", outcome);

      await expect(rotateConnectorTokens(flaky.db, { refreshToken, clientId, issuer: ISSUER, now: LATER }))
        .rejects.toMatchObject({ refusal: "expired" });
      expect(await db.oAuthRefreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(await db.apiCredential.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(await db.oAuthGrant.count({ where: { userId, status: "active" } })).toBe(0);
    }
  });

  it("gives up with a retryable error when every try is lost", async () => {
    const { refreshToken } = await issue();
    await db.oAuthRefreshToken.updateMany({ where: { userId }, data: { expiresAt: NOW } });
    const flaky = flakyPrisma(db);
    flaky.failNext("oAuthRefreshToken", "updateMany", ...GIVE_UP);

    await expect(rotateConnectorTokens(flaky.db, { refreshToken, clientId, issuer: ISSUER, now: LATER }))
      .rejects.toBeInstanceOf(D1WriteUnavailableError);
  });
});
