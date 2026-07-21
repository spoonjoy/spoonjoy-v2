import { beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { expectConsoleError } from "./warning-policy";

/**
 * Guards the CSP-nonce wiring in `handleRequest`. React Router's internal
 * StreamTransfer emits inline hydration scripts (`window.__reactRouterContext…`)
 * that are nonced ONLY via `<ServerRouter nonce>` — NOT via `NonceContext`. So
 * if `handleRequest` forgets to pass the nonce to `ServerRouter`, those scripts
 * render un-nonced and an enforcing CSP blocks them on every page. This test
 * fails if that prop is dropped.
 *
 * We mock `ServerRouter` to capture its props (rendering a real one needs a
 * full `EntryContext`/build, which would make the test brittle). `...actual`
 * keeps the rest of react-router intact for `handleError`'s imports.
 */
const rr = vi.hoisted(() => ({
  allReady: Promise.resolve() as Promise<void>,
  controlled: false,
  errorBeforeShell: undefined as unknown,
  onError: undefined as ((error: unknown) => void) | undefined,
  renderOptions: undefined as Record<string, unknown> | undefined,
  serverRouterProps: undefined as Record<string, unknown> | undefined,
}));

const analytics = vi.hoisted(() => ({
  captureException: vi.fn(() => Promise.resolve()),
  resolvePostHogServerConfig: vi.fn((env: { POSTHOG_KEY?: string }) => env.POSTHOG_KEY
    ? { enabled: true as const, key: env.POSTHOG_KEY }
    : { enabled: false as const, reason: "missing-key" as const }),
}));

vi.mock("~/lib/analytics-server", () => analytics);

vi.mock("react-dom/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/server")>();
  return {
    ...actual,
    renderToReadableStream: (
      element: Parameters<typeof actual.renderToReadableStream>[0],
      options: Parameters<typeof actual.renderToReadableStream>[1],
    ) => {
      rr.renderOptions = options as Record<string, unknown>;
      rr.onError = options?.onError;
      if (rr.controlled) {
        if (rr.errorBeforeShell !== undefined) rr.onError?.(rr.errorBeforeShell);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
        Object.defineProperty(stream, "allReady", { value: rr.allReady });
        return Promise.resolve(stream as Awaited<ReturnType<typeof actual.renderToReadableStream>>);
      }
      return actual.renderToReadableStream(element, options);
    },
  };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    ServerRouter: (props: Record<string, unknown>) => {
      rr.serverRouterProps = props;
      return null;
    },
  };
});

import handleRequest from "~/entry.server";

function render(nonce: string | undefined) {
  const request = new UndiciRequest("http://localhost/") as unknown as Request;
  // No cloudflare.env → PostHog config resolves disabled, so no analytics I/O.
  const loadContext = { nonce } as never;
  return handleRequest(request, 200, new Headers(), {} as never, loadContext);
}

describe("entry.server handleRequest — CSP nonce wiring", () => {
  beforeEach(() => {
    analytics.captureException.mockClear();
    analytics.resolvePostHogServerConfig.mockClear();
    rr.allReady = Promise.resolve();
    rr.controlled = false;
    rr.errorBeforeShell = undefined;
    rr.onError = undefined;
  });

  it("threads the request nonce into <ServerRouter> so RR streaming scripts are nonced", async () => {
    rr.renderOptions = undefined;
    rr.serverRouterProps = undefined;
    await render("test-nonce-abc123");
    expect(rr.serverRouterProps?.nonce).toBe("test-nonce-abc123");
    expect(rr.renderOptions?.nonce).toBe("test-nonce-abc123");
  });

  it("falls back to an empty nonce when loadContext carries none", async () => {
    rr.serverRouterProps = undefined;
    await render(undefined);
    expect(rr.serverRouterProps?.nonce).toBe("");
    expect(rr.renderOptions?.nonce).toBe("");
  });

  it("awaits stream readiness for bots and returns an HTML response", async () => {
    rr.controlled = true;
    const ready = vi.fn();
    rr.allReady = { then: (resolve: () => void) => { ready(); resolve(); } } as Promise<void>;
    const request = new UndiciRequest("http://localhost/search", {
      headers: { "user-agent": "Googlebot/2.1" },
    }) as unknown as Request;

    const response = await handleRequest(request, 201, new Headers(), {} as never, {} as never);

    expect(ready).toHaveBeenCalledOnce();
    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("text/html");
  });

  it("captures a pre-shell render error without console output or waitUntil", async () => {
    rr.controlled = true;
    rr.errorBeforeShell = new Error("pre-shell render failed");
    const response = await handleRequest(
      new UndiciRequest("http://localhost/recipes", { method: "POST" }) as unknown as Request,
      200,
      new Headers(),
      {} as never,
      { cloudflare: { env: { POSTHOG_KEY: "ph_test" } } } as never,
    );

    expect(response.status).toBe(500);
    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
      expect.objectContaining({ route: "/recipes", method: "POST" }),
    );
  });

  it("captures post-shell errors with waitUntil and owned console output", async () => {
    rr.controlled = true;
    const waitUntil = vi.fn();
    await handleRequest(
      new UndiciRequest("http://localhost/cookbooks") as unknown as Request,
      200,
      new Headers(),
      {} as never,
      { cloudflare: { env: { POSTHOG_KEY: "ph_test" }, ctx: { waitUntil } } } as never,
    );
    const error = new Error("post-shell render failed");

    expectConsoleError(error);
    rr.onError?.(error);

    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("logs post-shell errors without telemetry when PostHog is disabled", async () => {
    rr.controlled = true;
    await handleRequest(
      new UndiciRequest("http://localhost/account") as unknown as Request,
      200,
      new Headers(),
      {} as never,
      { cloudflare: { env: {} } } as never,
    );
    const error = new Error("disabled telemetry render failure");

    expectConsoleError(error);
    rr.onError?.(error);

    expect(analytics.captureException).not.toHaveBeenCalled();
  });
});
