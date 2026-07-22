import { createRequestHandler } from "react-router";
import { canonicalizeRequestUrlForHost } from "../app/lib/canonical-host.server";
import { ApiAuthError, authenticateApiRequest } from "../app/lib/api-auth.server";
import { getDb } from "../app/lib/db.server";
import { handleMcpPostRouteRequest } from "../app/lib/mcp/http-mcp-route.server";
import { oauthCorsPreflightResponse } from "../app/lib/oauth-cors.server";
import { generateNonce, withSecurityHeaders } from "../app/lib/security-headers.server";
import {
  captureException,
  resolvePostHogServerConfig,
} from "../app/lib/analytics-server";

export { CookSession } from "./cook-session";

declare global {
  interface CloudflareEnvironment extends Env {}
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const COOK_SESSION_PREFIX = "/api/cook-sessions";
const COOK_SESSION_BOOTSTRAP_PATH = "/.well-known/spoonjoy-cook-session-bootstrap";
const ACCOUNT_DELETE_INTENT_RESOURCE = "urn:spoonjoy:account-delete-intent:v1";

interface CookRouteRequirement {
  ownerDelete?: boolean;
  originRequired: boolean;
  scope: "account:write" | "kitchen:read" | "kitchen:write";
}

function cookErrorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return Response.json({ error: { code, message, retryable } }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function cookProtocolUnavailableResponse() {
  const response = cookErrorResponse(
    503,
    "cook_session_protocol_unavailable",
    "Cook session protocol is temporarily unavailable.",
    true,
  );
  response.headers.set("Retry-After", "1");
  return response;
}

function configuredCookSessionOrigin(env: CloudflareEnvironment): string | null {
  if (!env.SPOONJOY_BASE_URL) return null;
  try {
    const url = new URL(env.SPOONJOY_BASE_URL);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

async function requestHasBodyBytes(request: Request): Promise<boolean> {
  if (!request.body) return false;

  const reader = request.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return false;
      if (chunk.value.byteLength > 0) return true;
    }
  } finally {
    reader.releaseLock();
  }
}

function classifyCookRoute(request: Request, url: URL): CookRouteRequirement | null {
  if (url.search) return null;
  if (request.method === "DELETE" && url.pathname === COOK_SESSION_PREFIX) {
    return { scope: "account:write", originRequired: true, ownerDelete: true };
  }
  if (request.method === "GET" && url.pathname === COOK_SESSION_PREFIX) {
    return { scope: "kitchen:read", originRequired: false };
  }

  const recipePath = `${COOK_SESSION_PREFIX}/[^/]+`;
  if (request.method === "GET" && new RegExp(`^${recipePath}$`).test(url.pathname)) {
    return { scope: "kitchen:read", originRequired: false };
  }
  if (request.method === "GET" && new RegExp(`^${recipePath}/socket$`).test(url.pathname)) {
    return { scope: "kitchen:read", originRequired: true };
  }
  if (
    (request.method === "PATCH" || request.method === "DELETE") &&
    new RegExp(`^${recipePath}$`).test(url.pathname)
  ) {
    return { scope: "kitchen:write", originRequired: true };
  }
  if (
    request.method === "POST" &&
    new RegExp(`^${recipePath}/(?:start|complete|abandon|restart)$`).test(url.pathname)
  ) {
    return { scope: "kitchen:write", originRequired: true };
  }
  return null;
}

async function handleCookSessionRequest(
  request: Request,
  env: CloudflareEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  const isOwnerDelete = request.method === "DELETE" && url.pathname === COOK_SESSION_PREFIX;
  if (isOwnerDelete && url.search) {
    return cookErrorResponse(400, "invalid_request", "Cook session request is invalid.");
  }
  const requirement = classifyCookRoute(request, url);
  if (!requirement) return new Response(null, { status: 404 });

  try {
    const principal = await authenticateApiRequest(
      await getDb({ DB: env.DB as D1Database }),
      request,
      env,
    );
    if (!principal) {
      return cookErrorResponse(401, "authentication_required", "Authentication required.");
    }
    if (
      requirement.ownerDelete
        ? principal.source !== "bearer" ||
          !principal.credentialId ||
          !principal.scopes.includes(requirement.scope) ||
          principal.oauthResource !== ACCOUNT_DELETE_INTENT_RESOURCE
        : principal.source === "bearer" && !principal.scopes.includes(requirement.scope)
    ) {
      return cookErrorResponse(
        403,
        "insufficient_scope",
        "This credential does not include the required cook-session scope.",
      );
    }
    const configuredOrigin = requirement.originRequired
      ? configuredCookSessionOrigin(env)
      : null;
    if (
      requirement.originRequired &&
      (!configuredOrigin || request.headers.get("Origin") !== configuredOrigin)
    ) {
      return cookErrorResponse(403, "origin_forbidden", "Request origin is not allowed.");
    }
    if (requirement.ownerDelete && await requestHasBodyBytes(request)) {
      return cookErrorResponse(400, "invalid_request", "Cook session request is invalid.");
    }
    return cookProtocolUnavailableResponse();
  } catch (error) {
    if (!(error instanceof ApiAuthError)) throw error;
    if (error.status === 400) {
      return cookErrorResponse(400, "invalid_request", "Authentication request is invalid.");
    }
    return cookErrorResponse(401, "authentication_required", "Authentication required.");
  }
}

async function handleCookSessionBootstrapRequest(
  request: Request,
  env: CloudflareEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  const workerVersionId = env.CF_VERSION_METADATA?.id;
  const connectingIp = request.headers.get("CF-Connecting-IP");
  const contentLength = request.headers.get("Content-Length");
  if (
    url.pathname !== COOK_SESSION_BOOTSTRAP_PATH ||
    url.search ||
    request.method !== "POST" ||
    env.COOK_SESSION_BOOTSTRAP_MODE !== "1" ||
    !workerVersionId ||
    !env.COOK_SESSIONS ||
    (request.body !== null && contentLength !== "0") ||
    request.headers.has("Content-Type") ||
    request.headers.has("Transfer-Encoding") ||
    ![null, "0"].includes(contentLength) ||
    !connectingIp ||
    !env.AUTH_IP_RATE_LIMITER
  ) {
    return new Response(null, { status: 404 });
  }
  const rateLimit = await env.AUTH_IP_RATE_LIMITER.limit({
    key: `cook-session-bootstrap:${connectingIp}`,
  });
  if (!rateLimit.success) return new Response(null, { status: 404 });

  const objectId = env.COOK_SESSIONS.idFromName(`bootstrap:${workerVersionId}`);
  const response = await env.COOK_SESSIONS.get(objectId).fetch(new Request(
    "https://cook-session.internal/__bootstrap/probe",
    {
      method: "POST",
      headers: { "X-Spoonjoy-Internal-Probe": "1" },
      body: new TextEncoder().encode('{"version":1}'),
    },
  ));
  const payload = await response.json() as Record<string, unknown>;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return Response.json({ ...payload, workerVersionId }, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function finalizeResponse(
  response: Response,
  env: CloudflareEnvironment,
  nonce?: string,
): Response {
  const finalized = withSecurityHeaders(response, nonce, env);
  const workerVersionId = env.CF_VERSION_METADATA?.id;
  if (workerVersionId) {
    finalized.headers.set("X-Spoonjoy-Worker-Version", workerVersionId);
  }
  return finalized;
}

export default {
  async fetch(request, env, ctx) {
    const oauthPreflight = oauthCorsPreflightResponse(request);
    if (oauthPreflight) {
      return finalizeResponse(oauthPreflight, env);
    }

    const canonicalUrl =
      canonicalizeRequestUrlForHost(request.url, request.headers.get("X-Forwarded-Host")) ??
      canonicalizeRequestUrlForHost(request.url, request.headers.get("Host"));

    if (canonicalUrl) {
      return finalizeResponse(Response.redirect(canonicalUrl.toString(), 308), env);
    }

    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith(COOK_SESSION_BOOTSTRAP_PATH)) {
        return finalizeResponse(await handleCookSessionBootstrapRequest(request, env), env);
      }
      if (url.pathname.startsWith(COOK_SESSION_PREFIX)) {
        return finalizeResponse(await handleCookSessionRequest(request, env), env);
      }

      if (request.method === "POST" && new URL(request.url).pathname === "/mcp") {
        const response = await handleMcpPostRouteRequest(request, {
          cloudflare: { env, ctx },
        });
        return finalizeResponse(response, env);
      }

      // One nonce per request: it must appear identically in the selected CSP
      // header (below) and in the SSR shell's inline <script> nonces,
      // threaded via loadContext → entry.server → NonceContext.
      const nonce = generateNonce();
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
        nonce,
      });
      return finalizeResponse(response, env, nonce);
    } catch (error) {
      // Outer catch: errors that escaped React Router's onError (e.g. thrown
      // before the response stream started, or from a non-route boundary).
      const postHogConfig = resolvePostHogServerConfig(env);
      if (postHogConfig.enabled) {
        ctx.waitUntil(
          captureException(postHogConfig, {
            error,
            distinctId: "server",
            route: new URL(request.url).pathname,
            method: request.method,
          }),
        );
      }
      throw error;
    }
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
