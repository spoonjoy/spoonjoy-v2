import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_V1_DISCOVERY_DATA,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
} from "~/lib/api-v1-contract.server";

function readProjectFile(path: string) {
  return readFileSync(resolve(__dirname, "..", "..", path), "utf8");
}

const apiDocs = readProjectFile("docs/api.md");
const claudeConnectorDocs = readProjectFile("docs/claude-connector.md");
const ouroborosMcpDocs = readProjectFile("docs/ouroboros-mcp.md");
const oauthRoutesSource = readProjectFile("app/lib/oauth-routes.server.ts");
const oauthServerSource = readProjectFile("app/lib/oauth-server.server.ts");

const uniqueResourcePaths = Array.from(new Set(API_V1_RESOURCES.map((resource) => resource.path))).sort();
const uniqueScopes = Array.from(
  new Set(API_V1_SCOPE_REQUIREMENTS.flatMap((requirement) => requirement.scopes)),
).sort();

describe("developer platform docs drift", () => {
  it("keeps docs/api.md aligned with the public API v1 contract", () => {
    expect(apiDocs).toContain("/developers");
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.openapiUrl);
    expect(apiDocs).toContain("public-by-default Chef graph");
    expect(apiDocs).toContain("rate limited by IP and credential");

    for (const path of uniqueResourcePaths) {
      expect(apiDocs).toContain(path);
    }

    for (const scope of uniqueScopes) {
      expect(apiDocs).toContain(scope);
    }
  });

  it("documents REST auth entry points for personal tokens, OAuth, delegated auth, and MCP", () => {
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.tokenUrl);
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.oauth.register);
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.oauth.authorize);
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.oauth.token);
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.mcp.endpoint);
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.mcp.startAgentConnection);
    expect(apiDocs).toContain(API_V1_DISCOVERY_DATA.auth.mcp.pollAgentConnection);
    expect(apiDocs).toContain("Authorization: Bearer");
  });

  it("documents shopping-list sync and idempotent mutation semantics", () => {
    expect(apiDocs).toContain("/api/v1/shopping-list/sync");
    expect(apiDocs).toContain("cursor");
    expect(apiDocs).toContain("tombstone");
    expect(apiDocs).toContain("clientMutationId");
    expect(apiDocs).toContain("idempotency");
  });

  it("keeps MCP docs pointed at the same auth and REST surface", () => {
    for (const docs of [claudeConnectorDocs, ouroborosMcpDocs]) {
      expect(docs).toContain("/api");
      expect(docs).toContain("/api/v1/openapi.json");
      expect(docs).toContain("/api/tools/start_agent_connection");
      expect(docs).toContain("/api/tools/poll_agent_connection");
      expect(docs).toContain("/oauth/register");
      expect(docs).toContain("/oauth/token");
      expect(docs).toContain("/mcp");
    }
  });

  it("does not claim remote MCP tools/list is unauthenticated", () => {
    expect(claudeConnectorDocs).not.toMatch(/no auth needed/i);

    const toolsListIndex = claudeConnectorDocs.indexOf('"method":"tools/list"');
    expect(toolsListIndex).toBeGreaterThan(0);
    const toolsListExample = claudeConnectorDocs.slice(Math.max(0, toolsListIndex - 180), toolsListIndex + 180);

    expect(toolsListExample).toContain("Authorization: Bearer sj_your_token_here");
  });

  it("documents rotating OAuth refresh tokens instead of stale no-refresh-token claims", () => {
    for (const text of [claudeConnectorDocs, oauthRoutesSource, oauthServerSource]) {
      expect(text).toContain("refresh_token");
      expect(text).toMatch(/refresh token/i);
      expect(text).toMatch(/rotat/i);
      expect(text).not.toMatch(/no refresh tokens?/i);
      expect(text).not.toMatch(/no refresh/i);
    }
  });
});
