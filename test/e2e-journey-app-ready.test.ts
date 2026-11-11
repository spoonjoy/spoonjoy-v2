// The journeys load a page once more when the first load's connection was reset before any answer,
// and ask again for a built static file Cloudflare answered 502, 503 or 504, or 404 for a file this
// run built (e2e/journeys/support/app-ready.ts), and only then.
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectConsoleWarning } from "./warning-policy";
import {
  BUILT_FILE_404_RETRY_DELAYS_MS,
  CLIENT_ASSETS_DIR,
  DATA_REQUEST_RETRY_DELAY_MS,
  ROUTED_FETCH_TIMEOUT_MS,
  STATIC_ASSET_RETRY_DELAYS_MS,
  TRANSPORT_RETRY_DELAY_MS,
  answerDataRequest,
  answerStaticAsset,
  dataRequestPattern,
  isFetchTimeout,
  isFetchTransportFailure,
  isBuiltAsset,
  isTransportFailure,
  resetBuiltAssets,
  loadAgainAfterTransportFailure,
  waitForHydrationOnLoad,
} from "../e2e/journeys/support/app-ready";

// Playwright's errors for the two page loads that failed in Journeys run 40592921397.
const WEBKIT_RESET = "page.goto: Error receiving data: Connection reset by peer";
const WEBKIT_TLS_RESET = "page.goto: Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer";

function timeoutError(message = "route.fetch: Timeout 6000ms exceeded.") {
  return Object.assign(new Error(message), { name: "TimeoutError" });
}

describe("isTransportFailure", () => {
  it.each([
    WEBKIT_RESET,
    WEBKIT_TLS_RESET,
    "page.goto: net::ERR_CONNECTION_RESET at https://example.test/",
    "page.reload: net::ERR_CONNECTION_CLOSED",
    "page.goto: net::ERR_SSL_PROTOCOL_ERROR at https://example.test/",
  ])("is a load whose connection was cut: %s", (message) => {
    expect(isTransportFailure(new Error(message))).toBe(true);
  });

  it.each([
    ["a timeout", timeoutError("page.goto: Timeout 60000ms exceeded. Connection reset by peer")],
    ["a refused connection", new Error("page.goto: net::ERR_CONNECTION_REFUSED")],
    ["a name that does not resolve", new Error("page.goto: net::ERR_NAME_NOT_RESOLVED")],
    ["an aborted load", new Error("page.goto: net::ERR_ABORTED")],
    ["another error", new Error("Target page, context or browser has been closed")],
    ["a reset mentioned only after the first line", new Error("page.goto: net::ERR_ABORTED\nCall log:\n  - Connection reset by peer")],
    ["a string", WEBKIT_RESET],
    ["nothing", undefined],
  ])("is never %s", (_case, error) => {
    expect(isTransportFailure(error)).toBe(false);
  });
});

describe("loadAgainAfterTransportFailure", () => {
  it("loads once, without waiting, when the first load is answered", async () => {
    const load = vi.fn(async () => "answer");
    const wait = vi.fn(async () => undefined);

    await expect(loadAgainAfterTransportFailure(load, wait)).resolves.toBe("answer");
    expect(load).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("loads once more, a second later, after a reset connection", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error(WEBKIT_TLS_RESET))
      .mockResolvedValueOnce("answer");
    const wait = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    await expect(loadAgainAfterTransportFailure(load, wait, onRetry)).resolves.toBe("answer");
    expect(load).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(TRANSPORT_RETRY_DELAY_MS);
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: WEBKIT_TLS_RESET }));
  });

  it("throws the second failure, with the first as its cause, instead of loading a third time", async () => {
    const first = new Error(WEBKIT_TLS_RESET);
    const second = new Error(WEBKIT_RESET);
    const load = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);

    await expect(loadAgainAfterTransportFailure(load, async () => undefined)).rejects.toBe(second);
    expect(second.cause).toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps a second failure's own cause, and throws a second failure that is not an Error", async () => {
    const own = new Error("own cause");
    const second = new Error(WEBKIT_RESET, { cause: own });
    const twice = vi.fn().mockRejectedValueOnce(new Error(WEBKIT_RESET)).mockRejectedValueOnce(second);
    await expect(loadAgainAfterTransportFailure(twice, async () => undefined)).rejects.toBe(second);
    expect(second.cause).toBe(own);

    const odd = vi.fn().mockRejectedValueOnce(new Error(WEBKIT_RESET)).mockRejectedValueOnce("gone");
    await expect(loadAgainAfterTransportFailure(odd, async () => undefined)).rejects.toBe("gone");
  });

  it("throws every other failure at once", async () => {
    const failure = timeoutError("page.goto: Timeout 60000ms exceeded.");
    const load = vi.fn().mockRejectedValueOnce(failure);
    const wait = vi.fn(async () => undefined);

    await expect(loadAgainAfterTransportFailure(load, wait)).rejects.toBe(failure);
    expect(load).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("waits a second by default", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn()
        .mockRejectedValueOnce(new Error(WEBKIT_RESET))
        .mockResolvedValueOnce("answer");
      const loading = loadAgainAfterTransportFailure(load);
      await vi.advanceTimersByTimeAsync(TRANSPORT_RETRY_DELAY_MS - 1);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(loading).resolves.toBe("answer");
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("waitForHydrationOnLoad", () => {
  it("routes only the app's own built files and data requests, before the first load", async () => {
    const base = process.env.SPOONJOY_JOURNEYS_BASE_URL;
    process.env.SPOONJOY_JOURNEYS_BASE_URL = "https://spoonjoy-v2-qa-run-39850143035-1.mendelow-studio.workers.dev/";
    try {
      const order: string[] = [];
      const page = {
        route: vi.fn(async () => { order.push("route"); }),
        goto: vi.fn(async () => { order.push("goto"); return null; }),
        reload: vi.fn(async () => null),
        waitForFunction: vi.fn(async () => undefined),
      };
      waitForHydrationOnLoad(page as never);
      await (page as unknown as { goto(url: string): Promise<unknown> }).goto("/recipes");

      expect(page.route.mock.calls).toEqual([
        ["https://spoonjoy-v2-qa-run-39850143035-1.mendelow-studio.workers.dev/assets/**", expect.any(Function)],
        [dataRequestPattern("https://spoonjoy-v2-qa-run-39850143035-1.mendelow-studio.workers.dev"), expect.any(Function)],
      ]);
      expect(order).toEqual(["route", "route", "goto"]);
    } finally {
      if (base === undefined) delete process.env.SPOONJOY_JOURNEYS_BASE_URL;
      else process.env.SPOONJOY_JOURNEYS_BASE_URL = base;
    }
  });
});

describe("answerStaticAsset", () => {
  const url = "https://spoonjoy-v2-qa-run-39850143035-1.mendelow-studio.workers.dev/assets/heading-BIJmUf4w.js?v=1";

  function route(...answers: Array<number | Error>) {
    let ray = 0;
    const responses = answers.map((answer) => (typeof answer === "number" ? { status: () => answer, headers: () => ({ "cf-ray": `ray${(ray += 1)}-IAD` }) } : answer));
    let tries = 0;
    return {
      fetch: vi.fn(async () => {
        const next = responses[tries++];
        if (next instanceof Error) throw next;
        return next;
      }),
      fulfill: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
      request: () => ({ url: () => url }),
    };
  }

  it("hands the page the first answer that is not 502, 503 or 504, waiting before each new try", async () => {
    const assets = route(502, 503, 200);
    const wait = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    await answerStaticAsset(assets as never, wait, onRetry, () => false, () => undefined);

    expect(assets.fetch).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([...STATIC_ASSET_RETRY_DELAYS_MS]);
    expect(onRetry.mock.calls).toEqual([["/assets/heading-BIJmUf4w.js", 502, 2, "ray1-IAD", 3], ["/assets/heading-BIJmUf4w.js", 503, 3, "ray2-IAD", 3]]);
    expect(assets.fulfill).toHaveBeenCalledExactlyOnceWith({ response: expect.objectContaining({ status: expect.any(Function) }) });
    expect((assets.fulfill.mock.calls[0] as unknown as [{ response: { status(): number } }])[0].response.status()).toBe(200);
  });

  it("hands the page the last 5xx after three tries instead of asking a fourth time", async () => {
    const assets = route(504, 504, 504, 200);

    await answerStaticAsset(assets as never, async () => undefined, () => undefined, () => false, () => undefined);

    expect(assets.fetch).toHaveBeenCalledTimes(3);
    expect((assets.fulfill.mock.calls[0] as unknown as [{ response: { status(): number } }])[0].response.status()).toBe(504);
  });

  it.each([200, 404, 500, 501])("hands the page a %s at once", async (status) => {
    const assets = route(status);
    const wait = vi.fn(async () => undefined);

    await answerStaticAsset(assets as never, wait, () => undefined, () => false);

    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("gives each try ROUTED_FETCH_TIMEOUT_MS to be answered", async () => {
    const assets = route(502, 200);

    await answerStaticAsset(assets as never, async () => undefined, () => undefined, () => false, () => undefined);

    expect(assets.fetch.mock.calls).toEqual([[{ timeout: ROUTED_FETCH_TIMEOUT_MS }], [{ timeout: ROUTED_FETCH_TIMEOUT_MS }]]);
    expect(ROUTED_FETCH_TIMEOUT_MS).toBe(6_000);
  });

  it("lets the browser make the request itself when no answer comes in time", async () => {
    const assets = route(timeoutError());

    await answerStaticAsset(assets as never, async () => undefined, () => undefined, () => false);

    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(assets.continue).toHaveBeenCalledTimes(1);
    expect(assets.fulfill).not.toHaveBeenCalled();
  });

  it("asks again, for about 50 s at most, when a file this run built answers 404", async () => {
    const assets = route(404, 404, 200);
    const wait = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const isBuilt = vi.fn((pathname: string) => pathname === "/assets/heading-BIJmUf4w.js");

    await answerStaticAsset(assets as never, wait, onRetry, isBuilt, () => undefined);

    expect(assets.fetch).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual(BUILT_FILE_404_RETRY_DELAYS_MS.slice(0, 2));
    expect(onRetry.mock.calls).toEqual([["/assets/heading-BIJmUf4w.js", 404, 2, "ray1-IAD", 6], ["/assets/heading-BIJmUf4w.js", 404, 3, "ray2-IAD", 6]]);
    expect((assets.fulfill.mock.calls[0] as unknown as [{ response: { status(): number } }])[0].response.status()).toBe(200);
  });

  it("hands the page a built file's 404 after six tries, waiting 250 ms, 1 s, 4 s, 15 s and 30 s, instead of asking a seventh time", async () => {
    const assets = route(404, 404, 404, 404, 404, 404, 200);
    const wait = vi.fn(async () => undefined);

    await answerStaticAsset(assets as never, wait, () => undefined, () => true, () => undefined);

    expect(BUILT_FILE_404_RETRY_DELAYS_MS).toEqual([250, 1_000, 4_000, 15_000, 30_000]);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([...BUILT_FILE_404_RETRY_DELAYS_MS]);
    expect(assets.fetch).toHaveBeenCalledTimes(6);
    expect((assets.fulfill.mock.calls[0] as unknown as [{ response: { status(): number } }])[0].response.status()).toBe(404);
  });

  it("says how a retried file ended: its last answer, on which try, with Cloudflare's ray", async () => {
    const recovered = route(404, 200);
    const onRecovered = vi.fn();
    await answerStaticAsset(recovered as never, async () => undefined, () => undefined, () => true, onRecovered);
    expect(onRecovered).toHaveBeenCalledExactlyOnceWith("/assets/heading-BIJmUf4w.js", 200, 2, "ray2-IAD", 6);

    const exhausted = route(404, 404, 404, 404, 404, 404);
    const onExhausted = vi.fn();
    await answerStaticAsset(exhausted as never, async () => undefined, () => undefined, () => true, onExhausted);
    expect(onExhausted).toHaveBeenCalledExactlyOnceWith("/assets/heading-BIJmUf4w.js", 404, 6, "ray6-IAD", 6);

    const cached = {
      fetch: vi.fn(async () => ({ status: () => (cached.fetch.mock.calls.length === 1 ? 404 : 200), headers: () => ({ "cf-ray": "abc-IAD", "cf-cache-status": "HIT", age: "42" }) })),
      fulfill: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
      request: () => ({ url: () => url }),
    };
    const onCachedRetry = vi.fn();
    await answerStaticAsset(cached as never, async () => undefined, onCachedRetry, () => true, () => undefined);
    expect(onCachedRetry).toHaveBeenCalledExactlyOnceWith("/assets/heading-BIJmUf4w.js", 404, 2, "abc-IAD, cf-cache-status HIT, age 42", 6);

    const firstTry = route(200);
    const onFirstTry = vi.fn();
    await answerStaticAsset(firstTry as never, async () => undefined, () => undefined, () => true, onFirstTry);
    expect(onFirstTry).not.toHaveBeenCalled();
  });

  it("stays quiet when the page closed before the answer could reach it", async () => {
    const assets = route(404, 200);
    assets.fulfill.mockRejectedValueOnce(new Error("route.fulfill: Target page, context or browser has been closed"));

    await expect(answerStaticAsset(assets as never, async () => undefined, () => undefined, () => true, () => undefined)).resolves.toBeUndefined();
    expect(assets.fulfill).toHaveBeenCalledTimes(1);
  });

  it("hands the page a 404 at once for a file this run did not build", async () => {
    const assets = route(404, 200);
    const onRetry = vi.fn();

    await answerStaticAsset(assets as never, async () => undefined, onRetry, () => false);

    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("prints a built file's 404 with its name and try in the test's output", async () => {
    const assets = route(404, 200);
    expectConsoleWarning("Journeys: static file /assets/heading-BIJmUf4w.js answered 404; asking again (try 2 of 6, cf-ray ray1-IAD)");
    expectConsoleWarning("Journeys: static file /assets/heading-BIJmUf4w.js answered 200 on try 2 of 6 (cf-ray ray2-IAD)");

    await answerStaticAsset(assets as never, async () => undefined, undefined, () => true);
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });

  it("lets the browser make the request itself when asking fails", async () => {
    const assets = route(new Error("socket hang up"));

    await answerStaticAsset(assets as never, async () => undefined, () => undefined, () => false, () => undefined);

    expect(assets.continue).toHaveBeenCalledTimes(1);
    expect(assets.fulfill).not.toHaveBeenCalled();
  });

  it("prints each new try in the test's output by default", async () => {
    const assets = route(502, 200);
    expectConsoleWarning("Journeys: static file /assets/heading-BIJmUf4w.js answered 502; asking again (try 2 of 3, cf-ray ray1-IAD)");
    expectConsoleWarning("Journeys: static file /assets/heading-BIJmUf4w.js answered 200 on try 2 of 3 (cf-ray ray2-IAD)");

    await answerStaticAsset(assets as never, async () => undefined);
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("dataRequestPattern", () => {
  const pattern = dataRequestPattern("https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev");

  it.each([
    "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/recipes/6fd4f6b4/steps/new.data",
    "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/login.data?_routes=routes%2Flogin",
    "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/_root.data",
  ])("matches the app's data request %s", (url) => {
    expect(pattern.test(url)).toBe(true);
  });

  it.each([
    "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/recipes",
    "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/assets/notes.database",
    "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/search?q=.data",
    "https://spoonjoy-v2-qa-run-43057324617-1xmendelow-studio.workers.dev/login.data",
    "https://example.test/login.data",
  ])("leaves %s alone", (url) => {
    expect(pattern.test(url)).toBe(false);
  });
});

describe("isFetchTransportFailure", () => {
  it.each([
    "read ECONNRESET",
    "write EPIPE",
    "socket hang up",
    "Client network socket disconnected before secure TLS connection was established",
  ])("is a request whose connection dropped: %s", (message) => {
    expect(isFetchTransportFailure(new Error(message))).toBe(true);
  });

  it.each([
    ["a timeout", Object.assign(new Error("Request timed out after 30000ms: read ECONNRESET"), { name: "TimeoutError" })],
    ["a name that does not resolve", new Error("getaddrinfo ENOTFOUND example.test")],
    ["a refused connection", new Error("connect ECONNREFUSED 127.0.0.1:443")],
    ["a closed page", new Error("Target page, context or browser has been closed")],
    ["a drop mentioned only after the first line", new Error("Request context disposed.\n  - read ECONNRESET")],
    ["something that is not an Error", "read ECONNRESET"],
  ])("is not %s", (_label, error) => {
    expect(isFetchTransportFailure(error)).toBe(false);
  });
});

describe("isFetchTimeout", () => {
  it("is route.fetch's own timeout", () => {
    expect(isFetchTimeout(timeoutError())).toBe(true);
  });

  it.each([
    ["a dropped connection", new Error("read ECONNRESET")],
    ["a test that ended", new Error("route.fetch: Test ended.")],
    ["the test's own timeout", new Error("route.fetch: Test timeout of 60000ms exceeded.")],
    ["a timeout named otherwise", new Error("route.fetch: Timeout 6000ms exceeded.")],
    ["another call's timeout", Object.assign(new Error("page.goto: Timeout 6000ms exceeded."), { name: "TimeoutError" })],
    ["something that is not an Error", "route.fetch: Timeout 6000ms exceeded."],
  ])("is not %s", (_label, error) => {
    expect(isFetchTimeout(error)).toBe(false);
  });
});

describe("answerDataRequest", () => {
  const url = "https://spoonjoy-v2-qa-run-43057324617-1.mendelow-studio.workers.dev/recipes/6fd4f6b4/steps/new.data?index";

  function route(...answers: Array<number | Error>) {
    return routeFor("POST", ...answers);
  }

  function routeFor(method: string, ...answers: Array<number | Error>) {
    let tries = 0;
    return {
      fetch: vi.fn(async (_options?: { maxRedirects?: number; timeout?: number }) => {
        const next = answers[tries++];
        if (next instanceof Error) throw next;
        return { status: () => next };
      }),
      fulfill: vi.fn(async (_options: { response: { status(): number } }) => undefined),
      abort: vi.fn(async (_code?: string) => undefined),
      request: () => ({ url: () => url, method: () => method }),
    };
  }

  it.each([200, 202, 204, 302, 400, 404, 500, 503])("hands the page a %s at once, as it was answered", async (status) => {
    const data = route(status);
    const wait = vi.fn(async () => undefined);

    await answerDataRequest(data as never, wait, () => undefined);

    expect(data.fetch).toHaveBeenCalledExactlyOnceWith({ maxRedirects: 0, timeout: ROUTED_FETCH_TIMEOUT_MS });
    expect(wait).not.toHaveBeenCalled();
    expect(data.fulfill.mock.calls[0][0].response.status()).toBe(status);
  });

  it("sends it once more, a second later, after its connection dropped", async () => {
    const data = route(new Error("read ECONNRESET"), 200);
    const wait = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    await answerDataRequest(data as never, wait, onRetry);

    expect(data.fetch).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(DATA_REQUEST_RETRY_DELAY_MS);
    expect(DATA_REQUEST_RETRY_DELAY_MS).toBe(1_000);
    expect(onRetry).toHaveBeenCalledExactlyOnceWith("POST", "/recipes/6fd4f6b4/steps/new.data", expect.objectContaining({ message: "read ECONNRESET" }));
    expect(data.fulfill.mock.calls[0][0].response.status()).toBe(200);
    expect(data.abort).not.toHaveBeenCalled();
  });

  it("hands the page the second answer whatever it is, without trying a third time", async () => {
    const data = route(new Error("socket hang up"), 500, 200);

    await answerDataRequest(data as never, async () => undefined, () => undefined);

    expect(data.fetch).toHaveBeenCalledTimes(2);
    expect(data.fulfill.mock.calls[0][0].response.status()).toBe(500);
  });

  it("shows the page the reset when the second try drops too, instead of trying a third time", async () => {
    const data = route(new Error("read ECONNRESET"), new Error("read ECONNRESET"), 200);

    await answerDataRequest(data as never, async () => undefined, () => undefined);

    expect(data.fetch).toHaveBeenCalledTimes(2);
    expect(data.abort).toHaveBeenCalledExactlyOnceWith("connectionreset");
    expect(data.fulfill).not.toHaveBeenCalled();
  });

  it("never sends it again after any other failure", async () => {
    const data = route(new Error("getaddrinfo ENOTFOUND example.test"), 200);
    const onRetry = vi.fn();

    await answerDataRequest(data as never, async () => undefined, onRetry);

    expect(data.fetch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(data.abort).toHaveBeenCalledExactlyOnceWith("connectionreset");
  });

  it.each(["GET", "HEAD"])("sends a %s once more after no answer in time", async (method) => {
    const data = routeFor(method, timeoutError(), 200);
    const onRetry = vi.fn();

    await answerDataRequest(data as never, async () => undefined, onRetry);

    expect(data.fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(method, "/recipes/6fd4f6b4/steps/new.data", expect.objectContaining({ name: "TimeoutError" }));
    expect(data.fulfill.mock.calls[0][0].response.status()).toBe(200);
  });

  it("shows the page the reset when a GET has no answer twice, instead of trying a third time", async () => {
    const data = routeFor("GET", timeoutError(), timeoutError(), 200);

    await answerDataRequest(data as never, async () => undefined, () => undefined);

    expect(data.fetch).toHaveBeenCalledTimes(2);
    expect(data.abort).toHaveBeenCalledExactlyOnceWith("connectionreset");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("never sends a %s again after no answer in time, since it may be applying", async (method) => {
    const data = routeFor(method, timeoutError(), 200);
    const onRetry = vi.fn();

    await answerDataRequest(data as never, async () => undefined, onRetry);

    expect(data.fetch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(data.abort).toHaveBeenCalledExactlyOnceWith("connectionreset");
  });

  it("says in the test's output when a request is sent again for want of an answer", async () => {
    const data = routeFor("GET", timeoutError(), 200);
    expectConsoleWarning("Journeys: sending GET /recipes/6fd4f6b4/steps/new.data again after it had no answer (route.fetch: Timeout 6000ms exceeded.)");

    await answerDataRequest(data as never, async () => undefined);
    expect(data.fetch).toHaveBeenCalledTimes(2);
  });

  it("prints the new try in the test's output by default", async () => {
    const data = route(new Error("read ECONNRESET"), 200);
    expectConsoleWarning("Journeys: sending POST /recipes/6fd4f6b4/steps/new.data again after its connection was reset (read ECONNRESET)");

    await answerDataRequest(data as never, async () => undefined);
    expect(data.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("isBuiltAsset", () => {
  afterEach(() => resetBuiltAssets());

  it("knows this run's built files, reading the build's assets folder once", () => {
    const list = vi.fn(() => ["heading-BIJmUf4w.js", "root-Dx_9a.css", "fonts"]);

    expect(isBuiltAsset("/assets/heading-BIJmUf4w.js", list)).toBe(true);
    expect(isBuiltAsset("/assets/root-Dx_9a.css", list)).toBe(true);
    expect(isBuiltAsset("/assets/gone-0000.js", list)).toBe(false);
    // Only file names count, as in qa-run-scope.mjs verify: a folder is not a built file.
    expect(isBuiltAsset("/assets/fonts", list)).toBe(false);
    expect(list).toHaveBeenCalledExactlyOnceWith(CLIENT_ASSETS_DIR);
  });

  it("reads the build next to the repository root, wherever the suite starts", () => {
    expect(CLIENT_ASSETS_DIR).toBe(`${process.cwd()}/build/client/assets/`);
  });

  it("knows no file when there is no build", () => {
    const list = vi.fn(() => { throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }); });

    expect(isBuiltAsset("/assets/heading-BIJmUf4w.js", list)).toBe(false);
  });
});
