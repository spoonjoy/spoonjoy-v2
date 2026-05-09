import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getLocalDb: vi.fn(),
}));

vi.mock("~/lib/db.server", () => mocks);

import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";

describe("route-platform.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the Cloudflare env from route context", () => {
    const env = { OPENAI_API_KEY: "test-key" };

    expect(getCloudflareEnv({ cloudflare: { env } })).toBe(env);
  });

  it("returns undefined when the route context has no env", () => {
    expect(getCloudflareEnv({ cloudflare: { env: null } })).toBeUndefined();
    expect(getCloudflareEnv({})).toBeUndefined();
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
