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
      state: "xyz",
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
    render(<Stub initialEntries={["/oauth/authorize"]} />);
  }

  it("renders the consent screen with scopes and Allow/Deny", async () => {
    renderView({
      kind: "consent",
      clientName: "Claude",
      scope: "kitchen:read kitchen:write",
      params: { clientId: "c", redirectUri, state: "s", scope: "kitchen:read kitchen:write", codeChallenge: "cc", resource: "r" },
    });
    expect(await screen.findByRole("heading", { name: /authorize claude/i })).toBeInTheDocument();
    expect(screen.getByText(/view your recipes/i)).toBeInTheDocument();
    expect(screen.getByText(/add and edit your recipes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow access/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("renders an unnamed client and an unknown scope verbatim", async () => {
    renderView({
      kind: "consent",
      clientName: null,
      scope: "kitchen:read kitchen:future",
      params: { clientId: "c", redirectUri, state: "", scope: "kitchen:read kitchen:future", codeChallenge: "cc", resource: "" },
    });
    expect(await screen.findByRole("heading", { name: /authorize this app/i })).toBeInTheDocument();
    expect(screen.getByText(/kitchen:future/)).toBeInTheDocument();
  });

  it("renders the error view", async () => {
    renderView({ kind: "error", message: "Unknown OAuth client." });
    expect(await screen.findByRole("heading", { name: /connection problem/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Unknown OAuth client.");
  });
});
