// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { claimRunDbDir, prepareWorkerDb, releaseRunDbDir, workerDatabaseUrl, workerDbPath } from "./worker-db";

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

  it("gives a nested Vitest run its own directory, so the nested run's teardown leaves the parent's copies alone", () => {
    const remove = vi.fn();
    const parent: NodeJS.ProcessEnv = {};
    const parentDir = claimRunDbDir(parent, 10, () => "/tmp/parent");
    // A worker of the parent run has made its copy; a test in it starts a nested Vitest run,
    // which inherits that worker's environment.
    prepareWorkerDb(parent, 11, vi.fn());
    const nested: NodeJS.ProcessEnv = { ...parent };

    expect(claimRunDbDir(nested, 20, () => "/tmp/nested")).toBe("/tmp/nested");
    expect(nested.SPOONJOY_TEST_DB_PATH).toBeUndefined();
    expect(prepareWorkerDb(nested, 21, vi.fn())).toBe("/tmp/nested/worker-21.db");

    releaseRunDbDir(nested, 20, remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("/tmp/nested");

    releaseRunDbDir(parent, 10, remove);
    expect(remove).toHaveBeenLastCalledWith(parentDir);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("only removes a directory the releasing process created", () => {
    const remove = vi.fn();
    releaseRunDbDir({ SPOONJOY_TEST_DB_DIR: "/tmp/other", SPOONJOY_TEST_DB_DIR_OWNER: "10" }, 20, remove);
    releaseRunDbDir({ SPOONJOY_TEST_DB_DIR: "/tmp/unowned" }, 20, remove);
    releaseRunDbDir({}, 20, remove);
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps a run's own directory if its config is evaluated twice, and honours the empty opt-out", () => {
    const makeDir = vi.fn(() => "/tmp/once");
    const env: NodeJS.ProcessEnv = {};
    claimRunDbDir(env, 10, makeDir);
    expect(claimRunDbDir(env, 10, makeDir)).toBe("/tmp/once");
    expect(makeDir).toHaveBeenCalledTimes(1);

    const optedOut: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "" };
    expect(claimRunDbDir(optedOut, 10, makeDir)).toBeUndefined();
    expect(optedOut.SPOONJOY_TEST_DB_DIR).toBe("");
    expect(makeDir).toHaveBeenCalledTimes(1);
  });
});
