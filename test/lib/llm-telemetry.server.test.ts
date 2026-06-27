import { describe, expect, it, vi } from "vitest";
import { captureLlmCallFailure } from "~/lib/llm-telemetry.server";

function jsonResponse(): Response {
  return new Response("{}", { status: 200 });
}

describe("captureLlmCallFailure", () => {
  it("posts a spoonjoy.llm_call.failed event with the preserved OpenAI fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse());

    await captureLlmCallFailure({
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      distinctId: "chef_42",
      operation: "ingredient_parse",
      provider: "openai",
      model: "gpt-4o-mini",
      errorCode: "insufficient_quota",
      errorType: "insufficient_quota",
      errorStatus: 429,
      errorMessage: "OpenAI rate limit exceeded",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://posthog.example/i/v0/e/");
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("spoonjoy.llm_call.failed");
    expect(body.distinct_id).toBe("chef_42");
    expect(body.properties).toMatchObject({
      feature: "llm_call",
      operation: "ingredient_parse",
      provider: "openai",
      model: "gpt-4o-mini",
      errorCode: "insufficient_quota",
      errorType: "insufficient_quota",
      errorStatus: 429,
      errorMessage: "OpenAI rate limit exceeded",
    });
  });

  it("falls back to the anon distinct id and omits empty optional fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse());

    await captureLlmCallFailure({
      postHogConfig: { enabled: true, key: "ph_test", host: "https://posthog.example" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      operation: "recipe_import",
      provider: "openai",
      model: "gpt-4o-mini",
      errorStatus: null,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.distinct_id).toBe("anon");
    expect(body.properties.errorType).toBeUndefined();
    expect(body.properties.errorStatus).toBeUndefined();
    expect(body.properties.errorMessage).toBeUndefined();
  });

  it("resolves PostHog config from env when no explicit config is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse());

    await captureLlmCallFailure({
      env: { POSTHOG_KEY: "ph_env" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      operation: "ingredient_parse",
      provider: "openai",
      model: "gpt-4o-mini",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.api_key).toBe("ph_env");
  });

  it("no-ops when PostHog is unconfigured", async () => {
    const fetchImpl = vi.fn();

    await captureLlmCallFailure({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      operation: "ingredient_parse",
      provider: "openai",
      model: "gpt-4o-mini",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
