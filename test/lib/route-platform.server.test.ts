import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getLocalDb: vi.fn(),
}));

vi.mock("~/lib/db.server", () => mocks);

import {
  getCloudflareEnv,
  getIngredientParserEnv,
  getRequestDb,
} from "~/lib/route-platform.server";

describe("route-platform.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_TEXT_MODEL;
    delete process.env.GEMINI_TEXT_TIMEOUT_MS;
    delete process.env.INGREDIENT_PARSE_PROVIDER;
    delete process.env.INGREDIENT_PARSE_MODEL;
    delete process.env.INGREDIENT_PARSE_TIMEOUT_MS;
    delete process.env.INGREDIENT_PARSE_MAX_RETRIES;
    delete process.env.POSTHOG_KEY;
    delete process.env.POSTHOG_HOST;
    delete process.env.POSTHOG_DISABLED;
  });

  it("returns the Cloudflare env from route context", () => {
    const env = { OPENAI_API_KEY: "test-key" };

    expect(getCloudflareEnv({ cloudflare: { env } })).toBe(env);
  });

  it("returns undefined when the route context has no env", () => {
    expect(getCloudflareEnv({ cloudflare: { env: null } })).toBeUndefined();
    expect(getCloudflareEnv({})).toBeUndefined();
  });

  it("returns ingredient parser env from Cloudflare bindings before process env", () => {
    process.env.OPENAI_API_KEY = "process-key";
    process.env.INGREDIENT_PARSE_MODEL = "process-model";
    process.env.POSTHOG_KEY = "process-ph";

    expect(
      getIngredientParserEnv({
        cloudflare: {
          env: {
            OPENAI_API_KEY: "cf-key",
            GOOGLE_API_KEY: "cf-google",
            GEMINI_TEXT_MODEL: "cf-gemini-model",
            GEMINI_TEXT_TIMEOUT_MS: "5000",
            INGREDIENT_PARSE_PROVIDER: "openai",
            INGREDIENT_PARSE_MODEL: "cf-model",
            INGREDIENT_PARSE_TIMEOUT_MS: "9000",
            INGREDIENT_PARSE_MAX_RETRIES: "2",
            POSTHOG_KEY: "cf-ph",
            POSTHOG_HOST: "https://cf.posthog.example",
            POSTHOG_DISABLED: "0",
          },
        },
      })
    ).toEqual({
      OPENAI_API_KEY: "cf-key",
      // Gemini fallback keys MUST flow through (else the fallback is dead on
      // the interactive parse surfaces).
      GOOGLE_API_KEY: "cf-google",
      GEMINI_TEXT_MODEL: "cf-gemini-model",
      GEMINI_TEXT_TIMEOUT_MS: "5000",
      INGREDIENT_PARSE_PROVIDER: "openai",
      INGREDIENT_PARSE_MODEL: "cf-model",
      INGREDIENT_PARSE_TIMEOUT_MS: "9000",
      INGREDIENT_PARSE_MAX_RETRIES: "2",
      POSTHOG_KEY: "cf-ph",
      POSTHOG_HOST: "https://cf.posthog.example",
      POSTHOG_DISABLED: "0",
    });
  });

  it("falls back to process env for ingredient parser values outside Cloudflare", () => {
    process.env.OPENAI_API_KEY = "process-key";
    process.env.GOOGLE_API_KEY = "process-google";
    process.env.GEMINI_TEXT_MODEL = "process-gemini-model";
    process.env.GEMINI_TEXT_TIMEOUT_MS = "6000";
    process.env.INGREDIENT_PARSE_PROVIDER = "openai";
    process.env.INGREDIENT_PARSE_MODEL = "process-model";
    process.env.INGREDIENT_PARSE_TIMEOUT_MS = "7000";
    process.env.INGREDIENT_PARSE_MAX_RETRIES = "0";
    process.env.POSTHOG_KEY = "process-ph";
    process.env.POSTHOG_HOST = "https://process.posthog.example";
    process.env.POSTHOG_DISABLED = "1";

    expect(getIngredientParserEnv({ cloudflare: { env: null } })).toEqual({
      OPENAI_API_KEY: "process-key",
      GOOGLE_API_KEY: "process-google",
      GEMINI_TEXT_MODEL: "process-gemini-model",
      GEMINI_TEXT_TIMEOUT_MS: "6000",
      INGREDIENT_PARSE_PROVIDER: "openai",
      INGREDIENT_PARSE_MODEL: "process-model",
      INGREDIENT_PARSE_TIMEOUT_MS: "7000",
      INGREDIENT_PARSE_MAX_RETRIES: "0",
      POSTHOG_KEY: "process-ph",
      POSTHOG_HOST: "https://process.posthog.example",
      POSTHOG_DISABLED: "1",
    });
  });

  it("uses the Cloudflare D1 binding when present", async () => {
    const d1 = {} as D1Database;
    const prisma = { source: "cloudflare" };
    mocks.getDb.mockResolvedValue(prisma);

    await expect(getRequestDb({ cloudflare: { env: { DB: d1 } } })).resolves.toBe(prisma);
    expect(mocks.getDb).toHaveBeenCalledWith({ DB: d1 });
    expect(mocks.getLocalDb).not.toHaveBeenCalled();
  });

  it("falls back to the local database outside Cloudflare", async () => {
    const prisma = { source: "local" };
    mocks.getLocalDb.mockResolvedValue(prisma);

    await expect(getRequestDb({})).resolves.toBe(prisma);
    expect(mocks.getLocalDb).toHaveBeenCalledOnce();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
