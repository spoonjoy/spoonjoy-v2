import type { Route } from "./+types/oauth.token";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleOAuthToken } from "~/lib/oauth-routes.server";
import { enforceRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";

// RFC 6749 token endpoint (authorization_code + PKCE) — thin shell.
// Throttle per-IP before any work so an attacker can't burn auth codes /
// refresh tokens through repeated guesses against this unauthenticated
// endpoint. (Codes are 256-bit random with a 60s TTL, so success probability
// is already negligible — but the endpoint shouldn't be uncapped.)
export async function action({ request, context }: Route.ActionArgs) {
  const cfEnv = context.cloudflare?.env;
  const rateLimit = await enforceRateLimit({
    ip: request.headers.get("CF-Connecting-IP"),
    ipLimiter: cfEnv?.API_IP_RATE_LIMITER,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);

  const db = await getRequestDb(context);
  return handleOAuthToken(request, db, cfEnv);
}
