import { describe, expect, it } from "vitest";
import routes from "~/routes";
import { action, loader } from "~/routes/api.docs";
import * as openapiRedirect from "~/routes/api.openapi";
import * as playgroundRedirect from "~/routes/api.playground";

function routeArgs(url: string) {
  return { request: new Request(url) };
}

describe("developer docs API aliases", () => {
  it("registers docs aliases before the legacy /api/* catch-all", () => {
    const routeConfig = JSON.stringify(routes);
    const legacyApiIndex = routeConfig.indexOf("api/*");

    for (const alias of [
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
    ["/api/docs", "/developers"],
    ["/api/docs/auth", "/developers"],
    ["/api/developer", "/developers"],
    ["/api/developers", "/developers"],
    ["/api/developers/scopes?from=wearable", "/developers?from=wearable"],
  ])("redirects %s to %s", (from, to) => {
    const response = loader(routeArgs(`https://spoonjoy.app${from}`));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(to);
  });

  it("redirects mutation methods too so docs aliases never fall through to the legacy API dispatcher", () => {
    const response = action(routeArgs("https://spoonjoy.app/api/docs"));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/developers");
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

  it.each(["/api/playground", "/api/try"])("redirects %s to the developer playground", (from) => {
    const response = playgroundRedirect.loader(routeArgs(`https://spoonjoy.app${from}`));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/developers/playground");
  });

  it("redirects playground mutation methods to the playground too", () => {
    const response = playgroundRedirect.action(routeArgs("https://spoonjoy.app/api/playground"));

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/developers/playground");
  });
});
