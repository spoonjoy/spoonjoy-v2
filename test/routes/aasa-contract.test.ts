import { describe, expect, it } from "vitest";
import routes from "../../app/routes";
import {
  APPLE_APP_LINK_COMPONENTS,
  APPLE_BUNDLE_IDS,
  WEB_ROUTE_MANIFEST,
  appleTeamID,
  buildAppleAppSiteAssociation,
  type WebRouteCategory,
} from "~/lib/web-route-manifest.server";
import { loader } from "~/routes/well-known.apple-app-site-association";

const ALLOWED_CATEGORIES = new Set<WebRouteCategory>([
  "user-product",
  "secure-web-handoff",
  "api-or-oauth",
  "developer-resource",
  "platform-asset",
  "intentional-exclude",
]);

type RouteConfigEntry = {
  file?: string;
  index?: boolean;
  path?: string;
  children?: readonly RouteConfigEntry[];
};

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function urlPatternFromParts(parts: string[]) {
  const path = parts.filter(Boolean).join("/");
  return `/${path}` as `/${string}`;
}

function routeEntriesFromRoutesConfig(
  entries: readonly RouteConfigEntry[] = routes as readonly RouteConfigEntry[],
  parentParts: string[] = [],
) {
  return entries.flatMap((entry) => {
    const routeParts = entry.index ? parentParts : [...parentParts, entry.path ?? ""];
    const current = entry.file
      ? [{ routeFile: entry.file, urlPattern: urlPatternFromParts(routeParts) }]
      : [];
    return [
      ...current,
      ...routeEntriesFromRoutesConfig(entry.children ?? [], routeParts),
    ];
  });
}

function groupRoutesByUrlPattern() {
  const groups = new Map<string, typeof WEB_ROUTE_MANIFEST[number][]>();
  for (const route of WEB_ROUTE_MANIFEST) {
    groups.set(route.urlPattern, [...(groups.get(route.urlPattern) ?? []), route]);
  }
  return groups;
}

function componentCoversRoute(componentPath: string, routePattern: string) {
  if (componentPath.endsWith("/*")) {
    const base = componentPath.slice(0, -1);
    return routePattern.startsWith(base);
  }
  return componentPath === routePattern;
}

describe("Apple app-site-association and route classification contract", () => {
  it("classifies every React Router module and URL pattern exactly once", () => {
    const configuredRoutes = routeEntriesFromRoutesConfig()
      .sort((left, right) => left.routeFile.localeCompare(right.routeFile));
    const manifestRoutes = WEB_ROUTE_MANIFEST
      .map(({ routeFile, urlPattern }) => ({ routeFile, urlPattern }))
      .sort((left, right) => left.routeFile.localeCompare(right.routeFile));
    const manifestRouteFiles = WEB_ROUTE_MANIFEST.map((route) => route.routeFile).sort();
    const uniqueManifestRouteFiles = new Set(manifestRouteFiles);
    const uniqueRouteIds = new Set(WEB_ROUTE_MANIFEST.map((route) => route.routeId));

    expect(manifestRoutes).toEqual(configuredRoutes);
    expect(uniqueManifestRouteFiles.size).toBe(WEB_ROUTE_MANIFEST.length);
    expect(uniqueRouteIds.size).toBe(WEB_ROUTE_MANIFEST.length);
    expect(WEB_ROUTE_MANIFEST.every((route) => ALLOWED_CATEGORIES.has(route.category))).toBe(true);
    expect(WEB_ROUTE_MANIFEST.every((route) => route.urlPattern.startsWith("/"))).toBe(true);
  });

  it("keeps duplicate URL patterns limited to layout/index coalescing", () => {
    const duplicates = groupRoutesByUrlPattern();
    const duplicatedPatterns = [...duplicates]
      .filter(([, routes]) => routes.length > 1)
      .map(([urlPattern]) => urlPattern)
      .sort();

    expect(duplicatedPatterns).toEqual(["/cookbooks", "/recipes"]);
    for (const urlPattern of duplicatedPatterns) {
      const routes = duplicates.get(urlPattern) ?? [];
      expect(new Set(routes.map((route) => route.category))).toEqual(new Set(["user-product"]));
      expect(new Set(routes.map((route) => route.universalLink))).toEqual(new Set([true]));
      expect(new Set(routes.map((route) => route.publicShareable))).toEqual(new Set([false]));
    }
  });

  it("limits public shareable web routes to current public recipe and cookbook object pages", () => {
    const shareablePatterns = WEB_ROUTE_MANIFEST
      .filter((route) => route.publicShareable)
      .map((route) => route.urlPattern)
      .sort();

    expect(shareablePatterns).toEqual(["/cookbooks/:id", "/recipes/:id"]);
    expect(WEB_ROUTE_MANIFEST.some((route) => route.urlPattern === "/capture")).toBe(false);
    expect(WEB_ROUTE_MANIFEST.some((route) => route.urlPattern === "/import")).toBe(false);
  });

  it("publishes universal-link components for current native web routes without claiming native-only actions", () => {
    const componentPaths = APPLE_APP_LINK_COMPONENTS.map((component) => component["/"]);
    const componentKeys = new Set(APPLE_APP_LINK_COMPONENTS.map(canonical));

    expect(componentKeys.has(canonical({ "/": "/search" }))).toBe(true);
    expect(componentKeys.has(canonical({ "/": "/search", "?": { "*": "*" } }))).toBe(true);
    expect(componentPaths).toEqual([
      "/",
      "/recipes",
      "/recipes/*",
      "/cookbooks",
      "/cookbooks/*",
      "/users/*",
      "/shopping-list",
      "/search",
      "/search",
      "/recipes/new",
      "/account/settings",
      "/oauth/callback",
      "/oauth/callback",
    ]);
    expect(componentKeys.has(canonical({ "/": "/oauth/callback" }))).toBe(true);
    expect(componentKeys.has(canonical({ "/": "/oauth/callback", "?": { "*": "*" } }))).toBe(true);
    expect(componentPaths).not.toContain("/capture");
    expect(componentPaths).not.toContain("/import");
    expect(componentPaths).not.toContain("/api/*");
    expect(componentPaths).not.toContain("/oauth/*");
    expect(componentPaths).not.toContain("/.well-known/*");
  });

  it("keeps every universal-link route covered by a published component", () => {
    const uncoveredRoutes = WEB_ROUTE_MANIFEST
      .filter((route) => route.universalLink)
      .filter((route) => !APPLE_APP_LINK_COMPONENTS.some((component) => componentCoversRoute(component["/"], route.urlPattern)))
      .map(({ routeFile, urlPattern }) => ({ routeFile, urlPattern }));
    const orphanComponents = APPLE_APP_LINK_COMPONENTS
      .filter((component) => !WEB_ROUTE_MANIFEST.some((route) => route.universalLink && componentCoversRoute(component["/"], route.urlPattern)))
      .map((component) => component["/"]);

    expect(uncoveredRoutes).toEqual([]);
    expect(orphanComponents).toEqual([]);
  });

  it("builds AASA JSON with configured team IDs and the bare search component", () => {
    expect(appleTeamID({ APPLE_TEAM_ID: "abcde12345" })).toBe("ABCDE12345");
    expect(() => appleTeamID({ APPLE_TEAM_ID: "not-a-team" })).toThrow(/10-character/);
    expect(() => appleTeamID({ APPLE_TEAM_ID: "   " })).toThrow(/required/);
    expect(() => appleTeamID({})).toThrow(/required/);
    expect(() => appleTeamID(null)).toThrow(/required/);

    const aasa = buildAppleAppSiteAssociation({ APPLE_TEAM_ID: "abcde12345" });
    const details = aasa.applinks.details[0];

    expect(details.appIDs).toEqual(APPLE_BUNDLE_IDS.map((bundleID) => `ABCDE12345.${bundleID}`));
    expect(details.components).toEqual(APPLE_APP_LINK_COMPONENTS);
  });

  it("serves the AASA response as cacheable JSON", async () => {
    const response = loader({
      context: { cloudflare: { env: { APPLE_TEAM_ID: "ZYXWV98765" } } },
    } as never);
    const body = await response.json();

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(body.applinks.details[0].appIDs).toEqual(
      APPLE_BUNDLE_IDS.map((bundleID) => `ZYXWV98765.${bundleID}`),
    );

    expect(() => loader({ context: {} } as never)).toThrow(/APPLE_TEAM_ID/);
  });
});
