import { describe, expect, it, vi } from "vitest";
import {
  enforceRateLimit,
  hashTokenForRateLimitKey,
  parseBearerToken,
  rateLimitedResponse,
  type RateLimiterBinding,
} from "~/lib/rate-limit.server";

function mockLimiter(success: boolean): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn().mockResolvedValue({ success }) };
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

  it("uses the token limiter when both token and limiter present", async () => {
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
    expect(ipLimiter.limit).not.toHaveBeenCalled();
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
