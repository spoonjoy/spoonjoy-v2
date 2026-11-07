import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_R2_PUT_RETRY_DELAYS_MS,
  isTransientR2Error,
  putWithTransientRetry,
} from "~/lib/r2-transient-retry.server";
import { expectConsoleWarning } from "../warning-policy";

// R2's answer to the account photo upload in Journeys run 40562451574.
const INTERNAL = "put: We encountered an internal error. Please try again. (10001)";
const UNAVAILABLE = "put: Service unavailable. (10043)";
const OPTIONS = { httpMetadata: { contentType: "image/webp" } };
const BYTES = new Uint8Array([1]);
const retried = (attempt: number, code: string) =>
  JSON.stringify({ event: "platform_retry", call: "r2.put", attempt, code });

describe("isTransientR2Error", () => {
  it.each([INTERNAL, UNAVAILABLE])("is R2's own failure: %s", (message) => {
    expect(isTransientR2Error(new Error(message))).toBe(true);
  });

  it.each([
    ["an unauthorized put", new Error("put: Unauthorized. (10002)")],
    ["an object too large", new Error("put: Your proposed upload exceeds the maximum allowed object size. (100100)")],
    ["a code that only starts the same", new Error("put: (100010)")],
    ["a code inside the message", new Error("put: (10001) then something else")],
    ["a string", INTERNAL],
    ["nothing", undefined],
  ])("is never %s", (_case, error) => {
    expect(isTransientR2Error(error)).toBe(false);
  });
});

describe("putWithTransientRetry", () => {
  it("puts once when R2 accepts the object", async () => {
    const bucket = { put: vi.fn().mockResolvedValue({}) };
    const sleep = vi.fn(async () => undefined);
    const body = new Uint8Array([1, 2, 3]);

    await putWithTransientRetry(bucket, "covers/1.webp", body, OPTIONS, { sleep });

    expect(bucket.put).toHaveBeenCalledExactlyOnceWith("covers/1.webp", body, OPTIONS);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("puts the same body to the same key again after each transient refusal, up to its delays", async () => {
    const bucket = {
      put: vi.fn()
        .mockRejectedValueOnce(new Error(INTERNAL))
        .mockRejectedValueOnce(new Error(UNAVAILABLE))
        .mockResolvedValueOnce({}),
    };
    const sleep = vi.fn(async () => undefined);
    const body = new Blob(["image"]);
    expectConsoleWarning(retried(2, "10001"));
    expectConsoleWarning(retried(3, "10043"));

    await putWithTransientRetry(bucket, "covers/1.webp", body, OPTIONS, { sleep });

    expect(bucket.put.mock.calls).toEqual([
      ["covers/1.webp", body, OPTIONS],
      ["covers/1.webp", body, OPTIONS],
      ["covers/1.webp", body, OPTIONS],
    ]);
    expect(sleep.mock.calls).toEqual(DEFAULT_R2_PUT_RETRY_DELAYS_MS.map((ms) => [ms]));
  });

  it("throws the last try's refusal instead of trying without a bound", async () => {
    const last = new Error(INTERNAL);
    const bucket = { put: vi.fn().mockRejectedValueOnce(new Error(INTERNAL)).mockRejectedValueOnce(last) };
    expectConsoleWarning(retried(2, "10001"));

    await expect(putWithTransientRetry(bucket, "k", BYTES, OPTIONS, { delaysMs: [1], sleep: async () => undefined }))
      .rejects.toBe(last);
    expect(bucket.put).toHaveBeenCalledTimes(2);
  });

  it("throws any other error at once", async () => {
    const error = new Error("put: Unauthorized. (10002)");
    const bucket = { put: vi.fn().mockRejectedValueOnce(error) };
    const sleep = vi.fn(async () => undefined);

    await expect(putWithTransientRetry(bucket, "k", BYTES, OPTIONS, { sleep })).rejects.toBe(error);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits with a real timer by default", async () => {
    vi.useFakeTimers();
    try {
      const bucket = { put: vi.fn().mockRejectedValueOnce(new Error(INTERNAL)).mockResolvedValueOnce({}) };
      expectConsoleWarning(retried(2, "10001"));
      const putting = putWithTransientRetry(bucket, "k", BYTES, OPTIONS);
      await vi.advanceTimersByTimeAsync(DEFAULT_R2_PUT_RETRY_DELAYS_MS[0] - 1);
      expect(bucket.put).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await putting;
      expect(bucket.put).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
