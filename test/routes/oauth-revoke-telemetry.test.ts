import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/oauth.revoke";
import { captureEvent } from "~/lib/analytics-server";
import { createAuthorizationCode, registerOAuthClient } from "~/lib/oauth-server.server";
import { handleOAuthToken } from "~/lib/oauth-routes.server";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

type RevokeActionArgs = Parameters<typeof action>[0] & {
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
): RevokeActionArgs {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  return {
    request,
    params: {},
    context: { cloudflare: { env, ctx: { waitUntil } } },
    waitUntil,
  } as unknown as RevokeActionArgs;
}

function formRequest(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const body = new URLSearchParams(fields);
  return {
    bodyText: body.toString(),
    request: new Request("https://spoonjoy.app/oauth/revoke", {
      method: "POST",
      headers,
      body,
    }),
  };
}

function rawPost(bodyText: string, headers: Record<string, string> = {}) {
  return {
    bodyText,
    request: new Request("https://spoonjoy.app/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: bodyText,
    }),
  };
}

async function mintRefreshToken() {
  const user = await db.user.create({ data: createTestUser() });
  const client = await registerOAuthClient(db, {
    clientName: "Revoke Telemetry Client",
    redirectUris: [REDIRECT_URI],
  });
  const code = await createAuthorizationCode(db, {
    clientId: client.clientId,
    userId: user.id,
    redirectUri: REDIRECT_URI,
    codeChallenge: await challengeFor(VERIFIER),
    scope: "shopping_list:read",
    resource: "https://spoonjoy.app/mcp",
  });
  const tokenResponse = await handleOAuthToken(
    new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
      }),
    }),
    db,
    null,
  );
  const tokens = await tokenResponse.json() as { refresh_token: string };
  return { client, refreshToken: tokens.refresh_token };
}

async function invokeAction(request: Request, env?: Record<string, unknown>) {
  const args = routeArgs(request, env);
  const response = await action(args);
  return { args, response };
}

function oauthRevokeInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectCaptureScheduled(args: RevokeActionArgs) {
  const captureResult = vi.mocked(captureEvent).mock.results.at(-1);
  expect(captureResult?.type).toBe("return");
  expect(args.waitUntil).toHaveBeenCalledOnce();
  expect(args.waitUntil).toHaveBeenCalledWith(captureResult!.value);
}

function expectOAuthRevokeEvent(input: {
  status: number;
  outcome: "revoked" | "not_found" | "error" | "rate_limited";
  method?: string;
  errorCode?: string;
  clientId?: string;
  tokenTypeHint?: "refresh_token" | "unsupported" | "unknown";
  rateLimitScope?: string;
  forbidden?: readonly string[];
}) {
  const eventInput = oauthRevokeInputs().find((candidate) => (
    candidate.event === "spoonjoy.oauth.revoke" &&
    candidate.properties?.status === input.status &&
    candidate.properties?.outcome === input.outcome &&
    (
      input.errorCode === undefined
        ? candidate.properties?.error_code === undefined
        : candidate.properties?.error_code === input.errorCode
    )
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.oauth.revoke",
    distinctId: input.clientId ?? "anon",
    properties: {
      route_template: "/oauth/revoke",
      method: input.method ?? "POST",
      status: input.status,
      outcome: input.outcome,
      error_code: input.errorCode,
      client_id: input.clientId,
      token_type_hint: input.tokenTypeHint ?? "unknown",
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
  expect(serialized).not.toContain("token=");
  expect(serialized).not.toContain("requestBody");
  expect(serialized).not.toContain("203.0.113.");
  expect(serialized).not.toContain("Cookie");
  expect(serialized).not.toContain("Authorization");
  return eventInput;
}

describe("OAuth revoke telemetry", () => {
  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("captures safe revoke success, not-found, and binding-error telemetry", async () => {
    const { client, refreshToken } = await mintRefreshToken();

    const success = formRequest({
      token: refreshToken,
      client_id: client.clientId,
      token_type_hint: "refresh_token",
    }, {
      "CF-Connecting-IP": "203.0.113.31",
      Authorization: "Bearer sj_raw_revoke_bearer",
      Cookie: "session=raw_revoke_cookie",
    });
    const successResponse = await invokeAction(success.request);
    expect(successResponse.response.status).toBe(204);
    expectOAuthRevokeEvent({
      status: 204,
      outcome: "revoked",
      clientId: client.clientId,
      tokenTypeHint: "refresh_token",
      forbidden: [
        refreshToken,
        success.bodyText,
        "ort_",
        "203.0.113.31",
        "sj_raw_revoke_bearer",
        "raw_revoke_cookie",
      ],
    });
    expectCaptureScheduled(successResponse.args);

    const unknown = formRequest({
      token: "ort_raw_unknown_secret",
      client_id: client.clientId,
      token_type_hint: "refresh_token",
    });
    const unknownResponse = await invokeAction(unknown.request);
    expect(unknownResponse.response.status).toBe(204);
    expectOAuthRevokeEvent({
      status: 204,
      outcome: "not_found",
      tokenTypeHint: "refresh_token",
      forbidden: ["ort_raw_unknown_secret", unknown.bodyText, "ort_"],
    });
    expectCaptureScheduled(unknownResponse.args);

    const otherClient = await registerOAuthClient(db, {
      clientName: "Other Client",
      redirectUris: ["https://other.example/oauth/callback"],
    });
    const { refreshToken: mismatchedRefreshToken } = await mintRefreshToken();
    const mismatched = formRequest({
      token: mismatchedRefreshToken,
      client_id: otherClient.clientId,
      token_type_hint: "access_token",
    });
    const mismatchResponse = await invokeAction(mismatched.request);
    expect(mismatchResponse.response.status).toBe(400);
    expectOAuthRevokeEvent({
      status: 400,
      outcome: "error",
      errorCode: "invalid_grant",
      tokenTypeHint: "unsupported",
      forbidden: [mismatchedRefreshToken, mismatched.bodyText, otherClient.clientId, "ort_"],
    });
    expectCaptureScheduled(mismatchResponse.args);
  });

  it("captures safe method, invalid body, and rate-limit telemetry", async () => {
    const method = await invokeAction(new Request("https://spoonjoy.app/oauth/revoke", { method: "GET" }));
    expect(method.response.status).toBe(405);
    expectOAuthRevokeEvent({
      status: 405,
      method: "GET",
      outcome: "error",
      errorCode: "invalid_request",
    });
    expectCaptureScheduled(method.args);

    const invalidBody = rawPost("{\"token\":\"ort_raw_json_secret\"}", {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.32",
      Authorization: "Bearer sj_raw_invalid_revoke_bearer",
      Cookie: "session=raw_invalid_revoke_cookie",
    });
    const invalidBodyResponse = await invokeAction(invalidBody.request);
    expect(invalidBodyResponse.response.status).toBe(400);
    expectOAuthRevokeEvent({
      status: 400,
      outcome: "error",
      errorCode: "invalid_request",
      forbidden: [
        "ort_raw_json_secret",
        invalidBody.bodyText,
        "203.0.113.32",
        "sj_raw_invalid_revoke_bearer",
        "raw_invalid_revoke_cookie",
      ],
    });
    expectCaptureScheduled(invalidBodyResponse.args);

    const consumedBodyRequest = new Request("https://spoonjoy.app/oauth/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: "ort_raw_consumed_secret" }),
    });
    await consumedBodyRequest.text();
    const consumedBodyResponse = await invokeAction(consumedBodyRequest);
    expect(consumedBodyResponse.response.status).toBe(400);
    expectOAuthRevokeEvent({
      status: 400,
      outcome: "error",
      errorCode: "invalid_request",
      forbidden: ["ort_raw_consumed_secret", "Body is unusable"],
    });
    expectCaptureScheduled(consumedBodyResponse.args);

    const rateLimited = formRequest({
      token: "ort_raw_rate_secret",
      client_id: "raw_client_id",
      token_type_hint: "refresh_token",
    }, {
      "CF-Connecting-IP": "203.0.113.33",
    });
    const rateLimitedResponse = await invokeAction(rateLimited.request, {
      POSTHOG_KEY: "ph_test",
      API_IP_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          expect(key).toBe("ip:203.0.113.33");
          return { success: false };
        },
      },
    });
    expect(rateLimitedResponse.response.status).toBe(429);
    expectOAuthRevokeEvent({
      status: 429,
      outcome: "rate_limited",
      errorCode: "rate_limited",
      rateLimitScope: "ip",
      forbidden: ["ort_raw_rate_secret", "raw_client_id", rateLimited.bodyText, "203.0.113.33"],
    });
    expectCaptureScheduled(rateLimitedResponse.args);
  });
});
