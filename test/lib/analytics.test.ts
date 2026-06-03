import { describe, expect, it, vi } from "vitest";
import {
  captureSafeClientEvent,
  DEFAULT_POSTHOG_HOST,
  isTruthyEnvFlag,
  latencyBucket,
  resolvePostHogConfig,
  responseStatusClass,
  safeClientTelemetryProperties,
  toAnalyticsPageUrl,
} from "~/lib/analytics";

describe("analytics configuration", () => {
  it("treats true-ish environment flags as enabled", () => {
    expect(isTruthyEnvFlag(true)).toBe(true);
    expect(isTruthyEnvFlag("1")).toBe(true);
    expect(isTruthyEnvFlag(" TRUE ")).toBe(true);
    expect(isTruthyEnvFlag("yes")).toBe(true);
    expect(isTruthyEnvFlag("on")).toBe(true);
  });

  it("treats false, missing, and unrecognized environment flags as disabled", () => {
    expect(isTruthyEnvFlag(false)).toBe(false);
    expect(isTruthyEnvFlag(undefined)).toBe(false);
    expect(isTruthyEnvFlag("0")).toBe(false);
    expect(isTruthyEnvFlag("false")).toBe(false);
    expect(isTruthyEnvFlag("off")).toBe(false);
  });

  it("disables PostHog when the key is missing or blank", () => {
    expect(resolvePostHogConfig({})).toEqual({
      enabled: false,
      reason: "missing-key",
    });
    expect(resolvePostHogConfig({ VITE_POSTHOG_KEY: "   " })).toEqual({
      enabled: false,
      reason: "missing-key",
    });
    expect(resolvePostHogConfig({ VITE_POSTHOG_KEY: true })).toEqual({
      enabled: false,
      reason: "missing-key",
    });
  });

  it("disables PostHog when the explicit disable flag is true-ish", () => {
    expect(
      resolvePostHogConfig({
        VITE_POSTHOG_KEY: "ph_test_key",
        VITE_POSTHOG_DISABLED: "true",
      })
    ).toEqual({
      enabled: false,
      reason: "disabled",
    });
    expect(
      resolvePostHogConfig({
        VITE_POSTHOG_KEY: "ph_test_key",
        VITE_POSTHOG_DISABLED: true,
      })
    ).toEqual({
      enabled: false,
      reason: "disabled",
    });
  });

  it("uses the default PostHog host when no custom host is configured", () => {
    expect(resolvePostHogConfig({ VITE_POSTHOG_KEY: " ph_test_key " })).toEqual({
      enabled: true,
      key: "ph_test_key",
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  it("uses a custom PostHog host when configured", () => {
    expect(
      resolvePostHogConfig({
        VITE_POSTHOG_KEY: "ph_test_key",
        VITE_POSTHOG_HOST: " https://eu.i.posthog.com ",
        VITE_POSTHOG_DISABLED: "false",
      })
    ).toEqual({
      enabled: true,
      key: "ph_test_key",
      host: "https://eu.i.posthog.com",
    });
  });

  it("uses origin and pathname for page URLs without query strings or hashes", () => {
    expect(toAnalyticsPageUrl(new URL("https://spoonjoy.app/recipes/abc?token=secret#step-2"))).toBe(
      "https://spoonjoy.app/recipes/abc"
    );
    expect(
      toAnalyticsPageUrl({
        origin: "https://spoonjoy.app",
        pathname: "/api/playground",
        search: "?access_token=secret",
        hash: "#oauth-code",
      } as Location)
    ).toBe("https://spoonjoy.app/api/playground");
  });
});

describe("safe client telemetry", () => {
  it("buckets response statuses and latency without preserving raw timing precision", () => {
    expect(responseStatusClass(0)).toBe("network");
    expect(responseStatusClass(204)).toBe("2xx");
    expect(responseStatusClass(302)).toBe("3xx");
    expect(responseStatusClass(403)).toBe("4xx");
    expect(responseStatusClass(503)).toBe("5xx");
    expect(responseStatusClass(102)).toBe("unknown");
    expect(responseStatusClass(600)).toBe("unknown");

    expect(latencyBucket(-1)).toBe("unknown");
    expect(latencyBucket(99)).toBe("lt_100ms");
    expect(latencyBucket(499)).toBe("100_499ms");
    expect(latencyBucket(1499)).toBe("500_1499ms");
    expect(latencyBucket(4999)).toBe("1500_4999ms");
    expect(latencyBucket(5000)).toBe("gte_5000ms");
  });

  it("keeps only controlled developer telemetry fields and drops unsafe values", () => {
    const safe = safeClientTelemetryProperties({
      page: "api_playground",
      surface: "full",
      operation_id: "POST /api/v1/tokens",
      operation_group: "Tokens",
      method: "POST",
      auth_mode: "bearer",
      auth_status: "authenticated",
      response_status: 201,
      response_status_class: "2xx",
      latency_bucket: "100_499ms",
      request_body_present: true,
      validation_error_count: 0,
      operation_count: Number.NaN,
      token: "sj_secret_token",
      authorization: "Bearer sj_secret_token",
      code: "oac_secret_code",
      code_verifier: "verifier_secret",
      state: "state_secret",
      raw_url: "https://spoonjoy.app/api/v1/recipes?token=sj_secret_token#code",
      query: "token=sj_secret_token",
      request_body: "{\"clientMutationId\":\"secret\",\"name\":\"Eggs\"}",
      response_body: "{\"token\":\"sj_secret_token\"}",
      headers: { Authorization: "Bearer sj_secret_token" },
      clientMutationId: "secret",
      example: "curl -H 'Authorization: Bearer sj_secret_token'",
    });

    expect(safe).toEqual({
      page: "api_playground",
      surface: "full",
      operation_id: "POST /api/v1/tokens",
      operation_group: "Tokens",
      method: "POST",
      auth_mode: "bearer",
      auth_status: "authenticated",
      response_status: 201,
      response_status_class: "2xx",
      latency_bucket: "100_499ms",
      request_body_present: true,
      validation_error_count: 0,
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("sj_secret_token");
    expect(serialized).not.toContain("oac_secret_code");
    expect(serialized).not.toContain("verifier_secret");
    expect(serialized).not.toContain("state_secret");
    expect(serialized).not.toContain("clientMutationId");
    expect(serialized).not.toContain("Eggs");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("https://spoonjoy.app");
    expect(serialized).not.toContain("?token=");
  });

  it("drops unsafe values even when the property key is allowlisted", () => {
    expect(safeClientTelemetryProperties({
      page: "api_playground",
      surface: "",
      operation_id: "GET /api/v1/recipes?query=private",
      operation_group: "Bearer sj_secret_token",
      method: "GET\nPOST",
      auth_mode: { mode: "session" },
      auth_status: "sj_secret_token",
      operation_kind: "read",
      operation_risk: "safe",
    })).toEqual({
      page: "api_playground",
      operation_kind: "read",
      operation_risk: "safe",
    });
  });

  it("captures only allowlisted Spoonjoy developer events", () => {
    const posthog = { capture: vi.fn() };

    captureSafeClientEvent(posthog, "spoonjoy.developer.playground.request_submitted", {
      operation_id: "GET /api/v1/recipes",
      operation_group: "Recipes",
      method: "GET",
      auth_mode: "anonymous",
      raw_url: "/api/v1/recipes?query=private",
    });
    captureSafeClientEvent(posthog, "raw_event_name", {
      operation_id: "GET /api/v1/recipes",
    });
    captureSafeClientEvent(null, "spoonjoy.developer.docs.viewed", { page: "api_docs" });
    captureSafeClientEvent({}, "spoonjoy.developer.docs.viewed", { page: "api_docs" });
    captureSafeClientEvent(posthog, "spoonjoy.developer.docs.viewed");

    expect(posthog.capture).toHaveBeenCalledTimes(2);
    expect(posthog.capture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.request_submitted",
      {
        operation_id: "GET /api/v1/recipes",
        operation_group: "Recipes",
        method: "GET",
        auth_mode: "anonymous",
      },
    );
    expect(posthog.capture).toHaveBeenCalledWith("spoonjoy.developer.docs.viewed", {});
  });
});
