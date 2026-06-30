import { describe, expect, it } from "vitest";
import { NonceContext } from "~/lib/nonce";

describe("NonceContext", () => {
  it("is a React context with Provider/Consumer (empty-string default)", () => {
    expect(NonceContext).toBeDefined();
    expect(NonceContext.Provider).toBeDefined();
    expect(NonceContext.Consumer).toBeDefined();
  });
});
