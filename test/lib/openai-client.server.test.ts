import { describe, expect, it, vi } from "vitest";
import { createOpenAIClient } from "~/lib/openai-client.server";

const constructorOptions = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      constructorOptions(options);
    }
  },
}));

describe("createOpenAIClient", () => {
  it("centralizes server-side OpenAI construction for Workers-like runtimes", () => {
    const client = createOpenAIClient({
      apiKey: "sk-test",
      timeout: 1234,
      maxRetries: 0,
    });

    expect(client).toBeInstanceOf(Object);
    expect(constructorOptions).toHaveBeenCalledWith({
      apiKey: "sk-test",
      timeout: 1234,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });
  });
});
