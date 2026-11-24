import { describe, expect, it, vi } from "vitest";
import { redirect } from "react-router";
import { clientAction, shouldRevalidate } from "~/routes/move-in";
import { NETWORK_FAILURE_MESSAGE } from "~/lib/network-failure";

// What Chromium's fetch rejects with when a request's connection is reset before any answer.
const noAnswer = () => new TypeError("Failed to fetch");

function post(fields: Record<string, string>) {
  return new Request("https://spoonjoy.test/move-in?job=movein_1", { method: "POST", body: new URLSearchParams(fields) });
}

describe("move-in clientAction", () => {
  it("returns the server's answer", async () => {
    const serverAction = vi.fn(async () => ({ error: null }));
    await expect(clientAction({ request: post({ intent: "continue", jobId: "movein_1" }), params: {}, serverAction } as never)).resolves.toEqual({ error: null });
  });

  it("answers a progress check or an upload that got no answer with a message, offering nothing to send again", async () => {
    const serverAction = vi.fn().mockRejectedValue(noAnswer());
    await expect(clientAction({ request: post({ intent: "continue", jobId: "movein_1" }), params: {}, serverAction } as never)).resolves.toEqual({
      intent: null,
      error: NETWORK_FAILURE_MESSAGE,
      errorCode: "network_failure",
      retryable: true,
      resend: null,
    });
    expect(serverAction).toHaveBeenCalledTimes(1);
  });

  it("rethrows a server's error, which is an answer", async () => {
    const serverError = new Error("Unexpected Server Error");
    await expect(clientAction({ request: post({ intent: "continue" }), params: {}, serverAction: vi.fn().mockRejectedValue(serverError) } as never)).rejects.toBe(serverError);
  });

  it("passes an upload's redirect to its move-in through unchanged", async () => {
    const started = redirect("/move-in?job=movein_1");
    await expect(clientAction({ request: post({ app: "mealie" }), params: {}, serverAction: vi.fn().mockRejectedValue(started) } as never)).rejects.toBe(started);
  });

  it("keeps the progress shown after a check that got no answer, and otherwise revalidates as React Router would", () => {
    const lost = { intent: null, error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true, resend: null };
    expect(shouldRevalidate({ actionResult: lost, defaultShouldRevalidate: true } as never)).toBe(false);
    expect(shouldRevalidate({ actionResult: { error: null }, defaultShouldRevalidate: true } as never)).toBe(true);
  });
});
