/**
 * OAuth 2.1 discovery metadata for the Spoonjoy MCP connector.
 *
 * - Authorization Server Metadata (RFC 8414) at
 *   `/.well-known/oauth-authorization-server`.
 * - Protected Resource Metadata (RFC 9728) at
 *   `/.well-known/oauth-protected-resource`, pointing the `/mcp` resource at
 *   this authorization server.
 *
 * The issuer must be the public host the client reached (spoonjoy.app), which
 * is NOT necessarily `request.url`: the public domain fronts the worker, so
 * inside the worker `request.url` is the `*.workers.dev` origin. Prefer the
 * configured `SPOONJOY_BASE_URL`, falling back to the request origin for local
 * dev where it isn't set.
 */

import { SUPPORTED_SCOPES } from "~/lib/oauth-server.server";

/**
 * Resolve the public issuer origin: the configured base URL when present,
 * otherwise the request's own origin (local dev).
 */
export function resolveIssuerOrigin(requestUrl: string, baseUrl?: string | null): string {
  return new URL(baseUrl || requestUrl).origin;
}

/** The MCP endpoint these tokens are bound to (the protected resource). */
export function mcpResourceUrl(origin: string): string {
  return `${origin}/mcp`;
}

/** URL of the protected-resource metadata, for the `WWW-Authenticate` hint. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function buildAuthorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    registration_endpoint: `${origin}/oauth/register`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function buildProtectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...SUPPORTED_SCOPES],
    revocation_endpoint: `${origin}/oauth/revoke`,
  };
}
