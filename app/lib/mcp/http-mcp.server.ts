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
  handleJsonRpcMessage,
  JsonRpcError,
  parseJsonRpcLine,
  type JsonRpcFailure,
  type JsonRpcToolRouter,
} from "~/lib/mcp/json-rpc.server";
import {
  MCP_LEGACY_VERSION,
  validateModernMcpRequest,
  type McpProtocolContext,
} from "~/lib/mcp/http-mcp-protocol.server";
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
import {
  isCanonicalMcpResource,
  protectedResourceMetadataUrl,
  resolveIssuerOrigin,
} from "~/lib/oauth-metadata.server";
import { getOAuthClient, isClaudeMcpOAuthClient } from "~/lib/oauth-server.server";
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
import {
  RequestBodyInvalidUtf8Error,
  RequestBodyTooLargeError,
  readLimitedTextBody,
} from "~/lib/request-body-limit.server";
import type { ImageGenEnv } from "~/lib/image-gen.server";
import {
  PRODUCT_ACTIVATION_PENDING_CODE,
  PRODUCT_ACTIVATION_PENDING_MESSAGE,
  isSavedRecipeCutoverPendingError,
} from "~/lib/saved-recipe-cutover.server";

interface CloudflareEnvLike extends ImageGenEnv {
  SESSION_SECRET?: string;
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
  "server/discover",
  "initialize",
  "notifications/initialized",
  "tools/call",
  "tools/list",
]);
const MCP_TOOLS = listSpoonjoyMcpTools();
const MCP_TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));
const MCP_TOOL_SCOPES = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.requiredScopes ?? []]));
const PRODUCT_ACTIVATION_PENDING_JSON_RPC_CODE = -32001;
const PRODUCT_ACTIVATION_RETRY_AFTER_SECONDS = 1;

export function isCookbookMembershipCutoverToolError(
  toolName: string,
  error: unknown,
): boolean {
  return (
    toolName === "add_recipe_to_cookbook" ||
    toolName === "remove_recipe_from_cookbook"
  ) && isSavedRecipeCutoverPendingError(error);
}

export interface HandleMcpHttpRequestParams {
  request: Request;
  db: PrismaClientType;
  cloudflareEnv?: CloudflareEnvLike | null;
  waitUntil?: (promise: Promise<unknown>) => void;
  tokenLimiter?: RateLimiterBinding;
  ipLimiter?: RateLimiterBinding;
  transport?: McpProtocolContext;
}

type McpTelemetryInput = {
  response: Response;
  startedAt: number;
  principal?: ApiPrincipal | null;
  errorCode?: string;
  legacyOAuthResourceAllowed?: boolean;
  resourceMetadataUrl?: string;
  jsonRpcMethod?: string;
  jsonRpcErrorCode?: number;
  notification?: boolean;
  toolName?: string;
  rateLimitScope?: RateLimitScope;
};

function jsonResponse(payload: unknown, status: number): Response {
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
  const resourceMetadataUrl = authChallengeMetadataUrl(request, cloudflareEnv);
  return new Response(
    JSON.stringify({ error: "unauthorized", message: "Authentication required." }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
      },
    },
  );
}

function authChallengeMetadataUrl(
  request: Request,
  cloudflareEnv: CloudflareEnvLike | null | undefined,
): string {
  const origin = resolveIssuerOrigin(request.url, cloudflareEnv?.SPOONJOY_BASE_URL);
  return protectedResourceMetadataUrl(origin);
}

function insufficientScopeResponse(
  request: Request,
  cloudflareEnv: CloudflareEnvLike | null | undefined,
  requiredScopes: readonly string[],
): Response {
  const resourceMetadataUrl = authChallengeMetadataUrl(request, cloudflareEnv);
  return new Response(JSON.stringify({
    error: "insufficient_scope",
    message: "Additional authorization is required for this tool.",
    required_scopes: requiredScopes,
  }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${requiredScopes.join(" ")}", resource_metadata="${resourceMetadataUrl}"`,
    },
  });
}

function mcpAuthMode(principal: ApiPrincipal | null): string {
  if (!principal) return "anonymous";
  return principal.oauthClientId ? "oauth_bearer" : principal.source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mcpJsonRpcTelemetry(parsed: unknown): Pick<McpTelemetryInput, "jsonRpcMethod" | "toolName"> {
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
      resource_metadata_url: input.resourceMetadataUrl,
      auth_mode: mcpAuthMode(principal),
      principal_id: principal?.id,
      credential_id: principal?.credentialId,
      oauth_client_id: principal?.oauthClientId || undefined,
      oauth_resource: principal?.oauthClientId ? (principal.oauthResource ?? null) : undefined,
      legacy_oauth_resource_allowed: input.legacyOAuthResourceAllowed || undefined,
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

async function mcpOAuthResourceAllowed(
  db: PrismaClientType,
  principal: ApiPrincipal,
  expectedOrigin: string,
): Promise<{ allowed: boolean; legacyAllowed: boolean }> {
  if (!principal.oauthClientId) return { allowed: true, legacyAllowed: false };
  if (isCanonicalMcpResource(principal.oauthResource, expectedOrigin)) {
    return { allowed: true, legacyAllowed: false };
  }
  if (principal.oauthResource) return { allowed: false, legacyAllowed: false };

  const client = await getOAuthClient(db, principal.oauthClientId, expectedOrigin);
  const legacyAllowed = isClaudeMcpOAuthClient(client);
  return { allowed: legacyAllowed, legacyAllowed };
}

export async function handleMcpHttpRequest(params: HandleMcpHttpRequestParams): Promise<Response> {
  const { request, db, cloudflareEnv, waitUntil, tokenLimiter, ipLimiter } = params;
  const transport = params.transport ?? { era: "legacy", protocolVersion: null };
  const startedAt = Date.now();

  async function readBody(principal?: ApiPrincipal): Promise<{ body: string } | { response: Response }> {
    try {
      return {
        body: await readLimitedTextBody(request, undefined, {
          fatalUtf8: transport.era === "modern",
        }),
      };
    } catch (error) {
      if (error instanceof RequestBodyInvalidUtf8Error) {
        const response = jsonResponse({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }, error.status);
        return {
          response: observeMcpResponse(params, {
            response,
            startedAt,
            principal,
            errorCode: "jsonrpc_error",
            jsonRpcErrorCode: -32700,
          }),
        };
      }
      if (!(error instanceof RequestBodyTooLargeError)) throw error;
      const response = jsonResponse(
        { error: "request_too_large", message: error.message },
        error.status,
      );
      return {
        response: observeMcpResponse(params, {
          response,
          startedAt,
          principal,
          errorCode: "request_too_large",
        }),
      };
    }
  }

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

  let body: string | undefined;
  let parsedMessage: unknown;
  let parsedError: JsonRpcFailure | undefined;
  if (transport.era === "modern") {
    const bodyResult = await readBody();
    if ("response" in bodyResult) return bodyResult.response;
    body = bodyResult.body;
    const parsed = parseJsonRpcLine(body);
    if (!parsed.ok) {
      const response = jsonResponse(parsed.error, 400);
      return observeMcpResponse(params, {
        response,
        startedAt,
        errorCode: "jsonrpc_error",
        jsonRpcErrorCode: parsed.error.error.code,
      });
    }
    const validated = validateModernMcpRequest(request, parsed.value);
    if (!validated.ok) {
      const response = jsonResponse(validated.error, validated.status);
      return observeMcpResponse(params, {
        response,
        startedAt,
        ...mcpJsonRpcTelemetry(parsed.value),
        errorCode: "jsonrpc_error",
        jsonRpcErrorCode: validated.error.error.code,
      });
    }
    parsedMessage = validated.message;
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
        resourceMetadataUrl: authChallengeMetadataUrl(request, cloudflareEnv),
      });
    }
    principal = await authenticateApiToken(
      db,
      bearerToken,
      resolveIssuerOrigin(request.url, cloudflareEnv?.SPOONJOY_BASE_URL),
    );
  } catch (error) {
    const response = authChallengeResponse(request, cloudflareEnv);
    return observeMcpResponse(params, {
      response,
      startedAt,
      errorCode: error instanceof ApiAuthError && error.status === 400 ? "malformed_authorization" : "invalid_token",
      resourceMetadataUrl: authChallengeMetadataUrl(request, cloudflareEnv),
    });
  }
  const expectedOrigin = resolveIssuerOrigin(request.url, cloudflareEnv?.SPOONJOY_BASE_URL);
  const resourceAllowed = await mcpOAuthResourceAllowed(db, principal, expectedOrigin);
  if (!resourceAllowed.allowed) {
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

  let productActivationPending = false;
  const router: JsonRpcToolRouter = {
    listTools() {
      return { tools: listSpoonjoyMcpTools() };
    },
    async callTool(name, args) {
      const context = buildSpoonjoyApiContext({ db, principal, cloudflareEnv, waitUntil });
      try {
        const text = await callSpoonjoyMcpTool(name, args, context);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        if (isCookbookMembershipCutoverToolError(name, error)) {
          productActivationPending = true;
          throw new JsonRpcError(
            PRODUCT_ACTIVATION_PENDING_JSON_RPC_CODE,
            PRODUCT_ACTIVATION_PENDING_MESSAGE,
            {
              code: PRODUCT_ACTIVATION_PENDING_CODE,
              retryable: true,
              retryAfterSeconds: PRODUCT_ACTIVATION_RETRY_AFTER_SECONDS,
            },
          );
        }
        throw error;
      }
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

  if (body === undefined) {
    const bodyResult = await readBody(principal);
    if ("response" in bodyResult) return bodyResult.response;
    body = bodyResult.body;
    const parsed = parseJsonRpcLine(body);
    if (parsed.ok) parsedMessage = parsed.value;
    else parsedError = parsed.error;
  }
  const jsonRpcTelemetry = mcpJsonRpcTelemetry(parsedMessage);
  if (jsonRpcTelemetry.toolName) {
    const grantedScopes = new Set(principal.scopes);
    const missingScopes = MCP_TOOL_SCOPES.get(jsonRpcTelemetry.toolName)!
      .filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length) {
      return observeMcpResponse(params, {
        response: insufficientScopeResponse(request, cloudflareEnv, missingScopes),
        startedAt,
        principal,
        legacyOAuthResourceAllowed: resourceAllowed.legacyAllowed,
        ...jsonRpcTelemetry,
        errorCode: "insufficient_scope",
      });
    }
  }
  const response = parsedError ?? await handleJsonRpcMessage(
    parsedMessage,
    router,
    {
      onError,
      era: transport.era,
      protocolVersion: transport.era === "legacy" ? MCP_LEGACY_VERSION : transport.protocolVersion,
    },
  );

  // Notifications (no id) produce no JSON-RPC response — ack with 202.
  if (response === null) {
    return observeMcpResponse(params, {
      response: new Response(null, { status: 202 }),
      startedAt,
      principal,
      legacyOAuthResourceAllowed: resourceAllowed.legacyAllowed,
      ...jsonRpcTelemetry,
      notification: true,
    });
  }

  const httpStatus = transport.era === "modern" && jsonRpcErrorCode(response) === -32601 ? 404 : 200;
  const httpResponse = jsonResponse(response, httpStatus);
  if (productActivationPending) {
    httpResponse.headers.set("Retry-After", String(PRODUCT_ACTIVATION_RETRY_AFTER_SECONDS));
    httpResponse.headers.set("Cache-Control", "private, no-store");
  }
  if (!isJsonRpcSuccessResponse(response)) {
    return observeMcpResponse(params, {
      response: httpResponse,
      startedAt,
      principal,
      legacyOAuthResourceAllowed: resourceAllowed.legacyAllowed,
      ...jsonRpcTelemetry,
      errorCode: "jsonrpc_error",
      jsonRpcErrorCode: jsonRpcErrorCode(response),
    });
  }
  return observeMcpResponse(params, {
    response: httpResponse,
    startedAt,
    principal,
    legacyOAuthResourceAllowed: resourceAllowed.legacyAllowed,
    ...jsonRpcTelemetry,
  });
}
