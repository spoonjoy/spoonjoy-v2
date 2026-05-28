import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAllowsRedirect,
  consumeAuthorizationCode,
  createAuthorizationCode,
  DEFAULT_SCOPE,
  getOAuthClient,
  isValidRedirectUri,
  normalizeScope,
  OAuthError,
  registerOAuthClient,
  verifyPkceS256,
} from "~/lib/oauth-server.server";
import { getLocalDb } from "~/lib/db.server";
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

describe("verifyPkceS256", () => {
  it("accepts a verifier whose S256 hash matches the challenge", async () => {
    expect(await verifyPkceS256(VERIFIER, await challengeFor(VERIFIER))).toBe(true);
  });

  it("rejects a mismatched verifier", async () => {
    expect(await verifyPkceS256("wrong", await challengeFor(VERIFIER))).toBe(false);
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
});

describe("normalizeScope", () => {
  it("defaults to read+write when empty", () => {
    expect(normalizeScope(undefined)).toBe(DEFAULT_SCOPE);
    expect(normalizeScope("   ")).toBe(DEFAULT_SCOPE);
  });

  it("passes through a supported subset", () => {
    expect(normalizeScope("kitchen:read")).toBe("kitchen:read");
    expect(normalizeScope("kitchen:read kitchen:write")).toBe("kitchen:read kitchen:write");
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
      clientName: "  Claude  ",
      redirectUris: ["https://claude.ai/cb", " https://claude.ai/cb2 "],
    });
    expect(registered.clientName).toBe("Claude");
    expect(registered.redirectUris).toEqual(["https://claude.ai/cb", "https://claude.ai/cb2"]);

    const fetched = await getOAuthClient(db, registered.clientId);
    expect(fetched?.redirectUris).toEqual(["https://claude.ai/cb", "https://claude.ai/cb2"]);
    expect(clientAllowsRedirect(fetched!, "https://claude.ai/cb2")).toBe(true);
    expect(clientAllowsRedirect(fetched!, "https://claude.ai/other")).toBe(false);
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

  it("returns null for a missing or empty client id", async () => {
    expect(await getOAuthClient(db, "")).toBeNull();
    expect(await getOAuthClient(db, "nope")).toBeNull();
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
    await expect(
      consumeAuthorizationCode(db, { code, clientId: "other", redirectUri, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
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
    const stub = {
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
        }),
        updateMany: async () => ({ count: 0 }),
      },
    } as never;

    await expect(
      consumeAuthorizationCode(stub, { code: "oac_race", clientId, redirectUri, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("OAuthError", () => {
  it("defaults to status 400 and carries the code", () => {
    const err = new OAuthError("invalid_request", "bad");
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_request");
  });
});
