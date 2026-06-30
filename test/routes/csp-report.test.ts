import { beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/csp-report";
import { captureEvent } from "~/lib/analytics-server";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
}));

const Request = UndiciRequest as unknown as typeof globalThis.Request;

type CspActionArgs = Parameters<typeof action>[0];

/**
 * Build route args with a Workers-style `ctx.waitUntil` so we can assert the
 * capture promise is handed off fire-and-forget.
 */
function routeArgs(
  request: Request,
  env: Record<string, unknown> | null = { POSTHOG_KEY: "ph_test" },
): { args: CspActionArgs; waitUntil: ReturnType<typeof vi.fn> } {
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    void promise;
  });
  const args = {
    request,
    params: {},
    context: { cloudflare: { env, ctx: { waitUntil } } },
  } as unknown as CspActionArgs;
  return { args, waitUntil };
}

/** Build route args WITHOUT a Workers execution context (the test-style shape). */
function routeArgsNoWaitUntil(
  request: Request,
  env: Record<string, unknown> | null = { POSTHOG_KEY: "ph_test" },
): CspActionArgs {
  return {
    request,
    params: {},
    context: { cloudflare: { env } },
  } as unknown as CspActionArgs;
}

/** Build route args with no `cloudflare` binding at all (the most degraded shape). */
function routeArgsNoCloudflare(request: Request): CspActionArgs {
  return {
    request,
    params: {},
    context: {},
  } as unknown as CspActionArgs;
}

function reportRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://spoonjoy.app/csp-report", {
    method: "POST",
    headers: { "Content-Type": "application/csp-report", ...headers },
    body,
  });
}

function lastCaptureInput() {
  return vi.mocked(captureEvent).mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.mocked(captureEvent).mockClear();
});

describe("POST /csp-report", () => {
  it("captures a privacy-safe summary from a legacy csp-report body and schedules it via waitUntil", async () => {
    const { args, waitUntil } = routeArgs(
      reportRequest(
        JSON.stringify({
          "csp-report": {
            "blocked-uri": "https://evil.example/inject.js",
            "violated-directive": "script-src 'self'",
            "effective-directive": "script-src",
            "document-uri": "https://spoonjoy.app/recipes/42?token=secret#frag",
            disposition: "report",
            "original-policy": "default-src 'self'; report-uri /csp-report",
            referrer: "https://spoonjoy.app/secret-referrer",
          },
        }),
      ),
    );

    const response = await action(args);
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");

    expect(captureEvent).toHaveBeenCalledOnce();
    expect(lastCaptureInput()).toEqual({
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties: {
        blockedUri: "https://evil.example/inject.js",
        violatedDirective: "script-src 'self'",
        effectiveDirective: "script-src",
        documentUri: "https://spoonjoy.app/recipes/42",
        disposition: "report",
      },
    });

    // The capture promise is handed to waitUntil, not awaited inline.
    const captureResult = vi.mocked(captureEvent).mock.results.at(-1);
    expect(captureResult?.type).toBe("return");
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(captureResult!.value);

    // Sensitive report fields must never leak into the captured payload.
    const serialized = JSON.stringify(lastCaptureInput());
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("frag");
    expect(serialized).not.toContain("original-policy");
    expect(serialized).not.toContain("secret-referrer");
  });

  it("passes an opaque-origin document-uri (about:blank) through verbatim", async () => {
    const { args } = routeArgs(
      reportRequest(
        JSON.stringify({
          "csp-report": {
            "violated-directive": "style-src",
            "document-uri": "about:blank",
          },
        }),
      ),
    );

    const response = await action(args);
    expect(response.status).toBe(204);
    expect(lastCaptureInput()).toEqual({
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties: {
        violatedDirective: "style-src",
        documentUri: "about:blank",
      },
    });
  });

  it("passes an unparseable document-uri through verbatim", async () => {
    const { args } = routeArgs(
      reportRequest(
        JSON.stringify({
          "csp-report": {
            "violated-directive": "style-src",
            "document-uri": "inline",
          },
        }),
      ),
    );

    const response = await action(args);
    expect(response.status).toBe(204);
    expect(lastCaptureInput()).toEqual({
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties: {
        violatedDirective: "style-src",
        documentUri: "inline",
      },
    });
  });

  it("ignores non-string and empty report fields", async () => {
    const { args } = routeArgs(
      reportRequest(
        JSON.stringify({
          "csp-report": {
            "blocked-uri": "",
            "violated-directive": 123,
            "effective-directive": "img-src",
            "document-uri": null,
            disposition: "enforce",
          },
        }),
      ),
    );

    const response = await action(args);
    expect(response.status).toBe(204);
    expect(lastCaptureInput()).toEqual({
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties: {
        effectiveDirective: "img-src",
        disposition: "enforce",
      },
    });
  });

  it("awaits the capture when no Workers waitUntil is available", async () => {
    const response = await action(
      routeArgsNoWaitUntil(
        reportRequest(
          JSON.stringify({ "csp-report": { "violated-directive": "connect-src" } }),
        ),
      ),
    );
    expect(response.status).toBe(204);
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(lastCaptureInput()).toMatchObject({
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties: { violatedDirective: "connect-src" },
    });
  });

  it("still returns 204 and lets capture no-op when PostHog is unconfigured", async () => {
    const { args } = routeArgs(
      reportRequest(JSON.stringify({ "csp-report": { "violated-directive": "font-src" } })),
      {},
    );
    const response = await action(args);
    expect(response.status).toBe(204);
    // The route always calls captureEvent; the no-op happens inside it when the
    // PostHog config is disabled (no POSTHOG_KEY).
    expect(captureEvent).toHaveBeenCalledOnce();
  });

  it("still returns 204 when env is explicitly null", async () => {
    const response = await action(
      routeArgsNoWaitUntil(
        reportRequest(JSON.stringify({ "csp-report": { "violated-directive": "default-src" } })),
        null,
      ),
    );
    expect(response.status).toBe(204);
    expect(captureEvent).toHaveBeenCalledOnce();
  });

  it("still returns 204 when there is no cloudflare binding at all", async () => {
    const response = await action(
      routeArgsNoCloudflare(
        reportRequest(JSON.stringify({ "csp-report": { "violated-directive": "base-uri" } })),
      ),
    );
    expect(response.status).toBe(204);
    expect(captureEvent).toHaveBeenCalledOnce();
  });

  it("returns 204 and captures nothing on malformed JSON", async () => {
    const { args, waitUntil } = routeArgs(reportRequest("{not json"));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("returns 204 and captures nothing on an empty body", async () => {
    const { args } = routeArgs(reportRequest("   "));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("returns 204 and captures nothing for an empty Reporting API array", async () => {
    const { args } = routeArgs(reportRequest("[]"));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("returns 204 and captures nothing when the parsed body is JSON null", async () => {
    const { args } = routeArgs(reportRequest("null"));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("returns 204 and captures nothing when the csp-report key is missing", async () => {
    const { args } = routeArgs(reportRequest(JSON.stringify({ other: { foo: "bar" } })));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("returns 204 and captures nothing when csp-report is an array", async () => {
    const { args } = routeArgs(reportRequest(JSON.stringify({ "csp-report": ["nope"] })));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("returns 204 and captures nothing when csp-report is null", async () => {
    const { args } = routeArgs(reportRequest(JSON.stringify({ "csp-report": null })));
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });
});

describe("POST /csp-report — modern Reporting API (report-to) array body", () => {
  it("captures the first csp-violation, mapping camelCase fields + sanitizing the URL", async () => {
    const { args, waitUntil } = routeArgs(
      reportRequest(
        JSON.stringify([
          {
            type: "csp-violation",
            body: {
              blockedURL: "https://evil.example/inject.js",
              effectiveDirective: "script-src-elem",
              violatedDirective: "script-src-elem",
              documentURL: "https://spoonjoy.app/recipes/42?token=secret#frag",
              disposition: "report",
            },
          },
        ]),
        { "Content-Type": "application/reports+json" },
      ),
    );

    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(lastCaptureInput()).toEqual({
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties: {
        blockedUri: "https://evil.example/inject.js",
        effectiveDirective: "script-src-elem",
        violatedDirective: "script-src-elem",
        documentUri: "https://spoonjoy.app/recipes/42",
        disposition: "report",
      },
    });
    expect(waitUntil).toHaveBeenCalledOnce();

    const serialized = JSON.stringify(lastCaptureInput());
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("frag");
  });

  it("skips non-object and non-violation entries to find the first csp-violation", async () => {
    const { args } = routeArgs(
      reportRequest(
        JSON.stringify([
          "not-an-object",
          { type: "deprecation" },
          { type: "csp-violation", body: { effectiveDirective: "img-src" } },
        ]),
      ),
    );
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(lastCaptureInput()).toMatchObject({
      properties: { effectiveDirective: "img-src" },
    });
  });

  it("captures nothing when no array entry is a csp-violation", async () => {
    const { args } = routeArgs(
      reportRequest(JSON.stringify([{ type: "deprecation" }, "noise"])),
    );
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("captures nothing when the csp-violation body is not an object", async () => {
    const { args } = routeArgs(
      reportRequest(JSON.stringify([{ type: "csp-violation", body: null }])),
    );
    const response = await action(args);
    expect(response.status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });
});

describe("/csp-report — non-POST methods", () => {
  it("returns 405 on GET without capturing", async () => {
    const { args } = routeArgs(
      new Request("https://spoonjoy.app/csp-report", { method: "GET" }),
    );
    const response = await action(args);
    expect(response.status).toBe(405);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("returns 405 on PUT without capturing", async () => {
    const { args } = routeArgs(
      new Request("https://spoonjoy.app/csp-report", {
        method: "PUT",
        headers: { "Content-Type": "application/csp-report" },
        body: JSON.stringify({ "csp-report": {} }),
      }),
    );
    const response = await action(args);
    expect(response.status).toBe(405);
    expect(captureEvent).not.toHaveBeenCalled();
  });
});
