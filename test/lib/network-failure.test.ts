import { describe, expect, it, vi } from "vitest";
import {
  NETWORK_FAILURE_MESSAGE,
  isNetworkFailure,
  isNetworkFailureResult,
  revalidateUnlessNetworkFailure,
  submitOrReportLostRequest,
} from "~/lib/network-failure";

// What WebKit's fetch rejects with when the TLS handshake to the server is reset (Journeys run
// 39838941793): a TypeError, with no response.
const noAnswer = () => new TypeError("Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer");

describe("submitOrReportLostRequest", () => {
  const resend = { intent: "updateTitle", title: "Renamed" };

  it("returns the server's answer", async () => {
    const serverAction = vi.fn(async () => ({ success: true }));
    await expect(submitOrReportLostRequest(serverAction, { intent: "updateTitle", resend })).resolves.toEqual({ success: true });
    expect(serverAction).toHaveBeenCalledTimes(1);
  });

  it("says Spoonjoy couldn't be reached, with the fields to send again, and sends nothing itself", async () => {
    const serverAction = vi.fn().mockRejectedValue(noAnswer());
    await expect(submitOrReportLostRequest(serverAction, { intent: "updateTitle", resend })).resolves.toEqual({
      intent: "updateTitle",
      error: NETWORK_FAILURE_MESSAGE,
      errorCode: "network_failure",
      retryable: true,
      resend,
    });
    expect(serverAction).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to send again for an intent that is not idempotent", async () => {
    const serverAction = vi.fn().mockRejectedValue(noAnswer());
    await expect(submitOrReportLostRequest(serverAction, { intent: "delete", resend: null })).resolves.toMatchObject({
      intent: "delete",
      resend: null,
    });
  });

  // Under `react-router dev` a server error keeps its class and message, so a TypeError thrown by
  // the action reaches the client as a TypeError. It is an answer, never "couldn't be reached".
  it("rethrows a server's TypeError rebuilt by the client", async () => {
    const serverBug = new TypeError("Cannot read properties of undefined (reading 'title')");
    await expect(submitOrReportLostRequest(vi.fn().mockRejectedValue(serverBug), { intent: "updateTitle", resend })).rejects.toBe(serverBug);
  });

  it("rethrows a server's error, which is an answer, not a lost request", async () => {
    const serverError = new Error("Unexpected Server Error");
    await expect(submitOrReportLostRequest(vi.fn().mockRejectedValue(serverError), { intent: "updateTitle", resend })).rejects.toBe(serverError);
    const notFound = new Response("Cookbook not found", { status: 404 });
    await expect(submitOrReportLostRequest(vi.fn().mockRejectedValue(notFound), { intent: "updateTitle", resend })).rejects.toBe(notFound);
  });
});

describe("network failure results", () => {
  it.each([
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
    "Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer",
  ])("knows fetch's own failure %j as a lost request", (message) => {
    expect(isNetworkFailure(new TypeError(message))).toBe(true);
  });

  it("tells a lost request from other errors and results", () => {
    expect(isNetworkFailure(noAnswer())).toBe(true);
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading 'title')"))).toBe(false);
    expect(isNetworkFailure(new Error("Failed to fetch"))).toBe(false);
    expect(isNetworkFailure(new Error("Unexpected Server Error"))).toBe(false);
    expect(isNetworkFailureResult({ errorCode: "network_failure" })).toBe(true);
    expect(isNetworkFailureResult({ errorCode: "temporarily_unavailable" })).toBe(false);
    expect(isNetworkFailureResult(null)).toBe(false);
  });

  it("keeps the page's data after a submission that got no answer, and otherwise defers", () => {
    const failed = { intent: "updateTitle", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true, resend: null };
    expect(revalidateUnlessNetworkFailure({ actionResult: failed }, true)).toBe(false);
    expect(revalidateUnlessNetworkFailure({ actionResult: { success: true } }, true)).toBe(true);
    expect(revalidateUnlessNetworkFailure({ actionResult: undefined }, false)).toBe(false);
  });
});
