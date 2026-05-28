import type { Route } from "./+types/mcp";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleMcpHttpRequest } from "~/lib/mcp/http-mcp.server";

/**
 * Remote MCP connector endpoint (Streamable HTTP, `application/json`).
 *
 * Thin shell over `handleMcpHttpRequest` — mirrors `api.$.ts`'s context
 * assembly so the real logic stays in the coverage-measured lib. GET hits
 * `loader` (→ 405 inside the handler); POST hits `action`.
 */
async function handle({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const cloudflare = context.cloudflare;
  const ctx = cloudflare?.ctx;
  const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  const cfEnv = cloudflare?.env;
  const db = await getRequestDb(context);

  return handleMcpHttpRequest({
    request,
    db,
    cloudflareEnv: cfEnv ?? null,
    waitUntil,
    tokenLimiter: cfEnv?.API_TOKEN_RATE_LIMITER,
    ipLimiter: cfEnv?.API_IP_RATE_LIMITER,
  });
}

export async function loader(args: Route.LoaderArgs) {
  return handle(args);
}

export async function action(args: Route.ActionArgs) {
  return handle(args);
}
