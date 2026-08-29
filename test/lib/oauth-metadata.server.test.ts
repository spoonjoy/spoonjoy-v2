import { describe, expect, it } from "vitest";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  isCanonicalMcpResource,
  mcpResourceUrl,
  parseSerializedHttpOrigin,
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

  it("canonicalizes case, a trailing DNS dot, default ports, and configured paths", () => {
    expect(resolveIssuerOrigin(
      "https://internal.workers.dev/path",
      "HTTPS://SPOONJOY.APP.:443/ignored/%2Fmcp?query=1#fragment",
    )).toBe("https://spoonjoy.app");
    expect(resolveIssuerOrigin("HTTP://LOCALHOST:80/path", undefined)).toBe("http://localhost");
    expect(resolveIssuerOrigin("https://spoonjoy.app:8443/path", undefined)).toBe(
      "https://spoonjoy.app:8443",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,spoonjoy",
    "https://user:password@spoonjoy.app",
    "https://spoonjoy.app\\@evil.example",
  ])("rejects a non-origin issuer input %s", (baseUrl) => {
    expect(() => resolveIssuerOrigin("https://internal.workers.dev/path", baseUrl)).toThrow(
      "canonical HTTP(S) origin",
    );
  });

  it("rejects an invalid multi-dot fully-qualified host", () => {
    expect(() => resolveIssuerOrigin("https://internal.workers.dev", "https://spoonjoy.app.."))
      .toThrow("canonical HTTP(S) origin");
  });

  it("parses only serialized HTTP origins", () => {
    expect(parseSerializedHttpOrigin("HTTPS://SPOONJOY.APP:443")).toBe("https://spoonjoy.app");
    expect(parseSerializedHttpOrigin("ftp://spoonjoy.app")).toBeNull();
    expect(parseSerializedHttpOrigin("https://user@spoonjoy.app")).toBeNull();
    expect(parseSerializedHttpOrigin("https://%")).toBeNull();
    expect(parseSerializedHttpOrigin("https://spoonjoy.app/path")).toBeNull();
    expect(parseSerializedHttpOrigin("https://spoonjoy.app\\@evil.example")).toBeNull();
    expect(parseSerializedHttpOrigin("https://%73poonjoy.app")).toBeNull();
    expect(parseSerializedHttpOrigin("https://spoonjoy。app")).toBeNull();
  });
});

describe("oauth metadata builders", () => {
  it("derives endpoint URLs from the origin", () => {
    expect(mcpResourceUrl(ORIGIN)).toBe("https://spoonjoy.app/mcp");
    expect(protectedResourceMetadataUrl(ORIGIN)).toBe(
      "https://spoonjoy.app/.well-known/oauth-protected-resource/mcp",
    );
    expect(isCanonicalMcpResource("https://spoonjoy.app/mcp", ORIGIN)).toBe(true);
    expect(isCanonicalMcpResource("https://spoonjoy.app./mcp", ORIGIN)).toBe(false);
    expect(isCanonicalMcpResource(null, ORIGIN)).toBe(false);
  });

  it("builds RFC 8414 authorization server metadata", () => {
    expect(buildAuthorizationServerMetadata(ORIGIN)).toEqual({
      issuer: "https://spoonjoy.app",
      authorization_endpoint: "https://spoonjoy.app/oauth/authorize",
      token_endpoint: "https://spoonjoy.app/oauth/token",
      revocation_endpoint: "https://spoonjoy.app/oauth/revoke",
      registration_endpoint: "https://spoonjoy.app/oauth/register",
      scopes_supported: [
        "account:read",
        "account:write",
        "cookbooks:read",
        "kitchen:read",
        "kitchen:write",
        "public:read",
        "recipes:read",
        "shopping_list:read",
        "shopping_list:write",
      ],
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
      scopes_supported: [
        "account:read",
        "account:write",
        "cookbooks:read",
        "kitchen:read",
        "kitchen:write",
        "public:read",
        "recipes:read",
        "shopping_list:read",
        "shopping_list:write",
      ],
      revocation_endpoint: "https://spoonjoy.app/oauth/revoke",
    });
  });

  it("works on a localhost dev origin", () => {
    expect(buildAuthorizationServerMetadata("http://localhost:5173").issuer).toBe(
      "http://localhost:5173",
    );
  });
});
