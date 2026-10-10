import { afterEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { handleError } from "~/entry.server";
import { formatQaErrorLog, QA_ERROR_LOGS_VAR } from "~/lib/qa-error-logs.server";
import { expectNoSecrets, FAKE_SECRETS, secretLine, secretMessage } from "./fixtures/fake-secrets";
import { expectConsoleError } from "./warning-policy";

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

  // console.warn and console.error stay with the suite's warning policy (test/warning-policy.ts):
  // any call these tests do not declare with expectConsoleError fails the test.
  function consoleLogSpy() {
    return vi.spyOn(console, "log").mockImplementation(() => {});
  }

  it("writes nothing to the console without the per-run QA switch, and still reports to PostHog", async () => {
    for (const value of [undefined, "0", "true", ""]) {
      const { calls, fetchMock } = postHogFetchStub();
      const log = consoleLogSpy();
      const scheduled: Promise<unknown>[] = [];
      const env = { POSTHOG_KEY: "ph_test", ...(value === undefined ? {} : { [QA_ERROR_LOGS_VAR]: value }) };

      handleError(new Error(`D1 read exploded for ${FAKE_SECRETS.email}`), loaderArgs(env, { waitUntil: (p) => scheduled.push(p) }));
      handleError(new Error("no PostHog"), loaderArgs({ [QA_ERROR_LOGS_VAR]: value }));

      await Promise.all(scheduled);
      expect(log, `value ${value}`).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      expect(calls[0].event).toBe("$exception");
      vi.restoreAllMocks();
      fetchMock.mockRestore();
    }
  });

  it("with the per-run QA switch, writes one scrubbed line holding the class, message and five frames", async () => {
    const { calls, fetchMock } = postHogFetchStub();
    const log = consoleLogSpy();
    const scheduled: Promise<unknown>[] = [];
    const error = new TypeError(`login action failed: ${secretMessage}`);
    error.stack = [
      `TypeError: login action failed: ${secretMessage}`,
      `    at action (https://chef:${FAKE_SECRETS.userinfo}@qa.example.test/build/server.js?code=${FAKE_SECRETS.query}#${FAKE_SECRETS.fragment}:1:2)`,
      `    at loader (index.js:3:4) ${secretLine.split("\n")[0]}`,
      `    at token (index.js:5:6) ${FAKE_SECRETS.jwt} ${FAKE_SECRETS.connectionKey}`,
      ...Array.from({ length: 4 }, (_, index) => `    at frame${index} (index.js:${index + 7}:1)`),
    ].join("\n");

    const line = formatQaErrorLog(error);
    // handleError must write exactly this one line, as console.error's only argument.
    expectConsoleError(line);
    handleError(error, loaderArgs({ POSTHOG_KEY: "ph_test", [QA_ERROR_LOGS_VAR]: "1" }, { waitUntil: (p) => scheduled.push(p) }));

    await Promise.all(scheduled);
    expect(line).not.toContain("\n");
    expectNoSecrets(line);
    const logged = JSON.parse(line) as { name: string; message: string; stack: string };
    expect(logged.name).toBe("TypeError");
    expect(logged.message).toMatch(/^login action failed: cookie \[cookie\]/);
    expect(logged.stack.split("\n")).toEqual([
      "at action (https://[userinfo]@qa.example.test/build/server.js?[query])",
      "at loader (index.js:3:4) Cookie: [cookie]",
      "at token (index.js:5:6) [token] [token]",
      "at frame0 (index.js:7:1)",
      "at frame1 (index.js:8:1)",
    ]);
    expect(log).not.toHaveBeenCalled();
    // PostHog reporting is unchanged.
    expect(calls).toHaveLength(1);
    fetchMock.mockRestore();
  });

  it("never throws when writing the QA line fails", () => {
    // Formatting and writing share one try block, so a line that cannot be built stands in for a
    // console that throws, without overriding console.error.
    const error = new Error("boom");
    Object.defineProperty(error, "stack", {
      get() {
        throw new Error("stack unavailable");
      },
    });

    expect(() => handleError(error, loaderArgs({ [QA_ERROR_LOGS_VAR]: "1" }))).not.toThrow();
  });
});
