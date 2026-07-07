import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { captureEvent } from "~/lib/analytics-server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

function routeArgs(request: Request, splat: string, env: Record<string, unknown> = { POSTHOG_KEY: "ph_test" }) {
  const scheduled: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    scheduled.push(promise);
  });

  return {
    args: {
      request,
      params: { "*": splat },
      context: { cloudflare: { env, ctx: { waitUntil } } },
    },
    waitUntil,
    scheduled,
  } as const;
}

function nativeTelemetryRequest(token: string | null, requestId: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    "User-Agent": "Spoonjoy/1.0 CFNetwork/1700 Darwin/26.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return new UndiciRequest("http://localhost/api/v1/native/telemetry", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function nativeTelemetryCaptures() {
  return vi.mocked(captureEvent).mock.calls
    .map(([, input]) => input)
    .filter((input) => input.event === "spoonjoy.native.telemetry");
}

describe("API v1 native telemetry", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("captures redacted native diagnostics for account-scoped bearer clients", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });
    const body = {
      event: "settings_refresh_failed",
      stage: "settings",
      environment: "production",
      platform: "ios",
      appVersion: "1.0",
      buildNumber: "12",
      route: "settings",
      errorType: "APITransportError",
      requestId: "req_settings_surface",
      status: 403,
      apiCode: "insufficient_scope",
      retry: "do_not_retry",
      accountBound: true,
      hasRenderableCacheContent: true,
      recipes: 4,
      cookbooks: 2,
      shoppingItems: 0,
      queuedMutations: 1,
    };

    const context = routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry", body), "native/telemetry");
    const response = await action(context.args);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_native_telemetry",
      data: { accepted: true },
    });
    expect(context.waitUntil).toHaveBeenCalledWith(expect.any(Promise));

    const input = nativeTelemetryCaptures()[0];
    expect(input).toMatchObject({
      event: "spoonjoy.native.telemetry",
      distinctId: user.id,
      properties: {
        native_event: "settings_refresh_failed",
        stage: "settings",
        environment: "production",
        platform: "ios",
        app_version: "1.0",
        build_number: "12",
        route: "settings",
        error_type: "APITransportError",
        native_request_id: "req_settings_surface",
        http_status: 403,
        api_error_code: "insufficient_scope",
        retry: "do_not_retry",
        account_bound: true,
        has_renderable_cache_content: true,
        recipe_count: 4,
        cookbook_count: 2,
        shopping_item_count: 0,
        queued_mutation_count: 1,
        server_request_id: "req_native_telemetry",
      },
    });
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain(credential.token);
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain(credential.credential.tokenPrefix);
  });

  it("rejects unknown diagnostic fields instead of recording raw app text", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });
    const request = nativeTelemetryRequest(credential.token, "req_native_telemetry_unknown", {
      event: "settings_refresh_failed",
      stage: "settings",
      privateMessage: "profile response said the secret kitchen name",
    });

    const response = await action(routeArgs(request, "native/telemetry").args);

    expect(response.status).toBe(400);
    expect(nativeTelemetryCaptures()).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain("secret kitchen name");
  });

  it("accepts minimal diagnostics without optional counts or booleans", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });
    const context = routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry_minimal", {
      event: "bootstrap_offline",
      stage: "launch",
    }), "native/telemetry");

    const response = await action(context.args);

    expect(response.status).toBe(202);
    const input = nativeTelemetryCaptures()[0];
    expect(input.properties).toMatchObject({
      native_event: "bootstrap_offline",
      stage: "launch",
      environment: "local",
      platform: null,
      http_status: null,
      account_bound: null,
      recipe_count: null,
      queued_mutation_count: null,
      server_request_id: "req_native_telemetry_minimal",
    });
  });

  it("rejects malformed numeric and boolean diagnostics", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });

    const invalidStatus = await action(routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry_bad_status", {
      event: "settings_refresh_failed",
      stage: "settings",
      status: 99,
    }), "native/telemetry").args);
    const invalidBoolean = await action(routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry_bad_bool", {
      event: "settings_refresh_failed",
      stage: "settings",
      accountBound: "true",
    }), "native/telemetry").args);

    expect(invalidStatus.status).toBe(400);
    await expect(invalidStatus.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "status must be an integer between 100 and 599" },
    });
    expect(invalidBoolean.status).toBe(400);
    await expect(invalidBoolean.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "accountBound must be a boolean" },
    });
    expect(nativeTelemetryCaptures()).toHaveLength(0);
  });

  it("rejects non POST telemetry requests", async () => {
    const request = new UndiciRequest("http://localhost/api/v1/native/telemetry", {
      method: "GET",
      headers: { "X-Request-Id": "req_native_telemetry_method" },
    }) as unknown as Request;

    const response = await action(routeArgs(request, "native/telemetry").args);

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_native_telemetry_method",
      error: { code: "method_not_allowed" },
    });
  });

  it("requires account read scope", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Kitchen-only client", {
      scopes: ["kitchen:read"],
    });
    const request = nativeTelemetryRequest(credential.token, "req_native_telemetry_scope", {
      event: "settings_refresh_failed",
      stage: "settings",
    });

    const response = await action(routeArgs(request, "native/telemetry").args);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_native_telemetry_scope",
      error: { code: "insufficient_scope" },
    });
    expect(nativeTelemetryCaptures()).toHaveLength(0);
  });
});
