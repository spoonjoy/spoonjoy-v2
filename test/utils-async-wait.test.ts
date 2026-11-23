import { getConfig } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASYNC_UTIL_TIMEOUT_MS } from "./utils";

describe("test utils", () => {
  it("give findBy* and waitFor 3 s before they fail", () => {
    expect(ASYNC_UTIL_TIMEOUT_MS).toBe(3000);
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
  });
});
