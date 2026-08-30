import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { db, getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { NativePasswordAuthError } from "~/lib/native-password-auth.server";
import { handleOAuthToken } from "~/lib/oauth-routes.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { expectConsoleError } from "../warning-policy";

function routeArgs(request: Request, splat = "auth/password/native", env: Record<string, unknown> = {}) {
  return {
    request,
    params: { "*": splat },
    context: {
      cloudflare: {
        env,
      },
    },
  } as any;
}

function jsonRequest(body: unknown, requestId = "req_native_password") {
  return new UndiciRequest("http://localhost/api/v1/auth/password/native", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

describe("native username/password sign-in API", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("defaults native password auth errors to validation status when no status is supplied", () => {
    const error = new NativePasswordAuthError("invalid_payload", "Invalid native password payload.");

    expect(error.name).toBe("NativePasswordAuthError");
    expect(error.code).toBe("invalid_payload");
    expect(error.status).toBe(400);
  });

  it("exchanges first-party native email/password credentials for Spoonjoy app tokens", async () => {
    const created = await createUser(db, "NativeChef@Example.com", "native_chef", "correctHorseBatteryStaple");

    const response = await action(routeArgs(jsonRequest({
      emailOrUsername: "NATIVECHEF@EXAMPLE.COM",
      password: "correctHorseBatteryStaple",
    })));
    const json = await response.json() as any;

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(json).toMatchObject({
      ok: true,
      requestId: "req_native_password",
      data: {
        action: "user_logged_in",
        userId: created.id,
        token_type: "Bearer",
        expires_in: 900,
        scope: "kitchen:read kitchen:write shopping_list:read shopping_list:write account:read account:write",
      },
    });
    expect(json.data.access_token).toMatch(/^sj_/);
    expect(json.data.refresh_token).toMatch(/^ort_/);
    expect(json.data.client_id).toMatch(/^spoonjoy-apple-native:/);
    await expect(db.oAuthClient.findUnique({ where: { id: json.data.client_id } }))
      .resolves.toMatchObject({ clientName: "Spoonjoy Apple", issuer: "http://localhost" });
  });

  it("accepts username/password credentials for local native dogfooding", async () => {
    const created = await createUser(db, "chef@example.com", "dogfood_chef", "correctHorseBatteryStaple");

    const response = await action(routeArgs(jsonRequest({
      emailOrUsername: "dogfood_chef",
      password: "correctHorseBatteryStaple",
    }, "req_native_username")));
    const json = await response.json() as any;

    expect(response.status).toBe(201);
    expect(json.data).toMatchObject({
      action: "user_logged_in",
      userId: created.id,
      token_type: "Bearer",
    });
  });

  it("issues refreshable first-party credentials for two exact issuers", async () => {
    await createUser(db, "multi-issuer@example.com", "multi_issuer_chef", "correctHorseBatteryStaple");
    const issuerA = "https://spoonjoy.app";
    const issuerB = "https://preview.example";

    const signIn = async (issuer: string, requestId: string) => {
      const response = await action(routeArgs(jsonRequest({
        emailOrUsername: "multi_issuer_chef",
        password: "correctHorseBatteryStaple",
      }, requestId), "auth/password/native", { SPOONJOY_BASE_URL: issuer }));
      expect(response.status).toBe(201);
      return await response.json() as any;
    };
    const first = await signIn(issuerA, "req_native_password_issuer_a");
    const second = await signIn(issuerB, "req_native_password_issuer_b");

    expect(first.data.client_id).toBe("spoonjoy-apple-native");
    expect(second.data.client_id).toMatch(/^spoonjoy-apple-native:/);
    expect(second.data.client_id).not.toBe(first.data.client_id);
    await expect(db.oAuthClient.findMany({
      where: { id: { in: [first.data.client_id, second.data.client_id] } },
      orderBy: { issuer: "asc" },
    })).resolves.toMatchObject([
      { id: second.data.client_id, issuer: issuerB },
      { id: first.data.client_id, issuer: issuerA },
    ]);

    const refresh = await handleOAuthToken(new UndiciRequest(`${issuerB}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: second.data.client_id,
        refresh_token: second.data.refresh_token,
      }),
    }) as unknown as Request, db, { SPOONJOY_BASE_URL: issuerB });
    expect(refresh.status).toBe(200);
  });

  it("rejects invalid credentials without revealing whether the account exists", async () => {
    await createUser(db, "chef@example.com", "dogfood_chef", "correctHorseBatteryStaple");

    for (const [requestId, body] of [
      ["req_native_bad_password", { emailOrUsername: "dogfood_chef", password: "wrongPassword" }],
      ["req_native_missing_account", { emailOrUsername: "not_a_chef", password: "wrongPassword" }],
    ] as const) {
      const response = await action(routeArgs(jsonRequest(body, requestId)));
      const json = await response.json() as any;

      expect(response.status).toBe(401);
      expect(json.error).toMatchObject({
        code: "invalid_token",
        message: "Invalid username/email or password.",
        details: { providerCode: "invalid_credentials" },
      });
    }
  });

  it("lets unexpected native password exchange errors bubble to the API error boundary", async () => {
    await createUser(db, "token-failure@example.com", "native_token_failure", "correctHorseBatteryStaple");
    const localDb = await getLocalDb();
    const originalUpsert = localDb.oAuthClient.upsert;
    const tokenStoreError = new Error("token store unavailable");
    localDb.oAuthClient.upsert = vi.fn().mockRejectedValueOnce(tokenStoreError) as typeof localDb.oAuthClient.upsert;
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_native_password_unexpected",
      method: "POST",
      path: "/api/v1/auth/password/native",
      error: {
        name: tokenStoreError.name,
        message: tokenStoreError.message,
        stack: tokenStoreError.stack,
      },
    });
    try {
      const response = await action(routeArgs(jsonRequest({
        emailOrUsername: "native_token_failure",
        password: "correctHorseBatteryStaple",
      }, "req_native_password_unexpected")));
      const json = await response.json() as any;

      expect(response.status).toBe(500);
      expect(json.error).toMatchObject({
        code: "internal_error",
        status: 500,
      });
    } finally {
      localDb.oAuthClient.upsert = originalUpsert;
    }
  });

  it("maps non-credential native password auth errors to validation errors", async () => {
    await createUser(db, "validation-failure@example.com", "native_validation_failure", "correctHorseBatteryStaple");
    const localDb = await getLocalDb();
    const originalUpsert = localDb.oAuthClient.upsert;
    localDb.oAuthClient.upsert = vi.fn().mockRejectedValueOnce(
      new NativePasswordAuthError("native_validation_failure", "Native validation failed."),
    ) as typeof localDb.oAuthClient.upsert;
    try {
      const response = await action(routeArgs(jsonRequest({
        emailOrUsername: "native_validation_failure",
        password: "correctHorseBatteryStaple",
      }, "req_native_password_validation_error")));
      const json = await response.json() as any;

      expect(response.status).toBe(400);
      expect(json.error).toMatchObject({
        code: "validation_error",
        details: { providerCode: "native_validation_failure" },
      });
    } finally {
      localDb.oAuthClient.upsert = originalUpsert;
    }
  });

  it("validates native password payloads before credential exchange", async () => {
    for (const [body, fields] of [
      [{ password: "secret" }, ["emailOrUsername"]],
      [{ emailOrUsername: "chef@example.com" }, ["password"]],
      [{ emailOrUsername: " ", password: "secret" }, ["emailOrUsername"]],
      [{ emailOrUsername: "chef@example.com", password: " " }, ["password"]],
      [{ emailOrUsername: "chef@example.com", password: "secret", grant_type: "password" }, ["grant_type"]],
    ] as const) {
      const response = await action(routeArgs(jsonRequest(body, "req_native_password_validation")));
      const json = await response.json() as any;

      expect(response.status).toBe(400);
      expect(json.error.code).toBe("validation_error");
      for (const field of fields) {
        expect(JSON.stringify(json.error)).toContain(field);
      }
    }
  });

  it("maps method and dedicated auth rate-limit failures to API errors", async () => {
    const methodResponse = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/password/native", {
      method: "GET",
    }) as unknown as Request));
    const methodJson = await methodResponse.json() as any;

    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("POST");
    expect(methodJson.error.code).toBe("method_not_allowed");

    const rateLimitedResponse = await action({
      ...routeArgs(new UndiciRequest("http://localhost/api/v1/auth/password/native", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "req_native_password_limited",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({ emailOrUsername: "chef@example.com", password: "secret" }),
      }) as unknown as Request),
      context: {
        cloudflare: {
          env: {
            AUTH_IP_RATE_LIMITER: {
              limit: vi.fn().mockResolvedValue({ success: false, reset: 17 }),
            },
          },
        },
      },
    } as any);
    const rateLimitedJson = await rateLimitedResponse.json() as any;

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.get("Retry-After")).toBe("17");
    expect(rateLimitedResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(rateLimitedJson.error).toMatchObject({
      code: "rate_limited",
      details: { scope: "ip", retryAfterSeconds: 17 },
    });

    const globalLimitedResponse = await action({
      ...routeArgs(new UndiciRequest("http://localhost/api/v1/auth/password/native", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "req_native_password_global_limited",
          "CF-Connecting-IP": "203.0.113.11",
        },
        body: JSON.stringify({ emailOrUsername: "chef@example.com", password: "secret" }),
      }) as unknown as Request),
      context: {
        cloudflare: {
          env: {
            API_IP_RATE_LIMITER: {
              limit: vi.fn().mockResolvedValue({ success: false, reset: 19 }),
            },
          },
        },
      },
    } as any);
    const globalLimitedJson = await globalLimitedResponse.json() as any;

    expect(globalLimitedResponse.status).toBe(429);
    expect(globalLimitedResponse.headers.get("Retry-After")).toBe("19");
    expect(globalLimitedResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(globalLimitedResponse.headers.get("Access-Control-Allow-Headers")).toBeNull();
    expect(globalLimitedJson.error).toMatchObject({
      code: "rate_limited",
      details: { scope: "ip", retryAfterSeconds: 19 },
    });
  });

  it("does not publish permissive browser CORS preflight headers for the password token surface", async () => {
    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/auth/password/native", {
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
});
