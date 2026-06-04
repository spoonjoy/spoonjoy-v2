import { describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import {
  requestContentBytes,
  buildCaptureEventPayload,
  buildCaptureExceptionPayload,
  captureEvent,
  captureException,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";
import { DEFAULT_POSTHOG_HOST } from "~/lib/analytics";

describe("resolvePostHogServerConfig", () => {
  it("disables when POSTHOG_KEY is missing", () => {
    expect(resolvePostHogServerConfig({})).toEqual({
      enabled: false,
      reason: "missing-key",
    });
  });

  it("disables when POSTHOG_KEY is blank", () => {
    expect(resolvePostHogServerConfig({ POSTHOG_KEY: "   " })).toEqual({
      enabled: false,
      reason: "missing-key",
    });
  });

  it("disables when POSTHOG_DISABLED is true-ish", () => {
    expect(
      resolvePostHogServerConfig({
        POSTHOG_KEY: "ph_test",
        POSTHOG_DISABLED: "true",
      }),
    ).toEqual({ enabled: false, reason: "disabled" });

    expect(
      resolvePostHogServerConfig({
        POSTHOG_KEY: "ph_test",
        POSTHOG_DISABLED: "1",
      }),
    ).toEqual({ enabled: false, reason: "disabled" });
  });

  it("enables with default host when only POSTHOG_KEY is set", () => {
    expect(resolvePostHogServerConfig({ POSTHOG_KEY: "ph_test" })).toEqual({
      enabled: true,
      key: "ph_test",
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  it("uses POSTHOG_HOST when supplied", () => {
    expect(
      resolvePostHogServerConfig({
        POSTHOG_KEY: "ph_test",
        POSTHOG_HOST: "https://eu.posthog.example",
      }),
    ).toEqual({
      enabled: true,
      key: "ph_test",
      host: "https://eu.posthog.example",
    });
  });

  it("falls back to default host when POSTHOG_HOST is blank", () => {
    expect(
      resolvePostHogServerConfig({
        POSTHOG_KEY: "ph_test",
        POSTHOG_HOST: "   ",
      }),
    ).toEqual({
      enabled: true,
      key: "ph_test",
      host: DEFAULT_POSTHOG_HOST,
    });
  });
});

describe("analytics request context helpers", () => {
  it("reports valid content length values and treats invalid lengths as zero", () => {
    expect(requestContentBytes(new Request("https://spoonjoy.app/api"))).toBe(0);
    expect(requestContentBytes(new UndiciRequest("https://spoonjoy.app/api", {
      headers: { "Content-Length": "42" },
    }) as unknown as Request)).toBe(42);
    expect(requestContentBytes(new UndiciRequest("https://spoonjoy.app/api", {
      headers: { "Content-Length": "-1" },
    }) as unknown as Request)).toBe(0);
    expect(requestContentBytes(new UndiciRequest("https://spoonjoy.app/api", {
      headers: { "Content-Length": "many" },
    }) as unknown as Request)).toBe(0);
  });

  it("keeps domain hosts and omits malformed or IP-literal hosts", () => {
    expect(safeHeaderHost("https://Docs.Example:8443/start?token=secret")).toBe("docs.example:8443");
    expect(safeHeaderHost("not a url")).toBeUndefined();
    expect(safeHeaderHost("http://203.0.113.4:8443")).toBeUndefined();
    expect(safeHeaderHost("http://[2001:db8::1]/docs")).toBeUndefined();
    expect(safeHeaderHost(null)).toBeUndefined();
  });

  it("classifies user agents into coarse families only", () => {
    expect(userAgentFamily(null)).toBe("unknown");
    expect(userAgentFamily("PebbleKit/4.4")).toBe("pebble");
    expect(userAgentFamily("curl/8.7.1")).toBe("curl");
    expect(userAgentFamily("PostmanRuntime/7.39.0")).toBe("postman");
    expect(userAgentFamily("undici/7 node")).toBe("node");
    expect(userAgentFamily("Mozilla/5.0 Safari/605.1.15")).toBe("browser");
    expect(userAgentFamily("KitchenSyncBot/1.0")).toBe("other");
  });
});

describe("buildCaptureExceptionPayload", () => {
  const config = {
    enabled: true as const,
    key: "ph_test",
    host: DEFAULT_POSTHOG_HOST,
  };

  it("captures Error name, message, and stack", () => {
    const error = new TypeError("boom");
    const payload = buildCaptureExceptionPayload(
      config,
      {
        error,
        distinctId: "user_123",
        route: "/recipes/abc",
        method: "POST",
      },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.event).toBe("$exception");
    expect(payload.api_key).toBe("ph_test");
    expect(payload.distinct_id).toBe("user_123");
    expect(payload.timestamp).toBe("2026-05-27T20:00:00.000Z");
    expect(payload.properties.$exception_type).toBe("TypeError");
    expect(payload.properties.$exception_message).toBe("boom");
    expect(payload.properties.$exception_stack_trace_raw).toContain("TypeError");
    expect(payload.properties.route).toBe("/recipes/abc");
    expect(payload.properties.method).toBe("POST");
    expect(payload.properties.$lib).toBe("spoonjoy-server");
  });

  it("handles string throws", () => {
    const payload = buildCaptureExceptionPayload(
      config,
      { error: "string error", distinctId: "anon" },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.$exception_type).toBe("NonError");
    expect(payload.properties.$exception_message).toBe("string error");
    expect(payload.properties.$exception_stack_trace_raw).toBeNull();
  });

  it("handles plain-object throws via JSON.stringify", () => {
    const payload = buildCaptureExceptionPayload(
      config,
      { error: { code: 42, info: "weird" }, distinctId: "anon" },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.$exception_type).toBe("NonError");
    expect(payload.properties.$exception_message).toBe(
      '{"code":42,"info":"weird"}',
    );
  });

  it("handles non-stringifiable throws (circular refs)", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    const payload = buildCaptureExceptionPayload(
      config,
      { error: circular, distinctId: "anon" },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.$exception_type).toBe("NonError");
    expect(typeof payload.properties.$exception_message).toBe("string");
  });

  it("merges extras without clobbering exception properties", () => {
    const payload = buildCaptureExceptionPayload(
      config,
      {
        error: new Error("boom"),
        distinctId: "anon",
        extras: {
          requestId: "req_abc",
          $exception_message: "should not override",
        },
      },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.requestId).toBe("req_abc");
    expect(payload.properties.$exception_message).toBe("boom");
  });

  it("uses Error.name fallback when name is falsy", () => {
    const error = new Error("x");
    Object.defineProperty(error, "name", { value: "" });
    const payload = buildCaptureExceptionPayload(
      config,
      { error, distinctId: "anon" },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.$exception_type).toBe("Error");
  });

  it("uses null stack when Error.stack is undefined", () => {
    const error = new Error("no stack");
    Object.defineProperty(error, "stack", { value: undefined });
    const payload = buildCaptureExceptionPayload(
      config,
      { error, distinctId: "anon" },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.$exception_stack_trace_raw).toBeNull();
  });

  it("omits route and method when not provided", () => {
    const payload = buildCaptureExceptionPayload(
      config,
      { error: new Error("boom"), distinctId: "anon" },
      () => new Date("2026-05-27T20:00:00.000Z"),
    );

    expect(payload.properties.route).toBeUndefined();
    expect(payload.properties.method).toBeUndefined();
  });
});

describe("buildCaptureEventPayload", () => {
  const config = {
    enabled: true as const,
    key: "ph_test",
    host: DEFAULT_POSTHOG_HOST,
  };

  it("builds a generic server event payload with locked server metadata", () => {
    const payload = buildCaptureEventPayload(
      config,
      {
        event: "spoonjoy.api_v1.request",
        distinctId: "chef_123",
        properties: {
          route: "/api/v1/recipes/:id",
          method: "GET",
          status: 200,
          $lib: "caller-should-not-win",
        },
      },
      () => new Date("2026-06-03T14:00:00.000Z"),
    );

    expect(payload).toEqual({
      api_key: "ph_test",
      event: "spoonjoy.api_v1.request",
      distinct_id: "chef_123",
      timestamp: "2026-06-03T14:00:00.000Z",
      properties: {
        route: "/api/v1/recipes/:id",
        method: "GET",
        status: 200,
        $lib: "spoonjoy-server",
      },
    });
  });

  it("rejects non-Spoonjoy event names at payload construction time", () => {
    expect(() =>
      buildCaptureEventPayload(config, {
        event: "$pageview",
        distinctId: "chef_123",
      }),
    ).toThrow("PostHog server events must use a spoonjoy.* event name");
  });

  it("drops unsafe property keys and keeps safe sibling metadata", () => {
    const payload = buildCaptureEventPayload(config, {
      event: "spoonjoy.oauth.token",
      distinctId: "server",
      properties: {
        token: "sj_secret",
        accessToken: "oa_access",
        refresh_token: "or_refresh",
        authorization: "Bearer sj_secret",
        cookie: "session=abc",
        code_verifier: "pkce_secret",
        rawQueryString: "code=oac_secret&state=raw",
        requestBody: { token: "nested" },
        responseBody: { ok: true },
        stack: "Error: nope",
        route_template: "/oauth/token",
        status: 400,
        error_code: "invalid_grant",
      },
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("sj_secret");
    expect(serialized).not.toContain("oa_access");
    expect(serialized).not.toContain("or_refresh");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("session=abc");
    expect(serialized).not.toContain("pkce_secret");
    expect(serialized).not.toContain("oac_secret");
    expect(serialized).not.toContain("Error: nope");
    expect(payload.properties.route_template).toBe("/oauth/token");
    expect(payload.properties.status).toBe(400);
    expect(payload.properties.error_code).toBe("invalid_grant");
  });

  it("normalizes unsupported property values instead of leaking object contents", () => {
    const payload = buildCaptureEventPayload(config, {
      event: "spoonjoy.api_v1.request",
      distinctId: "chef_123",
      properties: {
        scopes: ["recipes:read", "shopping_list:write"],
        response: new Response("secret body"),
        request: new Request("https://spoonjoy.app/api/v1/recipes?query=soup"),
        nested: { query: "soup" },
        empty: null,
      },
    });

    expect(payload.properties.scopes).toEqual(["recipes:read", "shopping_list:write"]);
    expect(payload.properties.response).toBeUndefined();
    expect(payload.properties.request).toBeUndefined();
    expect(payload.properties.nested).toBeUndefined();
    expect(payload.properties.empty).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("soup");
    expect(JSON.stringify(payload)).not.toContain("secret body");
  });

  it("drops mixed arrays when any item is unsupported", () => {
    const payload = buildCaptureEventPayload(config, {
      event: "spoonjoy.api_v1.request",
      distinctId: "chef_123",
      properties: {
        safeScopes: ["recipes:read"],
        mixedValues: ["recipes:read", { requestBody: "secret" }],
      },
    });

    expect(payload.properties.safeScopes).toEqual(["recipes:read"]);
    expect(payload.properties.mixedValues).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("uses only locked server metadata when no properties are supplied", () => {
    const payload = buildCaptureEventPayload(config, {
      event: "spoonjoy.api_v1.request",
      distinctId: "chef_123",
    });

    expect(payload.properties).toEqual({ $lib: "spoonjoy-server" });
  });
});

describe("captureEvent", () => {
  it("is a no-op when config is disabled", async () => {
    const fetchSpy = vi.fn();
    await captureEvent(
      { enabled: false, reason: "missing-key" },
      { event: "spoonjoy.api_v1.request", distinctId: "anon" },
      fetchSpy as unknown as typeof fetch,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts generic events to the configured PostHog endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await captureEvent(
      { enabled: true, key: "ph_test", host: "https://posthog.example/" },
      {
        event: "spoonjoy.mcp.request",
        distinctId: "chef_1",
        properties: {
          route_template: "/mcp",
          method: "POST",
          status: 200,
        },
      },
      fetchSpy as unknown as typeof fetch,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://posthog.example/i/v0/e/");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("spoonjoy.mcp.request");
    expect(body.distinct_id).toBe("chef_1");
    expect(body.properties.route_template).toBe("/mcp");
    expect(body.properties.$lib).toBe("spoonjoy-server");
  });

  it("swallows fetch failures for generic events", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      captureEvent(
        { enabled: true, key: "ph_test", host: "https://posthog.example" },
        { event: "spoonjoy.api_v1.request", distinctId: "anon" },
        fetchSpy as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });

  it("falls back to the global fetch for generic events when no fetchImpl is provided", async () => {
    const globalFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      await captureEvent(
        { enabled: true, key: "ph_test", host: "https://posthog.example" },
        { event: "spoonjoy.api_v1.request", distinctId: "anon" },
      );
      expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalFetchSpy.mockRestore();
    }
  });
});

describe("captureException", () => {
  it("is a no-op when config is disabled (missing key)", async () => {
    const fetchSpy = vi.fn();
    await captureException(
      { enabled: false, reason: "missing-key" },
      { error: new Error("boom"), distinctId: "anon" },
      fetchSpy as unknown as typeof fetch,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when config is disabled (explicit)", async () => {
    const fetchSpy = vi.fn();
    await captureException(
      { enabled: false, reason: "disabled" },
      { error: new Error("boom"), distinctId: "anon" },
      fetchSpy as unknown as typeof fetch,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the configured PostHog capture endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await captureException(
      { enabled: true, key: "ph_test", host: "https://posthog.example" },
      {
        error: new Error("boom"),
        distinctId: "user_1",
        route: "/recipes",
        method: "GET",
      },
      fetchSpy as unknown as typeof fetch,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://posthog.example/i/v0/e/");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body.api_key).toBe("ph_test");
    expect(body.event).toBe("$exception");
    expect(body.distinct_id).toBe("user_1");
    expect(body.properties.route).toBe("/recipes");
    expect(body.properties.method).toBe("GET");
  });

  it("trims a trailing slash from the host", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await captureException(
      { enabled: true, key: "ph_test", host: "https://posthog.example/" },
      { error: new Error("boom"), distinctId: "anon" },
      fetchSpy as unknown as typeof fetch,
    );

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://posthog.example/i/v0/e/");
  });

  it("swallows fetch failures (capture must never affect the request)", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    await expect(
      captureException(
        { enabled: true, key: "ph_test", host: "https://posthog.example" },
        { error: new Error("boom"), distinctId: "anon" },
        fetchSpy as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });

  it("falls back to the global fetch when no fetchImpl is provided", async () => {
    const globalFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      await captureException(
        { enabled: true, key: "ph_test", host: "https://posthog.example" },
        { error: new Error("boom"), distinctId: "anon" },
      );
      expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalFetchSpy.mockRestore();
    }
  });
});
