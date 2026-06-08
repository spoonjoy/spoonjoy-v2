/**
 * HTTP MCP transport for the Spoonjoy Claude connector.
 *
 * A stateless remote Streamable-HTTP MCP endpoint: each POST carries one
 * JSON-RPC message, which we route through the shared transport-agnostic
 * core (`handleJsonRpcMessage`) against a `JsonRpcToolRouter` backed by the
 * same operation layer the REST API and stdio bridge use. Responses are
 * `application/json` (no SSE); notifications get a 202 with no body.
 *
 * The endpoint is an OAuth-protected resource: EVERY request (including
 * `initialize`) must carry a valid bearer token, and an unauthenticated request
 * gets a 401 + `WWW-Authenticate` pointing at the protected-resource metadata —
 * the cue an OAuth-capable client (claude.ai) uses to run login + consent before
 * connecting. Claude Code authenticates the same way via its bearer header.
 * Requests are rate-limited before any auth work.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";
import {
  handleJsonRpcLine,
  type JsonRpcToolRouter,
} from "~/lib/mcp/json-rpc.server";
import {
  callSpoonjoyMcpTool,
  listSpoonjoyMcpTools,
} from "~/lib/mcp/spoonjoy-tools.server";
import {
  buildSpoonjoyApiContext,
} from "~/lib/spoonjoy-api-request.server";
import {
  ApiAuthError,
  authenticateApiToken,
  extractBearerToken,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import { mcpResourceUrl, protectedResourceMetadataUrl, resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import {
  enforceRateLimit,
  rateLimitedResponse,
  type RateLimitScope,
  type RateLimiterBinding,
} from "~/lib/rate-limit.server";
import {
  captureEvent,
  captureException,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";
import { RequestBodyTooLargeError, readLimitedTextBody } from "~/lib/request-body-limit.server";

interface CloudflareEnvLike {
  SESSION_SECRET?: string;
  OPENAI_API_KEY?: string;
  SPOONJOY_BASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PHOTOS?: R2Bucket;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  POSTHOG_DISABLED?: string;
}

const MCP_SAFE_JSONRPC_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/call",
  "tools/list",
]);
const MCP_TOOL_NAMES = new Set(listSpoonjoyMcpTools().map((tool) => tool.name));

export interface HandleMcpHttpRequestParams {
  request: Request;
  db: PrismaClientType;
  cloudflareEnv?: CloudflareEnvLike | null;
  waitUntil?: (promise: Promise<unknown>) => void;
  tokenLimiter?: RateLimiterBinding;
  ipLimiter?: RateLimiterBinding;
}

type McpTelemetryInput = {
  response: Response;
  startedAt: number;
  principal?: ApiPrincipal | null;
  errorCode?: string;
  jsonRpcMethod?: string;
  jsonRpcErrorCode?: number;
  notification?: boolean;
  toolName?: string;
  rateLimitScope?: RateLimitScope;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build the 401 that tells an MCP client to authenticate. The
 * `WWW-Authenticate` header points at the protected-resource metadata, which is
 * how an OAuth-capable client (claude.ai) discovers the authorization server
 * and starts the login + consent flow.
 */
function authChallengeResponse(
  request: Request,
  cloudflareEnv: CloudflareEnvLike | null | undefined,
): Response {
  const origin = resolveIssuerOrigin(request.url, cloudflareEnv?.SPOONJOY_BASE_URL);
  return new Response(
    JSON.stringify({ error: "unauthorized", message: "Authentication required." }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
      },
    },
  );
}

function mcpAuthMode(principal: ApiPrincipal | null): string {
  if (!principal) return "anonymous";
  return principal.oauthClientId ? "oauth_bearer" : principal.source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mcpJsonRpcTelemetry(body: string): Pick<McpTelemetryInput, "jsonRpcMethod" | "toolName"> {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) return {};

    const method = typeof parsed.method === "string" && MCP_SAFE_JSONRPC_METHODS.has(parsed.method)
      ? parsed.method
      : undefined;
    if (!method) return {};

    const params = parsed.params;
    const toolName = method === "tools/call" && isRecord(params) && typeof params.name === "string" && MCP_TOOL_NAMES.has(params.name)
      ? params.name
      : undefined;
    return { jsonRpcMethod: method, toolName };
  } catch {
    return {};
  }
}

function isJsonRpcSuccessResponse(response: unknown): boolean {
  return isRecord(response) && "result" in response && !("error" in response);
}

export function jsonRpcErrorCode(response: unknown): number | undefined {
  if (!isRecord(response) || !isRecord(response.error)) return undefined;
  return typeof response.error.code === "number" ? response.error.code : undefined;
}

function observeMcpResponse(
  params: HandleMcpHttpRequestParams,
  input: McpTelemetryInput,
): Response {
  const { request, cloudflareEnv, waitUntil } = params;
  if (!cloudflareEnv || !waitUntil) return input.response;

  const postHogConfig = resolvePostHogServerConfig(cloudflareEnv);
  if (!postHogConfig.enabled) return input.response;

  const principal = input.principal ?? null;
  waitUntil(captureEvent(postHogConfig, {
    event: "spoonjoy.mcp.request",
    distinctId: principal?.id ?? "anon",
    properties: {
      route_template: "/mcp",
      method: request.method,
      status: input.response.status,
      error_code: input.errorCode,
      auth_mode: mcpAuthMode(principal),
      principal_id: principal?.id,
      credential_id: principal?.credentialId,
      oauth_client_id: principal?.oauthClientId || undefined,
      oauth_resource: principal?.oauthClientId ? (principal.oauthResource ?? null) : undefined,
      scopes: principal?.scopes,
      jsonrpc_method: input.jsonRpcMethod,
      jsonrpc_error_code: input.jsonRpcErrorCode,
      notification: input.notification,
      tool_name: input.toolName,
      request_bytes: requestContentBytes(request),
      origin_host: safeHeaderHost(request.headers.get("Origin")),
      referrer_host: safeHeaderHost(request.headers.get("Referer")),
      user_agent_family: userAgentFamily(request.headers.get("User-Agent")),
      rate_limit_scope: input.rateLimitScope,
      latency_ms: Math.max(0, Date.now() - input.startedAt),
    },
  }));

  return input.response;
}

export async function handleMcpHttpRequest(params: HandleMcpHttpRequestParams): Promise<Response> {
  const { request, db, cloudflareEnv, waitUntil, tokenLimiter, ipLimiter } = params;
  const startedAt = Date.now();

  if (request.method !== "POST") {
    const response = jsonResponse(
      { error: "method_not_allowed", message: "The MCP endpoint accepts POST." },
      405,
    );
    return observeMcpResponse(params, { response, startedAt, errorCode: "method_not_allowed" });
  }

  const rateLimit = await enforceRateLimit({
    authorization: request.headers.get("Authorization"),
    ip: request.headers.get("CF-Connecting-IP"),
    tokenLimiter,
    ipLimiter,
  });
  if (!rateLimit.allowed) {
    const response = rateLimitedResponse(rateLimit.retryAfterSeconds);
    return observeMcpResponse(params, {
      response,
      startedAt,
      errorCode: "rate_limited",
      rateLimitScope: rateLimit.scope,
    });
  }

  let principal: ApiPrincipal;
  try {
    const bearerToken = extractBearerToken(request);
    if (!bearerToken) {
      const response = authChallengeResponse(request, cloudflareEnv);
      return observeMcpResponse(params, {
        response,
        startedAt,
        errorCode: "authentication_required",
      });
    }
    principal = await authenticateApiToken(db, bearerToken);
  } catch (error) {
    const response = authChallengeResponse(request, cloudflareEnv);
    return observeMcpResponse(params, {
      response,
      startedAt,
      errorCode: error instanceof ApiAuthError && error.status === 400 ? "malformed_authorization" : "invalid_token",
    });
  }
  const expectedResource = mcpResourceUrl(resolveIssuerOrigin(request.url, cloudflareEnv?.SPOONJOY_BASE_URL));
  if (principal.oauthClientId && principal.oauthResource !== expectedResource) {
    const response = jsonResponse(
      { error: "invalid_token", message: "OAuth access token is not audience-bound to this MCP resource." },
      403,
    );
    return observeMcpResponse(params, {
      response,
      startedAt,
      principal,
      errorCode: "invalid_token",
    });
  }

  const router: JsonRpcToolRouter = {
    listTools() {
      return { tools: listSpoonjoyMcpTools() };
    },
    async callTool(name, args) {
      const context = buildSpoonjoyApiContext({ db, principal, cloudflareEnv, waitUntil });
      const text = await callSpoonjoyMcpTool(name, args, context);
      return { content: [{ type: "text", text }] };
    },
  };

  // Surface unexpected exceptions inside tool dispatch to PostHog. Without this
  // an exception during a tools/call is collapsed to a JSON-RPC -32603 with the
  // message on the wire and no record of the original stack in observability.
  const onError = (error: unknown) => {
    if (!waitUntil || !cloudflareEnv) return;
    const phConfig = resolvePostHogServerConfig(cloudflareEnv);
    if (!phConfig.enabled) return;
    waitUntil(
      captureException(phConfig, {
        error,
        distinctId: principal.id,
        route: new URL(request.url).pathname,
        method: request.method,
      }),
    );
  };

  let body: string;
  try {
    body = await readLimitedTextBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      const response = jsonResponse(
        { error: "request_too_large", message: error.message },
        error.status,
      );
      return observeMcpResponse(params, {
        response,
        startedAt,
        principal,
        errorCode: "request_too_large",
      });
    }
    throw error;
  }
  const jsonRpcTelemetry = mcpJsonRpcTelemetry(body);
  const response = await handleJsonRpcLine(body, router, { onError });

  // Notifications (no id) produce no JSON-RPC response — ack with 202.
  if (response === null) {
    return observeMcpResponse(params, {
      response: new Response(null, { status: 202 }),
      startedAt,
      principal,
      ...jsonRpcTelemetry,
      notification: true,
    });
  }

  const httpResponse = jsonResponse(response);
  if (!isJsonRpcSuccessResponse(response)) {
    return observeMcpResponse(params, {
      response: httpResponse,
      startedAt,
      principal,
      ...jsonRpcTelemetry,
      errorCode: "jsonrpc_error",
      jsonRpcErrorCode: jsonRpcErrorCode(response),
    });
  }
  return observeMcpResponse(params, {
    response: httpResponse,
    startedAt,
    principal,
    ...jsonRpcTelemetry,
  });
}
