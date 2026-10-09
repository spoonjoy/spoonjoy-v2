/**
 * Rate limiting for /api/* REST endpoints and the MCP bearer surface.
 *
 * Uses Cloudflare's native Workers `RateLimit` binding (sliding window,
 * free tier). Bindings are declared in `wrangler.json`:
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
import {
  captureEvent,
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

export interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean; reset?: number }>;
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
  /**
   * Optional telemetry config. When a present limiter's `.limit()` throws,
   * the module fails open (allows the request, scope `"skip"`) and — if this
   * is set and enabled — emits `spoonjoy.ratelimit.backend_error` so the
   * otherwise-silent unprotected window is observable.
   */
  postHogConfig?: PostHogServerConfig;
}

export type RateLimitScope = "token" | "ip" | "skip";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds to wait before the next attempt. Always set when `allowed` is false. */
  retryAfterSeconds: number;
  scope: RateLimitScope;
}

export const DEFAULT_RETRY_AFTER_SECONDS = 60;
const LIMITER_TIMEOUT_MS = 750;

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

/** Sentinel returned by {@link safeLimit} when the binding's `.limit()` threw. */
const LIMITER_ERRORED = Symbol("limiter_errored");

/**
 * Call a limiter binding, failing OPEN if it throws. Rate limiting is
 * hardening, not a security boundary — a backend error must never 500 the
 * request. The throw is captured (when `postHogConfig` is set) so the
 * unprotected window does not go silent, then {@link LIMITER_ERRORED} signals
 * the caller to skip the guard.
 */
async function safeLimit(
  limiter: RateLimiterBinding,
  key: string,
  scope: Exclude<RateLimitScope, "skip"> | "user",
  ctx: RateLimitContext,
): Promise<{ success: boolean; reset?: number } | typeof LIMITER_ERRORED> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      limiter.limit({ key }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Rate limiter timed out after ${LIMITER_TIMEOUT_MS}ms.`));
        }, LIMITER_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const config = ctx.postHogConfig;
    if (config?.enabled) {
      // Fire-and-forget; capture helpers swallow their own failures. No
      // waitUntil is plumbed here, so await defensively — capture must not
      // throw and must not change the fail-open outcome.
      await captureException(config, {
        error,
        distinctId: "ratelimit",
        extras: { scope, phase: "limit" },
      });
      await captureEvent(config, {
        event: "spoonjoy.ratelimit.backend_error",
        distinctId: "ratelimit",
        properties: { scope },
      });
    }
    return LIMITER_ERRORED;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Pick the right limiter + key for this request and call it.
 *
 * - If an IP is present and an IP limiter is configured, applies an IP guard.
 * - If a bearer token is present and a token limiter is configured, also
 *   applies the token path. This keeps invalid-token rotation from bypassing
 *   rate limits before auth can reject the token.
 * - Otherwise returns `{ allowed: true, scope: "skip" }`.
 *
 * Fails OPEN on a limiter backend error: returns `{ allowed: true, scope:
 * "skip" }` and emits `spoonjoy.ratelimit.backend_error` (see {@link safeLimit}).
 */
export async function enforceRateLimit(
  ctx: RateLimitContext,
): Promise<RateLimitResult> {
  const token = parseBearerToken(ctx.authorization);

  if (ctx.ip && ctx.ipLimiter) {
    const key = `ip:${ctx.ip}`;
    const ipResult = await safeLimit(ctx.ipLimiter, key, "ip", ctx);
    if (ipResult === LIMITER_ERRORED) {
      return { allowed: true, retryAfterSeconds: 0, scope: "skip" };
    }
    if (!ipResult.success) {
      return {
        allowed: false,
        retryAfterSeconds: retryAfterSecondsForLimitResult(ipResult),
        scope: "ip",
      };
    }
    if (!token || !ctx.tokenLimiter) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        scope: "ip",
      };
    }
  }

  if (token && ctx.tokenLimiter) {
    const key = `token:${await hashTokenForRateLimitKey(token)}`;
    const tokenResult = await safeLimit(ctx.tokenLimiter, key, "token", ctx);
    if (tokenResult === LIMITER_ERRORED) {
      return { allowed: true, retryAfterSeconds: 0, scope: "skip" };
    }
    return {
      allowed: tokenResult.success,
      retryAfterSeconds: tokenResult.success ? 0 : retryAfterSecondsForLimitResult(tokenResult),
      scope: "token",
    };
  }

  return { allowed: true, retryAfterSeconds: 0, scope: "skip" };
}

function retryAfterSecondsForLimitResult(result: { reset?: number }): number {
  if (typeof result.reset === "number" && Number.isFinite(result.reset) && result.reset > 0) {
    return Math.ceil(result.reset);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Throttle anonymous auth attempts (login, signup, passkey sign-in) per
 * client IP to blunt brute-force and credential-stuffing. Uses the dedicated
 * `AUTH_IP_RATE_LIMITER` binding (tighter than the general API limiter).
 *
 * Fails OPEN like {@link enforceRateLimit}: with no binding (local dev, tests)
 * the attempt is allowed and reported as scope `"skip"`. An optional
 * `postHogConfig` lets callers surface limiter backend errors.
 */
export async function enforceAuthRateLimit(
  request: Request,
  ipLimiter: RateLimiterBinding | undefined,
  postHogConfig?: PostHogServerConfig,
): Promise<RateLimitResult> {
  return enforceRateLimit({
    ip: clientIpForRateLimit(request),
    ipLimiter,
    postHogConfig,
  });
}

function clientIpForRateLimit(request: Request): string {
  const forwardedFor = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || null;
  const ip = request.headers.get("CF-Connecting-IP") ?? forwardedFor;
  return ip ? ipv6NetworkForRateLimit(ip) : `unknown:${new URL(request.url).host}`;
}

/**
 * One IPv6 subscriber usually holds a whole /64, so keying on the full
 * address would hand them about 2^64 separate budgets. Key IPv6 on its /64
 * network instead. An IPv4-mapped address (::ffff:a.b.c.d) is keyed on its
 * IPv4 address, so mapped clients never share one bucket. IPv4 and anything
 * that is not a well-formed IPv6 address pass through unchanged.
 */
export function ipv6NetworkForRateLimit(ip: string): string {
  if (!ip.includes(":")) return ip;
  const groups = parseIpv6Groups(ip.split("%")[0]);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of a well-formed IPv6 address, or null. */
function parseIpv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parsed = halves.map((half) => (half ? half.split(":") : []));
  const last = parsed[parsed.length - 1];
  const tail = last[last.length - 1];
  if (tail?.includes(".")) {
    const octets = tail.split(".");
    if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return null;
    const [a, b, c, d] = octets.map(Number);
    last.splice(last.length - 1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
  }
  const parts = parsed.flat();
  if (!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return null;
  if (halves.length === 1 ? parts.length !== 8 : parts.length > 7) return null;
  const head = parsed[0];
  const rest = halves.length === 2 ? parsed[1] : [];
  const groups = [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest];
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * Throttle guesses at agent connection codes on `/agent/connect`. The
 * per-address check (IPv6 grouped by /64) is the main protection, because the
 * lookup does not require sign-in; signed-in chefs also get a per-user check,
 * so adding addresses does not buy a signed-in guesser more tries. The user is
 * resolved only after the address check passes. Uses the
 * `AUTH_IP_RATE_LIMITER` binding under its own key prefix, so code lookups
 * never spend the login and signup budget.
 *
 * Fails OPEN like {@link enforceRateLimit}, one check at a time.
 */
export async function enforceAgentCodeLookupRateLimit(
  request: Request,
  limiter: RateLimiterBinding | undefined,
  resolveUserId: () => Promise<string | null>,
  postHogConfig?: PostHogServerConfig,
): Promise<Omit<RateLimitResult, "scope"> & { scope: "ip" | "user" | "skip" }> {
  if (!limiter) return { allowed: true, retryAfterSeconds: 0, scope: "skip" };
  const ctx: RateLimitContext = { postHogConfig };
  let scope: "ip" | "user" | "skip" = "skip";
  const check = async (key: string, checkScope: "ip" | "user") => {
    const result = await safeLimit(limiter, key, checkScope, ctx);
    if (result === LIMITER_ERRORED) return null;
    if (!result.success) {
      return { allowed: false, retryAfterSeconds: retryAfterSecondsForLimitResult(result), scope: checkScope };
    }
    scope = checkScope;
    return null;
  };
  const refusedByAddress = await check(`agent-code:ip:${clientIpForRateLimit(request)}`, "ip");
  if (refusedByAddress) return refusedByAddress;
  const userId = await resolveUserId();
  if (userId) {
    const refusedByUser = await check(`agent-code:user:${userId}`, "user");
    if (refusedByUser) return refusedByUser;
  }
  return { allowed: true, retryAfterSeconds: 0, scope };
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
