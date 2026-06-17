import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_V1_RESOURCES, API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import {
  endpointKey,
  NATIVE_REST_ENDPOINT_SCOPE,
  NON_REST_ENDPOINT_SCOPE,
} from "./api-v1-native-endpoint-scope";

function registeredResourceOperations() {
  return new Map(
    API_V1_RESOURCES.flatMap((resource) => (
      resource.methods.map((method) => [
        endpointKey({ method, path: resource.path }),
        { auth: resource.auth },
      ] as const)
    )),
  );
}

function registeredScopeRequirements() {
  return new Map(
    API_V1_SCOPE_REQUIREMENTS.map((requirement) => [
      endpointKey(requirement),
      { auth: requirement.auth, scopes: [...requirement.scopes] },
    ] as const),
  );
}

describe("API v1 route coverage config", () => {
  it("covers TypeScript route modules in coverage reports", () => {
    const config = readFileSync(resolve(__dirname, "..", "..", "vitest.config.ts"), "utf8");

    expect(config).toMatch(/["']app\/routes\/\*\*\/\*\.ts["']/);
  });

  it("keeps the REST registry aligned with the accepted native Endpoint Scope", () => {
    const resourceOperations = registeredResourceOperations();
    const scopeRequirements = registeredScopeRequirements();

    expect(
      NATIVE_REST_ENDPOINT_SCOPE
        .filter((row) => !resourceOperations.has(endpointKey(row)))
        .map(endpointKey),
    ).toEqual([]);
    expect(
      NATIVE_REST_ENDPOINT_SCOPE
        .filter((row) => resourceOperations.get(endpointKey(row))?.auth !== row.auth)
        .map((row) => ({
          operation: endpointKey(row),
          expectedAuth: row.auth,
          actualAuth: resourceOperations.get(endpointKey(row))?.auth ?? null,
        })),
    ).toEqual([]);
    expect(
      NATIVE_REST_ENDPOINT_SCOPE
        .filter((row) => !scopeRequirements.has(endpointKey(row)))
        .map(endpointKey),
    ).toEqual([]);
    expect(
      NATIVE_REST_ENDPOINT_SCOPE
        .filter((row) => {
          const actual = scopeRequirements.get(endpointKey(row));
          return !actual || actual.auth !== row.auth || JSON.stringify(actual.scopes) !== JSON.stringify(row.scopes);
        })
        .map((row) => ({
          operation: endpointKey(row),
          expected: { auth: row.auth, scopes: row.scopes },
          actual: scopeRequirements.get(endpointKey(row)) ?? null,
        })),
    ).toEqual([]);
  });

  it("keeps non-REST link and well-known routes out of the REST registry", () => {
    const resourceOperations = registeredResourceOperations();
    const scopeRequirements = registeredScopeRequirements();

    for (const row of NON_REST_ENDPOINT_SCOPE) {
      expect(resourceOperations.has(endpointKey(row))).toBe(false);
      expect(scopeRequirements.has(endpointKey(row))).toBe(false);
    }
  });
});
