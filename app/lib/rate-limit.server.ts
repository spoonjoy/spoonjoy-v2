/**
 * Rate limiting for /api/* REST endpoints and the MCP bearer surface.
 *
 * Uses Cloudflare's native Workers `RateLimit` binding (sliding window,
 * free tier). Two bindings are declared in `wrangler.json`:
 *
 * - `API_TOKEN_RATE_LIMITER` — keyed on SHA-256(bearer token). Allows
 *   bursty legitimate agent traffic (e.g. MCP doing bulk ops).
 * - `API_IP_RATE_LIMITER` — keyed on Cloudflare `CF-Connecting-IP`.
 *   Tighter to deter anonymous abuse of unauthenticated endpoints
 *   (health, agent-connection bootstrap).
 *
 * The check runs BEFORE auth so an attacker cannot bypass it by
 * sending invalid tokens to chew through D1 auth queries.
 *
 * Failure mode: this module fails OPEN. Rate limiting is hardening,
 * not a security boundary. If the binding is missing (local dev,
 * misconfigured deploy), the helper allows the request and reports
 * scope `"skip"` so callers can log the bypass if desired.
 */

import { Buffer } from "node:buffer";

export interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitContext {
  /** Raw `Authorization` header value, if any. */
  authorization?: string | null;
  /** Client IP — typically `request.headers.get('CF-Connecting-IP')`. */
  ip?: string | null;
  /** Limiter for authenticated bearer-token requests. */
  tokenLimiter?: RateLimiterBinding;
  /** Limiter for anonymous IP-based requests. */
  ipLimiter?: RateLimiterBinding;
}

export type RateLimitScope = "token" | "ip" | "skip";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds to wait before the next attempt. Always set when `allowed` is false. */
  retryAfterSeconds: number;
  scope: RateLimitScope;
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

const BEARER_PREFIX_REGEX = /^Bearer\s+(.+)$/i;

export function parseBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = BEARER_PREFIX_REGEX.exec(authorization);
  if (!match) return null;
  const token = match[1].trim();
  return token || null;
}

/**
 * Returns the SHA-256 of the token as a hex string. Hashing keeps the
 * raw token out of the rate-limit key space (which can show up in
 * observability tooling later).
 */
export async function hashTokenForRateLimitKey(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}

/**
 * Pick the right limiter + key for this request and call it.
 *
 * - If a bearer token is present and a token limiter is configured,
 *   uses the token path.
 * - Else if an IP is present and an IP limiter is configured, uses
 *   the IP path.
 * - Otherwise returns `{ allowed: true, scope: "skip" }`.
 */
export async function enforceRateLimit(
  ctx: RateLimitContext,
): Promise<RateLimitResult> {
  const token = parseBearerToken(ctx.authorization);

  if (token && ctx.tokenLimiter) {
    const key = `token:${await hashTokenForRateLimitKey(token)}`;
    const { success } = await ctx.tokenLimiter.limit({ key });
    return {
      allowed: success,
      retryAfterSeconds: success ? 0 : DEFAULT_RETRY_AFTER_SECONDS,
      scope: "token",
    };
  }

  if (ctx.ip && ctx.ipLimiter) {
    const key = `ip:${ctx.ip}`;
    const { success } = await ctx.ipLimiter.limit({ key });
    return {
      allowed: success,
      retryAfterSeconds: success ? 0 : DEFAULT_RETRY_AFTER_SECONDS,
      scope: "ip",
    };
  }

  return { allowed: true, retryAfterSeconds: 0, scope: "skip" };
}

/**
 * Build a 429 response with the standard `Retry-After` header.
 * Callers should also set their CORS / API headers on the response if
 * needed (this helper does not, so it stays generic).
 */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    {
      error: "rate_limited",
      message: "Too many requests. Try again later.",
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
