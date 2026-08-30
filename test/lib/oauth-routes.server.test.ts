import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import {
  handleOAuthAuthorizeAction,
  handleOAuthRegister,
  handleOAuthRevoke,
  handleOAuthToken,
  loadOAuthAuthorize,
} from "~/lib/oauth-routes.server";
import {
  CLAUDE_MCP_REDIRECT_URI,
  createAuthorizationCode,
  issueConnectorTokens,
  registerOAuthClient,
} from "~/lib/oauth-server.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

// happy-dom's global Request strips the forbidden `Cookie` header, so use
// undici's (real Fetch) Request, typed as the global, to keep sessions intact.
const Request = UndiciRequest as unknown as typeof globalThis.Request;

const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function authedCookie(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function jsonPost(body: unknown): Request {
  return new Request("https://spoonjoy.app/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formPost(url: string, fields: Record<string, string>, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  return new Request(url, { method: "POST", headers, body: new URLSearchParams(fields) });
}

describe("handleOAuthRegister", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  beforeEach(async () => { await cleanupDatabase(); db = await getLocalDb(); });
  afterEach(async () => { await cleanupDatabase(); });

  it("rejects non-POST", async () => {
    const res = await handleOAuthRegister(new Request("https://spoonjoy.app/oauth/register"), db);
    expect(res.status).toBe(405);
  });

  it("rejects invalid JSON", async () => {
    const req = new Request("https://spoonjoy.app/oauth/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad",
    });
    const res = await handleOAuthRegister(req, db);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("rejects oversized dynamic registration bodies before parsing", async () => {
    const req = new Request("https://spoonjoy.app/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: " ".repeat(16 * 1024 + 1),
    });
    const res = await handleOAuthRegister(req, db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: "Request body is too large",
    });
  });

  it("rejects declared oversized dynamic registration bodies before reading", async () => {
    const req = new Request("https://spoonjoy.app/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(16 * 1024 + 1) },
    });
    const res = await handleOAuthRegister(req, db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: "Request body is too large",
    });
  });

  it("registers a client", async () => {
    const res = await handleOAuthRegister(jsonPost({ redirect_uris: ["https://claude.ai/cb"] }), db);
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.client_id).toBe("string");
    expect(body.redirect_uris).toEqual(["https://claude.ai/cb"]);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.application_type).toBe("web");
  });

  it("binds a dynamically registered client to the configured issuer", async () => {
    const registration = await handleOAuthRegister(
      jsonPost({ redirect_uris: ["https://example.com/cb"] }),
      db,
      { SPOONJOY_BASE_URL: "https://issuer-a.example" },
    );
    const { client_id: registeredClientId } = await registration.json() as { client_id: string };
    const challenge = await challengeFor(VERIFIER);
    const authorizeUrl = new URL("https://worker.example/oauth/authorize");
    for (const [key, value] of Object.entries({
      client_id: registeredClientId,
      redirect_uri: "https://example.com/cb",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: "",
    })) authorizeUrl.searchParams.set(key, value);

    const result = await loadOAuthAuthorize(
      new Request(authorizeUrl),
      db,
      { SPOONJOY_BASE_URL: "https://issuer-b.example" },
    );

    expect(result).toMatchObject({ kind: "error", message: "Unknown OAuth client." });
  });

  it("echoes the client name when provided", async () => {
    const res = await handleOAuthRegister(
      jsonPost({ client_name: "Example App", redirect_uris: ["https://example.com/cb"] }),
      db,
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ client_name: "Example App" });
  });

  it.each([
    { client_name: "Claude", redirect_uris: ["https://attacker.example/cb"] },
    { client_name: "Spoonjoy Apple", redirect_uris: ["https://attacker.example/cb"] },
    { client_name: "Example App", redirect_uris: ["https://example.com/cb", "https://example.com/cb"] },
    { client_name: "x".repeat(81), redirect_uris: ["https://example.com/cb"] },
    { client_name: "safe\u202ename", redirect_uris: ["https://example.com/cb"] },
  ])("rejects unsafe client metadata without persisting a row", async (metadata) => {
    const before = await db.oAuthClient.count();
    const res = await handleOAuthRegister(jsonPost(metadata), db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(await db.oAuthClient.count()).toBe(before);
  });

  it("maps an invalid redirect URI to an OAuth error", async () => {
    const res = await handleOAuthRegister(jsonPost({ redirect_uris: ["http://evil.example.com/cb"] }), db);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("rejects a non-array redirect_uris", async () => {
    const res = await handleOAuthRegister(jsonPost({ redirect_uris: "nope" }), db);
    expect(res.status).toBe(400);
  });

  it.each([
    ["a null redirect URI", ["https://example.com/cb", null]],
    ["a numeric redirect URI", ["https://example.com/cb", 42]],
    ["an object redirect URI", ["https://example.com/cb", { uri: "https://other.example/cb" }]],
  ])("rejects redirect_uris containing %s without filtering the malformed member", async (_description, redirectUris) => {
    const before = await db.oAuthClient.count();
    const res = await handleOAuthRegister(jsonPost({ redirect_uris: redirectUris }), db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(await db.oAuthClient.count()).toBe(before);
  });

  it.each([null, 42, {}, ["Example App"]])("rejects non-string client_name %# without coercing it to null", async (clientName) => {
    const before = await db.oAuthClient.count();
    const res = await handleOAuthRegister(jsonPost({
      client_name: clientName,
      redirect_uris: ["https://example.com/cb"],
    }), db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(await db.oAuthClient.count()).toBe(before);
  });

  it("rejects unsupported dynamic-registration metadata", async () => {
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: ["https://claude.ai/cb"],
      client_secret: "nope",
    }), db);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
  });

  it("rejects unsupported auth methods, grants, response types, and scopes", async () => {
    for (const body of [
      { redirect_uris: ["https://claude.ai/cb"], token_endpoint_auth_method: "client_secret_basic" },
      { redirect_uris: ["https://claude.ai/cb"], grant_types: "authorization_code" },
      { redirect_uris: ["https://claude.ai/cb"], grant_types: ["client_credentials"] },
      { redirect_uris: ["https://claude.ai/cb"], response_types: ["token"] },
      { redirect_uris: ["https://claude.ai/cb"], scope: "tokens:write" },
      { redirect_uris: ["https://claude.ai/cb"], scope: "recipes:delete" },
      { redirect_uris: ["https://claude.ai/cb"], scope: ["kitchen:read"] },
    ]) {
      const res = await handleOAuthRegister(jsonPost(body), db);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/invalid_(client_metadata|scope)/) });
    }
  });

  it("accepts supported optional dynamic-registration metadata", async () => {
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: ["https://claude.ai/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "shopping_list:read shopping_list:write",
    }), db);
    expect(res.status).toBe(201);
  });

  it.each(["web", "native"])("validates and echoes application_type %s", async (applicationType) => {
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: [applicationType === "native" ? "http://127.0.0.1:3210/callback" : "https://example.com/cb"],
      application_type: applicationType,
    }), db);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ application_type: applicationType });
  });

  it("rejects an invalid application_type without persisting a client", async () => {
    const before = await db.oAuthClient.count();
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: ["https://example.com/cb"],
      application_type: "desktop",
    }), db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(await db.oAuthClient.count()).toBe(before);
  });

  it.each([null, 42, {}, ["native"]])("rejects non-string application_type %#", async (applicationType) => {
    const before = await db.oAuthClient.count();
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: ["https://example.com/cb"],
      application_type: applicationType,
    }), db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_metadata" });
    expect(await db.oAuthClient.count()).toBe(before);
  });

  it("accepts and ignores standard RFC 7591 metadata Spoonjoy does not store", async () => {
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: ["https://example.com/cb"],
      client_name: "Example App",
      application_type: "web",
      client_uri: "https://claude.ai",
      logo_uri: "https://claude.ai/logo.png",
      policy_uri: "https://claude.ai/privacy",
      tos_uri: "https://claude.ai/terms",
      contacts: ["dev@example.com"],
      software_id: "claude-connector",
      software_version: "1.0.0",
      jwks_uri: "https://claude.ai/.well-known/jwks.json",
      subject_type: "public",
      request_uris: ["https://claude.ai/oauth/request"],
    }), db);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      client_name: "Example App",
      redirect_uris: ["https://example.com/cb"],
      token_endpoint_auth_method: "none",
    });
  });
});

describe("handleOAuthToken", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  const clientId = "client-abc";
  const redirectUri = "https://claude.ai/cb";
  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    await db.oAuthClient.create({
      data: { id: clientId, clientName: "Example App", redirectUris: redirectUri },
    });
  });
  afterEach(async () => { await cleanupDatabase(); });

  async function mintCode() {
    return createAuthorizationCode(db, {
      clientId, userId, redirectUri,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read kitchen:write",
      resource: "https://spoonjoy.app/mcp",
    });
  }

  it("rejects non-POST", async () => {
    const res = await handleOAuthToken(new Request("https://spoonjoy.app/oauth/token"), db, null);
    expect(res.status).toBe(405);
  });

  it("rejects a body that is not form-encoded", async () => {
    const req = new Request("https://spoonjoy.app/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const res = await handleOAuthToken(req, db, null);
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported grant type", async () => {
    const res = await handleOAuthToken(formPost("https://spoonjoy.app/oauth/token", { grant_type: "password" }), db, null);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "unsupported_grant_type" });
  });

  it("accepts an empty form-encoded token request and rejects it as an unsupported grant", async () => {
    const res = await handleOAuthToken(new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
    }), db, null);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "unsupported_grant_type" });
  });

  it("exchanges a valid code for access + refresh tokens", async () => {
    const code = await mintCode();
    const res = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: VERIFIER,
      }),
      db, null,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    expect(body.token_type).toBe("Bearer");
    expect(body).not.toHaveProperty("expires_in");
    expect(body.scope).toBe("kitchen:read kitchen:write");
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({
        name: "Example App (OAuth)",
        oauthClientId: clientId,
        oauthIssuer: "https://spoonjoy.app",
        oauthResource: "https://spoonjoy.app/mcp",
        expiresAt: null,
      });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ issuer: "https://spoonjoy.app" });
    await expect(db.oAuthClient.findUniqueOrThrow({ where: { id: clientId } }))
      .resolves.toMatchObject({ issuer: "https://spoonjoy.app" });
    // the access token is a real ApiCredential, plus one refresh token
    expect(await db.apiCredential.count({ where: { userId } })).toBe(1);
    expect(await db.oAuthRefreshToken.count({ where: { userId } })).toBe(1);
  });

  it("returns invalid_client when a client is revoked before code exchange", async () => {
    const code = await mintCode();
    await db.oAuthClient.update({ where: { id: clientId }, data: { revokedAt: new Date() } });
    const res = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: VERIFIER,
      }),
      db,
      null,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client" });
  });

  it("exchanges and refreshes tokens without a resource indicator", async () => {
    const code = await createAuthorizationCode(db, {
      clientId,
      userId,
      redirectUri,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: null,
    });
    const first = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: VERIFIER,
      }),
      db, null,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { refresh_token: string; expires_in: number };
    expect(firstBody.expires_in).toBeGreaterThan(0);
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ oauthClientId: clientId, oauthResource: null, expiresAt: expect.any(Date) });

    const refresh = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token", refresh_token: firstBody.refresh_token, client_id: clientId,
      }),
      db, null,
    );

    expect(refresh.status).toBe(200);
    await expect(refresh.json()).resolves.toMatchObject({ scope: "kitchen:read", expires_in: expect.any(Number) });
    await expect(db.apiCredential.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ oauthIssuer: "https://spoonjoy.app" });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, revokedAt: null },
    })).resolves.toMatchObject({ issuer: "https://spoonjoy.app" });
  });

  it("promotes legacy Claude MCP refresh tokens to the protected resource", async () => {
    const claudeClient = await registerOAuthClient(db, {
      clientName: "Claude",
      redirectUris: [CLAUDE_MCP_REDIRECT_URI],
    });
    const code = await createAuthorizationCode(db, {
      clientId: claudeClient.clientId,
      userId,
      redirectUri: CLAUDE_MCP_REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read kitchen:write",
      resource: null,
    });
    const first = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code",
        code,
        client_id: claudeClient.clientId,
        redirect_uri: CLAUDE_MCP_REDIRECT_URI,
        code_verifier: VERIFIER,
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { refresh_token: string; expires_in: number };
    expect(firstBody.expires_in).toBeGreaterThan(0);

    const refresh = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: firstBody.refresh_token,
        client_id: claudeClient.clientId,
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json() as Record<string, unknown>;
    expect(refreshBody).not.toHaveProperty("expires_in");
    await expect(db.apiCredential.findFirstOrThrow({
      where: { userId, oauthClientId: claudeClient.clientId },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({
      oauthResource: "https://spoonjoy.app/mcp",
      expiresAt: null,
    });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId: claudeClient.clientId, revokedAt: null },
    })).resolves.toMatchObject({ resource: "https://spoonjoy.app/mcp" });
  });

  it.each([
    "https://evil.example/mcp",
    "https://spoonjoy.app./mcp",
    "https://spoonjoy.app/mcp?query=1",
  ])("keeps a rotated non-canonical resource %s expiring", async (resource) => {
    const issued = await issueConnectorTokens(db, {
      userId,
      clientId,
      scope: "kitchen:read",
      resource,
      persistentMcpResource: "https://spoonjoy.app/mcp",
      issuer: "https://spoonjoy.app",
    });

    const response = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: issued.refreshToken,
        client_id: clientId,
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ expires_in: expect.any(Number) });
    await expect(db.apiCredential.findFirstOrThrow({
      where: { userId, oauthClientId: clientId },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ oauthResource: resource, expiresAt: expect.any(Date) });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId, revokedAt: null },
    })).resolves.toMatchObject({ resource });
  });

  it("does not promote a legacy mixed-callback Claude refresh token", async () => {
    const mixedClient = await db.oAuthClient.create({
      data: {
        clientName: "Claude",
        redirectUris: `${CLAUDE_MCP_REDIRECT_URI} https://attacker.example/cb`,
      },
    });
    const code = await createAuthorizationCode(db, {
      clientId: mixedClient.id,
      userId,
      redirectUri: CLAUDE_MCP_REDIRECT_URI,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read kitchen:write",
      resource: null,
    });
    const first = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code",
        code,
        client_id: mixedClient.id,
        redirect_uri: CLAUDE_MCP_REDIRECT_URI,
        code_verifier: VERIFIER,
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );
    const firstBody = await first.json() as { refresh_token: string };

    const refresh = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: firstBody.refresh_token,
        client_id: mixedClient.id,
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(first.status).toBe(200);
    expect(refresh.status).toBe(200);
    await expect(refresh.json()).resolves.toMatchObject({ expires_in: expect.any(Number) });
    await expect(db.apiCredential.findFirstOrThrow({
      where: { userId, oauthClientId: mixedClient.id },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ oauthResource: null, expiresAt: expect.any(Date) });
    await expect(db.oAuthRefreshToken.findFirstOrThrow({
      where: { userId, clientId: mixedClient.id, revokedAt: null },
    })).resolves.toMatchObject({ resource: null });
  });

  it("exchanges a refresh token for a rotated pair and rejects the old one", async () => {
    const code = await mintCode();
    const first = await (await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: VERIFIER,
      }),
      db, null,
    )).json() as { refresh_token: string };

    const res = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId,
      }),
      db, null,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.access_token).toBe("string");
    expect(body.refresh_token).not.toBe(first.refresh_token); // rotated
    expect(body).not.toHaveProperty("expires_in");

    const replay = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId,
      }),
      db, null,
    );
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a refresh for an unknown token", async () => {
    const res = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token", refresh_token: "ort_nope", client_id: clientId,
      }),
      db, null,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("revokes a refresh token for native and extension disconnect flows", async () => {
    const code = await mintCode();
    const first = await (await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: VERIFIER,
      }),
      db, null,
    )).json() as { refresh_token: string };

    const revoke = await handleOAuthRevoke(
      formPost("https://spoonjoy.app/oauth/revoke", {
        token: first.refresh_token,
        client_id: clientId,
        token_type_hint: "refresh_token",
      }),
      db,
    );
    expect(revoke.status).toBe(200);
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ revokedAt: expect.any(Date) });

    const refresh = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: clientId,
      }),
      db, null,
    );
    expect(refresh.status).toBe(400);
    await expect(refresh.json()).resolves.toMatchObject({ error: "invalid_grant" });

    const repeat = await handleOAuthRevoke(
      formPost("https://spoonjoy.app/oauth/revoke", { token: first.refresh_token, client_id: clientId }),
      db,
    );
    expect(repeat.status).toBe(200);

    const empty = await handleOAuthRevoke(formPost("https://spoonjoy.app/oauth/revoke", {}), db);
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("rejects an authorization_code request with the fields missing", async () => {
    const res = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", { grant_type: "authorization_code" }),
      db, null,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects an invalid code", async () => {
    const res = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code", code: "oac_nope", client_id: clientId, redirect_uri: redirectUri, code_verifier: VERIFIER,
      }),
      db, null,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("does not consume an authorization code at a different issuer", async () => {
    const issuerA = "https://issuer-a.example";
    const issuerB = "https://issuer-b.example";
    const boundClient = await registerOAuthClient(db, {
      redirectUris: [redirectUri],
      issuer: issuerA,
    });
    const code = await createAuthorizationCode(db, {
      clientId: boundClient.clientId,
      userId,
      redirectUri,
      codeChallenge: await challengeFor(VERIFIER),
      scope: "kitchen:read",
      resource: null,
      issuer: issuerA,
    });
    const res = await handleOAuthToken(
      formPost("https://worker.example/oauth/token", {
        grant_type: "authorization_code",
        code,
        client_id: boundClient.clientId,
        redirect_uri: redirectUri,
        code_verifier: VERIFIER,
      }),
      db,
      { SPOONJOY_BASE_URL: issuerB },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_grant" });
    await expect(db.oAuthAuthCode.findFirstOrThrow({ where: { clientId: boundClient.clientId } }))
      .resolves.toMatchObject({ consumedAt: null });
  });

  it("does not rotate or revoke a refresh token at a different issuer", async () => {
    const issuerA = "https://issuer-a.example";
    const issuerB = "https://issuer-b.example";
    const boundClient = await registerOAuthClient(db, { redirectUris: [redirectUri], issuer: issuerA });
    const issued = await issueConnectorTokens(db, {
      userId,
      clientId: boundClient.clientId,
      scope: "kitchen:read",
      issuer: issuerA,
    });

    const rotation = await handleOAuthToken(
      formPost("https://worker.example/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: issued.refreshToken,
        client_id: boundClient.clientId,
      }),
      db,
      { SPOONJOY_BASE_URL: issuerB },
    );
    const revocation = await handleOAuthRevoke(
      formPost("https://worker.example/oauth/revoke", {
        token: issued.refreshToken,
        client_id: boundClient.clientId,
      }),
      db,
      { SPOONJOY_BASE_URL: issuerB },
    );

    expect(rotation.status).toBe(400);
    await expect(rotation.json()).resolves.toMatchObject({ error: "invalid_grant" });
    expect(revocation.status).toBe(200);
    await expect(db.oAuthRefreshToken.findFirstOrThrow({ where: { clientId: boundClient.clientId } }))
      .resolves.toMatchObject({ issuer: issuerA, revokedAt: null });
  });
});

describe("loadOAuthAuthorize", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  let clientId: string;
  const redirectUri = "https://claude.ai/cb";
  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    clientId = (await registerOAuthClient(db, { redirectUris: [redirectUri] })).clientId;
  });
  afterEach(async () => { await cleanupDatabase(); });

  async function authorizeGet(
    query: Record<string, string>,
    cookie?: string,
    requestUrl = "https://spoonjoy.app/oauth/authorize",
  ): Promise<Request> {
    const url = new URL(requestUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = new Headers();
    if (cookie) headers.set("Cookie", cookie);
    return new Request(url, { headers });
  }

  async function validQuery(): Promise<Record<string, string>> {
    return {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: "https://spoonjoy.app/mcp",
    };
  }

  it("errors on an unknown client", async () => {
    const result = await loadOAuthAuthorize(await authorizeGet({ client_id: "nope", redirect_uri: redirectUri }), db, null);
    expect(result).toMatchObject({ kind: "error" });
  });

  it("errors on an unregistered redirect URI", async () => {
    const result = await loadOAuthAuthorize(await authorizeGet({ client_id: clientId, redirect_uri: "https://evil/cb" }), db, null);
    expect(result).toMatchObject({ kind: "error" });
  });

  it.each([
    ["unsupported response type", { response_type: "token" }, "unsupported_response_type", true],
    ["missing state", { state: "" }, "invalid_request", false],
    ["invalid PKCE method", { code_challenge_method: "plain" }, "invalid_request", true],
    ["unsupported scope", { scope: "kitchen:admin" }, "invalid_scope", true],
    ["unexpected resource", { resource: "https://evil.example/mcp" }, "invalid_target", true],
  ] as const)("redirects %s with the exact issuer and safe state handling", async (_name, overrides, error, preservesState) => {
    const query = { ...await validQuery(), ...overrides };
    const result = await loadOAuthAuthorize(
      await authorizeGet(query, undefined, "https://internal.workers.dev/oauth/authorize"),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    ) as Response;
    const location = new URL(result.headers.get("Location") ?? "");

    expect(result.status).toBe(302);
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("iss")).toBe("https://spoonjoy.app");
    expect(location.searchParams.get("state")).toBe(preservesState ? "state_0123456789abcdef" : null);
  });

  it.each([
    "https://SPOONJOY.APP/mcp",
    "https://spoonjoy.app:443/mcp",
    "https://spoonjoy.app./mcp",
    "https://spoonjoy.app:8443/mcp",
    "http://spoonjoy.app/mcp",
    "https://spoonjoy.app/mcp/",
    "https://spoonjoy.app/%6dcp",
    "https://spoonjoy.app/mcp?query=1",
    "https://spoonjoy.app/mcp#fragment",
  ])("requires the exact configured protected resource instead of %s", async (resource) => {
    const query = await validQuery();
    query.resource = resource;
    const result = await loadOAuthAuthorize(
      await authorizeGet(query),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    ) as Response;

    const location = new URL(result.headers.get("Location") ?? "");
    expect(location.searchParams.get("error")).toBe("invalid_target");
    expect(location.searchParams.get("iss")).toBe("https://spoonjoy.app");
    expect(location.searchParams.get("state")).toBe("state_0123456789abcdef");
  });

  it("accepts a blank resource indicator as no resource", async () => {
    const cookie = await authedCookie(userId);
    const q = await validQuery();
    q.resource = "";
    const result = await loadOAuthAuthorize(await authorizeGet(q, cookie), db, null);
    expect(result).toMatchObject({ kind: "consent" });
    expect(result).not.toHaveProperty("resource");
  });

  it("rejects a consent POST when the session is no longer authenticated", async () => {
    const result = await loadOAuthAuthorize(await authorizeGet(await validQuery()), db, null) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toContain("/login?redirectTo=");
  });

  it("returns the consent view when authenticated", async () => {
    const cookie = await authedCookie(userId);
    const result = await loadOAuthAuthorize(await authorizeGet(await validQuery(), cookie), db, null);
    expect(result).toMatchObject({ kind: "consent", scope: "kitchen:read" });
    expect((result as { consentToken: string }).consentToken).toMatch(/^oct_[A-Za-z0-9_-]{43}$/);
    await expect(db.oAuthConsentTransaction.findFirstOrThrow({ where: { userId } })).resolves.toMatchObject({
      issuer: "https://spoonjoy.app",
      clientId,
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
    });
    expect((await db.oAuthConsentTransaction.findFirstOrThrow({ where: { userId } })).tokenHash)
      .not.toContain((result as { consentToken: string }).consentToken);
  });

  it("does not create a consent transaction before authentication", async () => {
    await loadOAuthAuthorize(await authorizeGet(await validQuery()), db, null);
    expect(await db.oAuthConsentTransaction.count()).toBe(0);
  });

  it("removes expired consent transactions before creating a replacement", async () => {
    await db.oAuthConsentTransaction.create({
      data: {
        tokenHash: "expired-consent",
        userId,
        issuer: "https://spoonjoy.app",
        clientId,
        redirectUri,
        state: "state_expired_0123456789",
        scope: "kitchen:read",
        codeChallenge: await challengeFor(VERIFIER),
        expiresAt: new Date(Date.now() - 1),
      },
    });
    const cookie = await authedCookie(userId);

    await loadOAuthAuthorize(await authorizeGet(await validQuery(), cookie), db, null);

    expect(await db.oAuthConsentTransaction.count({ where: { tokenHash: "expired-consent" } })).toBe(0);
    expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(1);
  });

  it("does not fetch or advertise unsupported Client ID Metadata Documents", async () => {
    const q = await validQuery();
    q.client_id = "https://client.example/oauth/client.json";
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const result = await loadOAuthAuthorize(await authorizeGet(q), db, null);
      expect(result).toMatchObject({ kind: "error", message: "Unknown OAuth client." });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats a revoked client as unknown", async () => {
    await db.oAuthClient.update({ where: { id: clientId }, data: { revokedAt: new Date() } });
    const result = await loadOAuthAuthorize(await authorizeGet(await validQuery()), db, null);

    expect(result).toMatchObject({ kind: "error", message: "Unknown OAuth client." });
  });

  it("rejects the reported corrected-path request with short state and no PKCE", async () => {
    const reportClientId = "cmt723pe00000tx0nap6unplp";
    const reportRedirect = "https://attacker.evil-test.example/cb";
    await db.oAuthClient.create({
      data: {
        id: reportClientId,
        clientName: "security-research-test",
        redirectUris: reportRedirect,
      },
    });
    const result = await loadOAuthAuthorize(await authorizeGet({
      client_id: reportClientId,
      redirect_uri: reportRedirect,
      response_type: "code",
      state: "randomstate123",
    }), db, null) as Response;
    const location = new URL(result.headers.get("Location") ?? "");

    expect(result.status).toBe(302);
    expect(location.origin + location.pathname).toBe(reportRedirect);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("randomstate123");
  });
});

describe("handleOAuthAuthorizeAction", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  let clientId: string;
  const redirectUri = "https://claude.ai/cb";
  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    clientId = (await registerOAuthClient(db, { redirectUris: [redirectUri] })).clientId;
  });
  afterEach(async () => { await cleanupDatabase(); });

  async function fields(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: "https://spoonjoy.app/mcp",
      decision: "approve",
      ...extra,
    };
  }

  async function consentTokenFor(
    requestedFields: Record<string, string>,
    cookie: string,
  ): Promise<string> {
    const url = new URL("https://spoonjoy.app/oauth/authorize");
    for (const [key, value] of Object.entries(requestedFields)) {
      if (key !== "decision") url.searchParams.set(key, value);
    }
    const result = await loadOAuthAuthorize(
      new Request(url, { headers: { Cookie: cookie } }),
      db,
      null,
    );
    expect(result).toMatchObject({ kind: "consent" });
    return (result as { consentToken: string }).consentToken;
  }

  it("400s on an invalid client/redirect", async () => {
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ client_id: "nope" })),
      db, null,
    );
    expect(res.status).toBe(400);
  });

  it("redirects to login when not authenticated", async () => {
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields()),
      db, null,
    );
    expect(res.status).toBe(400);
  });

  it("does not trust reposted authorize parameters before login", async () => {
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ scope: "kitchen:admin" })),
      db, null,
    );

    expect(res.status).toBe(400);
  });

  it("redirects back with access_denied on deny", async () => {
    const cookie = await authedCookie(userId);
    const requested = await fields();
    const consentToken = await consentTokenFor(requested, cookie);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "deny", consent_token: consentToken }, cookie),
      db, null,
    );
    expect(res.headers.get("Location")).toContain("error=access_denied");
    expect(res.headers.get("Location")).toContain("state=state_0123456789abcdef");
    expect(new URL(res.headers.get("Location") ?? "").searchParams.get("iss")).toBe("https://spoonjoy.app");
  });

  it("rejects a deny replay that loses the one-time consent race", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const consumeSpy = vi.spyOn(db.oAuthConsentTransaction, "deleteMany")
      .mockResolvedValueOnce({ count: 0 });

    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "deny", consent_token: consentToken }, cookie),
      db,
      null,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: "The consent transaction is invalid or expired.",
    });
    consumeSpy.mockRestore();
  });

  it("rejects cross-origin consent POSTs even when a session cookie is present", async () => {
    const cookie = await authedCookie(userId);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "https://evil.example");
    const res = await handleOAuthAuthorizeAction(
      new Request("https://spoonjoy.app/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams(await fields()),
      }),
      db, null,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: "OAuth consent must be submitted from Spoonjoy.",
    });
  });

  it.each([
    "https://spoonjoy.app/%2f%2fevil.example",
    "https://spoonjoy.app/path",
    "https://spoonjoy.app?next=https://evil.example",
    "https://user@spoonjoy.app",
    "https://spoonjoy.app\\@evil.example",
    "https://%73poonjoy.app",
  ])("rejects a non-serialized consent Origin %s", async (origin) => {
    const cookie = await authedCookie(userId);
    const response = await handleOAuthAuthorizeAction(
      new Request("https://spoonjoy.app/oauth/authorize", {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
        body: new URLSearchParams(await fields()),
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(response.status).toBe(403);
  });

  it("allows same-origin consent POSTs through the origin guard", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "https://spoonjoy.app");
    const res = await handleOAuthAuthorizeAction(
      new Request("https://spoonjoy.app/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams({ decision: "deny", consent_token: consentToken }),
      }),
      db, null,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=access_denied");
  });

  it("allows public-origin consent POSTs when the worker request URL is internal", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "https://spoonjoy.app");
    const res = await handleOAuthAuthorizeAction(
      new Request("https://spoonjoy-v2.workers.dev/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams({ decision: "deny", consent_token: consentToken }),
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=access_denied");
  });

  it("allows localhost consent POSTs in local dev even when a public issuer is configured", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields({ resource: "" }), cookie);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "http://localhost:5173");
    const res = await handleOAuthAuthorizeAction(
      new Request("http://localhost:5173/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams({ decision: "deny", consent_token: consentToken }),
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=access_denied");
  });

  it("allows bracketed IPv6 localhost consent POSTs in local dev", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields({ resource: "" }), cookie);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "http://[::1]:5173");
    const res = await handleOAuthAuthorizeAction(
      new Request("http://[::1]:5173/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams({ decision: "deny", consent_token: consentToken }),
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=access_denied");
  });

  it("rejects internal-origin consent POSTs when a public issuer is configured", async () => {
    const cookie = await authedCookie(userId);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "https://spoonjoy-v2.workers.dev");
    const res = await handleOAuthAuthorizeAction(
      new Request("https://spoonjoy-v2.workers.dev/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams(await fields()),
      }),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_request",
      error_description: "OAuth consent must be submitted from Spoonjoy.",
    });
  });

  it("rejects a bad scope repost without trusting its redirect", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ scope: "kitchen:admin" }), cookie),
      db, null,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing decision", async () => {
    const cookie = await authedCookie(userId);
    const fieldsNoDecision = await fields();
    delete fieldsNoDecision.decision;
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", fieldsNoDecision, cookie),
      db, null,
    );
    expect(res.status).toBe(400);
  });

  it("mints a code and redirects back on approve", async () => {
    const cookie = await authedCookie(userId);
    const approvedFields = await fields();
    approvedFields.consent_token = await consentTokenFor(approvedFields, cookie);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", approvedFields, cookie),
      db, null,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain(`${redirectUri}?code=`);
    expect(location).toContain("state=state_0123456789abcdef");
    expect(new URL(location).searchParams.get("iss")).toBe("https://spoonjoy.app");
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(1);
  });

  it("preserves an approved consent transaction when code persistence fails", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const createSpy = vi.spyOn(db.oAuthAuthCode, "create").mockRejectedValueOnce(new Error("code write failed"));

    await expect(handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: consentToken }, cookie),
      db,
      null,
    )).rejects.toThrow("code write failed");

    expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(1);
    createSpy.mockRestore();
  });

  it("removes an unpublished code when consent consumption fails", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const consumeSpy = vi.spyOn(db.oAuthConsentTransaction, "deleteMany")
      .mockRejectedValueOnce(new Error("consent write failed"));

    await expect(handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: consentToken }, cookie),
      db,
      null,
    )).rejects.toThrow("consent write failed");

    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
    expect(await db.oAuthConsentTransaction.count({ where: { userId } })).toBe(1);
    consumeSpy.mockRestore();
  });

  it("uses the one-time server-side consent snapshot instead of reposted OAuth parameters", async () => {
    const cookie = await authedCookie(userId);
    const requestedFields = await fields();
    const consentToken = await consentTokenFor(requestedFields, cookie);

    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: consentToken }, cookie),
      db,
      null,
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get("state")).toBe(requestedFields.state);
    expect(location.searchParams.has("code")).toBe(true);
  });

  it("consumes a consent transaction exactly once", async () => {
    const cookie = await authedCookie(userId);
    const requestedFields = await fields();
    const consentToken = await consentTokenFor(requestedFields, cookie);
    const body = { decision: "approve", consent_token: consentToken };

    const first = await handleOAuthAuthorizeAction(formPost("https://spoonjoy.app/oauth/authorize", body, cookie), db, null);
    const replay = await handleOAuthAuthorizeAction(formPost("https://spoonjoy.app/oauth/authorize", body, cookie), db, null);

    expect(first.status).toBe(302);
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toMatchObject({ error: "invalid_request" });
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(1);
  });

  it("allows only one of two concurrent approvals to consume the transaction", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const responses = await Promise.all([
      handleOAuthAuthorizeAction(formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: consentToken }, cookie), db, null),
      handleOAuthAuthorizeAction(formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: consentToken }, cookie), db, null),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([302, 400]);
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(1);
  });

  it("consumes a denial exactly once without minting a code", async () => {
    const cookie = await authedCookie(userId);
    const consentToken = await consentTokenFor(await fields(), cookie);
    const body = { decision: "deny", consent_token: consentToken };

    const first = await handleOAuthAuthorizeAction(formPost("https://spoonjoy.app/oauth/authorize", body, cookie), db, null);
    const replay = await handleOAuthAuthorizeAction(formPost("https://spoonjoy.app/oauth/authorize", body, cookie), db, null);

    expect(new URL(first.headers.get("Location") ?? "").searchParams.get("error")).toBe("access_denied");
    expect(replay.status).toBe(400);
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
  });

  it("rejects expired, cross-user, and cross-issuer consent transactions locally", async () => {
    const cookie = await authedCookie(userId);
    const requested = await fields();

    const expiredToken = await consentTokenFor(requested, cookie);
    await db.oAuthConsentTransaction.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    const expired = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: expiredToken }, cookie), db, null,
    );

    await db.oAuthConsentTransaction.deleteMany();
    const crossUserToken = await consentTokenFor(requested, cookie);
    const otherUser = await db.user.create({ data: createTestUser() });
    const otherCookie = await authedCookie(otherUser.id);
    const crossUser = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "approve", consent_token: crossUserToken }, otherCookie), db, null,
    );
    const crossIssuer = await handleOAuthAuthorizeAction(
      formPost("https://issuer-b.example/oauth/authorize", { decision: "approve", consent_token: crossUserToken }, cookie),
      db,
      { SPOONJOY_BASE_URL: "https://issuer-b.example" },
    );

    expect([expired.status, crossUser.status, crossIssuer.status]).toEqual([400, 400, 400]);
    expect(await db.oAuthAuthCode.count()).toBe(0);
  });

  it("requires the one-time consent token for denial", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", { decision: "deny" }, cookie),
      db,
      null,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it.each([
    { field: "scope", before: "shopping_list:read", after: "kitchen:write" },
    { field: "resource", before: "", after: "https://spoonjoy.app/mcp" },
  ])("ignores reposted consent $field after the user saw the approval screen", async ({ field, before, after }) => {
    const cookie = await authedCookie(userId);
    const approvedFields = await fields({ [field]: before });
    approvedFields.consent_token = await consentTokenFor(approvedFields, cookie);
    approvedFields[field] = after;

    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", approvedFields, cookie),
      db,
      null,
    );

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("Location") ?? "").searchParams.has("code")).toBe(true);
    await expect(db.oAuthAuthCode.findFirstOrThrow({ where: { userId } })).resolves.toMatchObject({
      ...(field === "scope" ? { scope: before } : { resource: null }),
    });
  });

  it("uses the configured issuer in authorization responses from an internal worker URL", async () => {
    const cookie = await authedCookie(userId);
    const approvedFields = await fields();
    approvedFields.consent_token = await consentTokenFor(approvedFields, cookie);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy-v2.workers.dev/oauth/authorize", approvedFields, cookie),
      db,
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    );

    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.searchParams.get("iss")).toBe("https://spoonjoy.app");
    expect(location.searchParams.has("code")).toBe(true);
  });

  it("rejects a missing state before minting a code", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ state: "", resource: "" }), cookie),
      db, null,
    );
    expect(res.status).toBe(400);
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
  });
});
