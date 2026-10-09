import { rmSync } from "node:fs";

// vitest.config.ts creates SPOONJOY_TEST_DB_DIR for this run's per-process database copies
// (see test/support/worker-db.ts); remove it once every worker has exited.
export default function setup(): () => void {
  return () => {
    const dir = process.env.SPOONJOY_TEST_DB_DIR;
    if (dir) rmSync(dir, { recursive: true, force: true });
  };
}
