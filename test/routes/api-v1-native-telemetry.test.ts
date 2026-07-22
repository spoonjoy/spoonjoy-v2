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

function routeArgsWithoutWaitUntil(
  request: Request,
  splat: string,
  env: Record<string, unknown> = { POSTHOG_KEY: "ph_test" },
) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env } },
  } as const;
}

function routeArgsWithoutEnv(request: Request, splat: string) {
  return {
    request,
    params: { "*": splat },
    context: {},
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

  it("captures signed-out Apple auth telemetry without bearer tokens or secret material", async () => {
    const body = {
      event: "auth_flow_failed",
      stage: "auth",
      environment: "production",
      platform: "ios",
      appVersion: "1.0",
      buildNumber: "42",
      route: "kitchen",
      errorType: "APITransportError",
      requestId: "req_apple_exchange",
      status: 401,
      apiCode: "apple_identity_token_invalid",
      retry: "do_not_retry",
      accountBound: false,
      authProvider: "apple",
      authPhase: "backend_request_failed",
      authOutcome: "failed",
      authDiagnosticCode: "provider_invalid_identity_token",
      authSessionState: "signed_out",
      authCredentialPresent: true,
      authIdentityTokenPresent: true,
      authRawNoncePresent: true,
      authEmailPresent: false,
      authFullNamePresent: false,
      authOAuthStatePresent: false,
      authRedirectScheme: "https",
      authRedirectHost: "spoonjoy.app",
    };

    const context = routeArgs(nativeTelemetryRequest(null, "req_native_auth_telemetry", body), "native/telemetry");
    const response = await action(context.args);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_native_auth_telemetry",
      data: { accepted: true },
    });
    expect(context.waitUntil).toHaveBeenCalledWith(expect.any(Promise));

    const input = nativeTelemetryCaptures()[0];
    expect(input).toMatchObject({
      event: "spoonjoy.native.telemetry",
      distinctId: "anonymous_native_app",
      properties: {
        native_event: "auth_flow_failed",
        stage: "auth",
        environment: "production",
        platform: "ios",
        app_version: "1.0",
        build_number: "42",
        route: "kitchen",
        error_type: "APITransportError",
        native_request_id: "req_apple_exchange",
        http_status: 401,
        api_error_code: "apple_identity_token_invalid",
        retry: "do_not_retry",
        account_bound: false,
        auth_provider: "apple",
        auth_phase: "backend_request_failed",
        auth_outcome: "failed",
        auth_diagnostic_code: "provider_invalid_identity_token",
        auth_session_state: "signed_out",
        auth_credential_present: true,
        auth_identity_token_present: true,
        auth_raw_nonce_present: true,
        auth_email_present: false,
        auth_full_name_present: false,
        auth_oauth_state_present: false,
        auth_redirect_scheme: "https",
        auth_redirect_host: "spoonjoy.app",
        server_request_id: "req_native_auth_telemetry",
      },
    });
    const captureJson = JSON.stringify(vi.mocked(captureEvent).mock.calls);
    expect(captureJson).not.toContain("identityToken");
    expect(captureJson).not.toContain("rawNonce");
    expect(captureJson).not.toContain("accessToken");
    expect(captureJson).not.toContain("refreshToken");
    expect(captureJson).not.toContain("password");
  });

  it("captures App Intent telemetry fields from optional native clients", async () => {
    const context = routeArgs(nativeTelemetryRequest(null, "req_native_intent_telemetry", {
      event: "app_intent_completed",
      stage: "app_intent.OpenRecipeIntent.open-route",
      environment: "production",
      platform: "ios",
      route: "recipe:recipe_123",
      intentName: "OpenRecipeIntent",
      intentActionKind: "open-route",
      intentOutcome: "completed",
      intentReturnsValue: false,
      intentQueuedMutationId: "mutation_123",
      intentQueuedMutationKind: "shopping-item-create",
      intentOpensUrl: "spoonjoy://recipe/recipe_123",
    }), "native/telemetry");

    const response = await action(context.args);

    expect(response.status).toBe(202);
    const input = nativeTelemetryCaptures()[0];
    expect(input).toMatchObject({
      distinctId: "anonymous_native_app",
      properties: {
        native_event: "app_intent_completed",
        stage: "app_intent.OpenRecipeIntent.open-route",
        route: "recipe:recipe_123",
        intent_name: "OpenRecipeIntent",
        intent_action_kind: "open-route",
        intent_outcome: "completed",
        intent_returns_value: false,
        intent_queued_mutation_id: "mutation_123",
        intent_queued_mutation_kind: "shopping-item-create",
        intent_opens_url: "spoonjoy://recipe/recipe_123",
        server_request_id: "req_native_intent_telemetry",
      },
    });
  });

  it("captures privacy-safe search lifecycle telemetry without search text", async () => {
    const samples = [
      {
        requestId: "req_native_search_started",
        body: {
          event: "search_started",
          searchScope: "all",
          searchQueryLength: 0,
          searchResultCount: null,
          durationMilliseconds: null,
        },
        expected: {
          native_event: "search_started",
          search_scope: "all",
          search_query_length: 0,
          search_result_count: null,
          duration_milliseconds: null,
        },
      },
      {
        requestId: "req_native_search_completed",
        body: {
          event: "search_completed",
          searchScope: "recipes",
          searchQueryLength: 42,
          searchResultCount: 7,
          durationMilliseconds: 1_234,
        },
        expected: {
          native_event: "search_completed",
          search_scope: "recipes",
          search_query_length: 42,
          search_result_count: 7,
          duration_milliseconds: 1_234,
        },
      },
      {
        requestId: "req_native_search_failed",
        body: {
          event: "search_failed",
          searchScope: "shopping-list",
          searchQueryLength: 100_000,
          searchResultCount: 100_000,
          durationMilliseconds: 86_400_000,
        },
        expected: {
          native_event: "search_failed",
          search_scope: "shopping-list",
          search_query_length: 100_000,
          search_result_count: 100_000,
          duration_milliseconds: 86_400_000,
        },
      },
    ] as const;

    for (const sample of samples) {
      const context = routeArgs(nativeTelemetryRequest(null, sample.requestId, sample.body), "native/telemetry");
      const response = await action(context.args);

      expect(response.status).toBe(202);
      expect(context.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    }

    expect(nativeTelemetryCaptures()).toHaveLength(3);
    for (const [index, sample] of samples.entries()) {
      expect(nativeTelemetryCaptures()[index]).toMatchObject({
        distinctId: "anonymous_native_app",
        properties: {
          ...sample.expected,
          server_request_id: sample.requestId,
        },
      });
    }
    const captures = JSON.stringify(nativeTelemetryCaptures());
    expect(captures).not.toContain("searchQuery");
    expect(captures).not.toContain("rawQuery");
  });

  it("awaits capture inline when waitUntil is unavailable", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });
    const request = nativeTelemetryRequest(credential.token, "req_native_telemetry_inline", {
      event: "sync_failed",
      stage: "sync",
    });

    const response = await action(routeArgsWithoutWaitUntil(request, "native/telemetry") as any);

    expect(response.status).toBe(202);
    expect(nativeTelemetryCaptures()).toHaveLength(1);
    expect(nativeTelemetryCaptures()[0]).toMatchObject({
      distinctId: user.id,
      properties: { native_event: "sync_failed", server_request_id: "req_native_telemetry_inline" },
    });
  });

  it("accepts diagnostics without analytics environment", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });
    const request = nativeTelemetryRequest(credential.token, "req_native_telemetry_no_env", {
      event: "bootstrap_failed",
      stage: "launch",
    });

    const response = await action(routeArgsWithoutEnv(request, "native/telemetry") as any);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_native_telemetry_no_env",
      data: { accepted: true },
    });
    expect(nativeTelemetryCaptures()).toHaveLength(0);
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

  it("rejects every raw search query spelling before analytics capture", async () => {
    const secretQuery = "family secret saffron phrase";
    for (const rawField of ["query", "searchQuery", "rawQuery"]) {
      const response = await action(routeArgs(nativeTelemetryRequest(null, `req_native_search_raw_${rawField}`, {
        event: "search_failed",
        searchScope: "all",
        searchQueryLength: secretQuery.length,
        [rawField]: secretQuery,
      }), "native/telemetry").args);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error" },
      });
    }

    expect(nativeTelemetryCaptures()).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain(secretQuery);
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

  it("rejects unsupported event environment and enum diagnostics", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native telemetry", {
      scopes: ["account:read"],
    });

    const invalidEvent = await action(routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry_bad_event", {
      event: "raw_error_message",
      stage: "settings",
    }), "native/telemetry").args);
    const invalidEnvironment = await action(routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry_bad_env", {
      event: "settings_refresh_failed",
      stage: "settings",
      environment: "staging",
    }), "native/telemetry").args);
    const invalidPlatform = await action(routeArgs(nativeTelemetryRequest(credential.token, "req_native_telemetry_bad_platform", {
      event: "settings_refresh_failed",
      stage: "settings",
      platform: "watchos",
    }), "native/telemetry").args);

    expect(invalidEvent.status).toBe(400);
    await expect(invalidEvent.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "event is not a supported native telemetry event" },
    });
    expect(invalidEnvironment.status).toBe(400);
    await expect(invalidEnvironment.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "environment must be local, preview, or production" },
    });
    expect(invalidPlatform.status).toBe(400);
    await expect(invalidPlatform.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "platform is not supported" },
    });
    expect(nativeTelemetryCaptures()).toHaveLength(0);
  });

  it("rejects unsupported search scopes and malformed or out-of-range search metrics", async () => {
    const invalidBodies: Array<{ field: string; body: Record<string, unknown>; message: string }> = [
      {
        field: "searchScope",
        body: { searchScope: "shopping" },
        message: "searchScope is not supported",
      },
      {
        field: "searchQueryLength",
        body: { searchQueryLength: -1 },
        message: "searchQueryLength must be an integer between 0 and 100000",
      },
      {
        field: "searchQueryLength",
        body: { searchQueryLength: 100_001 },
        message: "searchQueryLength must be an integer between 0 and 100000",
      },
      {
        field: "searchResultCount",
        body: { searchResultCount: 1.5 },
        message: "searchResultCount must be an integer between 0 and 100000",
      },
      {
        field: "searchResultCount",
        body: { searchResultCount: "7" },
        message: "searchResultCount must be an integer between 0 and 100000",
      },
      {
        field: "durationMilliseconds",
        body: { durationMilliseconds: -1 },
        message: "durationMilliseconds must be an integer between 0 and 86400000",
      },
      {
        field: "durationMilliseconds",
        body: { durationMilliseconds: 86_400_001 },
        message: "durationMilliseconds must be an integer between 0 and 86400000",
      },
    ];

    for (const [index, invalid] of invalidBodies.entries()) {
      const response = await action(routeArgs(nativeTelemetryRequest(null, `req_native_search_invalid_${index}`, {
        event: "search_failed",
        ...invalid.body,
      }), "native/telemetry").args);

      expect(response.status, invalid.field).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error", message: invalid.message },
      });
    }

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

  it("accepts lower-scope bearer clients because native telemetry is optional auth", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Kitchen-only client", {
      scopes: ["kitchen:read"],
    });
    const request = nativeTelemetryRequest(credential.token, "req_native_telemetry_scope", {
      event: "settings_refresh_failed",
      stage: "settings",
    });

    const response = await action(routeArgs(request, "native/telemetry").args);

    expect(response.status).toBe(202);
    expect(nativeTelemetryCaptures()[0]).toMatchObject({
      distinctId: user.id,
      properties: { native_event: "settings_refresh_failed", server_request_id: "req_native_telemetry_scope" },
    });
  });
});
