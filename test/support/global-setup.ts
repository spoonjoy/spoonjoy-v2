import { releaseRunDbDir } from "./worker-db";

// vitest.config.ts claims SPOONJOY_TEST_DB_DIR for this run's per-process database copies
// (see test/support/worker-db.ts); remove it once every worker has exited. A nested Vitest run
// started by a test never removes its parent's directory, because it does not own it.
export default function setup(): () => void {
  return () => releaseRunDbDir();
}
