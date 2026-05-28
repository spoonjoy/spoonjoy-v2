import { describe, expect, it, vi } from "vitest";
import {
  buildCaptureExceptionPayload,
  captureException,
  resolvePostHogServerConfig,
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
