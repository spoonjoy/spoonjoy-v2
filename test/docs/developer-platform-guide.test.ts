import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Developers, { loader } from "~/routes/developers";
import {
  API_V1_DISCOVERY_DATA,
  API_V1_SCOPE_REQUIREMENTS,
} from "~/lib/api-v1-contract.server";
import { createTestRoutesStub } from "../utils";

function readProjectFile(path: string) {
  return readFileSync(resolve(__dirname, "..", "..", path), "utf8");
}

function scopesFor(method: string, path: string) {
  return API_V1_SCOPE_REQUIREMENTS.find((requirement) => requirement.method === method && requirement.path === path)
    ?.scopes ?? [];
}

const CLIENT_PROFILES = [
  "Tiny-device clients",
  "Mobile apps",
  "CLI/script clients",
  "Browser clients",
  "Agent clients",
] as const;

const GUIDE_MARKERS = [
  "External Client Guide",
  "Terminal Quickstart",
  "Current API Boundary",
  "Token Acquisition",
  "Auth Implementation",
  "OAuth And Delegated Flows",
  "OAuth Scope Mapping",
  "Read the public Chef graph",
  "Use your Spoonjoy session",
  "Use bearer only outside the session",
  "There is no token to mint or paste for playground calls",
  "No token: signed-in browser",
  "password, passkey, or any configured Google, GitHub, or Apple provider",
  "Personal token: signed-in chef creates one",
  "existing bearer credential with",
  "tokens:write",
  "Delegated token: OAuth/PKCE",
  "Those provider buttons are Spoonjoy sign-in methods",
  "The client never handles the chef's password",
  "Delegated token: approval link",
  "POST /api/tools/start_agent_connection",
  "POST /api/tools/poll_agent_connection",
  "full login surface",
  "not in API v1 yet",
  "Recipe write, import, or export endpoints",
  "Meal plan or \"today's recipes\" APIs",
  "Full account export APIs",
  "Canonical unit registry or density-based ingredient conversion",
  "webhooks, REST Hooks, SSE, and event subscriptions",
  "curl + jq",
  "No password-token API",
  "Spoonjoy does not support an OAuth password grant",
  "Email/password login creates a session cookie, not an API token",
  "grant_type=password",
  "Same-origin browser session",
  "credentials: \"same-origin\"",
  "Do not send Authorization",
  "Authorization header is present",
  "bearer auth wins over the session",
  "External REST client",
  "Bearer callers cannot create a token with broader scopes",
  "OAuth/PKCE app",
  "token_endpoint_auth_method: none",
  "no client secret",
  "Do not request `offline_access`",
  "kitchen:read",
  "kitchen:write",
  "public:read",
  "single-use 60-second code",
  "application/x-www-form-urlencoded",
  "15 minutes",
  "expires_in: 900",
  "refresh_token rotates",
  "code_verifier",
  "S256",
  "Omit `Authorization` on public calls",
  "free-form display strings",
  "/api/v1/units",
  "Auth failures",
  "validation_error",
  "invalid_token",
  "insufficient_scope",
  "X-Request-Id",
  "Native mobile OAuth",
  "Browser extension OAuth",
  "Cron shopping-list export/import",
  "Cloudflare Worker sync bridge",
  "No-code connector profile",
  "Public BI snapshot export",
  "REST-powered embeds only",
  "retained for 24 hours",
  "mutation.replayed: true",
  "idempotency_conflict",
  "Session",
  "Authorization: Bearer",
  "clientMutationId",
  "cursor",
  "/api/v1/openapi.connector.json",
  "Cache-Control: public, max-age=60, stale-while-revalidate=300",
  "REST Hooks",
  "caches.default",
  API_V1_DISCOVERY_DATA.openapiUrl,
] as const;

describe("external client guide", () => {
  it("publishes a complete guide in docs/api.md", () => {
    const apiDocs = readProjectFile("docs/api.md");

    for (const marker of GUIDE_MARKERS) {
      expect(apiDocs).toContain(marker);
    }
    for (const profile of CLIENT_PROFILES) {
      expect(apiDocs).toContain(profile);
    }

    expect(apiDocs).toContain("curl 'https://spoonjoy.app/api/v1/recipes");
    expect(apiDocs).toContain("curl 'https://spoonjoy.app/api/v1/cookbooks");
    expect(apiDocs).toContain("POST /api/v1/tokens");
    expect(apiDocs).toContain('fetch("/api/v1/shopping-list"');
    expect(apiDocs).toContain("grant_type=authorization_code");
    expect(apiDocs).toContain("access_token: \"sj_...\"");
    expect(apiDocs).toContain("https://spoonjoy.app/api/playground");
    expect(apiDocs).toContain("curl -fsS 'https://spoonjoy.app/api/v1/shopping-list/sync");
    expect(apiDocs).toContain("curl -fsS -X POST 'https://spoonjoy.app/api/v1/shopping-list/items'");
    expect(apiDocs).toContain(scopesFor("POST", "/api/v1/tokens")[0]);
    expect(apiDocs).toContain(scopesFor("GET", "/api/v1/shopping-list/sync")[0]);
    expect(apiDocs).toContain(scopesFor("POST", "/api/v1/shopping-list/items")[0]);
    expect(apiDocs).not.toContain("sj_owner_token");
    expect(apiDocs).not.toMatch(/pebble/i);
  });

  it("renders the same guide on /developers", async () => {
    const data = loader({} as any);
    const Stub = createTestRoutesStub([
      { path: "/developers", Component: Developers, loader: () => data },
    ]);

    render(createElement(Stub, { initialEntries: ["/developers"] }));
    await screen.findByRole("heading", { name: "Spoonjoy Developer Platform" });
    const renderedText = document.body.textContent ?? "";

    for (const marker of GUIDE_MARKERS) {
      expect(renderedText).toContain(marker);
    }
    for (const profile of CLIENT_PROFILES) {
      expect(renderedText).toContain(profile);
    }

    expect(renderedText).toContain("GET /api/v1/recipes");
    expect(renderedText).toContain("GET /api/v1/cookbooks");
    expect(renderedText).toContain("POST /api/v1/tokens");
    expect(renderedText).toContain("Generated operation: POST /api/v1/tokens");
    expect(renderedText).toContain('fetch("/api/v1/shopping-list"');
    expect(renderedText).toContain("grant_type=authorization_code");
    expect(renderedText).toContain("Response: { \"ok\": true");
    expect(renderedText).toContain("GET /api/v1/shopping-list/sync");
    expect(renderedText).toContain("POST /api/v1/shopping-list/items");
    expect(renderedText).toContain(scopesFor("POST", "/api/v1/tokens")[0]);
    expect(renderedText).toContain(scopesFor("GET", "/api/v1/shopping-list/sync")[0]);
    expect(renderedText).toContain(scopesFor("POST", "/api/v1/shopping-list/items")[0]);
    expect(renderedText).not.toContain("sj_owner_token");
    expect(document.body).not.toHaveTextContent(/pebble/i);
  });
});
