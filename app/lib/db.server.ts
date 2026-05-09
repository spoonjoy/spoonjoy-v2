import { PrismaD1 } from "@prisma/adapter-d1";

// Type import only - doesn't cause runtime bundling issues
import type { PrismaClient as PrismaClientType } from "@prisma/client";

// Cloudflare D1 for all environments (local + production)
export async function getDb(env: { DB: D1Database }): Promise<PrismaClientType> {
  const { PrismaClient } = await import("@prisma/client");
  const adapter = new PrismaD1(env.DB as never);
  return new PrismaClient({ adapter });
}

async function createLocalSqliteDb(): Promise<PrismaClientType> {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient();
}

let localDbPromise: Promise<PrismaClientType> | null = null;
export let db: PrismaClientType | null = null;

// Backwards-compatible API for tests/scripts; now uses local D1, not SQLite.
export async function getLocalDb(): Promise<PrismaClientType> {
  if (!localDbPromise) {
    localDbPromise = (async () => {
      if (process.env.VITEST) {
        return createLocalSqliteDb();
      }

      try {
        const { getPlatformProxy } = await import("wrangler");
        const platform = await getPlatformProxy<{ DB: D1Database }>();
        if (platform.env?.DB) {
          return getDb({ DB: platform.env.DB });
        }
      } catch {
        // Fallback for restricted test sandboxes where workerd cannot bind loopback ports.
      }

      return createLocalSqliteDb();
    })();
  }

  db = await localDbPromise;
  return db;
}
