// The journeys load a page once more when the first load's connection was reset before any answer
// (e2e/journeys/support/app-ready.ts), and only then.
import { describe, expect, it, vi } from "vitest";
import {
  TRANSPORT_RETRY_DELAY_MS,
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
