import { describe, expect, it } from "vitest";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { isSpoonjoyOperationRetryableAfterD1Error } from "~/lib/spoonjoy-api.server";

const NETWORK_LOST = new Error("D1_ERROR: Network connection lost.");

describe("which tool calls are retryable after D1 was briefly unavailable", () => {
  it("retries any tool whose write gave up, since that write did not apply or is safe to run again", () => {
    const gaveUp = new D1WriteUnavailableError("shopping_list.add_item", NETWORK_LOST);
    expect(isSpoonjoyOperationRetryableAfterD1Error("add_shopping_list_item", gaveUp)).toBe(true);
  });

  it.each([
    ["get_shopping_list", true],
    ["remove_shopping_list_item", true],
    ["add_shopping_list_item", false],
    ["create_recipe", false],
    ["not_a_tool", false],
  ])("retries %s after a raw transient error: %s", (name, retryable) => {
    expect(isSpoonjoyOperationRetryableAfterD1Error(name, NETWORK_LOST)).toBe(retryable);
  });

  it("never treats an error that is not D1 being unavailable as retryable", () => {
    expect(isSpoonjoyOperationRetryableAfterD1Error("get_shopping_list", new Error("Recipe not found"))).toBe(false);
  });
});
