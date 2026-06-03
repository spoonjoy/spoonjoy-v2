import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader, action } from "~/routes/oauth.authorize";
import { captureEvent } from "~/lib/analytics-server";
import { registerOAuthClient } from "~/lib/oauth-server.server";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

type AuthorizeRouteArgs = Parameters<typeof loader>[0] & {
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

async function authedCookie(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function routeArgs(
  request: Request,
  env: Record<string, unknown> = { POSTHOG_KEY: "ph_test" },
): AuthorizeRouteArgs {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  return {
    request,
    params: {},
    context: { cloudflare: { env, ctx: { waitUntil } } },
    waitUntil,
  } as unknown as AuthorizeRouteArgs;
}

async function setup() {
  const user = await db.user.create({ data: createTestUser() });
  const client = await registerOAuthClient(db, {
    clientName: "Telemetry Client",
    redirectUris: [REDIRECT_URI],
  });
  const codeChallenge = await challengeFor(VERIFIER);
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "kitchen:read",
    state: "state_0123456789abcdef",
    resource: "https://spoonjoy.app/mcp",
  });
  return { user, client, codeChallenge, query };
}

function oauthAuthorizeInputs() {
  return vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
}

function expectCaptureScheduled(args: AuthorizeRouteArgs) {
  const captureResult = vi.mocked(captureEvent).mock.results.at(-1);
  expect(captureResult?.type).toBe("return");
  expect(args.waitUntil).toHaveBeenCalledOnce();
  expect(args.waitUntil).toHaveBeenCalledWith(captureResult!.value);
}

function expectOAuthAuthorizeEvent(input: {
  phase: "action" | "loader";
  status: number;
  outcome: string;
  clientId?: string;
  principalId?: string;
  decision?: string;
  errorCode?: string;
  stateClass?: string;
  scope?: string;
  resource?: string;
  rateLimitScope?: string;
  forbidden?: readonly string[];
}) {
  const eventInput = oauthAuthorizeInputs().find((candidate) => (
    candidate.event === "spoonjoy.oauth.authorize" &&
    candidate.properties?.phase === input.phase &&
    candidate.properties?.status === input.status &&
    candidate.properties?.outcome === input.outcome &&
    (
      input.errorCode === undefined
        ? candidate.properties?.error_code === undefined
        : candidate.properties?.error_code === input.errorCode
    )
  ));

  expect(eventInput).toMatchObject({
    event: "spoonjoy.oauth.authorize",
    distinctId: input.principalId ?? input.clientId ?? "anon",
    properties: {
      route_template: "/oauth/authorize",
      phase: input.phase,
      status: input.status,
      outcome: input.outcome,
      client_id: input.clientId,
      principal_id: input.principalId,
      decision: input.decision,
      error_code: input.errorCode,
      state_class: input.stateClass ?? "present",
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
  expect(serialized).not.toContain("code_challenge");
  expect(serialized).not.toContain("code_verifier");
  expect(serialized).not.toContain("state_0123456789abcdef");
  expect(serialized).not.toContain("raw");
  return eventInput;
}

describe("OAuth authorize telemetry", () => {
  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("captures safe loader telemetry for login gate, consent view, client errors, and rate limits", async () => {
    const { user, client, codeChallenge, query } = await setup();

    const loginArgs = routeArgs(new Request(`https://spoonjoy.app/oauth/authorize?${query}`));
    await expect(loader(loginArgs))
      .rejects.toSatisfy((thrown: Response) => thrown.status === 302);
    expectOAuthAuthorizeEvent({
      phase: "loader",
      status: 302,
      outcome: "login_redirect",
      clientId: client.clientId,
      stateClass: "present",
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [REDIRECT_URI, codeChallenge, query.get("state")!],
    });
    expectCaptureScheduled(loginArgs);

    const headers = new Headers({ Cookie: await authedCookie(user.id) });
    const consentArgs = routeArgs(new Request(`https://spoonjoy.app/oauth/authorize?${query}`, { headers }));
    const consent = await loader(consentArgs);
    expect(consent).toMatchObject({ kind: "consent", scope: "kitchen:read" });
    expectOAuthAuthorizeEvent({
      phase: "loader",
      status: 200,
      outcome: "consent",
      clientId: client.clientId,
      principalId: user.id,
      stateClass: "present",
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [REDIRECT_URI, codeChallenge, query.get("state")!],
    });
    expectCaptureScheduled(consentArgs);

    const unknownClient = "raw_unknown_client_secret";
    const unknownQuery = new URLSearchParams(query);
    unknownQuery.set("client_id", unknownClient);
    const clientErrorArgs = routeArgs(new Request(`https://spoonjoy.app/oauth/authorize?${unknownQuery}`));
    const errorView = await loader(clientErrorArgs);
    expect(errorView).toMatchObject({ kind: "error" });
    expectOAuthAuthorizeEvent({
      phase: "loader",
      status: 200,
      outcome: "client_error",
      errorCode: "invalid_client",
      stateClass: "present",
      forbidden: [unknownClient, REDIRECT_URI, codeChallenge, query.get("state")!],
    });
    expectCaptureScheduled(clientErrorArgs);

    const rateLimitArgs = routeArgs(new Request(`https://spoonjoy.app/oauth/authorize?${query}`, {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    }), {
      POSTHOG_KEY: "ph_test",
      API_IP_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          expect(key).toBe("ip:203.0.113.7");
          return { success: false };
        },
      },
    });
    await expect(loader(rateLimitArgs)).rejects.toSatisfy((thrown: Response) => thrown.status === 429);
    expectOAuthAuthorizeEvent({
      phase: "loader",
      status: 429,
      outcome: "rate_limited",
      errorCode: "rate_limited",
      stateClass: "present",
      rateLimitScope: "ip",
      forbidden: ["203.0.113.7", REDIRECT_URI, codeChallenge],
    });
    expectCaptureScheduled(rateLimitArgs);
  });

  it("captures safe action telemetry for approve, deny, and validation errors", async () => {
    const { user, client, codeChallenge, query } = await setup();
    const headers = new Headers({
      Cookie: await authedCookie(user.id),
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const approveBody = new URLSearchParams(query);
    approveBody.set("decision", "approve");
    const approveArgs = routeArgs(new Request("https://spoonjoy.app/oauth/authorize", {
      method: "POST",
      headers,
      body: approveBody,
    }));
    const approve = await action(approveArgs);
    expect(approve.status).toBe(302);
    expect(approve.headers.get("Location")).toContain("code=");
    expectOAuthAuthorizeEvent({
      phase: "action",
      status: 302,
      outcome: "approved",
      decision: "approve",
      clientId: client.clientId,
      principalId: user.id,
      stateClass: "present",
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [REDIRECT_URI, codeChallenge, query.get("state")!, approve.headers.get("Location")!],
    });
    expectCaptureScheduled(approveArgs);

    const denyBody = new URLSearchParams(query);
    denyBody.set("decision", "deny");
    const denyArgs = routeArgs(new Request("https://spoonjoy.app/oauth/authorize", {
      method: "POST",
      headers,
      body: denyBody,
    }));
    const deny = await action(denyArgs);
    expect(deny.status).toBe(302);
    expect(deny.headers.get("Location")).toContain("error=access_denied");
    expectOAuthAuthorizeEvent({
      phase: "action",
      status: 302,
      outcome: "denied",
      decision: "deny",
      clientId: client.clientId,
      principalId: user.id,
      errorCode: "access_denied",
      stateClass: "present",
      scope: "kitchen:read",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [REDIRECT_URI, codeChallenge, query.get("state")!, deny.headers.get("Location")!],
    });
    expectCaptureScheduled(denyArgs);

    const invalidScopeBody = new URLSearchParams(query);
    invalidScopeBody.set("decision", "approve");
    invalidScopeBody.set("scope", "recipes:delete");
    const invalidScopeArgs = routeArgs(new Request("https://spoonjoy.app/oauth/authorize", {
      method: "POST",
      headers,
      body: invalidScopeBody,
    }));
    const invalidScope = await action(invalidScopeArgs);
    expect(invalidScope.status).toBe(302);
    expectOAuthAuthorizeEvent({
      phase: "action",
      status: 302,
      outcome: "redirect_error",
      clientId: client.clientId,
      principalId: user.id,
      errorCode: "invalid_scope",
      stateClass: "present",
      resource: "https://spoonjoy.app/mcp",
      forbidden: [REDIRECT_URI, codeChallenge, "recipes:delete", invalidScopeBody.toString()],
    });
    expectCaptureScheduled(invalidScopeArgs);

    const rateLimitedBody = new URLSearchParams(query);
    rateLimitedBody.set("decision", "approve");
    const rateLimitedArgs = routeArgs(new Request("https://spoonjoy.app/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: await authedCookie(user.id),
        "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": "203.0.113.8",
      },
      body: rateLimitedBody,
    }), {
      POSTHOG_KEY: "ph_test",
      API_IP_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          expect(key).toBe("ip:203.0.113.8");
          return { success: false };
        },
      },
    });
    const rateLimited = await action(rateLimitedArgs);
    expect(rateLimited.status).toBe(429);
    expectOAuthAuthorizeEvent({
      phase: "action",
      status: 429,
      outcome: "rate_limited",
      errorCode: "rate_limited",
      stateClass: "present",
      rateLimitScope: "ip",
      forbidden: ["203.0.113.8", REDIRECT_URI, codeChallenge, rateLimitedBody.toString()],
    });
    expectCaptureScheduled(rateLimitedArgs);
  });
});
