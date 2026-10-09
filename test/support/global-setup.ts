import { releaseRunDbDir, snapshotTemplate } from "./worker-db";

// vitest.config.ts claims SPOONJOY_TEST_DB_DIR for this run's per-process database copies
// (see test/support/worker-db.ts). Before any worker starts, take one consistent snapshot of
// prisma/test.db for them to copy; remove the directory once every worker has exited. A nested
// Vitest run started by a test never removes its parent's directory, because it does not own it.
export default async function setup(): Promise<() => void> {
  await snapshotTemplate();
  return () => releaseRunDbDir();
}
