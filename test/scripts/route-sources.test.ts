import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contextRouteImports, inlineContextRoutes } from "../../scripts/route-sources.mjs";

const OWN_ROUTES_CEILING = 84;

const ROUTES = `import { type RouteConfig, index, route } from "@react-router/dev/routes";
import planningRoutes from "./route-config/planning/routes";
import kitchenRoutes from "./route-config/kitchen/routes";
import other from "./somewhere-else";

export default [
  index("routes/_index.tsx"),
  ...planningRoutes,
  ...kitchenRoutes,
  route("*", "routes/$.tsx"),
] satisfies RouteConfig;
`;

const PLANNING = `import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("plan", "routes/plan.tsx"),
  route("plan/:week", "routes/plan.$week.tsx"),
] satisfies RouteConfig;
`;

const EMPTY = `import type { RouteConfig } from "@react-router/dev/routes";

export default [] satisfies RouteConfig;
`;

describe("contextRouteImports", () => {
  it("lists the context route files routes.ts imports, resolved beside it", () => {
    expect(contextRouteImports(ROUTES, "app/routes.ts")).toEqual([
      { name: "planningRoutes", file: "app/route-config/planning/routes.ts" },
      { name: "kitchenRoutes", file: "app/route-config/kitchen/routes.ts" },
    ]);
  });
});

describe("inlineContextRoutes", () => {
  const sources = {
    "app/route-config/planning/routes.ts": PLANNING,
    "app/route-config/kitchen/routes.ts": EMPTY,
  };

  it("replaces each context spread with that context's route() calls", () => {
    const inlined = inlineContextRoutes(ROUTES, "app/routes.ts", sources);
    expect(inlined).toContain('route("plan", "routes/plan.tsx"),\nroute("plan/:week", "routes/plan.$week.tsx"),');
    expect(inlined).not.toContain("...planningRoutes");
    expect(inlined).not.toContain("...kitchenRoutes");
    expect(inlineContextRoutes(ROUTES, "app/routes.ts", new Map(Object.entries(sources)))).toBe(inlined);
  });

  it("fails on a context file it was not given, or one that exports no array", () => {
    expect(() => inlineContextRoutes(ROUTES, "app/routes.ts", {})).toThrow("app/routes.ts imports app/route-config/planning/routes.ts, which was not read.");
    expect(() => inlineContextRoutes(ROUTES, "app/routes.ts", { ...sources, "app/route-config/planning/routes.ts": "export const x = 1;" })).toThrow(
      "app/route-config/planning/routes.ts must export default an array of route() calls.",
    );
  });
});

describe("app/routes.ts", () => {
  // New routes go in their context's file under app/route-config/, so two pull requests that add
  // routes to different contexts never edit the same lines. This count may only go down.
  it("lists no more routes of its own than it did when the context files arrived", () => {
    const source = readFileSync("app/routes.ts", "utf8");
    const own = source.split("\n").filter((line) => /^\s{2}(route|index|layout)\(/.test(line));
    expect(own.length).toBeLessThanOrEqual(OWN_ROUTES_CEILING);
    expect(contextRouteImports(source, "app/routes.ts").map(({ file }) => file)).toContain("app/route-config/planning/routes.ts");
  });
});
