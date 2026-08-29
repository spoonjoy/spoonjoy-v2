/**
 * OAuth 2.1 discovery metadata for the Spoonjoy MCP connector.
 *
 * - Authorization Server Metadata (RFC 8414) at
 *   `/.well-known/oauth-authorization-server`.
 * - Protected Resource Metadata (RFC 9728) at
 *   `/.well-known/oauth-protected-resource/mcp`, pointing the `/mcp`
 *   resource at this authorization server. The root metadata path is still
 *   served for older clients.
 *
 * The issuer must be the public host the client reached (spoonjoy.app), which
 * is NOT necessarily `request.url`: the public domain fronts the worker, so
 * inside the worker `request.url` is the `*.workers.dev` origin. Prefer the
 * configured `SPOONJOY_BASE_URL`, falling back to the request origin for local
 * dev where it isn't set.
 */

import { SUPPORTED_SCOPES } from "~/lib/oauth-server.server";

const DNS_NAME = "(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const IPV6_HOST = "\\[[0-9a-f:.]+\\]";
const SERIALIZED_HTTP_ORIGIN = new RegExp(
  `^https?://(?:${DNS_NAME}|${IPV6_HOST})(?::\\d{1,5})?$`,
  "i",
);

/**
 * Resolve the public issuer origin: the configured base URL when present,
 * otherwise the request's own origin (local dev).
 */
export function resolveIssuerOrigin(requestUrl: string, baseUrl?: string | null): string {
  return canonicalHttpOrigin(baseUrl || requestUrl);
}

export function canonicalHttpOrigin(value: string): string {
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    throw new Error("OAuth issuer must be a canonical HTTP(S) origin.");
  }
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error("OAuth issuer must be a canonical HTTP(S) origin.");
  }
  const trailingDots = url.hostname.match(/\.+$/)?.[0] ?? "";
  if (trailingDots.length > 1) {
    throw new Error("OAuth issuer must be a canonical HTTP(S) origin.");
  }
  if (trailingDots) url.hostname = url.hostname.slice(0, -1);
  return url.origin;
}

export function parseSerializedHttpOrigin(value: string): string | null {
  if (!SERIALIZED_HTTP_ORIGIN.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** The MCP endpoint these tokens are bound to (the protected resource). */
export function mcpResourceUrl(origin: string): string {
  return `${origin}/mcp`;
}

export function isCanonicalMcpResource(resource: string | null | undefined, origin: string): boolean {
  return resource === mcpResourceUrl(origin);
}

/** URL of the protected-resource metadata, for the `WWW-Authenticate` hint. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
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
