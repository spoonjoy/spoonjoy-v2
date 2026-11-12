// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { handleOAuthToken, loadOAuthAuthorize, oauthAuthorizeTelemetryFor } from "~/lib/oauth-routes.server";
import {
  firstPartyLoginMarkerCookie,
  firstPartySameFlowLogin,
  FIRST_PARTY_LOGIN_MARKER_MAX_AGE_SECONDS,
  isFirstPartyAutoApprovalRequest,
  type FirstPartyAuthorizeParams,
} from "~/lib/oauth-first-party-consent.server";
import {
  registerOAuthClient,
  SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
  SPOONJOY_APPLE_OAUTH_REDIRECT_URI,
} from "~/lib/oauth-server.server";
import { getLocalDb } from "~/lib/db.server";
import { createUserSessionCookie, sessionStorage, signedCookieSettings } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

const fence = vi.hoisted(() => ({ fail: false }));
vi.mock("~/lib/session-version-fence.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/session-version-fence.server")>();
  return {
    ...actual,
    sessionVersionUnchanged: async (...args: Parameters<typeof actual.sessionVersionUnchanged>) =>
      fence.fail ? false : actual.sessionVersionUnchanged(...args),
  };
});

// happy-dom's global Request strips the forbidden `Cookie` header, so use undici's.
const Request = UndiciRequest as unknown as typeof globalThis.Request;

const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const APP_SCOPES = "kitchen:read kitchen:write shopping_list:read shopping_list:write account:read account:write";

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cookiePair(setCookie: string | null): string {
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

function authorizeRequest(query: Record<string, string>, cookies: string[] = []): Request {
  const url = new URL("https://spoonjoy.app/oauth/authorize");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = new Headers();
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  return new Request(url, { headers });
}

function paramsFor(query: Record<string, string>): FirstPartyAuthorizeParams {
  return {
    clientId: query.client_id ?? "",
    redirectUri: query.redirect_uri ?? "",
    responseType: query.response_type ?? "",
    state: query.state ?? "",
    scope: query.scope ?? "",
    codeChallenge: query.code_challenge ?? "",
    codeChallengeMethod: query.code_challenge_method ?? "",
    resource: query.resource ?? "",
  };
}

describe("first-party consent skip", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let userId: string;
  let appClientId: string;

  beforeEach(async () => {
    fence.fail = false;
    await cleanupDatabase();
    db = await getLocalDb();
    userId = (await db.user.create({ data: createTestUser() })).id;
    appClientId = (await registerOAuthClient(db, {
      clientName: SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
      redirectUris: [SPOONJOY_APPLE_OAUTH_REDIRECT_URI],
      issuer: "https://spoonjoy.app",
    })).clientId;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupDatabase();
  });

  async function appQuery(overrides: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
      client_id: appClientId,
      redirect_uri: SPOONJOY_APPLE_OAUTH_REDIRECT_URI,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: APP_SCOPES,
      state: "state_0123456789abcdef",
      ...overrides,
    };
  }

  /** The login redirect for a signed-out request, and the marker cookie it set. */
  async function loginRedirect(query: Record<string, string>) {
    const result = await loadOAuthAuthorize(authorizeRequest(query), db, null) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toContain("/login?redirectTo=");
    return result;
  }

  /** A signed-in session cookie, as a fresh sign-in issues it. */
  async function signIn(authenticatedAt?: number | null): Promise<string> {
    return cookiePair(await createUserSessionCookie(userId, null, null, { authenticatedAt }));
  }

  /** Condition 4, the happy path: signed out, sent to sign in, back with a new session. */
  async function sameFlowCookies(query: Record<string, string>): Promise<string[]> {
    const marker = cookiePair((await loginRedirect(query)).headers.get("Set-Cookie"));
    return [marker, await signIn()];
  }

  it("skips consent for Spoonjoy Apple signed in during this authorize flow, and the code exchanges", async () => {
    const query = await appQuery();
    const result = await loadOAuthAuthorize(authorizeRequest(query, await sameFlowCookies(query)), db, null) as Response;

    expect(result.status).toBe(302);
    const location = new URL(result.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(SPOONJOY_APPLE_OAUTH_REDIRECT_URI);
    expect(location.searchParams.get("state")).toBe(query.state);
    expect(location.searchParams.get("iss")).toBe("https://spoonjoy.app");
    const code = location.searchParams.get("code")!;
    expect(code).toMatch(/^oac_/);
    // The marker is single use.
    expect(result.headers.get("Set-Cookie")).toMatch(/^__sj_fp_authorize=;.*Max-Age=0/);
    // Condition 5: the auto-approval is recorded with client, user and flow.
    expect(oauthAuthorizeTelemetryFor(result)).toMatchObject({
      outcome: "auto_approved",
      clientId: appClientId,
      principalId: userId,
      loginProvider: "login_page",
      scope: APP_SCOPES,
    });
    expect(await db.oAuthConsentTransaction.count()).toBe(0);

    const token = await handleOAuthToken(new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appClientId,
        redirect_uri: SPOONJOY_APPLE_OAUTH_REDIRECT_URI,
        code,
        code_verifier: VERIFIER,
      }),
    }), db, null);
    expect(token.status).toBe(200);
  });

  it("records the provider hint as the flow's login provider", async () => {
    const query = await appQuery({ provider: "google" });
    const result = await loadOAuthAuthorize(authorizeRequest(query, await sameFlowCookies(query)), db, null) as Response;
    expect(oauthAuthorizeTelemetryFor(result)).toMatchObject({ outcome: "auto_approved", loginProvider: "google" });
  });

  it("accepts a subset of the app's scopes", async () => {
    const query = await appQuery({ scope: "shopping_list:read shopping_list:write" });
    const result = await loadOAuthAuthorize(authorizeRequest(query, await sameFlowCookies(query)), db, null);
    expect(oauthAuthorizeTelemetryFor(result)).toMatchObject({ outcome: "auto_approved" });
  });

  it("withdraws the code when the session was revoked during the request", async () => {
    const query = await appQuery();
    const cookies = await sameFlowCookies(query);
    fence.fail = true;
    const result = await loadOAuthAuthorize(authorizeRequest(query, cookies), db, null) as Response;

    expect(result.status).toBe(400);
    expect(oauthAuthorizeTelemetryFor(result)).toMatchObject({ outcome: "error", errorCode: "invalid_request" });
    expect(await db.oAuthAuthCode.count()).toBe(0);
  });

  describe("condition 1: canonical first-party client and exact redirect", () => {
    it("shows consent to a third-party client on Spoonjoy's callback, even with a marker for its request", async () => {
      const otherClientId = (await registerOAuthClient(db, {
        clientName: "Recipe Robot",
        redirectUris: [SPOONJOY_APPLE_OAUTH_REDIRECT_URI],
      })).clientId;
      const query = await appQuery({ client_id: otherClientId });
      // No marker is set for a request that cannot skip consent.
      expect((await loginRedirect(query)).headers.get("Set-Cookie")).toBeNull();
      const forged = cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), paramsFor(query), "google"));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [forged, await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent", clientName: "Recipe Robot" });
    });

    it("shows consent to a legacy Spoonjoy Apple row that lists more than one redirect", async () => {
      const legacy = await db.oAuthClient.create({
        data: {
          clientName: SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
          redirectUris: `${SPOONJOY_APPLE_OAUTH_REDIRECT_URI} https://evil.example/cb`,
          issuer: "https://spoonjoy.app",
        },
      });
      const query = await appQuery({ client_id: legacy.id });
      const forged = cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), paramsFor(query), "google"));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [forged, await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });

    it.each([
      `${SPOONJOY_APPLE_OAUTH_REDIRECT_URI}/`,
      `${SPOONJOY_APPLE_OAUTH_REDIRECT_URI}?x=1`,
      "https://SPOONJOY.APP/oauth/callback",
      "https://spoonjoy.app/OAuth/Callback",
    ])("never mints a code for the variant redirect %s", async (variant) => {
      const query = await appQuery({ redirect_uri: variant });
      const cookies = [
        cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), paramsFor(query), "google")),
        await signIn(),
      ];
      const result = await loadOAuthAuthorize(authorizeRequest(query, cookies), db, null);
      expect(result).toMatchObject({ kind: "error", message: "The redirect URI is not registered for this client." });
      expect(await db.oAuthAuthCode.count()).toBe(0);
    });

    it("rejects a variant redirect even for a client object that lists it", () => {
      const client = {
        clientId: appClientId,
        clientName: SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
        redirectUris: [SPOONJOY_APPLE_OAUTH_REDIRECT_URI],
        issuer: "https://spoonjoy.app",
      };
      const params = paramsFor({
        client_id: appClientId,
        redirect_uri: `${SPOONJOY_APPLE_OAUTH_REDIRECT_URI}/`,
        code_challenge: "c",
        code_challenge_method: "S256",
      });
      expect(isFirstPartyAutoApprovalRequest(client, params, { scope: "kitchen:read", resource: null })).toBe(false);
      expect(isFirstPartyAutoApprovalRequest(
        client,
        { ...params, redirectUri: SPOONJOY_APPLE_OAUTH_REDIRECT_URI },
        { scope: "kitchen:read", resource: null },
      )).toBe(true);
    });
  });

  describe("condition 2: PKCE S256", () => {
    it.each([
      ["missing PKCE", { code_challenge: "", code_challenge_method: "" }],
      ["plain PKCE", { code_challenge_method: "plain" }],
    ])("never auto-approves with %s", async (_label, overrides) => {
      const query = await appQuery(overrides);
      const cookies = [
        cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), paramsFor(query), "google")),
        await signIn(),
      ];
      const result = await loadOAuthAuthorize(authorizeRequest(query, cookies), db, null) as Response;
      // As today: the request is refused back to the client, and no code exists.
      expect(new URL(result.headers.get("Location")!).searchParams.get("error")).toBe("invalid_request");
      expect(oauthAuthorizeTelemetryFor(result).outcome).toBe("redirect_error");
      expect(await db.oAuthAuthCode.count()).toBe(0);
    });

    it("refuses a request without S256 in the predicate itself", () => {
      const client = {
        clientId: appClientId,
        clientName: SPOONJOY_APPLE_OAUTH_CLIENT_NAME,
        redirectUris: [SPOONJOY_APPLE_OAUTH_REDIRECT_URI],
        issuer: "https://spoonjoy.app",
      };
      const base = paramsFor({ redirect_uri: SPOONJOY_APPLE_OAUTH_REDIRECT_URI, code_challenge: "c", code_challenge_method: "S256" });
      const validated = { scope: "kitchen:read", resource: null };
      expect(isFirstPartyAutoApprovalRequest(client, { ...base, codeChallengeMethod: "plain" }, validated)).toBe(false);
      expect(isFirstPartyAutoApprovalRequest(client, { ...base, codeChallenge: "" }, validated)).toBe(false);
    });
  });

  describe("condition 3: the app's scopes only", () => {
    it.each([
      `${APP_SCOPES} public:read`,
      "recipes:read",
    ])("shows consent for the scope %s", async (scope) => {
      const query = await appQuery({ scope });
      expect((await loginRedirect(query)).headers.get("Set-Cookie")).toBeNull();
      const forged = cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), paramsFor(query), "google"));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [forged, await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent", scope });
    });

    it("shows consent when a resource indicator is requested", async () => {
      const query = await appQuery({ resource: "https://spoonjoy.app/mcp" });
      const forged = cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), paramsFor(query), "google"));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [forged, await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });
  });

  describe("condition 4: a session from this same authorize flow", () => {
    it("shows consent to a session from before the authorize request", async () => {
      const query = await appQuery();
      const result = await loadOAuthAuthorize(authorizeRequest(query, [await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });

    it("shows consent when the sign-in predates the login redirect", async () => {
      const query = await appQuery();
      const earlierSession = await signIn(Date.now() - 60_000);
      const marker = cookiePair((await loginRedirect(query)).headers.get("Set-Cookie"));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [marker, earlierSession]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });

    it("shows consent to a session that records no sign-in time", async () => {
      const query = await appQuery();
      const marker = cookiePair((await loginRedirect(query)).headers.get("Set-Cookie"));
      const session = await sessionStorage.getSession();
      session.set("userId", userId);
      const legacy = cookiePair(await sessionStorage.commitSession(session));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [marker, legacy]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });

    it("shows consent when the marker names a different authorize request", async () => {
      const query = await appQuery();
      const marker = cookiePair((await loginRedirect({ ...query, state: "state_other_0123456789" })).headers.get("Set-Cookie"));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [marker, await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });

    it("shows consent when the login round trip took longer than the marker lasts", async () => {
      const query = await appQuery();
      const params = paramsFor(query);
      const request = authorizeRequest(query);
      const stale = Date.now() - FIRST_PARTY_LOGIN_MARKER_MAX_AGE_SECONDS * 1000 - 1;
      const marker = cookiePair(await firstPartyLoginMarkerCookie(null, request, params, "google", stale));
      const result = await loadOAuthAuthorize(authorizeRequest(query, [marker, await signIn()]), db, null);
      expect(result).toMatchObject({ kind: "consent" });
    });

    it("ignores a marker dated in the future and an unsigned or malformed one", async () => {
      const query = await appQuery();
      const params = paramsFor(query);
      const session = await signIn();
      const future = cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), params, "google", Date.now() + 60_000));
      await expect(firstPartySameFlowLogin(null, authorizeRequest(query, [future, session]), params)).resolves.toBeNull();
      await expect(firstPartySameFlowLogin(null, authorizeRequest(query, [session]), params)).resolves.toBeNull();
      await expect(firstPartySameFlowLogin(null, authorizeRequest(query, ["__sj_fp_authorize=forged", session]), params))
        .resolves.toBeNull();
    });

    it.each([
      ["a string payload", "not-an-object"],
      ["a missing fingerprint", { at: 1 }],
      ["a non-integer time", { h: "x", at: 1.5 }],
    ])("ignores a signed marker with %s", async (_label, payload) => {
      const { createCookie } = await import("react-router");
      const query = await appQuery();
      const signer = createCookie("__sj_fp_authorize", { secrets: [signedCookieSettings(null, null).secret] });
      const marker = cookiePair(await signer.serialize(payload));
      await expect(firstPartySameFlowLogin(null, authorizeRequest(query, [marker, await signIn()]), paramsFor(query)))
        .resolves.toBeNull();
    });

    it("reports an unknown provider in the marker as the login page", async () => {
      const query = await appQuery();
      const params = paramsFor(query);
      const marker = cookiePair(await firstPartyLoginMarkerCookie(null, authorizeRequest(query), params, "something" as never));
      await expect(firstPartySameFlowLogin(null, authorizeRequest(query, [marker, await signIn()]), params))
        .resolves.toBe("login_page");
    });
  });
});
