import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/oauth.register";
import { captureEvent } from "~/lib/analytics-server";
import { cleanupDatabase } from "../helpers/cleanup";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

function routeArgs(request: Request, env: Record<string, unknown> = { POSTHOG_KEY: "ph_test" }) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  return {
    request,
    params: {},
    context: { cloudflare: { env, ctx: { waitUntil } } },
    waitUntil,
  } as never;
}

function registerRequest(body: unknown, headers: Record<string, string> = {}) {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return {
    bodyText,
    request: new UndiciRequest("https://spoonjoy.app/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: bodyText,
    }) as unknown as Request,
  };
}

function oauthRegisterInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectOAuthRegisterEvent(input: {
  status: number;
  method?: string;
  errorCode?: string;
  clientId?: string;
  redirectUriCount?: number;
  scopeCount?: number;
  rateLimitScope?: string;
  forbidden?: readonly string[];
}) {
  const eventInput = oauthRegisterInputs().find((candidate) => (
    candidate.event === "spoonjoy.oauth.register" &&
    candidate.properties?.status === input.status &&
    (
      input.errorCode === undefined
        ? candidate.properties?.error_code === undefined
        : candidate.properties?.error_code === input.errorCode
    )
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.oauth.register",
    distinctId: input.clientId ?? "anon",
    properties: {
      route_template: "/oauth/register",
      method: input.method ?? "POST",
      status: input.status,
      error_code: input.errorCode,
      client_id: input.clientId,
      redirect_uri_count: input.redirectUriCount,
      scope_count: input.scopeCount,
      request_bytes: expect.any(Number),
      latency_ms: expect.any(Number),
    },
  });

  const properties = eventInput!.properties as Record<string, unknown>;
  if (input.rateLimitScope) {
    expect(properties.rate_limit_scope).toBe(input.rateLimitScope);
  } else {
    expect(properties.rate_limit_scope).toBeUndefined();
  }

  const serialized = JSON.stringify(eventInput);
  for (const forbidden of input.forbidden ?? []) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toContain("redirect_uris");
  expect(serialized).not.toContain("client_name");
  expect(serialized).not.toContain("rawQuery");
  expect(serialized).not.toContain("requestBody");
  return eventInput;
}

describe("OAuth register telemetry", () => {
  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("captures safe dynamic-registration telemetry for success and validation errors", async () => {
    const redirectUri = "https://client.example/oauth/callback?code=secret";
    const success = registerRequest({
      client_name: "Kitchen Widget",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      scope: "recipes:read shopping_list:write",
    });
    const successResponse = await action(routeArgs(success.request));

    expect(successResponse.status).toBe(201);
    const successBody = await successResponse.json() as { client_id: string };
    expectOAuthRegisterEvent({
      status: 201,
      clientId: successBody.client_id,
      redirectUriCount: 1,
      scopeCount: 2,
      forbidden: [redirectUri, "code=secret", "Kitchen Widget", success.bodyText],
    });

    const invalidJson = registerRequest("{ raw invalid json secret");
    const invalidJsonResponse = await action(routeArgs(invalidJson.request));
    expect(invalidJsonResponse.status).toBe(400);
    expectOAuthRegisterEvent({
      status: 400,
      errorCode: "invalid_request",
      forbidden: [invalidJson.bodyText, "raw invalid json secret"],
    });

    const badRedirect = "http://evil.example.com/callback?token=raw";
    const invalidRedirect = registerRequest({ redirect_uris: [badRedirect] });
    const invalidRedirectResponse = await action(routeArgs(invalidRedirect.request));
    expect(invalidRedirectResponse.status).toBe(400);
    expectOAuthRegisterEvent({
      status: 400,
      errorCode: "invalid_redirect_uri",
      redirectUriCount: 1,
      forbidden: [badRedirect, "token=raw"],
    });

    const invalidScope = registerRequest({
      redirect_uris: ["https://client.example/oauth/callback"],
      scope: "recipes:delete",
    });
    const invalidScopeResponse = await action(routeArgs(invalidScope.request));
    expect(invalidScopeResponse.status).toBe(400);
    expectOAuthRegisterEvent({
      status: 400,
      errorCode: "invalid_scope",
      redirectUriCount: 1,
      scopeCount: 1,
      forbidden: [invalidScope.bodyText, "recipes:delete"],
    });

    const unsupportedMetadata = registerRequest({
      redirect_uris: ["https://client.example/oauth/callback"],
      client_secret: "raw-client-secret",
    });
    const unsupportedMetadataResponse = await action(routeArgs(unsupportedMetadata.request));
    expect(unsupportedMetadataResponse.status).toBe(400);
    expectOAuthRegisterEvent({
      status: 400,
      errorCode: "invalid_client_metadata",
      redirectUriCount: 1,
      forbidden: [unsupportedMetadata.bodyText, "raw-client-secret"],
    });
  });

  it("captures safe method and rate-limit telemetry", async () => {
    const methodResponse = await action(routeArgs(new UndiciRequest("https://spoonjoy.app/oauth/register", {
      method: "GET",
    }) as unknown as Request));
    expect(methodResponse.status).toBe(405);
    expectOAuthRegisterEvent({
      status: 405,
      method: "GET",
      errorCode: "invalid_request",
    });

    const rateLimited = registerRequest({ redirect_uris: ["https://client.example/oauth/callback"] }, {
      "CF-Connecting-IP": "203.0.113.9",
    });
    const rateLimitedResponse = await action(routeArgs(rateLimited.request, {
      POSTHOG_KEY: "ph_test",
      API_IP_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          expect(key).toBe("ip:203.0.113.9");
          return { success: false };
        },
      },
    }));
    expect(rateLimitedResponse.status).toBe(429);
    expectOAuthRegisterEvent({
      status: 429,
      errorCode: "rate_limited",
      rateLimitScope: "ip",
      forbidden: ["203.0.113.9", rateLimited.bodyText],
    });
  });
});
