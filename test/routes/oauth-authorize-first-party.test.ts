// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "~/routes/oauth.authorize";
import { captureEvent } from "~/lib/analytics-server";
import {
  registerOAuthClient,
  SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
  SPOONJOY_APPLE_OAUTH_REDIRECT_URI,
} from "~/lib/oauth-server.server";
import { db } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function routeArgs(request: Request) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => { void promise; });
  return {
    request,
    params: {},
    context: { cloudflare: { env: { POSTHOG_KEY: "ph_test" }, ctx: { waitUntil } } },
  } as unknown as Parameters<typeof loader>[0];
}

async function thrown(request: Request): Promise<Response> {
  try {
    await loader(routeArgs(request));
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected the authorize loader to throw a Response");
}

describe("oauth.authorize first-party consent skip", () => {
  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
  });
  afterEach(async () => { await cleanupDatabase(); });

  async function setup(resource?: string) {
    const user = await db.user.create({ data: createTestUser() });
    const client = await registerOAuthClient(db, {
      clientName: SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
      redirectUris: [SPOONJOY_APPLE_OAUTH_REDIRECT_URI],
    });
    const query = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: SPOONJOY_APPLE_OAUTH_REDIRECT_URI,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: "kitchen:read kitchen:write shopping_list:read shopping_list:write account:read account:write",
      state: "state_0123456789abcdef",
      provider: "google",
    });
    if (resource) query.set("resource", resource);
    return { userId: user.id, clientId: client.clientId, query };
  }

  it("keeps the marker on the Google redirect and auto-approves on return, reporting the flow to PostHog", async () => {
    const { userId, clientId, query } = await setup();
    const url = `https://spoonjoy.app/oauth/authorize?${query}`;

    const toGoogle = await thrown(new Request(url));
    expect(new URL(toGoogle.headers.get("Location")!, "https://spoonjoy.app").pathname).toBe("/auth/google");
    const marker = toGoogle.headers.get("Set-Cookie")!.split(";")[0];
    expect(marker).toMatch(/^__sj_fp_authorize=/);

    const session = (await createUserSessionCookie(userId)).split(";")[0];
    const back = await thrown(new Request(url, { headers: { Cookie: `${marker}; ${session}` } }));
    const location = new URL(back.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(SPOONJOY_APPLE_OAUTH_REDIRECT_URI);
    expect(location.searchParams.get("code")).toMatch(/^oac_/);

    const events = vi.mocked(captureEvent).mock.calls.map(([, input]) => input);
    expect(events.at(-1)).toMatchObject({
      event: "spoonjoy.oauth.authorize",
      distinctId: userId,
      properties: { outcome: "auto_approved", client_id: clientId, principal_id: userId, login_route: "google" },
    });
  });

  it("sets no marker on the provider redirect for a request that cannot skip consent", async () => {
    const { query } = await setup("https://spoonjoy.app/mcp");
    const toGoogle = await thrown(new Request(`https://spoonjoy.app/oauth/authorize?${query}`));
    expect(new URL(toGoogle.headers.get("Location")!, "https://spoonjoy.app").pathname).toBe("/auth/google");
    expect(toGoogle.headers.get("Set-Cookie")).toBeNull();
  });
});
