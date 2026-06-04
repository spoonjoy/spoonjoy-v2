import { describe, expect, it } from "vitest";
import routes from "~/routes";
import { action, loader } from "~/routes/api.docs";
import * as apiDocs from "~/routes/api";
import * as openapiRedirect from "~/routes/api.openapi";
import * as playground from "~/routes/api.playground";
import * as tryPlayground from "~/routes/api.try";

function routeArgs(url: string) {
  return { request: new Request(url) };
}

describe("developer docs API aliases", () => {
  it("registers docs aliases before the legacy /api/* catch-all", () => {
    const routeConfig = JSON.stringify(routes);
    const legacyApiIndex = routeConfig.indexOf("api/*");

    for (const alias of [
      "api",
      "api/docs",
      "api/docs/*",
      "api/developer",
      "api/developer/*",
      "api/developers",
      "api/developers/*",
      "api/playground",
      "api/try",
      "api/openapi",
      "api/openapi.json",
      "api/spec",
    ]) {
      expect(routeConfig.indexOf(alias)).toBeGreaterThanOrEqual(0);
      expect(routeConfig.indexOf(alias)).toBeLessThan(legacyApiIndex);
    }
  });

  it.each([
    ["/api/docs", "/api"],
    ["/api/docs/auth", "/api"],
    ["/api/developer", "/api"],
    ["/api/developers", "/api"],
    ["/api/developers/scopes?from=wearable", "/api?from=wearable"],
  ])("redirects %s to %s", (from, to) => {
    const response = loader(routeArgs(`https://spoonjoy.app${from}`));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(to);
  });

  it("redirects mutation methods too so docs aliases never fall through to the legacy API dispatcher", () => {
    const response = action(routeArgs("https://spoonjoy.app/api/docs"));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/api");
  });

  it.each(["/api/openapi", "/api/openapi.json", "/api/spec"])("redirects %s to the machine-readable OpenAPI spec", (from) => {
    const response = openapiRedirect.loader(routeArgs(`https://spoonjoy.app${from}`));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/api/v1/openapi.json");
  });

  it("redirects spec mutation methods to the OpenAPI document too", () => {
    const response = openapiRedirect.action(routeArgs("https://spoonjoy.app/api/spec"));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/api/v1/openapi.json");
  });

  it("renders the canonical docs and playground modules directly under /api", async () => {
    expect(apiDocs.loader({} as any).resources.length).toBeGreaterThan(0);
    expect((await playground.loader()).manifest.operations.length).toBeGreaterThan(0);
    expect((await tryPlayground.loader()).manifest.operations.length).toBeGreaterThan(0);
  });
});
