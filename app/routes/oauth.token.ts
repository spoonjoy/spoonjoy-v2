import type { Route } from "./+types/oauth.token";
import { applyOAuthCorsHeaders, oauthCorsPreflightResponse } from "~/lib/oauth-cors.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  handleOAuthToken,
  oauthTokenTelemetryFor,
  type OAuthTokenTelemetryMetadata,
} from "~/lib/oauth-routes.server";
import { enforceRateLimit, rateLimitedResponse, type RateLimitScope } from "~/lib/rate-limit.server";
import {
  captureEvent,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";

function observeOAuthTokenResponse(
  args: Pick<Route.ActionArgs, "context" | "request">,
  input: {
    response: Response;
    startedAt: number;
    telemetry?: OAuthTokenTelemetryMetadata;
    rateLimitScope?: RateLimitScope;
  },
): Response {
  const cloudflare = args.context.cloudflare;
  const env = cloudflare?.env;
  const waitUntil = cloudflare?.ctx?.waitUntil ? cloudflare.ctx.waitUntil.bind(cloudflare.ctx) : undefined;
  if (!env || !waitUntil) return input.response;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return input.response;

  const telemetry = { ...oauthTokenTelemetryFor(input.response), ...input.telemetry };
  waitUntil(captureEvent(postHogConfig, {
    event: "spoonjoy.oauth.token",
    distinctId: telemetry.clientId ?? "anon",
    properties: {
      route_template: "/oauth/token",
      method: args.request.method,
      status: input.response.status,
      outcome: telemetry.outcome ?? (input.response.status >= 400 ? "error" : undefined),
      grant_type: telemetry.grantType ?? "unknown",
      error_code: telemetry.errorCode,
      client_id: telemetry.clientId,
      scope: telemetry.scope,
      resource: telemetry.resource,
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

// RFC 6749 token endpoint (authorization_code + PKCE) — thin shell.
// Throttle per-IP before any work so an attacker can't burn auth codes /
// refresh tokens through repeated guesses against this unauthenticated
// endpoint. (Codes are 256-bit random with a 60s TTL, so success probability
// is already negligible — but the endpoint shouldn't be uncapped.)
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
    return observeOAuthTokenResponse({ request, context }, {
      response: applyOAuthCorsHeaders(response),
      startedAt,
      telemetry: {
        outcome: "rate_limited",
        grantType: "unknown",
        errorCode: "rate_limited",
      },
      rateLimitScope: rateLimit.scope,
    });
  }

  const db = await getRequestDb(context);
  const response = await handleOAuthToken(request, db, cfEnv);
  return observeOAuthTokenResponse({ request, context }, {
    response: applyOAuthCorsHeaders(response),
    startedAt,
  });
}
