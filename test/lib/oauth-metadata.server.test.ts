import { describe, expect, it } from "vitest";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  mcpResourceUrl,
  protectedResourceMetadataUrl,
  resolveIssuerOrigin,
} from "~/lib/oauth-metadata.server";

const ORIGIN = "https://spoonjoy.app";

describe("resolveIssuerOrigin", () => {
  it("prefers the configured base URL over the request origin", () => {
    // worker sees its *.workers.dev host, but the public issuer is spoonjoy.app
    expect(
      resolveIssuerOrigin("https://spoonjoy-v2.workers.dev/.well-known/x", "https://spoonjoy.app"),
    ).toBe("https://spoonjoy.app");
  });

  it("falls back to the request origin when no base URL is set", () => {
    expect(resolveIssuerOrigin("http://localhost:5173/x", undefined)).toBe("http://localhost:5173");
    expect(resolveIssuerOrigin("http://localhost:5173/x", "")).toBe("http://localhost:5173");
  });
});

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
      grant_types_supported: ["authorization_code", "refresh_token"],
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
