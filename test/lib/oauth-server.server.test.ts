import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientAllowsRedirect,
  consumeAuthorizationCode as consumeAuthorizationCodeRaw,
  createAuthorizationCode as createAuthorizationCodeRaw,
  DEFAULT_SCOPE,
  getOAuthClient as getOAuthClientRaw,
  isCanonicalOAuthClientRegistration,
  isValidRedirectUri,
  issueConnectorTokens as issueConnectorTokensRaw,
  normalizeScope,
  OAuthError,
  promoteLegacyOAuthIssuerForUser,
  registerOAuthClient as registerOAuthClientRaw,
  revokeConnectorGrantsByConnectionKeys,
  validateConnectorGrantConnectionKeys,
  rotateConnectorTokens as rotateConnectorTokensRaw,
  verifyPkceS256,
} from "~/lib/oauth-server.server";
import { getLocalDb } from "~/lib/db.server";
import { createApiCredential } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

/** Derive the S256 challenge for a verifier, mirroring the lib's encoding. */
async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const ISSUER = "https://spoonjoy.app";

const registerOAuthClient = (db: any, input: any) => registerOAuthClientRaw(db, { issuer: ISSUER, ...input });
const getOAuthClient = (db: any, clientId: string, issuer = ISSUER) => getOAuthClientRaw(db, clientId, issuer);
const createAuthorizationCode = (db: any, input: any) => createAuthorizationCodeRaw(db, { issuer: ISSUER, ...input });
const consumeAuthorizationCode = (db: any, input: any) => consumeAuthorizationCodeRaw(db, { issuer: ISSUER, ...input });
const issueConnectorTokens = (db: any, input: any) => issueConnectorTokensRaw(db, { issuer: ISSUER, ...input });
const rotateConnectorTokens = (db: any, input: any) => rotateConnectorTokensRaw(db, { issuer: ISSUER, ...input });

describe("verifyPkceS256", () => {
  it("accepts a verifier whose S256 hash matches the challenge", async () => {
    expect(await verifyPkceS256(VERIFIER, await challengeFor(VERIFIER))).toBe(true);
  });

  it("rejects a mismatched verifier", async () => {
    expect(await verifyPkceS256("wrong", await challengeFor(VERIFIER))).toBe(false);
  });

  it("rejects a verifier outside the PKCE length contract", async () => {
    expect(await verifyPkceS256("short", await challengeFor("short"))).toBe(false);
  });

  it("rejects empty inputs", async () => {
    expect(await verifyPkceS256("", "x")).toBe(false);
    expect(await verifyPkceS256("x", "")).toBe(false);
  });
});

describe("isValidRedirectUri", () => {
  it("accepts https and localhost http", () => {
    expect(isValidRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:5173/cb")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:8788/cb")).toBe(true);
  });

  it("rejects plain http on a remote host and malformed URLs", () => {
    expect(isValidRedirectUri("http://evil.example.com/cb")).toBe(false);
    expect(isValidRedirectUri("not a url")).toBe(false);
  });

  it("rejects fragments, wildcard hosts, and embedded credentials", () => {
    expect(isValidRedirectUri("https://example.com/cb#fragment")).toBe(false);
    expect(isValidRedirectUri("https://*.example.com/cb")).toBe(false);
    expect(isValidRedirectUri("https://user:pass@example.com/cb")).toBe(false);
  });
});

describe("normalizeScope", () => {
  it("defaults to read+write when empty", () => {
    expect(normalizeScope(undefined)).toBe(DEFAULT_SCOPE);
    expect(normalizeScope("   ")).toBe(DEFAULT_SCOPE);
  });

  it("passes through a supported subset", () => {
    expect(normalizeScope("kitchen:read")).toBe("kitchen:read");
    expect(normalizeScope("kitchen:read kitchen:write")).toBe("kitchen:read kitchen:write");
    expect(normalizeScope("account:read account:write account:read")).toBe("account:read account:write");
  });

  it("rejects an unsupported scope", () => {
    expect(() => normalizeScope("kitchen:admin")).toThrow(OAuthError);
  });
});

describe("OAuth client registration", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("registers a client and reads it back", async () => {
    const registered = await registerOAuthClient(db, {
      clientName: "  Example App  ",
      redirectUris: ["https://claude.ai/cb", " https://claude.ai/cb2 "],
    });
    expect(registered.clientName).toBe("Example App");
    expect(registered.redirectUris).toEqual(["https://claude.ai/cb", "https://claude.ai/cb2"]);

    const fetched = await getOAuthClient(db, registered.clientId);
    expect(fetched?.redirectUris).toEqual(["https://claude.ai/cb", "https://claude.ai/cb2"]);
    expect(clientAllowsRedirect(fetched!, "https://claude.ai/cb2")).toBe(true);
    expect(clientAllowsRedirect(fetched!, "https://claude.ai/other")).toBe(false);
  });

  it("keeps registered clients bound to their exact issuer", async () => {
    const issuerA = "https://issuer-a.example";
    const registered = await registerOAuthClientRaw(db, {
      clientName: "Issuer-bound app",
      redirectUris: ["https://client.example/callback"],
      issuer: issuerA,
    });

    await expect(getOAuthClientRaw(db, registered.clientId, issuerA))
      .resolves.toMatchObject({ issuer: issuerA });
    await expect(getOAuthClientRaw(db, registered.clientId, "https://issuer-b.example"))
      .resolves.toBeNull();
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: registered.clientId } }))
      .resolves.toMatchObject({ issuer: issuerA });
  });

  it("claims a legacy client once for the first exact issuer", async () => {
    const legacy = await db.oAuthClient.create({
      data: { clientName: "Legacy app", redirectUris: "https://client.example/callback" },
    });

    await expect(getOAuthClientRaw(db, legacy.id, "https://issuer-a.example"))
      .resolves.toMatchObject({ issuer: "https://issuer-a.example" });
    await expect(getOAuthClientRaw(db, legacy.id, "https://issuer-b.example"))
      .resolves.toBeNull();
  });

  it("defaults a blank client name to null", async () => {
    const registered = await registerOAuthClient(db, {
      clientName: "   ",
      redirectUris: ["https://claude.ai/cb"],
    });
    expect(registered.clientName).toBeNull();
  });

  it("rejects an empty redirect list", async () => {
    await expect(
      registerOAuthClient(db, { redirectUris: ["  "] }),
    ).rejects.toMatchObject({ code: "invalid_redirect_uri" });
  });

  it("rejects an invalid redirect URI", async () => {
    await expect(
      registerOAuthClient(db, { redirectUris: ["http://evil.example.com/cb"] }),
    ).rejects.toMatchObject({ code: "invalid_redirect_uri" });
  });

  it.each([
    [" Claude ", "https://claude.ai/api/mcp/auth_callback"],
    ["claude", "https://claude.ai/api/mcp/auth_callback"],
    [" Spoonjoy Apple ", "https://spoonjoy.app/oauth/callback"],
    ["spoonjoy apple", "https://spoonjoy.app/oauth/callback"],
  ])("accepts the canonical reserved registration for %s", async (clientName, redirectUri) => {
    await expect(registerOAuthClient(db, { clientName, redirectUris: [redirectUri] }))
      .resolves.toMatchObject({ clientName: clientName.trim(), redirectUris: [redirectUri] });
  });

  it.each([
    ["Claude", ["https://attacker.example/cb"]],
    ["Claude", ["https://claude.ai/api/mcp/auth_callback", "https://attacker.example/cb"]],
    ["Claude", ["https://attacker.example/cb", "https://claude.ai/api/mcp/auth_callback"]],
    ["Spoonjoy Apple", ["https://attacker.example/cb"]],
    ["Spoonjoy Apple", ["https://spoonjoy.app/oauth/callback", "https://attacker.example/cb"]],
  ])("rejects reserved name %s with a noncanonical redirect set", async (clientName, redirectUris) => {
    await expect(registerOAuthClient(db, { clientName, redirectUris }))
      .rejects.toMatchObject({ code: "invalid_client_metadata" });
  });

  it("rejects duplicate redirect URIs, including a duplicated canonical callback", async () => {
    await expect(registerOAuthClient(db, {
      clientName: "Claude",
      redirectUris: [
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/api/mcp/auth_callback",
      ],
    })).rejects.toMatchObject({ code: "invalid_client_metadata" });
  });

  it("enforces the 80 Unicode-code-point client-name boundary without splitting emoji", async () => {
    await expect(registerOAuthClient(db, {
      clientName: "🧑‍🍳".repeat(26) + "ab",
      redirectUris: ["https://example.com/cb"],
    })).resolves.toBeTruthy();
    await expect(registerOAuthClient(db, {
      clientName: "😀".repeat(81),
      redirectUris: ["https://example.com/cb"],
    })).rejects.toMatchObject({ code: "invalid_client_metadata" });
  });

  it.each(["\u0000", "\u001f", "\u007f", "\u009f", "\u061c", "\u200e", "\u200f", "\u202a", "\u202e", "\u2066", "\u2069"])(
    "rejects client names containing prohibited control or bidi character %#",
    async (prohibited) => {
      await expect(registerOAuthClient(db, {
        clientName: `Meal${prohibited}Planner`,
        redirectUris: ["https://example.com/cb"],
      })).rejects.toMatchObject({ code: "invalid_client_metadata" });
    },
  );

  it("allows useful format characters outside the prohibited set", async () => {
    await expect(registerOAuthClient(db, {
      clientName: "Cooking 👩‍🍳",
      redirectUris: ["https://example.com/cb"],
    })).resolves.toMatchObject({ clientName: "Cooking 👩‍🍳" });
  });

  it("recognizes only exact singleton compatibility registrations", () => {
    const canonical = {
      clientId: "canonical",
      clientName: " Claude ",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    };
    expect(isCanonicalOAuthClientRegistration(
      canonical,
      "Claude",
      "https://claude.ai/api/mcp/auth_callback",
    )).toBe(true);
    expect(isCanonicalOAuthClientRegistration(
      { ...canonical, redirectUris: [...canonical.redirectUris, "https://attacker.example/cb"] },
      "Claude",
      "https://claude.ai/api/mcp/auth_callback",
    )).toBe(false);
    expect(isCanonicalOAuthClientRegistration(
      { ...canonical, clientName: "Claudette" },
      "Claude",
      "https://claude.ai/api/mcp/auth_callback",
    )).toBe(false);
  });

  it("returns null for a missing or empty client id", async () => {
    expect(await getOAuthClient(db, "")).toBeNull();
    expect(await getOAuthClient(db, "nope")).toBeNull();
  });
});

describe("legacy OAuth issuer promotion", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("is a no-op when the user has no legacy connector rows", async () => {
    await expect(promoteLegacyOAuthIssuerForUser(db, userId, ISSUER)).resolves.toBeUndefined();
  });

  it("promotes only rows whose existing client can be bound to this issuer", async () => {
    const legacyClient = await db.oAuthClient.create({
      data: { clientName: "Legacy app", redirectUris: "https://client.example/callback" },
    });
    const otherIssuerClient = await db.oAuthClient.create({
      data: {
        clientName: "Other deployment",
        redirectUris: "https://client.example/other",
        issuer: "https://other.example",
      },
    });
    const createRefresh = (clientId: string) => db.oAuthRefreshToken.create({
      data: {
        tokenHash: `legacy-refresh-${clientId}`,
        userId,
        clientId,
        scope: "recipes:read",
      },
    });
    const createCredential = (clientId: string) => db.apiCredential.create({
      data: {
        userId,
        name: `Legacy ${clientId}`,
        tokenHash: `legacy-credential-${clientId}`,
        tokenPrefix: `legacy-${clientId}`,
        scopes: "recipes:read",
        oauthClientId: clientId,
      },
    });
    for (const clientId of [legacyClient.id, otherIssuerClient.id, "missing-client"]) {
      await createRefresh(clientId);
      await createCredential(clientId);
    }

    await promoteLegacyOAuthIssuerForUser(db, userId, ISSUER);

    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: legacyClient.id } }))
      .resolves.toMatchObject({ issuer: ISSUER });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId: legacyClient.id } }))
      .resolves.toMatchObject({ issuer: ISSUER });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: legacyClient.id } }))
      .resolves.toMatchObject({ oauthIssuer: ISSUER });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId: otherIssuerClient.id } }))
      .resolves.toMatchObject({ issuer: null });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: otherIssuerClient.id } }))
      .resolves.toMatchObject({ oauthIssuer: null });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId: "missing-client" } }))
      .resolves.toMatchObject({ issuer: null });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: "missing-client" } }))
      .resolves.toMatchObject({ oauthIssuer: null });
  });

  it("leaves orphaned legacy rows unbound when no client exists", async () => {
    await db.oAuthRefreshToken.create({
      data: {
        tokenHash: "orphan-refresh",
        userId,
        clientId: "missing-client",
        scope: "recipes:read",
      },
    });

    await promoteLegacyOAuthIssuerForUser(db, userId, ISSUER);

    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ issuer: null });
  });
});

describe("authorization code lifecycle", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  const clientId = "client-123";
  const redirectUri = "https://claude.ai/cb";

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    const user = await db.user.create({ data: createTestUser() });
    userId = user.id;
    await db.oAuthClient.create({
      data: { id: clientId, clientName: "Example App", redirectUris: redirectUri },
    });
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  async function mintCode(overrides: Partial<Parameters<typeof createAuthorizationCode>[1]> = {}) {
    return createAuthorizationCode(db, {
      clientId,
      userId,
      redirectUri,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read kitchen:write",
      resource: "https://spoonjoy.app/mcp",
      ...overrides,
    });
  }

  it("mints a code and exchanges it for the grant", async () => {
    const code = await mintCode();
    const grant = await consumeAuthorizationCode(db, {
      code,
      clientId,
      redirectUri,
      codeVerifier: VERIFIER,
    });
    expect(grant).toEqual({
      userId,
      scope: "kitchen:read kitchen:write",
      resource: "https://spoonjoy.app/mcp",
    });
  });

  it("stores a null resource when none is provided", async () => {
    const code = await mintCode({ resource: null });
    const grant = await consumeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier: VERIFIER });
    expect(grant.resource).toBeNull();
  });

  it("promotes a legacy authorization code to the recognized client issuer", async () => {
    const code = await mintCode();
    await db.oAuthAuthCode.updateMany({ where: { userId, clientId }, data: { issuer: null } });

    await expect(consumeAuthorizationCode(db, {
      code,
      clientId,
      redirectUri,
      codeVerifier: VERIFIER,
    })).resolves.toMatchObject({ userId });
    await expect(db.oAuthAuthCode.findFirstOrThrow({ where: { userId, clientId } }))
      .resolves.toMatchObject({ issuer: ISSUER });
  });

  it("rejects an empty code", async () => {
    await expect(
      consumeAuthorizationCode(db, { code: "", clientId, redirectUri, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects an unknown code", async () => {
    await expect(
      consumeAuthorizationCode(db, { code: "oac_nope", clientId, redirectUri, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects a code replayed after use", async () => {
    const code = await mintCode();
    await consumeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier: VERIFIER });
    await expect(
      consumeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects an expired code", async () => {
    const code = await mintCode({ ttlSeconds: -1 });
    await expect(
      consumeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects a different client", async () => {
    const code = await mintCode();
    const otherClient = await registerOAuthClient(db, {
      clientName: "Other client",
      redirectUris: ["https://other.example/cb"],
    });
    await expect(
      consumeAuthorizationCode(db, {
        code,
        clientId: otherClient.clientId,
        redirectUri,
        codeVerifier: VERIFIER,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects a code whose stored issuer differs from the recognized client issuer", async () => {
    const code = await mintCode({ issuer: "https://issuer-a.example" });
    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: "https://issuer-b.example" } });

    await expect(consumeAuthorizationCodeRaw(db, {
      code,
      clientId,
      redirectUri,
      codeVerifier: VERIFIER,
      issuer: "https://issuer-b.example",
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("does not bind a legacy client from a wrong-issuer authorization code request", async () => {
    const issuerA = "https://issuer-a.example";
    const issuerB = "https://issuer-b.example";
    const code = await mintCode({ issuer: issuerA });
    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: null } });

    await expect(consumeAuthorizationCodeRaw(db, {
      code,
      clientId,
      redirectUri,
      codeVerifier: VERIFIER,
      issuer: issuerB,
    })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: clientId } }))
      .resolves.toMatchObject({ issuer: null });

    await expect(consumeAuthorizationCodeRaw(db, {
      code,
      clientId,
      redirectUri,
      codeVerifier: VERIFIER,
      issuer: issuerA,
    })).resolves.toMatchObject({ scope: "kitchen:read kitchen:write" });
  });

  it("rejects a mismatched redirect URI", async () => {
    const code = await mintCode();
    await expect(
      consumeAuthorizationCode(db, { code, clientId, redirectUri: "https://claude.ai/other", codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects a bad PKCE verifier", async () => {
    const code = await mintCode();
    await expect(
      consumeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier: "wrong-verifier" }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("treats a lost burn race as already-used", async () => {
    const challenge = await challengeFor(VERIFIER);
    const observedMutations: string[] = [];
    const stub = {
      oAuthClient: {
        findFirst: async () => ({ id: clientId, clientName: "Example App", redirectUris: redirectUri }),
      },
      oAuthAuthCode: {
        findUnique: async () => ({
          id: "race",
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          clientId,
          redirectUri,
          codeChallenge: challenge,
          scope: "kitchen:read",
          resource: null,
          issuer: ISSUER,
        }),
        updateMany: async () => ({ count: 0 }),
      },
    } as never;

    await expect(
      consumeAuthorizationCodeRaw(
        stub,
        { code: "oac_race", clientId, redirectUri, codeVerifier: VERIFIER, issuer: ISSUER },
        {
          onPersistenceMutation: (stage, timing) => {
            observedMutations.push(`${stage}:${timing}`);
          },
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(observedMutations).toEqual(["code_consumption:before"]);
  });
});

describe("connector token issuance + rotation", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  const clientId = "client-tok";

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    await db.oAuthClient.create({
      data: { id: clientId, clientName: "Example App", redirectUris: "https://example.com/cb" },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("issues a persistent MCP access token plus a refresh token", async () => {
    const tokens = await issueConnectorTokens(db, {
      userId,
      clientId,
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      persistentMcpResource: "https://spoonjoy.app/mcp",
    });
    expect(tokens.accessToken).toMatch(/^/);
    expect(tokens.refreshToken).toMatch(/^ort_/);
    expect(tokens.expiresIn).toBeNull();
    expect(tokens.scope).toBe("kitchen:read");

    const credential = await db.apiCredential.findFirst({ where: { userId } });
    expect(credential?.expiresAt).toBeNull();
    expect(credential?.scopes).toBe("kitchen:read");
    expect(credential?.oauthClientId).toBe(clientId);
    expect(credential?.oauthIssuer).toBe(ISSUER);
    expect(credential?.oauthResource).toBe("https://spoonjoy.app/mcp");
    const refresh = await db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, resource: "https://spoonjoy.app/mcp" } });
    const grant = await db.oAuthGrant.findUniqueOrThrow({ where: { connectionKey: refresh.connectionKey! } });
    expect(grant).toMatchObject({
      userId,
      clientId,
      issuer: ISSUER,
      resource: "https://spoonjoy.app/mcp",
      scope: "kitchen:read",
      status: "active",
      statusReason: null,
    });
    expect(refresh).toMatchObject({ issuer: ISSUER, grantId: grant.id });
    expect(credential).toMatchObject({ oauthGrantId: grant.id });
    await expect(db.oAuthTokenIssuance.count()).resolves.toBe(0);
    await expect(db.oAuthRefreshLineage.count()).resolves.toBe(0);
  });

  it.each([
    "https://evil.example/mcp",
    "https://spoonjoy.app./mcp",
    "https://spoonjoy.app:8443/mcp",
    "http://spoonjoy.app/mcp",
    "https://spoonjoy.app/mcp?query=1",
    "https://spoonjoy.app/mcp#fragment",
    "https://spoonjoy.app/MCP",
    "https://spoonjoy.app/mcp/",
    "https://spoonjoy.app/%6dcp",
    "https://spoonjoy.app/mcp%2f",
  ])("keeps non-canonical MCP-like resource %s expiring", async (resource) => {
    const tokens = await issueConnectorTokens(db, {
      userId,
      clientId,
      scope: "kitchen:read",
      resource,
      persistentMcpResource: "https://spoonjoy.app/mcp",
    });

    expect(tokens.expiresIn).toBeGreaterThan(0);
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ expiresAt: expect.any(Date), oauthResource: resource });
  });

  it("keeps non-MCP OAuth access tokens expiring", async () => {
    const tokens = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    expect(tokens.expiresIn).toBeGreaterThan(0);

    const credential = await db.apiCredential.findFirst({ where: { userId } });
    expect(credential?.expiresAt).toBeInstanceOf(Date);
    expect(credential?.oauthResource).toBeNull();
  });

  it("uses a neutral credential name for an unnamed OAuth client", async () => {
    await db.oAuthClient.update({ where: { id: clientId }, data: { clientName: null } });

    await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });

    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ name: "OAuth client (OAuth)" });
  });

  it("does not grant durable access for malformed resource values", async () => {
    const tokens = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: "not a url" });
    expect(tokens.expiresIn).toBeGreaterThan(0);

    const credential = await db.apiCredential.findFirst({ where: { userId } });
    expect(credential?.expiresAt).toBeInstanceOf(Date);
    expect(credential?.oauthResource).toBe("not a url");
  });

  it("refuses to issue or rotate tokens for a revoked OAuth client", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await db.oAuthClient.update({ where: { id: clientId }, data: { revokedAt: new Date() } });

    await expect(getOAuthClient(db, clientId)).resolves.toBeNull();
    await expect(issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" }))
      .rejects.toMatchObject({ code: "invalid_client" });
    await expect(rotateConnectorTokens(db, { refreshToken: first.refreshToken, clientId }))
      .rejects.toMatchObject({ code: "invalid_client" });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } }))
      .resolves.toMatchObject({ revokedAt: null });
  });

  it("rotates a refresh token, revoking the old one", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    const rotated = await rotateConnectorTokens(db, { refreshToken: first.refreshToken, clientId });
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(db.apiCredential.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ oauthIssuer: ISSUER });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, revokedAt: null } }))
      .resolves.toMatchObject({ issuer: ISSUER });
    // a second use of the original refresh token is rejected
    await expect(
      rotateConnectorTokens(db, { refreshToken: first.refreshToken, clientId }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("promotes a legacy refresh token before rotating it", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await db.oAuthRefreshToken.updateMany({ where: { userId, clientId }, data: { issuer: null, grantId: null } });
    await db.apiCredential.updateMany({ where: { userId, oauthClientId: clientId }, data: { oauthGrantId: null } });
    await db.oAuthGrant.deleteMany({ where: { userId, clientId } });

    await expect(rotateConnectorTokens(db, { refreshToken: first.refreshToken, clientId }))
      .resolves.toMatchObject({ scope: "kitchen:read" });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId, revokedAt: null } }))
      .resolves.toMatchObject({ issuer: ISSUER });
  });

  it("does not poison a partially migrated refresh token at the wrong issuer", async () => {
    const issuerA = "https://issuer-a.example";
    const issuerB = "https://issuer-b.example";
    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: issuerA } });
    const first = await issueConnectorTokensRaw(db, {
      userId,
      clientId,
      scope: "kitchen:read",
      issuer: issuerA,
    });
    await db.oAuthRefreshToken.updateMany({ where: { userId, clientId }, data: { issuer: null, grantId: null } });
    await db.apiCredential.updateMany({ where: { userId, oauthClientId: clientId }, data: { oauthIssuer: null, oauthGrantId: null } });
    await db.oAuthGrant.deleteMany({ where: { userId, clientId } });

    await expect(rotateConnectorTokensRaw(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: issuerB,
    })).rejects.toMatchObject({ code: "invalid_client" });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } }))
      .resolves.toMatchObject({ issuer: null, revokedAt: null });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: clientId } }))
      .resolves.toMatchObject({ oauthIssuer: null, revokedAt: null, lastUsedAt: null });

    await expect(rotateConnectorTokensRaw(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: issuerA,
    })).resolves.toMatchObject({ scope: "kitchen:read" });
  });

  it("does not bind a legacy client from a wrong-issuer refresh request", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const issuerA = "https://issuer-a.example";
    const issuerB = "https://issuer-b.example";
    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: issuerA } });
    const first = await issueConnectorTokensRaw(db, {
      userId,
      clientId,
      scope: "kitchen:read",
      issuer: issuerA,
    });
    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: null } });

    await expect(rotateConnectorTokensRaw(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: issuerB,
    })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: clientId } }))
      .resolves.toMatchObject({ issuer: null });
    const rotated = await rotateConnectorTokensRaw(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: issuerA,
    });

    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: null } });
    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: rotated.refreshToken,
      clientId,
      issuer: issuerB,
    })).resolves.toBe(false);
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: clientId } }))
      .resolves.toMatchObject({ issuer: null });
    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: rotated.refreshToken,
      clientId,
      issuer: issuerA,
    })).resolves.toBe(true);
  });

  it("preserves the stable connection key while rotating refresh tokens", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "account:read" });
    const original = await db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId, revokedAt: null },
    });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: clientId } }))
      .resolves.toMatchObject({ oauthConnectionKey: original.connectionKey });

    await rotateConnectorTokens(db, { refreshToken: first.refreshToken, clientId });

    const rotated = await db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId, revokedAt: null },
    });
    expect(rotated.id).not.toBe(original.id);
    expect(rotated.connectionKey).toBe(original.connectionKey);
    expect(rotated.connectionKey).toMatch(/^ocn_/);
    expect(rotated.grantId).toBe(original.grantId);
    await expect(db.apiCredential.findFirstOrThrow({
      where: { userId, oauthConnectionKey: rotated.connectionKey },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ oauthGrantId: original.grantId });
  });

  it("rejects a refresh token cross-linked to another grant before revoking anything", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await issueConnectorTokens(db, { userId, clientId, scope: "account:read" });
    const refreshes = await db.oAuthRefreshToken.findMany({
      where: { userId, clientId },
      orderBy: { createdAt: "asc" },
    });
    const [firstRefresh, secondRefresh] = refreshes;
    await db.oAuthRefreshToken.update({
      where: { id: firstRefresh.id },
      data: { grantId: secondRefresh.grantId },
    });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: ISSUER,
    })).rejects.toMatchObject({ code: "invalid_grant" });

    await expect(db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: firstRefresh.id } }))
      .resolves.toMatchObject({ revokedAt: null, grantId: secondRefresh.grantId });
    await expect(db.apiCredential.count({ where: { userId, revokedAt: { not: null } } }))
      .resolves.toBe(0);
    await expect(db.oAuthGrant.count({ where: { userId, status: { not: "active" } } }))
      .resolves.toBe(0);
  });

  it("rejects a disconnect batch whose connection key belongs to another identity", async () => {
    await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    const grant = await db.oAuthGrant.findFirstOrThrow({ where: { userId, clientId } });

    await expect(revokeConnectorGrantsByConnectionKeys(db, {
      userId,
      clientId,
      issuer: ISSUER,
      resource: `${ISSUER}/mcp`,
      connectionKeys: [grant.connectionKey],
      now: new Date(),
    })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(db.oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } }))
      .resolves.toMatchObject({ status: "active", statusReason: null });
    await expect(revokeConnectorGrantsByConnectionKeys(db, {
      userId,
      clientId,
      issuer: ISSUER,
      resource: null,
      connectionKeys: [],
      now: new Date(),
    })).resolves.toBe(0);
    await expect(validateConnectorGrantConnectionKeys(db, {
      userId,
      clientId,
      issuer: ISSUER,
      resource: null,
      connectionKeys: [],
    })).resolves.toBeUndefined();
  });

  it("rejects a legacy resource promotion cross-linked to another grant before mutating anything", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await issueConnectorTokens(db, { userId, clientId, scope: "account:read" });
    const refreshes = await db.oAuthRefreshToken.findMany({
      where: { userId, clientId },
      orderBy: { createdAt: "asc" },
    });
    const [firstRefresh, secondRefresh] = refreshes;
    await db.oAuthRefreshToken.update({
      where: { id: firstRefresh.id },
      data: { grantId: secondRefresh.grantId },
    });

    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
      legacyMcpResource: `${ISSUER}/mcp`,
    })).rejects.toMatchObject({ code: "invalid_grant" });

    await expect(db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: firstRefresh.id } }))
      .resolves.toMatchObject({ revokedAt: null, resource: null, grantId: secondRefresh.grantId });
    await expect(db.apiCredential.count({ where: { userId, oauthResource: { not: null } } }))
      .resolves.toBe(0);
    await expect(db.oAuthGrant.count({ where: { userId, resource: { not: null } } }))
      .resolves.toBe(0);
  });

  it("rejects incomplete and unexpected linked identities during legacy resource promotion", async () => {
    await db.oAuthClient.update({
      where: { id: clientId },
      data: { clientName: "Claude", redirectUris: "https://claude.ai/api/mcp/auth_callback" },
    });
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    const refresh = await db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } });
    await db.oAuthRefreshToken.update({ where: { id: refresh.id }, data: { issuer: null } });
    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
      legacyMcpResource: `${ISSUER}/mcp`,
    })).rejects.toMatchObject({ code: "invalid_grant" });

    await db.oAuthRefreshToken.update({ where: { id: refresh.id }, data: { issuer: ISSUER } });
    await db.oAuthGrant.update({ where: { id: refresh.grantId! }, data: { scope: "account:read" } });
    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
      legacyMcpResource: `${ISSUER}/mcp`,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects an incomplete linked identity before ordinary rotation", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    await db.oAuthRefreshToken.updateMany({ where: { userId, clientId }, data: { connectionKey: null } });

    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it.each([
    ["refresh", "oAuthRefreshToken"],
    ["grant", "oAuthGrant"],
  ] as const)("fails closed when legacy %s resource promotion loses its guarded write", async (_label, model) => {
    await db.oAuthClient.update({
      where: { id: clientId },
      data: { clientName: "Claude", redirectUris: "https://claude.ai/api/mcp/auth_callback" },
    });
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    vi.spyOn(db[model], "updateMany").mockResolvedValueOnce({ count: 0 });

    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
      legacyMcpResource: `${ISSUER}/mcp`,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("fails closed when access resource promotion does not converge", async () => {
    await db.oAuthClient.update({
      where: { id: clientId },
      data: { clientName: "Claude", redirectUris: "https://claude.ai/api/mcp/auth_callback" },
    });
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    vi.spyOn(db.apiCredential, "findFirst").mockResolvedValueOnce({ id: "still-unconverged" } as never);

    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
      legacyMcpResource: `${ISSUER}/mcp`,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects issuance against an existing grant with a different identity", async () => {
    await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read", resource: null });
    const refresh = await db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } });

    await expect(issueConnectorTokens(db, {
      userId,
      clientId,
      scope: "account:read",
      resource: null,
      connectionKey: refresh.connectionKey,
      grantId: refresh.grantId,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("fails closed when a validated active grant loses the disconnect write", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    vi.spyOn(db.oAuthGrant, "updateMany").mockResolvedValueOnce({ count: 0 });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: ISSUER,
    })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("derives a stable connection key for legacy refresh tokens during rotation", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "account:read" });
    const legacy = await db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId, revokedAt: null },
    });
    await db.oAuthRefreshToken.update({
      where: { id: legacy.id },
      data: { connectionKey: null, grantId: null },
    });

    await db.oAuthClient.update({
      where: { id: clientId },
      data: { clientName: "Claude", redirectUris: "https://claude.ai/api/mcp/auth_callback" },
    });
    await rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
      legacyMcpResource: `${ISSUER}/mcp`,
    });

    const rotated = await db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId, revokedAt: null },
    });
    expect(rotated.id).not.toBe(legacy.id);
    expect(rotated.connectionKey).toBe(legacy.id);
    expect(rotated.grantId).toBeNull();
    expect(rotated.resource).toBe(`${ISSUER}/mcp`);
  });

  it("rejects an empty refresh token", async () => {
    await expect(
      rotateConnectorTokens(db, { refreshToken: "", clientId }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects an empty refresh token for revocation", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");

    await expect(
      revokeConnectorRefreshToken(db, { refreshToken: "", clientId, issuer: ISSUER }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("promotes a legacy refresh token and matching access credential during revocation", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await db.oAuthRefreshToken.updateMany({
      where: { userId, clientId },
      data: { issuer: null, connectionKey: null, grantId: null },
    });
    await db.apiCredential.updateMany({
      where: { userId, oauthClientId: clientId },
      data: { oauthIssuer: null, oauthConnectionKey: null, oauthGrantId: null },
    });
    await db.oAuthGrant.deleteMany({ where: { userId, clientId } });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: ISSUER,
    })).resolves.toBe(true);
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } }))
      .resolves.toMatchObject({ issuer: ISSUER, revokedAt: expect.any(Date) });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: clientId } }))
      .resolves.toMatchObject({ oauthIssuer: ISSUER, revokedAt: expect.any(Date) });
    await expect(db.oAuthGrant.count({ where: { userId, clientId } })).resolves.toBe(0);
  });

  it("retries access cleanup after refresh revocation already committed", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    const originalCredential = await db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: clientId } });
    const originalUpdateMany = db.apiCredential.updateMany.bind(db.apiCredential);
    let accessWrite = 0;
    vi.spyOn(db.apiCredential, "updateMany").mockImplementation(async (args) => {
      accessWrite += 1;
      if (accessWrite === 2) throw new Error("access revoke failed");
      return originalUpdateMany(args);
    });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: ISSUER,
    })).rejects.toThrow("access revoke failed");
    const revokedRefresh = await db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } });
    expect(revokedRefresh.revokedAt).toBeInstanceOf(Date);
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: clientId } }))
      .resolves.toMatchObject({ revokedAt: null });

    await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    const laterRefresh = await db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId, revokedAt: null },
    });
    const laterCredential = await db.apiCredential.findFirstOrThrow({
      where: { userId, oauthClientId: clientId, oauthConnectionKey: laterRefresh.connectionKey },
    });
    const sameSecond = new Date(Math.floor(revokedRefresh.revokedAt!.getTime() / 1_000) * 1_000);
    await db.apiCredential.update({
      where: { id: laterCredential.id },
      data: { createdAt: sameSecond },
    });

    vi.restoreAllMocks();
    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: ISSUER,
    })).resolves.toBe(false);
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: originalCredential.id } }))
      .resolves.toMatchObject({ revokedAt: expect.any(Date) });
    await expect(db.oAuthRefreshToken.findUniqueOrThrow({ where: { id: laterRefresh.id } }))
      .resolves.toMatchObject({ revokedAt: null });
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: laterCredential.id } }))
      .resolves.toMatchObject({ revokedAt: null });
  });

  it("does not poison or revoke partially migrated credentials at the wrong issuer", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const issuerA = "https://issuer-a.example";
    const issuerB = "https://issuer-b.example";
    await db.oAuthClient.update({ where: { id: clientId }, data: { issuer: issuerA } });
    const first = await issueConnectorTokensRaw(db, {
      userId,
      clientId,
      scope: "kitchen:read",
      issuer: issuerA,
    });
    await db.oAuthRefreshToken.updateMany({ where: { userId, clientId }, data: { issuer: null, grantId: null } });
    await db.apiCredential.updateMany({ where: { userId, oauthClientId: clientId }, data: { oauthIssuer: null, oauthGrantId: null } });
    await db.oAuthGrant.deleteMany({ where: { userId, clientId } });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: issuerB,
    })).resolves.toBe(false);
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } }))
      .resolves.toMatchObject({ issuer: null, revokedAt: null });
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId, oauthClientId: clientId } }))
      .resolves.toMatchObject({ oauthIssuer: null, revokedAt: null, lastUsedAt: null });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: issuerA,
    })).resolves.toBe(true);
  });

  it("fails closed when a refresh row's issuer disagrees with its client", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await db.oAuthRefreshToken.updateMany({
      where: { userId, clientId },
      data: { issuer: "https://corrupt.example" },
    });

    await expect(revokeConnectorRefreshToken(db, {
      refreshToken: first.refreshToken,
      clientId,
      issuer: ISSUER,
    })).resolves.toBe(false);
    await expect(rotateConnectorTokens(db, {
      refreshToken: first.refreshToken,
      clientId,
    })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId, clientId } }))
      .resolves.toMatchObject({ issuer: "https://corrupt.example", revokedAt: null });
  });

  it("rejects an unknown refresh token", async () => {
    await expect(
      rotateConnectorTokens(db, { refreshToken: "ort_missing", clientId }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects a refresh token presented by a different client", async () => {
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });
    await expect(
      rotateConnectorTokens(db, { refreshToken: first.refreshToken, clientId: "someone-else" }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects refresh-token revocation by a different client", async () => {
    const { revokeConnectorRefreshToken } = await import("~/lib/oauth-server.server");
    const first = await issueConnectorTokens(db, { userId, clientId, scope: "kitchen:read" });

    await expect(
      revokeConnectorRefreshToken(db, { refreshToken: first.refreshToken, clientId: "someone-else", issuer: ISSUER }),
    ).resolves.toBe(false);
  });

  it("treats a lost rotation race as already-used", async () => {
    const observedMutations: string[] = [];
    const stub = {
      oAuthClient: {
        findFirst: async () => ({ id: clientId, clientName: "Example App", redirectUris: "https://example.com/cb" }),
      },
      oAuthRefreshToken: {
        findUnique: async () => ({ id: "race", revokedAt: null, clientId, userId, scope: "kitchen:read", resource: null, issuer: ISSUER }),
        updateMany: async () => ({ count: 0 }),
      },
    } as never;
    await expect(
      rotateConnectorTokensRaw(
        stub,
        { refreshToken: "ort_race", clientId, issuer: ISSUER },
        {
          onPersistenceMutation: (stage, timing) => {
            observedMutations.push(`${stage}:${timing}`);
          },
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(observedMutations).toEqual(["parent_revoke:before"]);
  });
});

describe("OAuthError", () => {
  it("defaults to status 400 and carries the code", () => {
    const err = new OAuthError("invalid_request", "bad");
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_request");
  });
});
