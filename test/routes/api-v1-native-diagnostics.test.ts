import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { captureEvent } from "~/lib/analytics-server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

const INSTALL_ID = "0B1C2D3E-4F50-4617-8293-A4B5C6D7E8F9";

function routeArgs(request: Request, splat: string, env: Record<string, unknown> = { POSTHOG_KEY: "ph_test" }) {
  const waitUntil = vi.fn();
  return {
    args: { request, params: { "*": splat }, context: { cloudflare: { env, ctx: { waitUntil } } } },
    waitUntil,
  } as const;
}

function diagnosticsRequest(token: string | null, requestId: string, body: unknown, path = "native/diagnostics") {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    "User-Agent": "Spoonjoy/1.2.2 CFNetwork/1700 Darwin/27.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function captures(event?: string) {
  return vi.mocked(captureEvent).mock.calls
    .map(([, input]) => input)
    .filter((input) => (event ? input.event === event : input.event.startsWith("spoonjoy.native.")));
}

const crashBody = {
  kind: "crash",
  diagnosticId: "diag-crash-1",
  installId: INSTALL_ID,
  environment: "production",
  platform: "ios",
  appVersion: "1.2",
  buildNumber: "170",
  osVersion: "iPhone OS 27.1 (25B74)",
  deviceModel: "iPhone17,1",
  timestampBegin: "2026-11-14T00:00:00Z",
  timestampEnd: "2026-11-15T00:00:00Z",
  exceptionType: 1,
  exceptionCode: "18446744073709551615",
  signal: 11,
  terminationReason: "Namespace SIGNAL, Code 11 Segmentation fault: 11",
  frames: [
    { binaryName: "Spoonjoy", binaryUUID: "70B89F27-1634-3580-A695-57CDB41D7743", offsetIntoBinaryTextSegment: 255 },
    { binaryName: "SwiftUI", offsetIntoBinaryTextSegment: 4096 },
    { binaryName: "libdyld.dylib", binaryUUID: null, offsetIntoBinaryTextSegment: 0 },
  ],
};

describe("API v1 native diagnostics (MetricKit crashes and hangs)", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("forwards a signed-in crash to PostHog as spoonjoy.native.crash under the account id", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Native diagnostics", { scopes: ["account:read"] });

    const context = routeArgs(diagnosticsRequest(credential.token, "req_crash", crashBody), "native/diagnostics");
    const response = await action(context.args);

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ ok: true, requestId: "req_crash", data: { accepted: true } });
    expect(context.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    expect(captures()).toEqual([
      {
        event: "spoonjoy.native.crash",
        distinctId: user.id,
        properties: {
          diagnostic_kind: "crash",
          diagnostic_id: "diag-crash-1",
          install_id: INSTALL_ID,
          environment: "production",
          platform: "ios",
          app_version: "1.2",
          build_number: "170",
          os_version: "iPhone OS 27.1 (25B74)",
          device_model: "iPhone17,1",
          timestamp_begin: "2026-11-14T00:00:00Z",
          timestamp_end: "2026-11-15T00:00:00Z",
          exception_type: 1,
          exception_code: "18446744073709551615",
          signal: 11,
          termination_reason: "Namespace SIGNAL, Code 11 Segmentation fault: 11",
          hang_duration_milliseconds: null,
          frame_count: 3,
          top_frame: "Spoonjoy+0xff [70B89F27-1634-3580-A695-57CDB41D7743]",
          frames: [
            "Spoonjoy+0xff [70B89F27-1634-3580-A695-57CDB41D7743]",
            "SwiftUI+0x1000",
            "libdyld.dylib+0x0",
          ],
          server_request_id: "req_crash",
        },
      },
    ]);
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain(credential.token);
  });

  it("forwards a signed-out hang under the install id and awaits inline without waitUntil", async () => {
    const request = diagnosticsRequest(null, "req_hang", {
      kind: "hang",
      diagnosticId: "diag-hang-1",
      installId: INSTALL_ID,
      platform: "macos",
      hangDurationMilliseconds: 86_400_000,
    });

    const response = await action({
      request,
      params: { "*": "native/diagnostics" },
      context: { cloudflare: { env: { POSTHOG_KEY: "ph_test" } } },
    } as any);

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control") ?? "").not.toContain("private");
    expect(captures("spoonjoy.native.hang")).toEqual([
      expect.objectContaining({
        distinctId: `native_install:${INSTALL_ID}`,
        properties: expect.objectContaining({
          diagnostic_kind: "hang",
          platform: "macos",
          environment: "local",
          hang_duration_milliseconds: 86_400_000,
          frame_count: 0,
          top_frame: null,
          frames: [],
        }),
      }),
    ]);
  });

  it("falls back to the shared anonymous id without an install id and skips capture without env", async () => {
    const withEnv = await action(routeArgs(diagnosticsRequest(null, "req_anon", { kind: "crash", diagnosticId: "d1", frames: null }), "native/diagnostics").args);
    expect(withEnv.status).toBe(202);
    expect(captures()[0]).toMatchObject({ event: "spoonjoy.native.crash", distinctId: "anonymous_native_app" });

    vi.mocked(captureEvent).mockClear();
    const withoutEnv = await action({
      request: diagnosticsRequest(null, "req_no_env", { kind: "crash", diagnosticId: "d2" }),
      params: { "*": "native/diagnostics" },
      context: {},
    } as any);
    expect(withoutEnv.status).toBe(202);
    expect(captures()).toHaveLength(0);
  });

  it.each([
    ["missing kind", { diagnosticId: "d" }],
    ["unknown kind", { kind: "oom", diagnosticId: "d" }],
    ["missing diagnosticId", { kind: "crash" }],
    ["unknown field", { kind: "crash", diagnosticId: "d", exceptionMessage: "user typed secret pasta" }],
    ["bad install id", { kind: "crash", diagnosticId: "d", installId: "short" }],
    ["install id with spaces", { kind: "crash", diagnosticId: "d", installId: "has spaces in it" }],
    ["bad timestamp", { kind: "crash", diagnosticId: "d", timestampBegin: "yesterday" }],
    ["bad timestampEnd", { kind: "crash", diagnosticId: "d", timestampEnd: "soon" }],
    ["oversized termination reason", { kind: "crash", diagnosticId: "d", terminationReason: "x".repeat(301) }],
    ["negative signal", { kind: "crash", diagnosticId: "d", signal: -1 }],
    ["fractional exception type", { kind: "crash", diagnosticId: "d", exceptionType: 1.5 }],
    ["hang too long", { kind: "hang", diagnosticId: "d", hangDurationMilliseconds: 86_400_001 }],
    ["frames not an array", { kind: "crash", diagnosticId: "d", frames: "Spoonjoy+0x1" }],
    ["too many frames", { kind: "crash", diagnosticId: "d", frames: Array.from({ length: 25 }, () => ({ binaryName: "A", offsetIntoBinaryTextSegment: 1 })) }],
    ["frame not an object", { kind: "crash", diagnosticId: "d", frames: ["Spoonjoy"] }],
    ["frame is null", { kind: "crash", diagnosticId: "d", frames: [null] }],
    ["frame is an array", { kind: "crash", diagnosticId: "d", frames: [[]] }],
    ["frame with symbol text", { kind: "crash", diagnosticId: "d", frames: [{ binaryName: "A", offsetIntoBinaryTextSegment: 1, symbol: "secret()" }] }],
    ["frame without binary", { kind: "crash", diagnosticId: "d", frames: [{ offsetIntoBinaryTextSegment: 1 }] }],
    ["frame without offset", { kind: "crash", diagnosticId: "d", frames: [{ binaryName: "A" }] }],
    ["frame with negative offset", { kind: "crash", diagnosticId: "d", frames: [{ binaryName: "A", offsetIntoBinaryTextSegment: -4 }] }],
  ])("rejects %s with a validation error and captures nothing", async (_label, body) => {
    const response = await action(routeArgs(diagnosticsRequest(null, "req_bad", body), "native/diagnostics").args);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
    expect(captures()).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain("secret pasta");
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain("secret()");
  });

  it("accepts exactly 24 frames", async () => {
    const frames = Array.from({ length: 24 }, (_, index) => ({ binaryName: "Spoonjoy", offsetIntoBinaryTextSegment: index }));
    const response = await action(routeArgs(diagnosticsRequest(null, "req_24", { kind: "crash", diagnosticId: "d", frames }), "native/diagnostics").args);

    expect(response.status).toBe(202);
    expect(captures()[0].properties).toMatchObject({ frame_count: 24, top_frame: "Spoonjoy+0x0" });
  });

  it("only allows POST", async () => {
    const request = new UndiciRequest("http://localhost/api/v1/native/diagnostics", { method: "GET" }) as unknown as Request;
    const response = await loader(routeArgs(request, "native/diagnostics").args as any);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe("API v1 native telemetry install id and launch marker", () => {
  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    await cleanupDatabase();
  });

  it("records launch_completed under the install id when signed out", async () => {
    const response = await action(routeArgs(diagnosticsRequest(null, "req_launch", {
      event: "launch_completed",
      installId: INSTALL_ID,
      appVersion: "1.2.2",
      buildNumber: "176",
      platform: "ios",
    }, "native/telemetry"), "native/telemetry").args);

    expect(response.status).toBe(202);
    expect(captures("spoonjoy.native.telemetry")[0]).toMatchObject({
      distinctId: `native_install:${INSTALL_ID}`,
      properties: { native_event: "launch_completed", install_id: INSTALL_ID, app_version: "1.2.2", build_number: "176" },
    });
  });

  it("rejects a malformed install id on telemetry", async () => {
    const response = await action(routeArgs(diagnosticsRequest(null, "req_bad_install", {
      event: "launch_completed",
      installId: "nope",
    }, "native/telemetry"), "native/telemetry").args);

    expect(response.status).toBe(400);
    expect(captures()).toHaveLength(0);
  });
});
