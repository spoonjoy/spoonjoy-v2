import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceAuthRateLimit,
  enforceRateLimit,
  hashTokenForRateLimitKey,
  parseBearerToken,
  rateLimitedResponse,
  type RateLimiterBinding,
} from "~/lib/rate-limit.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";

function mockLimiter(success: boolean): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

function throwingLimiter(error: unknown = new Error("limiter backend down")): RateLimiterBinding & {
  limit: ReturnType<typeof vi.fn>;
} {
  return { limit: vi.fn().mockRejectedValue(error) };
}

function syncThrowingLimiter(error: unknown = new Error("limiter binding crashed synchronously")): RateLimiterBinding & {
  limit: ReturnType<typeof vi.fn>;
} {
  return {
    limit: vi.fn(() => {
      throw error;
    }),
  };
}

function hangingLimiter(): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(() => new Promise<{ success: boolean }>(() => {})) };
}

const POSTHOG_ENABLED: PostHogServerConfig = {
  enabled: true,
  key: "ph_test",
  host: "https://posthog.example",
};

function postHogFetchSpy() {
  return vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
}

function postHogBodies(
  fetchImpl: typeof fetch,
): Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string),
  );
}

describe("parseBearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearerToken("Bearer sj_abc123")).toBe("sj_abc123");
  });

  it("is case-insensitive on the Bearer prefix", () => {
    expect(parseBearerToken("bearer sj_abc")).toBe("sj_abc");
    expect(parseBearerToken("BEARER sj_abc")).toBe("sj_abc");
  });

  it("trims surrounding whitespace from the token", () => {
    expect(parseBearerToken("Bearer   sj_abc   ")).toBe("sj_abc");
  });

  it("returns null when the header is missing or empty", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
  });

  it("returns null for non-bearer auth schemes", () => {
    expect(parseBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearerToken("Digest realm=\"x\"")).toBeNull();
  });

  it("returns null when the bearer payload is empty after trim", () => {
    expect(parseBearerToken("Bearer    ")).toBeNull();
  });
});

describe("hashTokenForRateLimitKey", () => {
  it("returns a 64-character lowercase hex SHA-256 digest", async () => {
    const hash = await hashTokenForRateLimitKey("sj_test_token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    const a = await hashTokenForRateLimitKey("sj_same");
    const b = await hashTokenForRateLimitKey("sj_same");
    expect(a).toBe(b);
  });

  it("yields different hashes for different inputs", async () => {
    const a = await hashTokenForRateLimitKey("sj_a");
    const b = await hashTokenForRateLimitKey("sj_b");
    expect(a).not.toBe(b);
  });
});

describe("enforceRateLimit", () => {
  it("returns scope='skip' when no limiters configured", async () => {
    const result = await enforceRateLimit({ ip: "1.2.3.4" });
    expect(result).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      scope: "skip",
    });
  });

  it("returns scope='skip' with token but no token limiter", async () => {
    const result = await enforceRateLimit({
      authorization: "Bearer sj_x",
      ip: "1.2.3.4",
    });
    expect(result.scope).toBe("skip");
    expect(result.allowed).toBe(true);
  });

  it("uses the IP guard and token limiter when both token and limiter are present", async () => {
    const tokenLimiter = mockLimiter(true);
    const ipLimiter = mockLimiter(true);

    const result = await enforceRateLimit({
      authorization: "Bearer sj_test",
      ip: "1.2.3.4",
      tokenLimiter,
      ipLimiter,
    });

    expect(result).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      scope: "token",
    });
    expect(tokenLimiter.limit).toHaveBeenCalledTimes(1);
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "ip:1.2.3.4" });
    const callArg = tokenLimiter.limit.mock.calls[0][0] as { key: string };
    expect(callArg.key.startsWith("token:")).toBe(true);
    // 64 hex digits after the "token:" prefix
    expect(callArg.key.length).toBe("token:".length + 64);
  });

  it("denies with Retry-After=60 when the token limiter says !success", async () => {
    const tokenLimiter = mockLimiter(false);
    const result = await enforceRateLimit({
      authorization: "Bearer sj_test",
      ip: "1.2.3.4",
      tokenLimiter,
    });

    expect(result).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
      scope: "token",
    });
  });

  it("denies on the IP guard before hashing a rotating bearer token", async () => {
    const ipLimiter = mockLimiter(false);
    const tokenLimiter = mockLimiter(true);
    const result = await enforceRateLimit({
      authorization: "Bearer totally_fake_rotating_token",
      ip: "1.2.3.4",
      tokenLimiter,
      ipLimiter,
    });

    expect(result).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
      scope: "ip",
    });
    expect(tokenLimiter.limit).not.toHaveBeenCalled();
  });

  it("uses the IP limiter when no token is present", async () => {
    const ipLimiter = mockLimiter(true);
    const tokenLimiter = mockLimiter(true);

    const result = await enforceRateLimit({
      ip: "203.0.113.5",
      tokenLimiter,
      ipLimiter,
    });

    expect(result).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      scope: "ip",
    });
    expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "ip:203.0.113.5" });
    expect(tokenLimiter.limit).not.toHaveBeenCalled();
  });

  it("denies with Retry-After=60 when the IP limiter says !success", async () => {
    const ipLimiter = mockLimiter(false);
    const result = await enforceRateLimit({
      ip: "203.0.113.5",
      ipLimiter,
    });

    expect(result).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
      scope: "ip",
    });
  });

  it("returns scope='skip' when IP is missing", async () => {
    const ipLimiter = mockLimiter(false);
    const result = await enforceRateLimit({ ipLimiter });
    expect(result).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      scope: "skip",
    });
    expect(ipLimiter.limit).not.toHaveBeenCalled();
  });

  it("falls back to IP when token is malformed (Bearer header empty)", async () => {
    const ipLimiter = mockLimiter(true);
    const tokenLimiter = mockLimiter(false);

    const result = await enforceRateLimit({
      authorization: "Bearer   ",
      ip: "203.0.113.5",
      ipLimiter,
      tokenLimiter,
    });

    expect(result.scope).toBe("ip");
    expect(result.allowed).toBe(true);
    expect(tokenLimiter.limit).not.toHaveBeenCalled();
    expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
  });

  it("falls back to skip when token is malformed and no IP limiter configured", async () => {
    const result = await enforceRateLimit({
      authorization: "NotBearer something",
      ip: "203.0.113.5",
    });

    expect(result.scope).toBe("skip");
    expect(result.allowed).toBe(true);
  });
});

describe("rateLimitedResponse", () => {
  it("returns a 429 with Retry-After and JSON body", async () => {
    const response = rateLimitedResponse(60);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    const body = await response.json() as { error: string; message: string; retryAfterSeconds: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBe(60);
    expect(body.message).toMatch(/too many requests/i);
  });
});

describe("enforceAuthRateLimit", () => {
  function requestWithIp(ip: string | null): Request {
    const headers = new Headers();
    if (ip) headers.set("CF-Connecting-IP", ip);
    return new Request("https://spoonjoy.app/login", { method: "POST", headers });
  }

  it("blocks on the client IP when the limiter is exhausted", async () => {
    const ipLimiter = mockLimiter(false);
    const result = await enforceAuthRateLimit(requestWithIp("203.0.113.4"), ipLimiter);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60, scope: "ip" });
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "ip:203.0.113.4" });
  });

  it("allows when the limiter has headroom", async () => {
    const result = await enforceAuthRateLimit(requestWithIp("203.0.113.4"), mockLimiter(true));
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("ip");
  });

  it("uses X-Forwarded-For when Cloudflare has not supplied a connecting IP", async () => {
    const ipLimiter = mockLimiter(false);
    const request = new Request("https://spoonjoy.app/api/v1/auth/password/native", {
      method: "POST",
      headers: { "X-Forwarded-For": "198.51.100.7, 10.0.0.2" },
    });

    const result = await enforceAuthRateLimit(request, ipLimiter);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60, scope: "ip" });
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "ip:198.51.100.7" });
  });

  it("uses a shared unknown-host bucket instead of skipping when proxy headers are absent", async () => {
    const ipLimiter = mockLimiter(false);
    const request = new Request("http://127.0.0.1:6622/api/v1/auth/password/native", { method: "POST" });

    const result = await enforceAuthRateLimit(request, ipLimiter);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60, scope: "ip" });
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "ip:unknown:127.0.0.1:6622" });
  });

  it("fails open (skip) when no limiter binding is configured", async () => {
    const result = await enforceAuthRateLimit(requestWithIp("203.0.113.4"), undefined);
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
  });

  it("forwards postHogConfig so an auth limiter backend error is captured", async () => {
    const origFetch = globalThis.fetch;
    const phFetch = postHogFetchSpy();
    globalThis.fetch = phFetch;
    try {
      const result = await enforceAuthRateLimit(
        requestWithIp("203.0.113.4"),
        throwingLimiter(),
        POSTHOG_ENABLED,
      );
      expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
      const backendError = postHogBodies(phFetch).find(
        (b) => b.event === "spoonjoy.ratelimit.backend_error",
      );
      expect(backendError).toBeDefined();
      expect(backendError!.properties.scope).toBe("ip");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("enforceRateLimit — fail-open + backend-error capture (L6)", () => {
  let origFetch: typeof globalThis.fetch;
  let phFetch: ReturnType<typeof postHogFetchSpy>;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    phFetch = postHogFetchSpy();
    globalThis.fetch = phFetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("fails OPEN (allowed, scope=skip) when the IP limiter throws", async () => {
    const ipLimiter = throwingLimiter();
    const result = await enforceRateLimit({
      ip: "1.2.3.4",
      ipLimiter,
      postHogConfig: POSTHOG_ENABLED,
    });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
    expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
  });

  it("emits spoonjoy.ratelimit.backend_error + an exception when the IP limiter throws", async () => {
    await enforceRateLimit({
      ip: "1.2.3.4",
      ipLimiter: throwingLimiter(),
      postHogConfig: POSTHOG_ENABLED,
    });
    const bodies = postHogBodies(phFetch);
    const backendError = bodies.find((b) => b.event === "spoonjoy.ratelimit.backend_error");
    const exception = bodies.find((b) => b.event === "$exception");
    expect(backendError).toBeDefined();
    expect(backendError!.properties.scope).toBe("ip");
    expect(exception).toBeDefined();
    expect(exception!.properties.scope).toBe("ip");
    expect(exception!.properties.phase).toBe("limit");
  });

  it("fails OPEN when the TOKEN limiter throws (after the IP guard passes)", async () => {
    const ipLimiter = mockLimiter(true);
    const tokenLimiter = throwingLimiter();
    const result = await enforceRateLimit({
      authorization: "Bearer sj_test",
      ip: "1.2.3.4",
      ipLimiter,
      tokenLimiter,
      postHogConfig: POSTHOG_ENABLED,
    });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
    expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
    expect(tokenLimiter.limit).toHaveBeenCalledTimes(1);
    const backendError = postHogBodies(phFetch).find(
      (b) => b.event === "spoonjoy.ratelimit.backend_error",
    );
    expect(backendError!.properties.scope).toBe("token");
  });

  it("fails OPEN when a token-only limiter throws (no IP path)", async () => {
    const tokenLimiter = throwingLimiter();
    const result = await enforceRateLimit({
      authorization: "Bearer sj_only",
      tokenLimiter,
      postHogConfig: POSTHOG_ENABLED,
    });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
    expect(tokenLimiter.limit).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when a limiter never resolves", async () => {
    vi.useFakeTimers();
    try {
      const ipLimiter = hangingLimiter();
      const pending = enforceRateLimit({
        ip: "1.2.3.4",
        ipLimiter,
        postHogConfig: POSTHOG_ENABLED,
      });

      await vi.advanceTimersByTimeAsync(751);

      await expect(pending).resolves.toEqual({
        allowed: true,
        retryAfterSeconds: 0,
        scope: "skip",
      });
      expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
      const backendError = postHogBodies(phFetch).find(
        (b) => b.event === "spoonjoy.ratelimit.backend_error",
      );
      expect(backendError!.properties.scope).toBe("ip");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails open silently (no capture) when the limiter throws and no postHogConfig is set", async () => {
    const result = await enforceRateLimit({
      ip: "1.2.3.4",
      ipLimiter: throwingLimiter(),
      // no postHogConfig.
    });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
    expect(phFetch).not.toHaveBeenCalled();
  });

  it("fails open when a limiter throws synchronously before the timeout is scheduled", async () => {
    const result = await enforceRateLimit({
      ip: "1.2.3.4",
      ipLimiter: syncThrowingLimiter(),
      postHogConfig: { enabled: false, reason: "sync-crash" },
    });

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
  });

  it("does not capture when the limiter throws but postHogConfig is disabled", async () => {
    const result = await enforceRateLimit({
      ip: "1.2.3.4",
      ipLimiter: throwingLimiter(),
      postHogConfig: { enabled: false, reason: "missing-key" },
    });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0, scope: "skip" });
    expect(phFetch).not.toHaveBeenCalled();
  });
});
