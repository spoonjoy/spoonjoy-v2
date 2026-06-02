import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import routes from "~/routes";
import Developers, { loader, meta } from "~/routes/developers";
import {
  API_V1_ERROR_STATUS,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
} from "~/lib/api-v1-contract.server";
import { createTestRoutesStub } from "../utils";

describe("/developers route", () => {
  it("is registered as the public developer docs page", () => {
    const routeConfig = JSON.stringify(routes);

    expect(routeConfig).toContain("developers");
    expect(routeConfig).toContain("routes/developers.tsx");
    expect(routeConfig.indexOf("developers")).toBeLessThan(routeConfig.indexOf("api/v1/*"));
  });

  it("exposes serializable docs data from the v1 contract", () => {
    const data = loader({} as any);

    expect(data.resources).toEqual(API_V1_RESOURCES);
    expect(data.scopeRequirements).toEqual(API_V1_SCOPE_REQUIREMENTS);
    expect(data.errorStatus).toEqual(API_V1_ERROR_STATUS);
    expect(data.openapiUrl).toBe("/api/v1/openapi.json");
    expect(data.scopes).toEqual([
      "public:read",
      "recipes:read",
      "cookbooks:read",
      "shopping_list:read",
      "shopping_list:write",
      "tokens:read",
      "tokens:write",
      "offline_access",
    ]);
  });

  it("declares developer-focused metadata", () => {
    expect(meta({} as any)).toEqual([
      { title: "Spoonjoy Developer Platform | Spoonjoy" },
      {
        name: "description",
        content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, session auth, and bearer credentials.",
      },
    ]);
  });

  it("renders the API reference, auth model, and integration guidance without Pebble-specific framing", async () => {
    const data = loader({} as any);
    const Stub = createTestRoutesStub([
      { path: "/developers", Component: Developers, loader: () => data },
    ]);

    render(<Stub initialEntries={["/developers"]} />);

    expect(await screen.findByRole("heading", { name: "Spoonjoy Developer Platform" })).toBeInTheDocument();
    expect(screen.getByText(/public-by-default Chef graph/i)).toBeInTheDocument();
    expect(screen.getByText("Client examples")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Tiny-device clients/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Token Acquisition" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No token: signed-in browser" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Personal token: signed-in chef creates one" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delegated token: OAuth/PKCE" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delegated token: approval link" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No password-token API" })).toBeInTheDocument();
    expect(screen.getByText(/password, passkey, or any configured Google, GitHub, or Apple provider/i)).toBeInTheDocument();
    expect(screen.getByText(/existing bearer credential with tokens:write/i)).toBeInTheDocument();
    expect(screen.getByText(/Those provider buttons are Spoonjoy sign-in methods/i)).toBeInTheDocument();
    expect(screen.getByText(/The client never handles the chef's password/i)).toBeInTheDocument();
    expect(screen.getByText(/Spoonjoy does not support an OAuth password grant/i)).toBeInTheDocument();
    expect(screen.getByText(/Email\/password login creates a session cookie, not an API token/i)).toBeInTheDocument();
    expect(screen.getByText(/grant_type=password/i)).toBeInTheDocument();
    expect(screen.getByText(/Response: \{ "token": "sj_\.\.\." \}/i)).toBeInTheDocument();
    expect(screen.getAllByText(/POST \/api\/tools\/start_agent_connection/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/POST \/api\/tools\/poll_agent_connection/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Auth Implementation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Same-origin browser session" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "External REST client" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OAuth/PKCE app" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Auth failures" })).toBeInTheDocument();
    expect(screen.getByText(/Do not send Authorization/i)).toBeInTheDocument();
    expect(screen.getByText(/bearer auth wins over the session/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot create a token with broader scopes/i)).toBeInTheDocument();
    expect(screen.getByText(/token_endpoint_auth_method: none/i)).toBeInTheDocument();
    expect(screen.getByText(/no client secret/i)).toBeInTheDocument();
    expect(screen.getAllByText(/kitchen:read/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/single-use 60-second code/i)).toBeInTheDocument();
    expect(screen.getByText(/access_token lasts 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Content-Type: application\/x-www-form-urlencoded/i)).toBeInTheDocument();
    expect(screen.getByText(/refresh_token rotates/i)).toBeInTheDocument();
    expect(screen.getByText(/validation_error/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid_token/i)).toBeInTheDocument();
    expect(screen.getAllByText(/insufficient_scope/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/X-Request-Id/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Spoonjoy session" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bearer credentials" })).toBeInTheDocument();
    expect(screen.getByText(/OAuth\/PKCE apps/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP clients/i)).toBeInTheDocument();
    expect(screen.getByText(/Delegated and device-style authorization/i)).toBeInTheDocument();
    expect(screen.getByText(/Idempotent shopping-list mutations/i)).toBeInTheDocument();
    expect(screen.getByText(/cursor sync/i)).toBeInTheDocument();
    expect(screen.getByText(/tombstones/i)).toBeInTheDocument();
    expect(screen.getByText(/rate limited by IP and credential/i)).toBeInTheDocument();

    const openApiLink = screen.getByRole("link", { name: /OpenAPI JSON/i });
    expect(openApiLink).toHaveAttribute("href", "/api/v1/openapi.json");

    for (const resource of API_V1_RESOURCES) {
      expect(screen.getByText(resource.path)).toBeInTheDocument();
    }

    for (const scope of data.scopes) {
      expect(screen.getByText(scope)).toBeInTheDocument();
    }

    const tokenEndpoint = screen.getByTestId("developer-resource-tokens");
    expect(within(tokenEndpoint).getByText("GET")).toBeInTheDocument();
    expect(within(tokenEndpoint).getByText("POST")).toBeInTheDocument();
    expect(within(tokenEndpoint).getByText("tokens:read")).toBeInTheDocument();
    expect(within(tokenEndpoint).getByText("tokens:write")).toBeInTheDocument();

    expect(screen.getAllByText(/clientMutationId/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/shopping_list:write/i).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(/pebble/i);
  });
});
