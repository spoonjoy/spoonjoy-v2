import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import {
  handleOAuthAuthorizeAction,
  handleOAuthRegister,
  handleOAuthRevoke,
  handleOAuthToken,
  loadOAuthAuthorize,
} from "~/lib/oauth-routes.server";
import { createAuthorizationCode, registerOAuthClient } from "~/lib/oauth-server.server";
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
  });

  it("echoes the client name when provided", async () => {
    const res = await handleOAuthRegister(
      jsonPost({ client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] }),
      db,
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ client_name: "Claude" });
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

  it("accepts and ignores standard RFC 7591 metadata Spoonjoy does not store", async () => {
    const res = await handleOAuthRegister(jsonPost({
      redirect_uris: ["https://claude.ai/cb"],
      client_name: "Claude",
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
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/cb"],
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
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.scope).toBe("kitchen:read kitchen:write");
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ name: "OAuth client (OAuth)", oauthClientId: clientId, oauthResource: "https://spoonjoy.app/mcp" });
    // the access token is a real ApiCredential, plus one refresh token
    expect(await db.apiCredential.count({ where: { userId } })).toBe(1);
    expect(await db.oAuthRefreshToken.count({ where: { userId } })).toBe(1);
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
    const firstBody = await first.json() as { refresh_token: string };
    await expect(db.apiCredential.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ oauthClientId: clientId, oauthResource: null });

    const refresh = await handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "refresh_token", refresh_token: firstBody.refresh_token, client_id: clientId,
      }),
      db, null,
    );

    expect(refresh.status).toBe(200);
    await expect(refresh.json()).resolves.toMatchObject({ scope: "kitchen:read" });
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
    expect(revoke.status).toBe(204);
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
    expect(repeat.status).toBe(204);

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

  async function authorizeGet(query: Record<string, string>, cookie?: string): Promise<Request> {
    const url = new URL("https://spoonjoy.app/oauth/authorize");
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

  it("redirects back with unsupported_response_type", async () => {
    const q = await validQuery();
    q.response_type = "token";
    const result = await loadOAuthAuthorize(await authorizeGet(q), db, null) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toContain("error=unsupported_response_type");
  });

  it("redirects back with invalid_request when state is missing", async () => {
    const q = await validQuery();
    q.state = "";
    const result = await loadOAuthAuthorize(await authorizeGet(q), db, null) as Response;
    const location = result.headers.get("Location") ?? "";
    expect(location).toContain("error=invalid_request");
    expect(location).not.toContain("state=");
  });

  it("redirects back with invalid_request when PKCE is missing", async () => {
    const q = await validQuery();
    q.code_challenge_method = "plain";
    const result = await loadOAuthAuthorize(await authorizeGet(q), db, null) as Response;
    expect(result.headers.get("Location")).toContain("error=invalid_request");
  });

  it("redirects back with invalid_scope", async () => {
    const q = await validQuery();
    q.scope = "kitchen:admin";
    const result = await loadOAuthAuthorize(await authorizeGet(q), db, null) as Response;
    expect(result.headers.get("Location")).toContain("error=invalid_scope");
  });

  it("redirects back with invalid_target for an unexpected resource indicator", async () => {
    const q = await validQuery();
    q.resource = "https://evil.example/mcp";
    const result = await loadOAuthAuthorize(await authorizeGet(q), db, null) as Response;
    expect(result.headers.get("Location")).toContain("error=invalid_target");
  });

  it("accepts a blank resource indicator as no resource", async () => {
    const cookie = await authedCookie(userId);
    const q = await validQuery();
    q.resource = "";
    const result = await loadOAuthAuthorize(await authorizeGet(q, cookie), db, null);
    expect(result).toMatchObject({ kind: "consent" });
    expect(result).not.toHaveProperty("resource");
  });

  it("redirects to login when not authenticated", async () => {
    const result = await loadOAuthAuthorize(await authorizeGet(await validQuery()), db, null) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toContain("/login?redirectTo=");
  });

  it("returns the consent view when authenticated", async () => {
    const cookie = await authedCookie(userId);
    const result = await loadOAuthAuthorize(await authorizeGet(await validQuery(), cookie), db, null);
    expect(result).toMatchObject({ kind: "consent", scope: "kitchen:read" });
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
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?redirectTo=");
  });

  it("redirects invalid authorize requests back before login", async () => {
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ scope: "kitchen:admin" })),
      db, null,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=invalid_scope");
    expect(res.headers.get("Location")).toContain("state=state_0123456789abcdef");
  });

  it("redirects back with access_denied on deny", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ decision: "deny" }), cookie),
      db, null,
    );
    expect(res.headers.get("Location")).toContain("error=access_denied");
    expect(res.headers.get("Location")).toContain("state=state_0123456789abcdef");
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

  it("allows same-origin consent POSTs through the origin guard", async () => {
    const cookie = await authedCookie(userId);
    const headers = new Headers();
    headers.set("Cookie", cookie);
    headers.set("Origin", "https://spoonjoy.app");
    const res = await handleOAuthAuthorizeAction(
      new Request("https://spoonjoy.app/oauth/authorize", {
        method: "POST",
        headers,
        body: new URLSearchParams(await fields({ scope: "kitchen:admin" })),
      }),
      db, null,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=invalid_scope");
  });

  it("redirects back with invalid_scope on a bad scope", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ scope: "kitchen:admin" }), cookie),
      db, null,
    );
    expect(res.headers.get("Location")).toContain("error=invalid_scope");
  });

  it("treats a missing decision as denial", async () => {
    const cookie = await authedCookie(userId);
    const fieldsNoDecision = await fields();
    delete fieldsNoDecision.decision;
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", fieldsNoDecision, cookie),
      db, null,
    );
    expect(res.headers.get("Location")).toContain("error=access_denied");
  });

  it("mints a code and redirects back on approve", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields(), cookie),
      db, null,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain(`${redirectUri}?code=`);
    expect(location).toContain("state=state_0123456789abcdef");
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(1);
  });

  it("rejects a missing state before minting a code", async () => {
    const cookie = await authedCookie(userId);
    const res = await handleOAuthAuthorizeAction(
      formPost("https://spoonjoy.app/oauth/authorize", await fields({ state: "", resource: "" }), cookie),
      db, null,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("error=invalid_request");
    expect(location).not.toContain("state=");
    expect(await db.oAuthAuthCode.count({ where: { userId } })).toBe(0);
  });
});
