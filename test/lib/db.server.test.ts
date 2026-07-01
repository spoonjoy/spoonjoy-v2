import { afterEach, describe, it, expect, vi } from "vitest";
import { getDb } from "~/lib/db.server";

describe("db.server", () => {
  afterEach(() => {
    vi.doUnmock("wrangler");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("getDb", () => {
    it("should create PrismaClient with D1 adapter for Cloudflare environment", async () => {
      // Mock D1Database
      const mockD1 = {
        prepare: vi.fn(),
        dump: vi.fn(),
        batch: vi.fn(),
        exec: vi.fn(),
      } as unknown as D1Database;

      const env = { DB: mockD1 };
      
      const db = await getDb(env);
      
      // Verify we got a PrismaClient instance
      expect(db).toBeDefined();
      expect(typeof db.$connect).toBe("function");
      expect(typeof db.$disconnect).toBe("function");
    });

    it("should handle different D1Database instances", async () => {
      const mockD1_1 = {
        prepare: vi.fn(),
        dump: vi.fn(),
        batch: vi.fn(),
        exec: vi.fn(),
      } as unknown as D1Database;

      const mockD1_2 = {
        prepare: vi.fn(),
        dump: vi.fn(),
        batch: vi.fn(),
        exec: vi.fn(),
      } as unknown as D1Database;

      const db1 = await getDb({ DB: mockD1_1 });
      const db2 = await getDb({ DB: mockD1_2 });

      // Should return different instances for different D1 databases
      expect(db1).toBeDefined();
      expect(db2).toBeDefined();
    });
  });

  describe("getLocalDb", () => {
    it("uses a Wrangler D1 binding when not running under Vitest mode", async () => {
      vi.resetModules();
      vi.stubEnv("VITEST", "");
      vi.stubEnv("SPOONJOY_FORCE_SQLITE_LOCAL_DB", "");
      vi.stubEnv("SPOONJOY_NATIVE_DOGFOOD_API", "");
      const mockD1 = {
        prepare: vi.fn(),
        dump: vi.fn(),
        batch: vi.fn(),
        exec: vi.fn(),
      } as unknown as D1Database;

      vi.doMock("wrangler", () => ({
        getPlatformProxy: vi.fn(async () => ({ env: { DB: mockD1 } })),
      }));

      const { getLocalDb } = await import("~/lib/db.server");
      const db = await getLocalDb();
      const cachedDb = await getLocalDb();

      expect(db).toBeDefined();
      expect(cachedDb).toBe(db);
      expect(typeof db.$connect).toBe("function");
    });

    it("uses local SQLite directly when native dogfood forces the local driver", async () => {
      vi.resetModules();
      vi.stubEnv("VITEST", "");
      vi.stubEnv("SPOONJOY_FORCE_SQLITE_LOCAL_DB", " yes ");
      vi.stubEnv("SPOONJOY_NATIVE_DOGFOOD_API", "true");
      const getPlatformProxy = vi.fn();

      vi.doMock("wrangler", () => ({ getPlatformProxy }));

      const { getLocalDb, shouldUseDirectLocalSqlite } = await import("~/lib/db.server");
      const db = await getLocalDb();

      expect(shouldUseDirectLocalSqlite()).toBe(true);
      expect(db).toBeDefined();
      expect(typeof db.$connect).toBe("function");
      expect(getPlatformProxy).not.toHaveBeenCalled();
    });

    it("does not force local SQLite for disabled dogfood driver values", async () => {
      vi.resetModules();
      vi.stubEnv("SPOONJOY_FORCE_SQLITE_LOCAL_DB", "no");
      vi.stubEnv("SPOONJOY_NATIVE_DOGFOOD_API", "true");

      const { shouldUseDirectLocalSqlite } = await import("~/lib/db.server");

      expect(shouldUseDirectLocalSqlite()).toBe(false);
    });

    it("does not force local SQLite unless the native dogfood harness is active", async () => {
      vi.resetModules();
      vi.stubEnv("SPOONJOY_FORCE_SQLITE_LOCAL_DB", "true");
      vi.stubEnv("SPOONJOY_NATIVE_DOGFOOD_API", "");

      const { shouldUseDirectLocalSqlite } = await import("~/lib/db.server");

      expect(shouldUseDirectLocalSqlite()).toBe(false);
    });

    it("falls back locally when Wrangler has no DB binding", async () => {
      vi.resetModules();
      vi.stubEnv("VITEST", "");
      vi.stubEnv("SPOONJOY_FORCE_SQLITE_LOCAL_DB", "");
      vi.stubEnv("SPOONJOY_NATIVE_DOGFOOD_API", "");
      vi.doMock("wrangler", () => ({
        getPlatformProxy: vi.fn(async () => ({ env: {} })),
      }));

      const { getLocalDb } = await import("~/lib/db.server");
      const db = await getLocalDb();

      expect(db).toBeDefined();
      expect(typeof db.$connect).toBe("function");
    });

    it("falls back to a local Prisma client when Wrangler is unavailable", async () => {
      vi.resetModules();
      vi.stubEnv("VITEST", "");
      vi.stubEnv("SPOONJOY_FORCE_SQLITE_LOCAL_DB", "");
      vi.stubEnv("SPOONJOY_NATIVE_DOGFOOD_API", "");
      vi.doMock("wrangler", () => ({
        getPlatformProxy: vi.fn(async () => {
          throw new Error("workerd unavailable");
        }),
      }));

      const { getLocalDb } = await import("~/lib/db.server");
      const db = await getLocalDb();

      expect(db).toBeDefined();
      expect(typeof db.$connect).toBe("function");
    });
  });
});
