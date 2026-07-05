import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import OAuthAuthorize, { loader, action } from "~/routes/oauth.authorize";
import type { AuthorizeView } from "~/lib/oauth-routes.server";
import { registerOAuthClient } from "~/lib/oauth-server.server";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

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

describe("oauth.authorize route", () => {
  beforeEach(async () => { await cleanupDatabase(); });
  afterEach(async () => { await cleanupDatabase(); });

  async function setup() {
    const user = await db.user.create({ data: createTestUser() });
    const client = await registerOAuthClient(db, { clientName: "Claude", redirectUris: [redirectUri] });
    const query = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: "https://spoonjoy.app/mcp",
    });
    return { userId: user.id, clientId: client.clientId, query };
  }

  it("loader throws a redirect Response when not authenticated", async () => {
    const { query } = await setup();
    const request = new Request(`https://spoonjoy.app/oauth/authorize?${query}`);
    await expect(
      loader({ request, context: { cloudflare: { env: null } }, params: {} } as any),
    ).rejects.toSatisfy((thrown: Response) => {
      expect(thrown).toBeInstanceOf(Response);
      expect(thrown.status).toBe(302);
      return true;
    });
  });

  it("loader returns the consent view when authenticated", async () => {
    const { userId, query } = await setup();
    const headers = new Headers();
    headers.set("Cookie", await authedCookie(userId));
    const request = new Request(`https://spoonjoy.app/oauth/authorize?${query}`, { headers });
    const result = await loader({ request, context: { cloudflare: { env: null } }, params: {} } as any);
    expect(result).toMatchObject({ kind: "consent", scope: "kitchen:read" });
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
    expect(rendered.container.querySelectorAll("form")).toHaveLength(2);
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
