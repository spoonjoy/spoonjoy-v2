import { afterEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { handleError } from "~/entry.server";

/**
 * `handleError` is React Router's catch-all for loader/action throws (the
 * render-stream `onError` only fires for render-time errors). These tests pin
 * the two behaviours that matter: unexpected errors are captured to PostHog
 * via `ctx.waitUntil`, and expected client outcomes (thrown Responses, route
 * error responses, aborted requests) are never recorded as exceptions. The
 * helper must also never throw.
 */

function postHogFetchStub() {
  const calls: Array<Record<string, unknown>> = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(null, { status: 200 });
  });
  return { calls, fetchMock };
}

function loaderArgs(env: Record<string, unknown> | null, ctx?: { waitUntil: (p: Promise<unknown>) => void }) {
  return {
    request: new UndiciRequest("http://localhost/recipes/search?q=secret") as unknown as Request,
    params: {},
    context: { cloudflare: { env, ctx } } as never,
  };
}

describe("entry.server handleError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures an unexpected loader/action error via ctx.waitUntil", async () => {
    const { calls, fetchMock } = postHogFetchStub();
    const scheduled: Promise<unknown>[] = [];
    const waitUntil = vi.fn((p: Promise<unknown>) => {
      scheduled.push(p);
    });

    handleError(new Error("D1 read exploded"), loaderArgs({ POSTHOG_KEY: "ph_test" }, { waitUntil }));

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(scheduled);
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe("$exception");
    expect(calls[0].distinct_id).toBe("server");
    const props = calls[0].properties as Record<string, unknown>;
    expect(props.$exception_message).toBe("D1 read exploded");
    // Route is path-only — no query string is leaked.
    expect(props.route).toBe("/recipes/search");
    expect(props.method).toBe("GET");
    fetchMock.mockRestore();
  });

  it("captures fire-and-forget when no waitUntil is available", async () => {
    const { calls, fetchMock } = postHogFetchStub();

    handleError(new Error("no ctx"), loaderArgs({ POSTHOG_KEY: "ph_test" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.some((c) => c.event === "$exception")).toBe(true);
    fetchMock.mockRestore();
  });

  it("does not capture thrown Response objects (redirects / data responses)", async () => {
    const { calls, fetchMock } = postHogFetchStub();
    const waitUntil = vi.fn();

    handleError(new Response(null, { status: 302 }), loaderArgs({ POSTHOG_KEY: "ph_test" }, { waitUntil }));

    expect(waitUntil).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    fetchMock.mockRestore();
  });

  it("does not capture route error responses (404s, thrown new Response)", async () => {
    const { calls, fetchMock } = postHogFetchStub();
    const waitUntil = vi.fn();
    const routeErrorResponse = { status: 404, statusText: "Not Found", internal: false, data: "Not Found" };

    handleError(routeErrorResponse, loaderArgs({ POSTHOG_KEY: "ph_test" }, { waitUntil }));

    expect(waitUntil).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    fetchMock.mockRestore();
  });

  it("does not capture when the request was aborted", async () => {
    const { calls, fetchMock } = postHogFetchStub();
    const waitUntil = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const args = {
      request: new UndiciRequest("http://localhost/recipes", { signal: controller.signal }) as unknown as Request,
      params: {},
      context: { cloudflare: { env: { POSTHOG_KEY: "ph_test" }, ctx: { waitUntil } } } as never,
    };

    handleError(new Error("aborted mid-flight"), args);

    expect(waitUntil).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    fetchMock.mockRestore();
  });

  it("is a no-op when PostHog is unconfigured and never throws", async () => {
    const { calls, fetchMock } = postHogFetchStub();
    const waitUntil = vi.fn();

    expect(() => handleError(new Error("boom"), loaderArgs({}, { waitUntil }))).not.toThrow();
    expect(() => handleError(new Error("boom"), loaderArgs(null, { waitUntil }))).not.toThrow();

    expect(waitUntil).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    fetchMock.mockRestore();
  });
});
