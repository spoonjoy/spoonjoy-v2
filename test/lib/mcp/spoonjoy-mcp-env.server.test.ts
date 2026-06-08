import { describe, expect, it } from "vitest";
import { getSpoonjoyMcpEnv } from "~/lib/mcp/spoonjoy-mcp-env.server";

describe("getSpoonjoyMcpEnv", () => {
  it("returns trimmed OpenAI env for local MCP imports", () => {
    expect(getSpoonjoyMcpEnv({
      OPENAI_API_KEY: "  sk-test  ",
      GOOGLE_API_KEY: " google-test ",
      GEMINI_API_KEY: " gemini-test ",
      GEMINI_IMAGE_MODEL: " gemini-3.1-flash-image ",
      GEMINI_IMAGE_TIMEOUT_MS: " 45000 ",
      IMAGE_PROVIDER_PRIMARY: " gemini ",
      IMAGE_PROVIDER_FALLBACKS: " openai ",
      SPOONJOY_BASE_URL: " https://spoonjoy.app/path ",
    })).toEqual({
      OPENAI_API_KEY: "sk-test",
      GOOGLE_API_KEY: "google-test",
      GEMINI_API_KEY: "gemini-test",
      GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
      GEMINI_IMAGE_TIMEOUT_MS: "45000",
      IMAGE_PROVIDER_PRIMARY: "gemini",
      IMAGE_PROVIDER_FALLBACKS: "openai",
      SPOONJOY_BASE_URL: "https://spoonjoy.app/path",
    });
  });

  it("returns the base URL alone and null when MCP env is absent or blank", () => {
    expect(getSpoonjoyMcpEnv({ SPOONJOY_BASE_URL: " https://spoonjoy.app " })).toEqual({
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
    });
    expect(getSpoonjoyMcpEnv({ OPENAI_API_KEY: " sk-only " })).toEqual({
      OPENAI_API_KEY: "sk-only",
    });
    expect(getSpoonjoyMcpEnv({ GEMINI_API_KEY: " gemini-only " })).toEqual({
      GEMINI_API_KEY: "gemini-only",
    });
    expect(getSpoonjoyMcpEnv({})).toBeNull();
    expect(getSpoonjoyMcpEnv({
      OPENAI_API_KEY: "   ",
      GEMINI_API_KEY: " ",
      GEMINI_IMAGE_TIMEOUT_MS: " ",
      IMAGE_PROVIDER_PRIMARY: "  ",
      SPOONJOY_BASE_URL: "  ",
    })).toBeNull();
  });
});
