import { describe, expect, it, vi } from "vitest";
import {
  NETWORK_FAILURE_MESSAGE,
  NETWORK_RETRY_DELAY_MS,
  isNetworkFailure,
  isNetworkFailureResult,
  revalidateUnlessNetworkFailure,
  submitWithNetworkRetry,
} from "~/lib/network-failure";

// What WebKit's fetch rejects with when the TLS handshake to the server is reset (Journeys run
// 39838941793): a TypeError, with no response.
const noAnswer = () => new TypeError("Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer");
const sleep = vi.fn(async () => {});

describe("submitWithNetworkRetry", () => {
  it("returns the server's answer when the first request gets one", async () => {
    const serverAction = vi.fn(async () => ({ success: true }));
    await expect(submitWithNetworkRetry(serverAction, { intent: "updateTitle", retry: true, sleep })).resolves.toEqual({ success: true });
    expect(serverAction).toHaveBeenCalledTimes(1);
  });

  it("sends an idempotent submission that got no answer once more, after a short wait", async () => {
    const waits: number[] = [];
    const serverAction = vi.fn()
      .mockRejectedValueOnce(noAnswer())
      .mockResolvedValueOnce({ success: true, intent: "updateTitle" });
    await expect(
      submitWithNetworkRetry(serverAction, { intent: "updateTitle", retry: true, sleep: async (ms) => { waits.push(ms); } }),
    ).resolves.toEqual({ success: true, intent: "updateTitle" });
    expect(serverAction).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([NETWORK_RETRY_DELAY_MS]);
  });

  it("says Spoonjoy couldn't be reached when the second request gets no answer either", async () => {
    const serverAction = vi.fn().mockRejectedValue(noAnswer());
    const result = await submitWithNetworkRetry(serverAction, { intent: "updateTitle", retry: true, sleep });
    expect(result).toEqual({ intent: "updateTitle", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true });
    expect(serverAction).toHaveBeenCalledTimes(2);
  });

  it("never sends a submission that is not idempotent twice", async () => {
    const serverAction = vi.fn().mockRejectedValue(noAnswer());
    const result = await submitWithNetworkRetry(serverAction, { intent: "delete", retry: false, sleep });
    expect(result).toEqual({ intent: "delete", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true });
    expect(serverAction).toHaveBeenCalledTimes(1);
  });

  it("rethrows a server's error, which is an answer, not a lost request", async () => {
    const serverError = new Error("Unexpected Server Error");
    const serverAction = vi.fn().mockRejectedValue(serverError);
    await expect(submitWithNetworkRetry(serverAction, { intent: "updateTitle", retry: true, sleep })).rejects.toBe(serverError);
    expect(serverAction).toHaveBeenCalledTimes(1);

    const notFound = new Response("Cookbook not found", { status: 404 });
    const retried = vi.fn().mockRejectedValueOnce(noAnswer()).mockRejectedValueOnce(notFound);
    await expect(submitWithNetworkRetry(retried, { intent: "updateTitle", retry: true, sleep })).rejects.toBe(notFound);
  });
});

describe("network failure results", () => {
  it("tells a lost request from other errors and results", () => {
    expect(isNetworkFailure(noAnswer())).toBe(true);
    expect(isNetworkFailure(new Error("Unexpected Server Error"))).toBe(false);
    expect(isNetworkFailureResult({ errorCode: "network_failure" })).toBe(true);
    expect(isNetworkFailureResult({ errorCode: "temporarily_unavailable" })).toBe(false);
    expect(isNetworkFailureResult(null)).toBe(false);
  });

  it("keeps the page's data after a submission that got no answer, and otherwise defers", () => {
    const failed = { intent: "updateTitle", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true };
    expect(revalidateUnlessNetworkFailure({ actionResult: failed }, true)).toBe(false);
    expect(revalidateUnlessNetworkFailure({ actionResult: { success: true } }, true)).toBe(true);
    expect(revalidateUnlessNetworkFailure({ actionResult: undefined }, false)).toBe(false);
  });
});
