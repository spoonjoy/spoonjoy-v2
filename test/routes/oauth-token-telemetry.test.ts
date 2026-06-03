import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/oauth.token";
import { captureEvent } from "~/lib/analytics-server";
import { createAuthorizationCode, registerOAuthClient } from "~/lib/oauth-server.server";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

type TokenActionArgs = Parameters<typeof action>[0] & {
  waitUntil: ReturnType<typeof vi.fn>;
};

const Request = UndiciRequest as unknown as typeof globalThis.Request;
const REDIRECT_URI = "https://client.example/oauth/callback?code=raw";
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(Array.from(new Uint8Array(digest), (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function routeArgs(
  request: Request,
  env: Record<string, unknown> = { POSTHOG_KEY: "ph_test" },
): TokenActionArgs {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  return {
    request,
    params: {},
    context: { cloudflare: { env, ctx: { waitUntil } } },
    waitUntil,
  } as unknown as TokenActionArgs;
}

function formRequest(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const body = new URLSearchParams(fields);
  return {
    bodyText: body.toString(),
    request: new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
      headers,
      body,
    }),
  };
}

function rawPost(bodyText: string, headers: Record<string, string> = {}) {
  return {
    bodyText,
    request: new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: bodyText,
    }),
  };
}

async function setupGrant() {
  const user = await db.user.create({ data: createTestUser() });
  const client = await registerOAuthClient(db, {
    clientName: "Token Telemetry Client",
    redirectUris: [REDIRECT_URI],
  });
  const codeChallenge = await challengeFor(VERIFIER);
  const code = await createAuthorizationCode(db, {
    clientId: client.clientId,
    userId: user.id,
    redirectUri: REDIRECT_URI,
    codeChallenge,
    scope: "shopping_list:read shopping_list:write",
    resource: "https://spoonjoy.app/mcp",
  });
  return { user, client, code, codeChallenge };
}

async function invokeAction(request: Request, env?: Record<string, unknown>) {
  const args = routeArgs(request, env);
  const response = await action(args);
  return { args, response };
}

function oauthTokenInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectCaptureScheduled(args: TokenActionArgs) {
  const captureResult = vi.mocked(captureEvent).mock.results.at(-1);
  expect(captureResult?.type).toBe("return");
  expect(args.waitUntil).toHaveBeenCalledOnce();
  expect(args.waitUntil).toHaveBeenCalledWith(captureResult!.value);
}

function expectOAuthTokenEvent(input: {
  status: number;
  grantType: "authorization_code" | "refresh_token" | "unsupported" | "unknown";
  outcome: "issued" | "refreshed" | "error" | "rate_limited";
  method?: string;
  errorCode?: string;
  clientId?: string;
  scope?: string;
  resource?: string;
  rateLimitScope?: string;
  forbidden?: readonly string[];
}) {
  const eventInput = oauthTokenInputs().find((candidate) => (
    candidate.event === "spoonjoy.oauth.token" &&
    candidate.properties?.status === input.status &&
    candidate.properties?.grant_type === input.grantType &&
    candidate.properties?.outcome === input.outcome &&
    (
      input.errorCode === undefined
        ? candidate.properties?.error_code === undefined
        : candidate.properties?.error_code === input.errorCode
    )
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.oauth.token",
    distinctId: input.clientId ?? "anon",
    properties: {
      route_template: "/oauth/token",
      method: input.method ?? "POST",
      status: input.status,
      outcome: input.outcome,
      grant_type: input.grantType,
      error_code: input.errorCode,
      client_id: input.clientId,
      scope: input.scope,
      resource: input.resource,
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
  expect(serialized).not.toContain("redirect_uri");
  expect(serialized).not.toContain("code_verifier");
  expect(serialized).not.toContain("authorizationCode");
  expect(serialized).not.toContain("access_token");
  expect(serialized).not.toContain("refresh_token");
  expect(serialized).not.toContain("requestBody");
  return eventInput;
}

describe("OAuth token telemetry", () => {
  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("captures safe token and refresh success telemetry", async () => {
    const { client, code, codeChallenge } = await setupGrant();
    const codeExchange = formRequest({
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    });
    const { args: codeArgs, response: codeResponse } = await invokeAction(codeExchange.request);

    expect(codeResponse.status).toBe(200);
    const codeBody = await codeResponse.json() as { access_token: string; refresh_token: string };
    expectOAuthTokenEvent({
      status: 200,
      outcome: "issued",
      grantType: "authorization_code",
      clientId: client.clientId,
      scope: "shopping_list:read shopping_list:write",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [
        code,
        codeChallenge,
        VERIFIER,
        REDIRECT_URI,
        codeExchange.bodyText,
        codeBody.access_token,
        codeBody.refresh_token,
        "sj_",
        "ort_",
      ],
    });
    expectCaptureScheduled(codeArgs);

    vi.mocked(captureEvent).mockClear();
    const refresh = formRequest({
      grant_type: "refresh_token",
      refresh_token: codeBody.refresh_token,
      client_id: client.clientId,
    });
    const { args: refreshArgs, response: refreshResponse } = await invokeAction(refresh.request);

    expect(refreshResponse.status).toBe(200);
    const refreshBody = await refreshResponse.json() as { access_token: string; refresh_token: string };
    expectOAuthTokenEvent({
      status: 200,
      outcome: "refreshed",
      grantType: "refresh_token",
      clientId: client.clientId,
      scope: "shopping_list:read shopping_list:write",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [
        codeBody.refresh_token,
        refresh.bodyText,
        refreshBody.access_token,
        refreshBody.refresh_token,
        "sj_",
        "ort_",
      ],
    });
    expectCaptureScheduled(refreshArgs);
  });

  it("captures safe token error and rate-limit telemetry", async () => {
    const { client, codeChallenge } = await setupGrant();

    const method = await invokeAction(new Request("https://spoonjoy.app/oauth/token", { method: "GET" }));
    expect(method.response.status).toBe(405);
    expectOAuthTokenEvent({
      status: 405,
      method: "GET",
      outcome: "error",
      grantType: "unknown",
      errorCode: "invalid_request",
    });
    expectCaptureScheduled(method.args);

    const unsupported = formRequest({ grant_type: "password", client_id: client.clientId });
    const unsupportedResponse = await invokeAction(unsupported.request);
    expect(unsupportedResponse.response.status).toBe(400);
    expectOAuthTokenEvent({
      status: 400,
      outcome: "error",
      grantType: "unsupported",
      errorCode: "unsupported_grant_type",
      forbidden: ["password", unsupported.bodyText],
    });
    expectCaptureScheduled(unsupportedResponse.args);

    const invalidGrant = formRequest({
      grant_type: "authorization_code",
      code: "oac_raw_secret_code",
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    });
    const invalidGrantResponse = await invokeAction(invalidGrant.request);
    expect(invalidGrantResponse.response.status).toBe(400);
    expectOAuthTokenEvent({
      status: 400,
      outcome: "error",
      grantType: "authorization_code",
      errorCode: "invalid_grant",
      forbidden: [
        "oac_raw_secret_code",
        codeChallenge,
        VERIFIER,
        REDIRECT_URI,
        invalidGrant.bodyText,
      ],
    });
    expectCaptureScheduled(invalidGrantResponse.args);

    const oversized = rawPost("x".repeat(8 * 1024 + 1));
    const oversizedResponse = await invokeAction(oversized.request);
    expect(oversizedResponse.response.status).toBe(400);
    expectOAuthTokenEvent({
      status: 400,
      outcome: "error",
      grantType: "unknown",
      errorCode: "invalid_request",
      forbidden: [oversized.bodyText],
    });
    expectCaptureScheduled(oversizedResponse.args);

    const rateLimited = formRequest({
      grant_type: "refresh_token",
      refresh_token: "ort_raw_refresh_secret",
      client_id: client.clientId,
    }, {
      "CF-Connecting-IP": "203.0.113.11",
    });
    const rateLimitedResponse = await invokeAction(rateLimited.request, {
      POSTHOG_KEY: "ph_test",
      API_IP_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          expect(key).toBe("ip:203.0.113.11");
          return { success: false };
        },
      },
    });
    expect(rateLimitedResponse.response.status).toBe(429);
    expectOAuthTokenEvent({
      status: 429,
      outcome: "rate_limited",
      grantType: "unknown",
      errorCode: "rate_limited",
      rateLimitScope: "ip",
      forbidden: ["203.0.113.11", "ort_raw_refresh_secret", rateLimited.bodyText],
    });
    expectCaptureScheduled(rateLimitedResponse.args);
  });
});
