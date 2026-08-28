import { describe, expect, it } from "vitest";
import routes from "~/routes";

type RouteEntry = { path?: string; children?: readonly RouteEntry[] };

function routePaths(config: readonly RouteEntry[]): string[] {
  return config.flatMap((entry) => [entry.path, ...routePaths(entry.children ?? [])])
    .filter((path): path is string => typeof path === "string");
}

describe("OAuth route contract", () => {
  it("exposes /oauth/authorize and leaves the reported /authorize path absent", () => {
    const paths = routePaths(routes as readonly RouteEntry[]);
    expect(paths).toContain("oauth/authorize");
    expect(paths).not.toContain("authorize");
  });
});
