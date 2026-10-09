import { resolve } from "node:path";

// Each Vitest worker gets its own SQLite file so DB-backed tests can run in parallel.
// Vitest numbers its pool slots from 1 (VITEST_POOL_ID); a run without a pool id
// (a bare script or a single in-process run) keeps using the shared prisma/test.db.
const prismaDir = resolve(__dirname, "../../prisma");

export function workerDbFileName(poolId: string | undefined = process.env.VITEST_POOL_ID): string {
  return poolId && /^\d+$/.test(poolId) ? `test-${poolId}.db` : "test.db";
}

export function workerDbPath(poolId?: string): string {
  return resolve(prismaDir, workerDbFileName(poolId));
}

export function workerDatabaseUrl(poolId?: string): string {
  return `file:./${workerDbFileName(poolId)}?connection_limit=1&socket_timeout=60`;
}
