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
        content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, and scoped tokens.",
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
    expect(screen.getByText(/Personal API tokens/i)).toBeInTheDocument();
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

    expect(screen.getByText(/clientMutationId/i)).toBeInTheDocument();
    expect(screen.getByText(/shopping_list:write/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/pebble/i);
  });
});
