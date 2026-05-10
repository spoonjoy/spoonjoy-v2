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
    delete process.env.INGREDIENT_PARSE_PROVIDER;
    delete process.env.INGREDIENT_PARSE_MODEL;
    delete process.env.INGREDIENT_PARSE_TIMEOUT_MS;
    delete process.env.INGREDIENT_PARSE_MAX_RETRIES;
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

    expect(
      getIngredientParserEnv({
        cloudflare: {
          env: {
            OPENAI_API_KEY: "cf-key",
            INGREDIENT_PARSE_PROVIDER: "openai",
            INGREDIENT_PARSE_MODEL: "cf-model",
            INGREDIENT_PARSE_TIMEOUT_MS: "9000",
            INGREDIENT_PARSE_MAX_RETRIES: "2",
          },
        },
      })
    ).toEqual({
      OPENAI_API_KEY: "cf-key",
      INGREDIENT_PARSE_PROVIDER: "openai",
      INGREDIENT_PARSE_MODEL: "cf-model",
      INGREDIENT_PARSE_TIMEOUT_MS: "9000",
      INGREDIENT_PARSE_MAX_RETRIES: "2",
    });
  });

  it("falls back to process env for ingredient parser values outside Cloudflare", () => {
    process.env.OPENAI_API_KEY = "process-key";
    process.env.INGREDIENT_PARSE_PROVIDER = "openai";
    process.env.INGREDIENT_PARSE_MODEL = "process-model";
    process.env.INGREDIENT_PARSE_TIMEOUT_MS = "7000";
    process.env.INGREDIENT_PARSE_MAX_RETRIES = "0";

    expect(getIngredientParserEnv({ cloudflare: { env: null } })).toEqual({
      OPENAI_API_KEY: "process-key",
      INGREDIENT_PARSE_PROVIDER: "openai",
      INGREDIENT_PARSE_MODEL: "process-model",
      INGREDIENT_PARSE_TIMEOUT_MS: "7000",
      INGREDIENT_PARSE_MAX_RETRIES: "0",
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
