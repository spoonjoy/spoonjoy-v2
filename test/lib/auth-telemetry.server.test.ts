import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureException: vi.fn(() => Promise.resolve()),
  captureEvent: vi.fn(() => Promise.resolve()),
}));

import { captureEvent, captureException } from "~/lib/analytics-server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";
import type { AppLoadContext } from "react-router";

function contextWith(
  env: Record<string, unknown> | null | undefined,
  options: { withWaitUntil?: boolean } = {},
): { context: AppLoadContext; waitUntil: ReturnType<typeof vi.fn> } {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  const ctx = options.withWaitUntil === false ? {} : { waitUntil };
  return {
    waitUntil,
    context: { cloudflare: { env, ctx } } as unknown as AppLoadContext,
  };
}

describe("authTelemetryFromContext", () => {
  beforeEach(() => {
    vi.mocked(captureException).mockClear();
    vi.mocked(captureEvent).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op when there is no cloudflare context at all", () => {
    const telemetry = authTelemetryFromContext({} as AppLoadContext);
    expect(telemetry.enabled).toBe(false);
    telemetry.captureException(new Error("boom"), { provider: "apple" });
    telemetry.captureEvent("spoonjoy.oauth.social_callback", "server", { provider: "apple" });
    expect(captureException).not.toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("is a no-op when env is missing", () => {
    const { context } = contextWith(undefined);
    const telemetry = authTelemetryFromContext(context);
    expect(telemetry.enabled).toBe(false);
    telemetry.captureException(new Error("boom"));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("is a no-op when waitUntil is unavailable", () => {
    const { context } = contextWith({ POSTHOG_KEY: "ph_test" }, { withWaitUntil: false });
    const telemetry = authTelemetryFromContext(context);
    expect(telemetry.enabled).toBe(false);
    telemetry.captureException(new Error("boom"));
    telemetry.captureEvent("spoonjoy.x", "server");
    expect(captureException).not.toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("is a no-op when PostHog is disabled (no key)", () => {
    const { context, waitUntil } = contextWith({});
    const telemetry = authTelemetryFromContext(context);
    expect(telemetry.enabled).toBe(false);
    telemetry.captureException(new Error("boom"));
    expect(waitUntil).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures exceptions through ctx.waitUntil when enabled", () => {
    const { context, waitUntil } = contextWith({ POSTHOG_KEY: "ph_test" });
    const telemetry = authTelemetryFromContext(context);
    expect(telemetry.enabled).toBe(true);

    const error = new Error("provider outage");
    telemetry.captureException(error, { provider: "google", phase: "userinfo", httpStatus: 503 });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test" }),
      {
        error,
        distinctId: "server",
        extras: { provider: "google", phase: "userinfo", httpStatus: 503 },
      },
    );
    // The capture promise is scheduled on waitUntil, never awaited inline.
    const captureResult = vi.mocked(captureException).mock.results.at(-1);
    expect(captureResult?.type).toBe("return");
    expect(waitUntil).toHaveBeenCalledWith(captureResult!.value);
  });

  it("captures events through ctx.waitUntil when enabled", () => {
    const { context, waitUntil } = contextWith({ POSTHOG_KEY: "ph_test", POSTHOG_HOST: "https://ph.example" });
    const telemetry = authTelemetryFromContext(context);

    telemetry.captureEvent("spoonjoy.oauth.social_callback", "server", {
      provider: "github",
      outcome: "error",
      error_code: "invalid_state",
      phase: "invalid_state",
    });

    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, key: "ph_test", host: "https://ph.example" }),
      {
        event: "spoonjoy.oauth.social_callback",
        distinctId: "server",
        properties: {
          provider: "github",
          outcome: "error",
          error_code: "invalid_state",
          phase: "invalid_state",
        },
      },
    );
    const eventResult = vi.mocked(captureEvent).mock.results.at(-1);
    expect(waitUntil).toHaveBeenCalledWith(eventResult!.value);
  });
});
