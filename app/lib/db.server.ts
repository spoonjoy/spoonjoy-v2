import { PrismaD1 } from "@prisma/adapter-d1";

// Type import only - doesn't cause runtime bundling issues
import type { PrismaClient as PrismaClientType } from "@prisma/client";

// One Prisma client per D1 binding for the life of the isolate. Each client starts its own
// WASM query engine, so a client per call grows the isolate's memory until the engine traps.
const clientsByBinding = new WeakMap<object, Promise<PrismaClientType>>();

// Cloudflare D1 for all environments (local + production)
export function getDb(env: { DB: D1Database }): Promise<PrismaClientType> {
  const binding = env.DB as unknown as object;
  let client = clientsByBinding.get(binding);
  if (!client) {
    client = (async () => {
      const { PrismaClient } = await import("@prisma/client");
      return new PrismaClient({ adapter: new PrismaD1(env.DB as never) });
    })();
    clientsByBinding.set(binding, client);
  }
  return client;
}

async function createLocalSqliteDb(): Promise<PrismaClientType> {
  const { PrismaClient } = await import("@prisma/client");
  return new PrismaClient();
}

async function loadWranglerPlatformProxy(): Promise<Pick<typeof import("wrangler"), "getPlatformProxy">> {
  const moduleName = "wrangler";
  return import(/* @vite-ignore */ moduleName);
}

export function shouldUseDirectLocalSqlite(): boolean {
  const forced = process.env.SPOONJOY_FORCE_SQLITE_LOCAL_DB;
  const dogfoodHarness = process.env.SPOONJOY_NATIVE_DOGFOOD_API;
  const isTruthy = (value: string | undefined) =>
    typeof value === "string" && /^(1|true|yes)$/i.test(value.trim());
  return isTruthy(forced) && isTruthy(dogfoodHarness);
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

      if (shouldUseDirectLocalSqlite()) {
        return createLocalSqliteDb();
      }

      try {
        const { getPlatformProxy } = await loadWranglerPlatformProxy();
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
