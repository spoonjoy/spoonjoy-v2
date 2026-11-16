import { describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";

function routeArgs(request: Request, env: Record<string, unknown> | null) {
  return { request, params: { "*": "native/config" }, context: { cloudflare: { env } } } as any;
}

function configRequest(requestId: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new UndiciRequest("http://localhost/api/v1/native/config", {
    method: init.method ?? "GET",
    headers: { "X-Request-Id": requestId, ...init.headers },
  }) as unknown as Request;
}

const FEATURES = ["cook-session-sync", "spotlight-indexing"];

describe("GET /api/v1/native/config", () => {
  it("is public and needs no scopes", () => {
    expect(resolveApiV1ScopeRequirement("GET", "native/config")).toEqual({ auth: "optional", scopes: [] });
  });

  it("answers every feature on, in a response any cache may keep for a minute, when nothing is switched off", async () => {
    const response = await loader(routeArgs(configRequest("req_native_config"), null));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Vary")).toBeNull();
    expect(response.headers.get("X-Request-Id")).toBe("req_native_config");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      requestId: "req_native_config",
      data: { killSwitches: {}, features: FEATURES },
    });
  });

  it("answers the features the Worker's SPOONJOY_NATIVE_KILL_SWITCHES turns off", async () => {
    const response = await loader(routeArgs(configRequest("req_native_config_off"), {
      SPOONJOY_NATIVE_KILL_SWITCHES: "{\"cook-session-sync\":\"Cook sessions are down\"}",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { killSwitches: { "cook-session-sync": { off: true, reason: "Cook sessions are down" } }, features: FEATURES },
    });
  });

  it("answers every feature on when the variable is garbled", async () => {
    const response = await loader(routeArgs(configRequest("req_native_config_garbled"), {
      SPOONJOY_NATIVE_KILL_SWITCHES: "{\"cook-session-sync\":",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { killSwitches: {} } });
  });

  it("ignores credentials, so an expired or unknown token still gets the switches", async () => {
    const response = await loader(routeArgs(configRequest("req_native_config_token", {
      headers: { Authorization: "Bearer sj_not_a_real_token" },
    }), { SPOONJOY_NATIVE_KILL_SWITCHES: "spotlight-indexing" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    await expect(response.json()).resolves.toMatchObject({
      data: { killSwitches: { "spotlight-indexing": { off: true, reason: null } } },
    });
  });

  it("answers only GET", async () => {
    const response = await action(routeArgs(configRequest("req_native_config_post", { method: "POST" }), null));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_native_config_post",
      error: { code: "method_not_allowed", status: 405 },
    });
  });
});
