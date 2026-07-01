import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

const APPLE_NATIVE_CLIENT_ID = "app.spoonjoy.Spoonjoy";

function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function nativeAppleTokenFixture(overrides: Record<string, unknown> = {}) {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const kid = "test-apple-key";
  const rawNonce = "native-nonce-test";
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", kid });
  const payload = base64UrlJson({
    iss: "https://appleid.apple.com",
    aud: APPLE_NATIVE_CLIENT_ID,
    exp: now + 300,
    iat: now,
    sub: "apple-user-123",
    email: "native-apple@example.com",
    email_verified: "true",
    is_private_email: false,
    nonce: await sha256Hex(rawNonce),
    ...overrides,
  });
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, signingInput));
  return {
    identityToken: `${header}.${payload}.${base64Url(signature)}`,
    rawNonce,
    jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] },
  };
}

function routeArgs(request: Request, splat = "auth/apple/native") {
  return {
    request,
    params: { "*": splat },
    context: {
      cloudflare: {
        env: { APPLE_NATIVE_CLIENT_IDS: APPLE_NATIVE_CLIENT_ID },
      },
    },
  } as any;
}

describe("native Sign in with Apple API", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("verifies a native Apple identity token and issues Spoonjoy tokens", async () => {
    const fixture = await nativeAppleTokenFixture();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture.jwks), {
      headers: { "Content-Type": "application/json" },
    }));

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_native_apple" },
      body: JSON.stringify({
        identityToken: fixture.identityToken,
        rawNonce: fixture.rawNonce,
        fullName: "Native Chef",
      }),
    }) as unknown as Request));
    const json = await response.json() as any;

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json.data).toMatchObject({
      action: "user_created",
      token_type: "Bearer",
      expires_in: 900,
      scope: "kitchen:read kitchen:write shopping_list:read shopping_list:write account:read account:write",
    });
    expect(json.data.access_token).toMatch(/^sj_/);
    expect(json.data.refresh_token).toMatch(/^ort_/);
    await expect(db.oAuth.findUnique({
      where: { provider_providerUserId: { provider: "apple", providerUserId: "apple-user-123" } },
    })).resolves.toMatchObject({ providerUsername: "Native Chef" });
  });

  it("rejects Apple tokens minted for a different native client id", async () => {
    const fixture = await nativeAppleTokenFixture({ aud: "app.spoonjoy.Other" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture.jwks), {
      headers: { "Content-Type": "application/json" },
    }));

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken: fixture.identityToken, rawNonce: fixture.rawNonce }),
    }) as unknown as Request));
    const json = await response.json() as any;

    expect(response.status).toBe(401);
    expect(json.error).toMatchObject({
      code: "invalid_token",
      details: { providerCode: "invalid_audience" },
    });
  });
});
