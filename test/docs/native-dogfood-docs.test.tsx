import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Developers, { loader } from "~/routes/developers";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";
import {
  buildApiV1ConnectorOpenApiDocument,
  buildApiV1SdkOpenApiDocument,
} from "~/lib/api-v1-openapi.server";
import { createTestRoutesStub } from "../utils";

function readProjectFile(path: string) {
  return readFileSync(resolve(__dirname, "..", "..", path), "utf8");
}

function markdownSection(markdown: string, heading: string) {
  const start = markdown.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextHeading = markdown.indexOf("\n### ", start + heading.length);
  return nextHeading === -1 ? markdown.slice(start) : markdown.slice(start, nextHeading);
}

function expectContainsAll(text: string, markers: readonly string[]) {
  const missing = markers.filter((marker) => !text.includes(marker));
  expect(missing).toEqual([]);
}

function expectOmitsAll(text: string, markers: readonly string[]) {
  const present = markers.filter((marker) => text.includes(marker));
  expect(present).toEqual([]);
}

const apiDocs = readProjectFile("docs/api.md");

const NATIVE_QUICKSTART_MARKERS = [
  "Spoonjoy Apple native dogfood quickstart",
  "https://spoonjoy.app/oauth/callback",
  "applinks:spoonjoy.app",
  "ASWebAuthenticationSession.Callback.https(host: \"spoonjoy.app\", path: \"/oauth/callback\")",
  "custom URL scheme is for app navigation only, not OAuth",
  "persist client_id in Keychain",
  "persist access_token and refresh_token in Keychain",
  "clear state and code_verifier after a successful token exchange",
  "replace the stored refresh token atomically",
  "single-flight refresh",
  "decode Spoonjoy REST envelopes",
] as const;

const OFFLINE_PRODUCT_CONTRACT_MARKERS = [
  "Offline Product Contract",
  "accountId",
  "environment",
  "schemaVersion",
  "fetchedAt",
  "lastValidatedAt",
  "sourceEndpoint",
  "server revision marker",
  "15 minutes",
  "6 hours",
  "24 hours",
  "Profile display-field updates, profile photo upload/remove after local media staging, and notification preference updates are queueable",
  "API token create/revoke, OAuth connection disconnect, logout/session revoke, passkey/password/provider-link actions are online-only",
  "queued work",
  "sync failure",
  "conflict",
  "blocker",
  "destructive confirmation",
] as const;

describe("native Apple dogfood API docs", () => {
  it("documents the real Spoonjoy Apple OAuth quickstart instead of generic example.com callbacks", () => {
    const nativeSection = markdownSection(apiDocs, "### Native iOS OAuth quickstart");

    expectContainsAll(apiDocs, NATIVE_QUICKSTART_MARKERS);
    expectContainsAll(nativeSection, [
      "https://spoonjoy.app/oauth/callback",
      "applinks:spoonjoy.app",
      "persist client_id in Keychain",
      "clear state and code_verifier after a successful token exchange",
    ]);
    expectOmitsAll(nativeSection, ["https://example.com/spoonjoy/oauth/callback"]);
  });

  it("renders the same native dogfood guidance on /developers", async () => {
    const data = loader({} as any);
    const Stub = createTestRoutesStub([
      { path: "/developers", Component: Developers, loader: () => data },
    ]);

    render(createElement(Stub, { initialEntries: ["/developers"] }));
    await screen.findByRole("heading", { name: "Spoonjoy Developer Platform" });

    expectContainsAll(document.body.textContent ?? "", NATIVE_QUICKSTART_MARKERS);
    expectContainsAll(document.body.textContent ?? "", OFFLINE_PRODUCT_CONTRACT_MARKERS);
  });

  it("documents profile photo examples and DELETE idempotency forms native clients must dogfood", () => {
    expectContainsAll(apiDocs, [
      "Profile photo upload/remove",
      "POST /api/v1/me/photo",
      "multipart/form-data",
      "photo=@profile.jpg;type=image/jpeg",
      "Do not set the Content-Type header manually for multipart uploads",
      "DELETE /api/v1/me/photo",
      "DELETE idempotency",
      "X-Client-Mutation-Id is recommended for DELETE retries",
      "JSON body clientMutationId",
      "query string clientMutationId",
      "DELETE /api/v1/shopping-list/items/{itemId}",
      "DELETE /api/v1/recipes/{id}/spoons/{spoonId}",
      "DELETE /api/v1/cookbooks/{id}",
    ]);
  });

  it("documents REST scope defaults separately from MCP resource-bound tokens", () => {
    expectContainsAll(apiDocs, [
      "Blank OAuth authorize scope defaults to kitchen:read",
      "Omitted delegated approval scopes default to shopping_list:read shopping_list:write",
      "Omit resource for REST OAuth apps",
      "Use resource=https://spoonjoy.app/mcp only for MCP OAuth",
      "resource-bound MCP tokens are rejected by REST API v1",
      "OAuth kitchen scopes do not grant tokens:read or tokens:write",
    ]);
  });

  it("documents the Offline Product Contract for native API/cache/sync responsibilities", () => {
    expectContainsAll(apiDocs, OFFLINE_PRODUCT_CONTRACT_MARKERS);
    expectContainsAll(apiDocs, [
      "Queued mutations must include stable clientMutationId, endpoint path, method, idempotency key, payload schema version, created-at time, dependency ordering key, retry count, and last error.",
      "Do not store bearer tokens, refresh tokens, one-time token values, provider secrets, passkey material, or raw credential values in general cache storage.",
      "Dismissal may hide only informational offline/stale states",
      "server tombstones remove or conflict local records",
    ]);
  });

  it("keeps generated playground and OpenAPI profiles aligned with native dogfood docs", () => {
    const nativeScenario = API_V1_PLAYGROUND_MANIFEST.clientScenarios.find((scenario) => (
      scenario.id === "spoonjoy-apple-native-dogfood"
    ));
    expect(nativeScenario).toBeDefined();
    expect(nativeScenario?.sample).toContain("https://spoonjoy.app/oauth/callback");
    expect(nativeScenario?.notes.join("\n")).toContain("Keychain");
    expect(nativeScenario?.notes.join("\n")).toContain("Offline Product Contract");

    const registerOperation = API_V1_PLAYGROUND_MANIFEST.operations.find((operation) => operation.id === "POST /oauth/register");
    expect(JSON.stringify(registerOperation?.requestBody?.examples)).toContain("https://spoonjoy.app/oauth/callback");

    const sdkDocument = buildApiV1SdkOpenApiDocument({ serverUrl: "https://spoonjoy.app" });
    const connectorDocument = buildApiV1ConnectorOpenApiDocument({ serverUrl: "https://spoonjoy.app" });

    expect(sdkDocument.paths["/api/v1/me/photo"].post).toBeDefined();
    expect(sdkDocument.paths["/api/v1/me/photo"].delete).toBeDefined();
    expect(sdkDocument.paths["/oauth/token"].post).toBeDefined();
    expect(sdkDocument.paths["/mcp"]).toBeUndefined();
    expect(connectorDocument.paths["/mcp"]).toBeUndefined();
  });
});
