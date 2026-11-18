import { describe, expect, it, vi } from "vitest";
import { clientAction, shouldRevalidate } from "~/routes/shopping-list";
import { NETWORK_FAILURE_MESSAGE } from "~/lib/network-failure";

// What WebKit on Linux's fetch rejected with when a Clear all's connection was reset (spoonjoy-v2#771).
const noAnswer = () => new TypeError("Error receiving data: Connection reset by peer");

function post(fields: Record<string, string>) {
  return new Request("https://spoonjoy.test/shopping-list", { method: "POST", body: new URLSearchParams(fields) });
}

describe("shopping list clientAction", () => {
  it("returns the server's answer", async () => {
    const serverAction = vi.fn(async () => ({ success: true }));
    await expect(clientAction({ request: post({ intent: "clearAll" }), params: {}, serverAction } as never)).resolves.toEqual({ success: true });
  });

  // Pins IDEMPOTENT_INTENTS: clearing leaves the same list however often it is applied; adding does not.
  it.each([
    ["clearAll", { intent: "clearAll" }],
    ["clearCompleted", { intent: "clearCompleted" }],
    ["addItem", null],
    ["toggleCheck", null],
    ["removeItem", null],
  ])("answers a lost %s with a message, offering %j to send again", async (intent, resend) => {
    const serverAction = vi.fn().mockRejectedValue(noAnswer());
    await expect(clientAction({ request: post({ intent }), params: {}, serverAction } as never)).resolves.toEqual({
      intent,
      error: NETWORK_FAILURE_MESSAGE,
      errorCode: "network_failure",
      retryable: true,
      resend,
    });
    expect(serverAction).toHaveBeenCalledTimes(1);
  });

  it("rethrows a server's error, which is an answer", async () => {
    const serverError = new Error("Unexpected Server Error");
    await expect(clientAction({ request: post({ intent: "clearAll" }), params: {}, serverAction: vi.fn().mockRejectedValue(serverError) } as never)).rejects.toBe(serverError);
  });

  it("keeps the list as it is after a lost submission, and otherwise revalidates as React Router would", () => {
    const lost = { intent: "clearAll", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true, resend: { intent: "clearAll" } };
    expect(shouldRevalidate({ actionResult: lost, defaultShouldRevalidate: true } as never)).toBe(false);
    expect(shouldRevalidate({ actionResult: { success: true }, defaultShouldRevalidate: true } as never)).toBe(true);
  });
});
