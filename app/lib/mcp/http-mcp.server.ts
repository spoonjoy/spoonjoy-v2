/**
 * HTTP MCP transport for the Spoonjoy Claude connector.
 *
 * A stateless remote Streamable-HTTP MCP endpoint: each POST carries one
 * JSON-RPC message, which we route through the shared transport-agnostic
 * core (`handleJsonRpcMessage`) against a `JsonRpcToolRouter` backed by the
 * same operation layer the REST API and stdio bridge use. Responses are
 * `application/json` (no SSE); notifications get a 202 with no body.
 *
 * Auth mirrors the REST surface: discovery (`initialize` / `tools/list`) is
 * open; `tools/call` resolves a principal (bearer token) and the operation
 * layer enforces per-tool authorization. Public bootstrap tools work
 * unauthenticated. Requests are rate-limited before any work.
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
  PUBLIC_BOOTSTRAP_OPERATIONS,
  resolveApiPrincipal,
} from "~/lib/spoonjoy-api-request.server";
import { protectedResourceMetadataUrl, resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import {
  enforceRateLimit,
  rateLimitedResponse,
  type RateLimiterBinding,
} from "~/lib/rate-limit.server";

interface CloudflareEnvLike {
  SESSION_SECRET?: string;
  OPENAI_API_KEY?: string;
  SPOONJOY_BASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PHOTOS?: R2Bucket;
}

export interface HandleMcpHttpRequestParams {
  request: Request;
  db: PrismaClientType;
  cloudflareEnv?: CloudflareEnvLike | null;
  waitUntil?: (promise: Promise<unknown>) => void;
  tokenLimiter?: RateLimiterBinding;
  ipLimiter?: RateLimiterBinding;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * If this message is a `tools/call` for a protected tool and the caller has no
 * valid principal, answer with an HTTP 401 carrying a `WWW-Authenticate` hint
 * at the protected-resource metadata. That's the signal an MCP client (e.g. the
 * claude.ai connector) uses to start the OAuth flow. `initialize`, `tools/list`,
 * and the public bootstrap tools stay open, and an authenticated caller (the
 * existing Claude Code bearer-token connection) is never challenged.
 */
async function authChallengeIfNeeded(
  body: string,
  request: Request,
  db: PrismaClientType,
  cloudflareEnv: CloudflareEnvLike | null | undefined,
): Promise<Response | null> {
  let parsed: { method?: unknown; params?: { name?: unknown } };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null; // let the JSON-RPC layer report the parse error
  }
  if (parsed?.method !== "tools/call") return null;

  const toolName = parsed.params?.name;
  if (typeof toolName !== "string" || PUBLIC_BOOTSTRAP_OPERATIONS.has(toolName)) {
    return null;
  }

  let principal = null;
  try {
    principal = await resolveApiPrincipal(db, request, cloudflareEnv, toolName);
  } catch {
    principal = null; // an invalid token on a protected op also warrants a challenge
  }
  if (principal) return null;

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

export async function handleMcpHttpRequest(params: HandleMcpHttpRequestParams): Promise<Response> {
  const { request, db, cloudflareEnv, waitUntil, tokenLimiter, ipLimiter } = params;

  if (request.method !== "POST") {
    return jsonResponse(
      { error: "method_not_allowed", message: "The MCP endpoint accepts POST." },
      405,
    );
  }

  const rateLimit = await enforceRateLimit({
    authorization: request.headers.get("Authorization"),
    ip: request.headers.get("CF-Connecting-IP"),
    tokenLimiter,
    ipLimiter,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  const router: JsonRpcToolRouter = {
    listTools() {
      return { tools: listSpoonjoyMcpTools() };
    },
    async callTool(name, args) {
      const principal = await resolveApiPrincipal(db, request, cloudflareEnv, name);
      const context = buildSpoonjoyApiContext({ db, principal, cloudflareEnv, waitUntil });
      const text = await callSpoonjoyMcpTool(name, args, context);
      return { content: [{ type: "text", text }] };
    },
  };

  const body = await request.text();

  const challenge = await authChallengeIfNeeded(body, request, db, cloudflareEnv);
  if (challenge) return challenge;

  const response = await handleJsonRpcLine(body, router);

  // Notifications (no id) produce no JSON-RPC response — ack with 202.
  if (response === null) {
    return new Response(null, { status: 202 });
  }

  return jsonResponse(response);
}
