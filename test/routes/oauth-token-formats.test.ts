import { describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action as tokenAction } from "~/routes/oauth.token";

const Request = UndiciRequest as unknown as typeof globalThis.Request;

function routeArgs(request: Request, env: Record<string, unknown> | null = null) {
  return { request, context: { cloudflare: { env } }, params: {} } as never;
}

function tokenRequest(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request("https://spoonjoy.app/oauth/token", { method: "POST", headers, body: new URLSearchParams(fields) });
}

describe("/oauth/token response formats", () => {
  it("answers a refused grant with OAuth error JSON, not Spoonjoy's API envelope", async () => {
    const response = await tokenAction(routeArgs(tokenRequest({ grant_type: "password", username: "chef", password: "secret" })));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ error: "unsupported_grant_type" });
    expect(body).not.toHaveProperty("ok");
    expect(body).not.toHaveProperty("requestId");
  });

  it("answers a rate-limited request with Spoonjoy's 429 body and Retry-After instead of an OAuth error", async () => {
    const response = await tokenAction(routeArgs(
      tokenRequest({ grant_type: "refresh_token", refresh_token: "ort_unused" }, { "CF-Connecting-IP": "203.0.113.9" }),
      { API_IP_RATE_LIMITER: { limit: async () => ({ success: false }) } },
    ));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
    await expect(response.json()).resolves.toEqual({
      error: "rate_limited",
      message: "Too many requests. Try again later.",
      retryAfterSeconds: Number(response.headers.get("Retry-After")),
    });
  });
});
