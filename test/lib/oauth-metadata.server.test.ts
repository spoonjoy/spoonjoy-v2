import { describe, expect, it } from "vitest";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  mcpResourceUrl,
  protectedResourceMetadataUrl,
} from "~/lib/oauth-metadata.server";

const ORIGIN = "https://spoonjoy.app";

describe("oauth metadata builders", () => {
  it("derives endpoint URLs from the origin", () => {
    expect(mcpResourceUrl(ORIGIN)).toBe("https://spoonjoy.app/mcp");
    expect(protectedResourceMetadataUrl(ORIGIN)).toBe(
      "https://spoonjoy.app/.well-known/oauth-protected-resource",
    );
  });

  it("builds RFC 8414 authorization server metadata", () => {
    expect(buildAuthorizationServerMetadata(ORIGIN)).toEqual({
      issuer: "https://spoonjoy.app",
      authorization_endpoint: "https://spoonjoy.app/oauth/authorize",
      token_endpoint: "https://spoonjoy.app/oauth/token",
      registration_endpoint: "https://spoonjoy.app/oauth/register",
      scopes_supported: ["kitchen:read", "kitchen:write"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("builds RFC 9728 protected resource metadata pointing at this issuer", () => {
    expect(buildProtectedResourceMetadata(ORIGIN)).toEqual({
      resource: "https://spoonjoy.app/mcp",
      authorization_servers: ["https://spoonjoy.app"],
      scopes_supported: ["kitchen:read", "kitchen:write"],
    });
  });

  it("works on a localhost dev origin", () => {
    expect(buildAuthorizationServerMetadata("http://localhost:5173").issuer).toBe(
      "http://localhost:5173",
    );
  });
});
