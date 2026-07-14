import type { AppLoadContext } from "react-router";
import { handleMcpHttpRequest } from "~/lib/mcp/http-mcp.server";
import { getRequestDb } from "~/lib/route-platform.server";

export async function handleMcpPostRouteRequest(
  request: Request,
  context: AppLoadContext,
): Promise<Response> {
  const cloudflare = context.cloudflare;
  const ctx = cloudflare?.ctx;
  const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  const cloudflareEnv = cloudflare?.env;
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
