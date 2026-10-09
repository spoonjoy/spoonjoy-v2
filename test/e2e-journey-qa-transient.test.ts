// The journeys retry a navigation once for QA's gateway errors and connection resets
// (e2e/journeys/support/qa-transient.ts), and nothing else.
import { describe, expect, it, vi } from "vitest";
import { isTransientQaError, isTransientQaStatus, retryOnceOnQaNoise } from "../e2e/journeys/support/qa-transient";

const response = (status: number) => ({ status: () => status });

describe("QA noise classification", () => {
  it.each([502, 503, 504])("treats a %i as noise", (status) => {
    expect(isTransientQaStatus(status)).toBe(true);
  });

  it.each([200, 301, 401, 404, 500])("treats a %i as a real result", (status) => {
    expect(isTransientQaStatus(status)).toBe(false);
  });

  it.each([
    "page.goto: net::ERR_CONNECTION_RESET at https://qa/",
    "read ECONNRESET",
    "NS_ERROR_NET_RESET",
  ])("treats %s as noise", (message) => {
    expect(isTransientQaError(new Error(message))).toBe(true);
  });

  it("does not treat a timeout or an assertion as noise", () => {
    expect(isTransientQaError(new Error("page.goto: Timeout 30000ms exceeded."))).toBe(false);
    expect(isTransientQaError(new Error("expect(locator).toBeVisible() failed"))).toBe(false);
  });
});

describe("retryOnceOnQaNoise", () => {
  it("returns a good response without retrying", async () => {
    const attempt = vi.fn().mockResolvedValue(response(200));
    expect((await retryOnceOnQaNoise(attempt))?.status()).toBe(200);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 503 and returns the second response", async () => {
    const attempt = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200));
    expect((await retryOnceOnQaNoise(attempt))?.status()).toBe(200);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry and returns the second 503", async () => {
    const attempt = vi.fn().mockResolvedValue(response(503));
    expect((await retryOnceOnQaNoise(attempt))?.status()).toBe(503);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("retries once after a connection reset", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error("read ECONNRESET")).mockResolvedValueOnce(response(200));
    expect((await retryOnceOnQaNoise(attempt))?.status()).toBe(200);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404, a 500 or a timeout", async () => {
    for (const outcome of [response(404), response(500)]) {
      const attempt = vi.fn().mockResolvedValue(outcome);
      await retryOnceOnQaNoise(attempt);
      expect(attempt).toHaveBeenCalledTimes(1);
    }
    const timeout = vi.fn().mockRejectedValue(new Error("page.goto: Timeout 30000ms exceeded."));
    await expect(retryOnceOnQaNoise(timeout)).rejects.toThrow("Timeout");
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it("passes a null response (a same-document navigation) through", async () => {
    const attempt = vi.fn().mockResolvedValue(null);
    expect(await retryOnceOnQaNoise(attempt)).toBeNull();
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
