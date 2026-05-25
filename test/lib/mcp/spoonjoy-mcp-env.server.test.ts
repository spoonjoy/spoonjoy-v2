import { describe, expect, it } from "vitest";
import { getSpoonjoyMcpEnv } from "~/lib/mcp/spoonjoy-mcp-env.server";

describe("getSpoonjoyMcpEnv", () => {
  it("returns trimmed OpenAI env for local MCP imports", () => {
    expect(getSpoonjoyMcpEnv({ OPENAI_API_KEY: "  sk-test  " })).toEqual({
      OPENAI_API_KEY: "sk-test",
    });
  });

  it("returns null when OpenAI env is absent or blank", () => {
    expect(getSpoonjoyMcpEnv({})).toBeNull();
    expect(getSpoonjoyMcpEnv({ OPENAI_API_KEY: "   " })).toBeNull();
  });
});
