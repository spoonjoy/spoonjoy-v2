import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import routes from "~/routes";
import Developers, { loader, meta } from "~/routes/developers";
import {
  API_V1_ERROR_STATUS,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
} from "~/lib/api-v1-contract.server";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";
import { createTestRoutesStub } from "../utils";

const { posthogCapture, usePostHogMock } = vi.hoisted(() => ({
  posthogCapture: vi.fn(),
  usePostHogMock: vi.fn(),
}));

vi.mock("@posthog/react", () => ({
  usePostHog: usePostHogMock,
}));

describe("/developers route", () => {
  beforeEach(() => {
    usePostHogMock.mockReturnValue({ capture: posthogCapture });
  });

  afterEach(() => {
    posthogCapture.mockClear();
    usePostHogMock.mockReset();
  });

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
    expect(data.sdkOpenapiUrl).toBe("/api/v1/openapi.sdk.json");
    expect(data.connectorOpenapiUrl).toBe("/api/v1/openapi.connector.json");
    expect(data.canonicalUrl).toBe("https://spoonjoy.app/api");
    expect(data.ogImageUrl).toBe("https://spoonjoy.app/og/pages/api.png");
    expect(data.scopes).toEqual([
      "public:read",
      "account:read",
      "account:write",
      "kitchen:read",
      "kitchen:write",
      "recipes:read",
      "cookbooks:read",
      "shopping_list:read",
      "shopping_list:write",
      "tokens:read",
      "tokens:write",
    ]);
  });

  it("uses the configured public origin for docs OG URLs", () => {
    const data = loader({
      request: new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/developers"),
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
    } as any);

    expect(data.canonicalUrl).toBe("https://spoonjoy.app/api");
    expect(data.ogImageUrl).toBe("https://spoonjoy.app/og/pages/api.png");
  });

  it("declares developer-focused metadata", () => {
    const data = loader({ request: new Request("https://local.spoonjoy.test/developers") });

    expect(meta({ data } as any)).toEqual([
      { title: "Spoonjoy Developer Platform | Spoonjoy" },
      {
        name: "description",
        content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, session auth, and bearer credentials.",
      },
      { property: "og:site_name", content: "Spoonjoy" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Spoonjoy Developer Platform" },
      {
        property: "og:description",
        content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, session auth, and bearer credentials.",
      },
      { property: "og:url", content: "https://local.spoonjoy.test/api" },
      { property: "og:image", content: "https://local.spoonjoy.test/og/pages/api.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/svg+xml" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Spoonjoy Developer Platform" },
      {
        name: "twitter:description",
        content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, session auth, and bearer credentials.",
      },
      { name: "twitter:image", content: "https://local.spoonjoy.test/og/pages/api.png" },
    ]);
  });

  it("falls back to production developer metadata when loader data is unavailable", () => {
    expect(meta()).toEqual(expect.arrayContaining([
      { property: "og:url", content: "https://spoonjoy.app/api" },
      { property: "og:image", content: "https://spoonjoy.app/og/pages/api.png" },
      { name: "twitter:image", content: "https://spoonjoy.app/og/pages/api.png" },
    ]));
  });

  it("does not capture docs view telemetry without a PostHog client", async () => {
    usePostHogMock.mockReturnValue(null);
    const data = loader({} as any);
    const Stub = createTestRoutesStub([
      { path: "/developers", Component: Developers, loader: () => data },
    ]);

    render(<Stub initialEntries={["/developers"]} />);

    expect(await screen.findByRole("heading", { name: "Spoonjoy Developer Platform" })).toBeInTheDocument();
    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it("captures a safe docs view event without leaking docs prose or URLs", async () => {
    const data = loader({} as any);
    const Stub = createTestRoutesStub([
      { path: "/developers", Component: Developers, loader: () => data },
    ]);

    render(<Stub initialEntries={["/developers"]} />);

    await waitFor(() => expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.docs.viewed",
      expect.objectContaining({
        page: "api_docs",
        operation_count: API_V1_PLAYGROUND_MANIFEST.operations.length,
        auth_flow_count: API_V1_PLAYGROUND_MANIFEST.authFlows.length,
        client_scenario_count: API_V1_PLAYGROUND_MANIFEST.clientScenarios.length,
      }),
    ));
    const serialized = JSON.stringify(posthogCapture.mock.calls);
    expect(serialized).not.toContain("grant_type=password");
    expect(serialized).not.toContain("https://spoonjoy.app/api/playground");
    expect(serialized).not.toContain("sj_");
    expect(serialized).not.toContain("clientMutationId");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("query=");
    expect(serialized).not.toContain("body");
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
    expect(screen.getByRole("link", { name: /Tiny-device clients/i })).toHaveAttribute("href", "#scenario-quickstarts");
    expect(screen.getByRole("heading", { name: "Token Acquisition" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No token: signed-in browser" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Personal token: signed-in chef creates one" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delegated token: OAuth/PKCE" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delegated token: approval link" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "First-party native token: Spoonjoy Apple app sign-in" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No third-party password-token API" })).toBeInTheDocument();
    expect(screen.getByText(/password, passkey, or any configured Google, GitHub, or Apple provider/i)).toBeInTheDocument();
    expect(screen.getByText(/existing bearer credential with tokens:write/i)).toBeInTheDocument();
    expect(screen.getByText(/Those provider buttons are Spoonjoy sign-in methods/i)).toBeInTheDocument();
    expect(screen.getByText(/The client never handles the chef's password/i)).toBeInTheDocument();
    expect(screen.getByText(/Spoonjoy does not support an OAuth password grant/i)).toBeInTheDocument();
    expect(screen.getByText(/Browser email\/password login creates a session cookie, not an API token/i)).toBeInTheDocument();
    expect(screen.getByText(/only password-to-token exception is Spoonjoy's own native Apple app endpoint/i)).toBeInTheDocument();
    expect(screen.getAllByText(/grant_type=password/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Response: \{ "ok": true, "data": \{ "token": "sj_\.\.\."/i)).toBeInTheDocument();
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
    expect(screen.getAllByText(/token_endpoint_auth_method: none/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no client secret/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/kitchen:read/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/single-use 60-second code/i)).toBeInTheDocument();
    expect(screen.getByText(/Generic OAuth access tokens last 15 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP-bound access tokens stay active until disconnect/i)).toBeInTheDocument();
    expect(screen.getByText(/omit expires_in/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Content-Type: application\/x-www-form-urlencoded/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/refresh_token rotates/i)).toBeInTheDocument();
    expect(screen.getByText(/validation_error/i)).toBeInTheDocument();
    expect(screen.getAllByText(/invalid_token/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/insufficient_scope/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/X-Request-Id/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Spoonjoy session" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bearer credentials" })).toBeInTheDocument();
    expect(screen.getByText(/OAuth\/PKCE apps/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP clients/i)).toBeInTheDocument();
    expect(screen.getByText(/Delegated and device-style authorization/i)).toBeInTheDocument();
    expect(screen.getByText(/API v1 REST response shape/i)).toBeInTheDocument();
    expect(screen.getByText(/Protocol exceptions/i)).toBeInTheDocument();
    expect(screen.getByText(/Idempotent owner mutations/i)).toBeInTheDocument();
    expect(screen.getByText(/account profile, profile photo, notification preferences/i)).toBeInTheDocument();
    expect(screen.getByText(/cookbook writes/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recipe spoon endpoints" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Manage owner recipe covers" })).toBeInTheDocument();
    expect(screen.getAllByText(/recipe-cover management/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/cursor sync/i)).toBeInTheDocument();
    expect(screen.getAllByText(/tombstones/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/rate limited by IP and credential/i)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Full Spec/i })).toHaveAttribute("href", "/api/v1/openapi.json");
    expect(screen.getByRole("link", { name: /SDK Spec/i })).toHaveAttribute("href", "/api/v1/openapi.sdk.json");
    expect(screen.getByRole("link", { name: /Connector Spec/i })).toHaveAttribute("href", "/api/v1/openapi.connector.json");

    for (const resource of API_V1_RESOURCES) {
      expect(screen.getAllByText(resource.path).length).toBeGreaterThan(0);
    }

    for (const scope of data.scopes) {
      expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("offline_access")).not.toBeInTheDocument();

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
