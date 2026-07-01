import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { db } from "~/lib/db.server";
import {
  NativeAppleAuthError,
  verifyNativeAppleIdentityToken,
} from "~/lib/apple-native-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

const APPLE_NATIVE_IOS_CLIENT_ID = "app.spoonjoy.Spoonjoy";
const APPLE_NATIVE_MACOS_CLIENT_ID = "app.spoonjoy.Spoonjoy.mac";
const APPLE_NATIVE_CLIENT_IDS = [APPLE_NATIVE_IOS_CLIENT_ID, APPLE_NATIVE_MACOS_CLIENT_ID];

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

async function nativeAppleTokenFixture(
  overrides: Record<string, unknown> = {},
  options: {
    header?: Record<string, unknown>;
    rawNonce?: string;
    signWithDifferentKey?: boolean;
    jwk?: Record<string, unknown>;
  } = {},
) {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const signingKeys = options.signWithDifferentKey
    ? await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
      )
    : keys;
  const kid = "test-apple-key";
  const rawNonce = options.rawNonce ?? "native-nonce-test";
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", kid, ...options.header });
  const payload = base64UrlJson({
    iss: "https://appleid.apple.com",
    aud: APPLE_NATIVE_IOS_CLIENT_ID,
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
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKeys.privateKey, signingInput));
  return {
    identityToken: `${header}.${payload}.${base64Url(signature)}`,
    rawNonce,
    jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig", ...options.jwk }] },
  };
}

function fetchAppleKeys(jwks: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(jwks), {
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch;
}

async function expectNativeAppleVerificationError(
  fixture: Awaited<ReturnType<typeof nativeAppleTokenFixture>>,
  providerCode: string,
  options: {
    identityToken?: string;
    rawNonce?: string;
    fetcher?: typeof fetch;
    now?: Date;
  } = {},
) {
  await expect(verifyNativeAppleIdentityToken(
    {
      identityToken: options.identityToken ?? fixture.identityToken,
      rawNonce: options.rawNonce ?? fixture.rawNonce,
    },
    { clientIds: APPLE_NATIVE_CLIENT_IDS },
    { fetcher: options.fetcher ?? fetchAppleKeys(fixture.jwks), now: options.now },
  )).rejects.toMatchObject({ code: providerCode });
}

function routeArgs(request: Request, splat = "auth/apple/native", env: Record<string, unknown> = {}) {
  return {
    request,
    params: { "*": splat },
    context: {
      cloudflare: {
        env: { APPLE_NATIVE_CLIENT_IDS: APPLE_NATIVE_CLIENT_IDS.join(","), ...env },
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
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(fixture.jwks), {
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
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

    const loginResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_native_apple_login" },
      body: JSON.stringify({
        identityToken: fixture.identityToken,
        rawNonce: fixture.rawNonce,
        email: " ",
        fullName: "Native Chef",
      }),
    }) as unknown as Request));
    const loginJson = await loginResponse.json() as any;

    expect(loginResponse.status).toBe(201);
    expect(loginJson.data).toMatchObject({ action: "user_logged_in" });
  });

  it("does not publish permissive browser CORS preflight headers for the native Apple token surface", async () => {
    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    }) as unknown as Request));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();
  });

  it("rate-limits native Apple sign-in before provider token exchange", async () => {
    const rateLimiter = {
      limit: vi.fn().mockResolvedValue({ success: false, reset: 42 }),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider fetch should not happen"));

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_native_apple_limited" },
      body: JSON.stringify({
        identityToken: "would.not.verify",
        rawNonce: "nonce",
      }),
    }) as unknown as Request, "auth/apple/native", { AUTH_IP_RATE_LIMITER: rateLimiter }));
    const json = await response.json() as any;

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(json.error).toMatchObject({
      code: "rate_limited",
      details: { retryAfterSeconds: 42, scope: "ip" },
    });
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "ip:unknown:localhost" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps native Apple sign-in same-party when the global API limiter rejects before auth", async () => {
    const globalRateLimiter = {
      limit: vi.fn().mockResolvedValue({ success: false, reset: 23 }),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider fetch should not happen"));

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "req_native_apple_global_limited",
        "CF-Connecting-IP": "203.0.113.23",
      },
      body: JSON.stringify({
        identityToken: "would.not.verify",
        rawNonce: "nonce",
      }),
    }) as unknown as Request, "auth/apple/native", { API_IP_RATE_LIMITER: globalRateLimiter }));
    const json = await response.json() as any;

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("23");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();
    expect(json.error).toMatchObject({
      code: "rate_limited",
      details: { retryAfterSeconds: 23, scope: "ip" },
    });
    expect(globalRateLimiter.limit).toHaveBeenCalledWith({ key: "ip:203.0.113.23" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the macOS native Apple identity-token audience", async () => {
    const fixture = await nativeAppleTokenFixture({ aud: APPLE_NATIVE_MACOS_CLIENT_ID });
    const claims = await verifyNativeAppleIdentityToken(
      { identityToken: fixture.identityToken, rawNonce: fixture.rawNonce },
      { clientIds: APPLE_NATIVE_CLIENT_IDS },
      { fetcher: fetchAppleKeys(fixture.jwks) },
    );

    expect(claims.id).toBe("apple-user-123");
    expect(claims.email).toBe("native-apple@example.com");
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
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(json.error).toMatchObject({
      code: "invalid_token",
      details: { providerCode: "invalid_audience" },
    });
  });

  it("maps native Apple method and configuration failures to API errors", async () => {
    const methodResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "GET",
    }) as unknown as Request));
    const methodJson = await methodResponse.json() as any;

    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("POST");
    expect(methodJson.error.code).toBe("method_not_allowed");

    const configResponse = await action({
      ...routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityToken: "a.b.c", rawNonce: "nonce" }),
      }) as unknown as Request),
      context: {},
    } as any);
    const configJson = await configResponse.json() as any;

    expect(configResponse.status).toBe(400);
    expect(configResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(configJson.error).toMatchObject({
      code: "validation_error",
      details: { providerCode: "apple_native_unconfigured" },
    });
  });

  it("rejects invalid optional native Apple text fields before token exchange", async () => {
    for (const [field, value] of [
      ["email", 123],
      ["fullName", "x".repeat(321)],
    ] as const) {
      const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identityToken: "a.b.c",
          rawNonce: "nonce",
          [field]: value,
        }),
      }) as unknown as Request));
      const json = await response.json() as any;

      expect(response.status).toBe(400);
      expect(json.error.code).toBe("validation_error");
    }
  });

  it("lets unexpected native Apple exchange errors bubble to the API error boundary", async () => {
    const fixture = await nativeAppleTokenFixture();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken: fixture.identityToken, rawNonce: fixture.rawNonce }),
    }) as unknown as Request));
    const json = await response.json() as any;

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(json.error.code).toBe("internal_error");
    expect(consoleErrorSpy).toHaveBeenCalledWith("[api-v1] internal_error", expect.any(Object));
  });

  it("rejects malformed and unsupported native Apple identity tokens", async () => {
    const fixture = await nativeAppleTokenFixture();
    const defaultError = new NativeAppleAuthError("native_apple_error", "Native Apple failed");

    expect(defaultError.status).toBe(400);
    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/apple/native", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken: "not-a-jwt", rawNonce: "nonce" }),
    }) as unknown as Request));
    const json = await response.json() as any;

    expect(response.status).toBe(400);
    expect(json.error).toMatchObject({
      code: "validation_error",
      details: { providerCode: "invalid_identity_token" },
    });
    await expectNativeAppleVerificationError(fixture, "invalid_identity_token", { identityToken: "not-a-jwt" });
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({}, { header: { alg: "ES256" } }),
      "invalid_identity_token",
    );
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({}, { header: { kid: "" } }),
      "invalid_identity_token",
    );
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({ aud: undefined }),
      "invalid_audience",
    );
  });

  it("rejects missing nonce and mismatched nonce values before account creation", async () => {
    const fixture = await nativeAppleTokenFixture();

    await expectNativeAppleVerificationError(fixture, "invalid_nonce", { rawNonce: " " });
    await expectNativeAppleVerificationError(fixture, "invalid_nonce", { rawNonce: "different-nonce" });
  });

  it("rejects unavailable or unsupported Apple signing keys", async () => {
    const fixture = await nativeAppleTokenFixture();
    const unavailableFetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })) as unknown as typeof fetch;

    await expectNativeAppleVerificationError(fixture, "apple_keys_unavailable", { fetcher: unavailableFetcher });
    await expectNativeAppleVerificationError(fixture, "invalid_identity_token", { fetcher: fetchAppleKeys({ keys: [] }) });
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({}, { jwk: { kty: "EC", n: undefined, e: undefined } }),
      "invalid_apple_key",
    );
  });

  it("rejects identity tokens with invalid signatures or issuer timing claims", async () => {
    const now = Math.floor(Date.now() / 1000);

    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({}, { signWithDifferentKey: true }),
      "invalid_identity_token",
    );
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({ iss: "https://example.com" }),
      "invalid_issuer",
    );
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({ exp: now - 1 }),
      "expired_identity_token",
    );
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({ iat: now + 301 }),
      "invalid_identity_token",
      { now: new Date(now * 1000) },
    );
  });

  it("accepts array audiences, fallback email, and boolean Apple email flags", async () => {
    const fixture = await nativeAppleTokenFixture({
      aud: ["other.client", APPLE_NATIVE_IOS_CLIENT_ID],
      email: undefined,
      email_verified: true,
      is_private_email: "true",
    });

    const appleUser = await verifyNativeAppleIdentityToken(
      {
        identityToken: fixture.identityToken,
        rawNonce: fixture.rawNonce,
        email: "fallback@example.com",
        fullName: " Fallback Chef ",
      },
      { clientIds: APPLE_NATIVE_CLIENT_IDS },
      { fetcher: fetchAppleKeys(fixture.jwks) },
    );

    expect(appleUser).toMatchObject({
      id: "apple-user-123",
      email: "fallback@example.com",
      emailVerified: true,
      isPrivateEmail: true,
      fullName: "Fallback Chef",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture.jwks), {
      headers: { "Content-Type": "application/json" },
    }));
    await expect(verifyNativeAppleIdentityToken(
      {
        identityToken: fixture.identityToken,
        rawNonce: fixture.rawNonce,
        email: "fallback@example.com",
      },
      { clientIds: APPLE_NATIVE_CLIENT_IDS },
    )).resolves.toMatchObject({ email: "fallback@example.com" });
  });

  it("rejects identity tokens missing required Apple account claims", async () => {
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({ sub: " " }),
      "invalid_identity_token",
    );
    await expectNativeAppleVerificationError(
      await nativeAppleTokenFixture({ email: undefined }),
      "invalid_identity_token",
    );
  });
});
