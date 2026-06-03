import type { Route } from "./+types/oauth.register";
import { applyOAuthCorsHeaders, oauthCorsPreflightResponse } from "~/lib/oauth-cors.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleOAuthRegister, oauthRegisterTelemetryFor, type OAuthRegisterTelemetryMetadata } from "~/lib/oauth-routes.server";
import { enforceRateLimit, rateLimitedResponse, type RateLimitScope } from "~/lib/rate-limit.server";
import {
  captureEvent,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";

function observeOAuthRegisterResponse(
  args: Pick<Route.ActionArgs, "context" | "request">,
  input: {
    response: Response;
    startedAt: number;
    telemetry?: OAuthRegisterTelemetryMetadata;
    rateLimitScope?: RateLimitScope;
  },
): Response {
  const cloudflare = args.context.cloudflare;
  const env = cloudflare?.env;
  const waitUntil = cloudflare?.ctx?.waitUntil ? cloudflare.ctx.waitUntil.bind(cloudflare.ctx) : undefined;
  if (!env || !waitUntil) return input.response;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return input.response;

  const telemetry = { ...oauthRegisterTelemetryFor(input.response), ...input.telemetry };
  waitUntil(captureEvent(postHogConfig, {
    event: "spoonjoy.oauth.register",
    distinctId: telemetry.clientId ?? "anon",
    properties: {
      route_template: "/oauth/register",
      method: args.request.method,
      status: input.response.status,
      error_code: telemetry.errorCode,
      client_id: telemetry.clientId,
      redirect_uri_count: telemetry.redirectUriCount,
      scope_count: telemetry.scopeCount,
      request_bytes: requestContentBytes(args.request),
      origin_host: safeHeaderHost(args.request.headers.get("Origin")),
      referrer_host: safeHeaderHost(args.request.headers.get("Referer")),
      user_agent_family: userAgentFamily(args.request.headers.get("User-Agent")),
      rate_limit_scope: input.rateLimitScope,
      latency_ms: Math.max(0, Date.now() - input.startedAt),
    },
  }));

  return input.response;
}

// RFC 7591 Dynamic Client Registration — thin shell over the measured handler.
// DCR is unauthenticated by design; without per-IP throttling an attacker can
// create unbounded OAuthClient rows (DB-fill / resource-exhaustion abuse). The
// per-IP cap forces any meaningful fill attempt across many IPs, which is
// substantially more costly.
export async function action({ request, context }: Route.ActionArgs) {
  const startedAt = Date.now();
  const preflight = oauthCorsPreflightResponse(request);
  if (preflight) return preflight;

  const cfEnv = context.cloudflare?.env;
  const rateLimit = await enforceRateLimit({
    ip: request.headers.get("CF-Connecting-IP"),
    ipLimiter: cfEnv?.API_IP_RATE_LIMITER,
  });
  if (!rateLimit.allowed) {
    const response = rateLimitedResponse(rateLimit.retryAfterSeconds);
    return observeOAuthRegisterResponse({ request, context }, {
      response: applyOAuthCorsHeaders(response),
      startedAt,
      telemetry: { errorCode: "rate_limited" },
      rateLimitScope: rateLimit.scope,
    });
  }

  const db = await getRequestDb(context);
  const response = await handleOAuthRegister(request, db);
  return observeOAuthRegisterResponse({ request, context }, {
    response: applyOAuthCorsHeaders(response),
    startedAt,
  });
}
