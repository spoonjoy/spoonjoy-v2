import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_V1_RESOURCES, API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";

describe("API v1 route coverage config", () => {
  it("covers TypeScript route modules in coverage reports", () => {
    const config = readFileSync(resolve(__dirname, "..", "..", "vitest.config.ts"), "utf8");

    expect(config).toMatch(/["']app\/routes\/\*\*\/\*\.ts["']/);
  });

  it("registers every private saved-recipe method, scope, and playground operation", () => {
    expect(API_V1_RESOURCES).toEqual(expect.arrayContaining([
      {
        name: "saved-recipes",
        path: "/api/v1/saved-recipes",
        methods: ["GET"],
        auth: "bearer",
        scopes: ["kitchen:read"],
      },
      {
        name: "saved-recipe",
        path: "/api/v1/saved-recipes/{recipeId}",
        methods: ["PUT", "DELETE"],
        auth: "bearer",
        scopes: ["kitchen:write"],
      },
    ]));
    expect(API_V1_SCOPE_REQUIREMENTS).toEqual(expect.arrayContaining([
      { path: "/api/v1/saved-recipes", method: "GET", auth: "bearer", scopes: ["kitchen:read"] },
      { path: "/api/v1/saved-recipes/{recipeId}", method: "PUT", auth: "bearer", scopes: ["kitchen:write"] },
      { path: "/api/v1/saved-recipes/{recipeId}", method: "DELETE", auth: "bearer", scopes: ["kitchen:write"] },
    ]));
    expect(API_V1_PLAYGROUND_MANIFEST.operations.map((operation) => operation.id)).toEqual(expect.arrayContaining([
      "GET /api/v1/saved-recipes",
      "PUT /api/v1/saved-recipes/{recipeId}",
      "DELETE /api/v1/saved-recipes/{recipeId}",
    ]));
  });
});
