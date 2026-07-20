import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import OAuthAuthorize, { action, headers as authorizeHeaders, loader } from "~/routes/oauth.authorize";
import type { AuthorizeView } from "~/lib/oauth-routes.server";
import { registerOAuthClient } from "~/lib/oauth-server.server";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";
import { OAUTH_FORM_ACTION_ORIGIN_HEADER } from "~/lib/security-headers.server";

const getOAuthClientCalls = vi.hoisted(() => vi.fn());

vi.mock("~/lib/oauth-server.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/oauth-server.server")>();
  return {
    ...actual,
    getOAuthClient: async (...args: Parameters<typeof actual.getOAuthClient>) => {
      getOAuthClientCalls(...args);
      return actual.getOAuthClient(...args);
    },
  };
});

// undici's Request preserves the `Cookie` header that happy-dom's global drops.
const Request = UndiciRequest as unknown as typeof globalThis.Request;

const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function authedCookie(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

const redirectUri = "https://claude.ai/cb";
const nativeRedirectUri = "https://spoonjoy.app/oauth/callback";

describe("oauth.authorize route", () => {
  beforeEach(async () => {
    getOAuthClientCalls.mockClear();
    await cleanupDatabase();
  });
  afterEach(async () => { await cleanupDatabase(); });

  async function setup(options: {
    clientName?: string;
    redirectUri?: string;
    redirectUris?: string[];
  } = {}) {
    const user = await db.user.create({ data: createTestUser() });
    const requestedRedirectUri = options.redirectUri ?? redirectUri;
    const client = await registerOAuthClient(db, {
      clientName: options.clientName ?? "Claude",
      redirectUris: options.redirectUris ?? [requestedRedirectUri],
    });
    const query = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: requestedRedirectUri,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: "https://spoonjoy.app/mcp",
    });
    return { userId: user.id, clientId: client.clientId, query };
  }

  async function thrownResponse(request: Request): Promise<Response> {
    try {
      await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      return error as Response;
    }
    throw new Error("Expected the authorize loader to throw a Response");
  }

  function providerStartLocation(response: Response, provider: "google" | "github", returnTo: string) {
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "", "https://spoonjoy.app");
    expect(location.pathname).toBe(`/auth/${provider}`);
    expect(location.searchParams.get("redirectTo")).toBe(returnTo);
    expect(location.searchParams.get("failureRedirect")).toBe(
      `/login?redirectTo=${encodeURIComponent(returnTo)}`,
    );
  }

  it("loader throws a redirect Response when not authenticated", async () => {
    const { query } = await setup();
    const request = new Request(`https://spoonjoy.app/oauth/authorize?${query}`);
    const response = await thrownResponse(request);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `/login?redirectTo=${encodeURIComponent(`/oauth/authorize?${query}`)}`,
    );
  });

  it("does not perform an extra client lookup for the no-hint login redirect", async () => {
    const { query } = await setup();

    await thrownResponse(new Request(`https://spoonjoy.app/oauth/authorize?${query}`));

    expect(getOAuthClientCalls).toHaveBeenCalledTimes(1);
  });

  it.each(["google", "github"] as const)(
    "routes a validated first-party %s hint directly to that provider",
    async (provider) => {
      const { query } = await setup({ clientName: "Spoonjoy Apple", redirectUri: nativeRedirectUri });
      query.set("provider", provider);
      const returnTo = `/oauth/authorize?${query}`;
      const response = await thrownResponse(new Request(`https://spoonjoy.app${returnTo}`));

      providerStartLocation(response, provider, returnTo);
    },
  );

  it.each([
    { label: "unknown", providers: ["apple"] },
    { label: "empty", providers: [""] },
    { label: "duplicate", providers: ["google", "github"] },
  ])("ignores $label provider hints", async ({ providers }) => {
    const { query } = await setup({ clientName: "Spoonjoy Apple", redirectUri: nativeRedirectUri });
    for (const provider of providers) query.append("provider", provider);
    const returnTo = `/oauth/authorize?${query}`;
    const response = await thrownResponse(new Request(`https://spoonjoy.app${returnTo}`));

    expect(response.headers.get("Location")).toBe(`/login?redirectTo=${encodeURIComponent(returnTo)}`);
  });

  it.each([
    {
      label: "third-party client name",
      clientName: "Example App",
      requestedRedirectUri: nativeRedirectUri,
      redirectUris: [nativeRedirectUri],
    },
    {
      label: "untrusted callback",
      clientName: "Spoonjoy Apple",
      requestedRedirectUri: "https://example.com/oauth/callback",
      redirectUris: ["https://example.com/oauth/callback"],
    },
    {
      label: "untrusted selected callback on a mixed registration",
      clientName: "Spoonjoy Apple",
      requestedRedirectUri: "https://example.com/oauth/callback",
      redirectUris: [nativeRedirectUri, "https://example.com/oauth/callback"],
    },
  ])("does not honor a hint for a $label", async ({ clientName, requestedRedirectUri, redirectUris }) => {
    const { query } = await setup({ clientName, redirectUri: requestedRedirectUri, redirectUris });
    query.set("provider", "google");
    const returnTo = `/oauth/authorize?${query}`;
    const response = await thrownResponse(new Request(`https://spoonjoy.app${returnTo}`));

    expect(response.headers.get("Location")).toBe(`/login?redirectTo=${encodeURIComponent(returnTo)}`);
  });

  it.each([
    { field: "state", value: "short", error: "invalid_request" },
    { field: "code_challenge", value: "not-valid", error: "invalid_request" },
  ])("validates $field before honoring a provider hint", async ({ field, value, error }) => {
    const { query } = await setup({ clientName: "Spoonjoy Apple", redirectUri: nativeRedirectUri });
    query.set("provider", "google");
    query.set(field, value);
    const response = await thrownResponse(
      new Request(`https://spoonjoy.app/oauth/authorize?${query}`),
    );
    const location = new URL(response.headers.get("Location") ?? "");

    expect(location.origin + location.pathname).toBe(nativeRedirectUri);
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("state")).toBe(query.get("state"));
  });

  it("loader returns consent with the exact validated callback origin for CSP", async () => {
    const { userId, query } = await setup({ clientName: "Claude", redirectUri });
    query.set("provider", "google");
    const headers = new Headers();
    headers.set("Cookie", await authedCookie(userId));
    const request = new Request(`https://spoonjoy.app/oauth/authorize?${query}`, { headers });
    const result = await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);
    expect(result).toMatchObject({
      data: {
        kind: "consent",
        scope: "kitchen:read",
        params: {
          clientId: query.get("client_id"),
          redirectUri,
          state: query.get("state"),
          codeChallenge: query.get("code_challenge"),
        },
      },
      init: {
        headers: {
          [OAUTH_FORM_ACTION_ORIGIN_HEADER]: "https://claude.ai",
        },
      },
    });
  });

  it("forwards the validated consent origin into the document response headers", () => {
    const loaderHeaders = new Headers({
      [OAUTH_FORM_ACTION_ORIGIN_HEADER]: "https://claude.ai",
    });
    const parentHeaders = new Headers({ "X-Parent": "kept" });

    const result = new Headers(authorizeHeaders({
      loaderHeaders,
      parentHeaders,
      actionHeaders: new Headers(),
      errorHeaders: undefined,
    }));

    expect(result.get(OAUTH_FORM_ACTION_ORIGIN_HEADER)).toBe("https://claude.ai");
    expect(result.get("X-Parent")).toBe("kept");
  });

  it("loader returns 429 when the IP rate limiter denies the request", async () => {
    const { query } = await setup();
    const denyingLimiter = { limit: async () => ({ success: false }) };
    const headers = new Headers();
    headers.set("CF-Connecting-IP", "203.0.113.9");
    const request = new Request(`https://spoonjoy.app/oauth/authorize?${query}`, { headers });
    await expect(
      loader({
        request,
        context: { cloudflare: { env: { API_IP_RATE_LIMITER: denyingLimiter } } },
        params: {},
      } as any),
    ).rejects.toSatisfy((thrown: Response) => {
      expect(thrown).toBeInstanceOf(Response);
      expect(thrown.status).toBe(429);
      return true;
    });
  });

  it("action returns 429 when the IP rate limiter denies the request", async () => {
    const { query } = await setup();
    const body = new URLSearchParams(query);
    body.set("decision", "approve");
    const denyingLimiter = { limit: async () => ({ success: false }) };
    const headers = new Headers();
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    headers.set("CF-Connecting-IP", "203.0.113.9");
    const request = new Request("https://spoonjoy.app/oauth/authorize", {
      method: "POST",
      headers,
      body,
    });
    const response = await action({
      request,
      context: { cloudflare: { env: { API_IP_RATE_LIMITER: denyingLimiter } } },
      params: {},
    } as any);
    expect(response.status).toBe(429);
  });

  it("action mints a code and redirects back on approve", async () => {
    const { userId, clientId, query } = await setup();
    const headers = new Headers();
    headers.set("Cookie", await authedCookie(userId));
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    const body = new URLSearchParams(query);
    body.set("decision", "approve");
    const request = new Request("https://spoonjoy.app/oauth/authorize", { method: "POST", headers, body });
    const response = await action({ request, context: { cloudflare: { env: null } }, params: {} } as any);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain(`${redirectUri}?code=`);
    expect(clientId).toBeTruthy();
  });

  it.each([
    { decision: "approve", expectedError: null },
    { decision: "deny", expectedError: "access_denied" },
  ])("keeps first-party consent $decision independent of the provider hint", async ({ decision, expectedError }) => {
    const { userId, query } = await setup({ clientName: "Spoonjoy Apple", redirectUri: nativeRedirectUri });
    query.set("provider", "github");
    const headers = new Headers();
    headers.set("Cookie", await authedCookie(userId));
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    const body = new URLSearchParams(query);
    body.set("decision", decision);
    const response = await action({
      request: new Request("https://spoonjoy.app/oauth/authorize", { method: "POST", headers, body }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);
    const location = new URL(response.headers.get("Location") ?? "");

    expect(location.origin + location.pathname).toBe(nativeRedirectUri);
    expect(location.searchParams.get("state")).toBe(query.get("state"));
    expect(location.searchParams.get("error")).toBe(expectedError);
    expect(location.searchParams.has("provider")).toBe(false);
    expect(location.searchParams.has(decision === "approve" ? "code" : "error")).toBe(true);
  });

  function renderView(view: AuthorizeView) {
    const Stub = createTestRoutesStub([
      { path: "/oauth/authorize", Component: OAuthAuthorize, loader: () => view },
    ]);
    return render(<Stub initialEntries={["/oauth/authorize"]} />);
  }

  it("renders a simple consent screen with scopes and working forms", async () => {
    const rendered = renderView({
      kind: "consent",
      clientName: "Claude",
      scope: "kitchen:read kitchen:write",
      params: {
        clientId: "c",
        redirectUri,
        responseType: "code",
        state: "state_0123456789abcdef",
        scope: "kitchen:read kitchen:write",
        codeChallenge: "cc",
        codeChallengeMethod: "S256",
        resource: "r",
      },
    });
    expect(await screen.findByRole("heading", { name: /connect claude to spoonjoy/i })).toBeInTheDocument();
    expect(screen.getByText(/read recipes, cookbooks, and your shopping list/i)).toBeInTheDocument();
    expect(screen.getByText(/add, edit, and remove kitchen data/i)).toBeInTheDocument();
    expect(screen.getByText(/stays active until you disconnect/i)).toBeInTheDocument();
    expect(screen.getByText(/connection details/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow access/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
    const forms = Array.from(rendered.container.querySelectorAll("form"));
    expect(forms).toHaveLength(2);
    expect(forms.every((form) => form.getAttribute("method") === "post")).toBe(true);
    expect(forms.every((form) => !form.hasAttribute("data-discover"))).toBe(true);
    expect(screen.queryByText("Bring your kitchen with you.")).not.toBeInTheDocument();
    expect(screen.getByText("Kitchen connection")).toBeInTheDocument();
    expect(screen.queryByText("Kitchen sign-in")).not.toBeInTheDocument();
  });

  it("renders an unnamed client and an unknown scope verbatim", async () => {
    renderView({
      kind: "consent",
      clientName: null,
      scope: "kitchen:read kitchen:future",
      params: {
        clientId: "c",
        redirectUri,
        responseType: "code",
        state: "",
        scope: "kitchen:read kitchen:future",
        codeChallenge: "cc",
        codeChallengeMethod: "S256",
        resource: "",
      },
    });
    expect(await screen.findByRole("heading", { name: /connect this app to spoonjoy/i })).toBeInTheDocument();
    expect(screen.getByText(/kitchen:future/)).toBeInTheDocument();
  });

  it("omits the broad-scope warning for narrow scopes", async () => {
    renderView({
      kind: "consent",
      clientName: "Tiny client",
      scope: "recipes:read",
      params: {
        clientId: "c",
        redirectUri,
        responseType: "code",
        state: "state_0123456789abcdef",
        scope: "recipes:read",
        codeChallenge: "cc",
        codeChallengeMethod: "S256",
        resource: "",
      },
    });
    expect(await screen.findByRole("heading", { name: /connect tiny client to spoonjoy/i })).toBeInTheDocument();
    expect(screen.queryByText(/broad kitchen changes/i)).not.toBeInTheDocument();
  });

  it("renders the error view", async () => {
    renderView({ kind: "error", message: "Unknown OAuth client." });
    expect(await screen.findByRole("heading", { name: /connection problem/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Unknown OAuth client.");
    // The error view can render to a signed-out visitor, so its copy stays auth-neutral.
    expect(screen.getByText("Kitchen connection")).toBeInTheDocument();
    expect(screen.queryByText("Kitchen sign-in")).not.toBeInTheDocument();
  });
});
