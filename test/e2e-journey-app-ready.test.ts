// The journeys load a page once more when the first load's connection was reset before any answer
// (e2e/journeys/support/app-ready.ts), and only then.
import { describe, expect, it, vi } from "vitest";
import { expectConsoleWarning } from "./warning-policy";
import {
  STATIC_ASSET_RETRY_DELAYS_MS,
  TRANSPORT_RETRY_DELAY_MS,
  answerStaticAsset,
  isStaticAsset,
  isTransportFailure,
  loadAgainAfterTransportFailure,
} from "../e2e/journeys/support/app-ready";

// Playwright's errors for the two page loads that failed in Journeys run 40592921397.
const WEBKIT_RESET = "page.goto: Error receiving data: Connection reset by peer";
const WEBKIT_TLS_RESET = "page.goto: Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer";

function timeoutError(message: string) {
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

describe("isStaticAsset", () => {
  const base = "https://spoonjoy-v2-qa-run-39850143035-1.mendelow-studio.workers.dev";

  it("is a built file of the app under test", () => {
    expect(isStaticAsset(new URL(`${base}/assets/reason-parts-BstUkRmX.js`), base)).toBe(true);
  });

  it.each([
    ["a page", `${base}/recipes`],
    ["a data request", `${base}/assets.data`],
    ["another origin's assets", "https://example.test/assets/app.js"],
  ])("is never %s", (_case, url) => {
    expect(isStaticAsset(new URL(url), base)).toBe(false);
  });

  it("is nothing without a base URL", () => {
    expect(isStaticAsset(new URL(`${base}/assets/app.js`), undefined)).toBe(false);
  });
});

describe("answerStaticAsset", () => {
  const url = "https://spoonjoy-v2-qa-run-39850143035-1.mendelow-studio.workers.dev/assets/heading-BIJmUf4w.js?v=1";

  function route(...answers: Array<number | Error>) {
    const responses = answers.map((answer) => (typeof answer === "number" ? { status: () => answer } : answer));
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

    await answerStaticAsset(assets as never, wait, onRetry);

    expect(assets.fetch).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([...STATIC_ASSET_RETRY_DELAYS_MS]);
    expect(onRetry.mock.calls).toEqual([["/assets/heading-BIJmUf4w.js", 502, 2], ["/assets/heading-BIJmUf4w.js", 503, 3]]);
    expect(assets.fulfill).toHaveBeenCalledExactlyOnceWith({ response: expect.objectContaining({ status: expect.any(Function) }) });
    expect((assets.fulfill.mock.calls[0] as unknown as [{ response: { status(): number } }])[0].response.status()).toBe(200);
  });

  it("hands the page the last 5xx after three tries instead of asking a fourth time", async () => {
    const assets = route(504, 504, 504, 200);

    await answerStaticAsset(assets as never, async () => undefined, () => undefined);

    expect(assets.fetch).toHaveBeenCalledTimes(3);
    expect((assets.fulfill.mock.calls[0] as unknown as [{ response: { status(): number } }])[0].response.status()).toBe(504);
  });

  it.each([200, 404, 500, 501])("hands the page a %s at once", async (status) => {
    const assets = route(status);
    const wait = vi.fn(async () => undefined);

    await answerStaticAsset(assets as never, wait, () => undefined);

    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("lets the browser make the request itself when asking fails", async () => {
    const assets = route(new Error("socket hang up"));

    await answerStaticAsset(assets as never, async () => undefined, () => undefined);

    expect(assets.continue).toHaveBeenCalledTimes(1);
    expect(assets.fulfill).not.toHaveBeenCalled();
  });

  it("prints each new try in the test's output by default", async () => {
    const assets = route(502, 200);
    expectConsoleWarning("Journeys: static file /assets/heading-BIJmUf4w.js answered 502; asking again (try 2 of 3)");

    await answerStaticAsset(assets as never, async () => undefined);
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });
});
