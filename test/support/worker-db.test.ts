// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { prepareWorkerDb, workerDatabaseUrl, workerDbPath } from "./worker-db";

const template = resolve(__dirname, "../../prisma/test.db");

describe("per-process test database", () => {
  it("gives two live worker processes different database files", () => {
    const copy = vi.fn();
    const a: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "/tmp/run" };
    const b: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "/tmp/run" };

    const first = prepareWorkerDb(a, 101, copy);
    const second = prepareWorkerDb(b, 102, copy);

    expect(first).toBe("/tmp/run/worker-101.db");
    expect(second).toBe("/tmp/run/worker-102.db");
    expect(copy).toHaveBeenNthCalledWith(1, template, first);
    expect(copy).toHaveBeenNthCalledWith(2, template, second);
    expect(workerDbPath(a)).toBe(first);
    expect(workerDatabaseUrl(first)).toBe("file:/tmp/run/worker-101.db?connection_limit=1&socket_timeout=60");
  });

  it("copies once per process, so a second test file in the same process never overwrites an open database", () => {
    const copy = vi.fn();
    const env: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "/tmp/run" };
    prepareWorkerDb(env, 7, copy);
    expect(prepareWorkerDb(env, 7, copy)).toBe("/tmp/run/worker-7.db");
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("uses prisma/test.db directly when no run directory is set", () => {
    const copy = vi.fn();
    expect(prepareWorkerDb({}, 1, copy)).toBe(template);
    expect(prepareWorkerDb({ SPOONJOY_TEST_DB_DIR: "" }, 1, copy)).toBe(template);
    expect(copy).not.toHaveBeenCalled();
    expect(workerDbPath({})).toBe(template);
  });
});
