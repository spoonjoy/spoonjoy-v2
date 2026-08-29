import type { AppLoadContext } from "react-router";
import { classifyMcpTransportRequest } from "~/lib/mcp/http-mcp-protocol.server";
import { handleMcpHttpRequest } from "~/lib/mcp/http-mcp.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { getRequestDb } from "~/lib/route-platform.server";

export async function handleMcpRouteRequest(
  request: Request,
  context: AppLoadContext,
): Promise<Response> {
  const cloudflare = context.cloudflare;
  const ctx = cloudflare?.ctx;
  const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  const cloudflareEnv = cloudflare?.env;
  const decision = classifyMcpTransportRequest(request, {
    canonicalOrigin: resolveIssuerOrigin(request.url, cloudflareEnv?.SPOONJOY_BASE_URL),
  });
  if (decision.kind === "response") return decision.response;
  if (decision.kind === "landing") {
    throw new Error("MCP landing requests must be handled by the route loader.");
  }
  const db = await getRequestDb(context);

  return handleMcpHttpRequest({
    request,
    db,
    cloudflareEnv: cloudflareEnv ?? null,
    waitUntil,
    tokenLimiter: cloudflareEnv?.API_TOKEN_RATE_LIMITER,
    ipLimiter: cloudflareEnv?.API_IP_RATE_LIMITER,
  });
}
