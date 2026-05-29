import type { Route } from "./+types/oauth.register";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleOAuthRegister } from "~/lib/oauth-routes.server";
import { enforceRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";

// RFC 7591 Dynamic Client Registration — thin shell over the measured handler.
// DCR is unauthenticated by design; without per-IP throttling an attacker can
// create unbounded OAuthClient rows (DB-fill / resource-exhaustion abuse). The
// per-IP cap forces any meaningful fill attempt across many IPs, which is
// substantially more costly.
export async function action({ request, context }: Route.ActionArgs) {
  const cfEnv = context.cloudflare?.env;
  const rateLimit = await enforceRateLimit({
    ip: request.headers.get("CF-Connecting-IP"),
    ipLimiter: cfEnv?.API_IP_RATE_LIMITER,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);

  const db = await getRequestDb(context);
  return handleOAuthRegister(request, db);
}
