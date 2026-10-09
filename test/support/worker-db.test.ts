// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import {
  claimRunDbDir,
  prepareWorkerDb,
  releaseRunDbDir,
  snapshotTemplate,
  workerDatabaseUrl,
  workerDbPath,
  type WorkerDbIo,
} from "./worker-db";

const template = resolve(__dirname, "../../prisma/test.db");

function fakeIo(existing: string[] = []) {
  const exitHandlers: Array<() => void> = [];
  const io = {
    copy: vi.fn(),
    exists: vi.fn((path: string) => existing.includes(path)),
    remove: vi.fn(),
    onExit: vi.fn((cleanup: () => void) => exitHandlers.push(cleanup)),
  } satisfies WorkerDbIo;
  return { io, exit: () => exitHandlers.forEach((cleanup) => cleanup()) };
}

describe("per-process test database", () => {
  it("gives two live worker processes different database files", () => {
    const { io } = fakeIo(["/tmp/run/template.db"]);
    const a: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "/tmp/run" };
    const b: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "/tmp/run" };

    const first = prepareWorkerDb(a, 101, io, 0);
    const second = prepareWorkerDb(b, 102, io, 0);

    expect(first).toBe("/tmp/run/worker-101.db");
    expect(second).toBe("/tmp/run/worker-102.db");
    expect(io.copy).toHaveBeenNthCalledWith(1, "/tmp/run/template.db", first);
    expect(io.copy).toHaveBeenNthCalledWith(2, "/tmp/run/template.db", second);
    expect(workerDbPath(a)).toBe(first);
    expect(workerDatabaseUrl(first)).toBe("file:/tmp/run/worker-101.db?connection_limit=1&socket_timeout=60");
  });

  it("refuses to copy the live template when the run's snapshot is missing", () => {
    const { io } = fakeIo();
    expect(() => prepareWorkerDb({ SPOONJOY_TEST_DB_DIR: "/tmp/run" }, 5, io, 0)).toThrow(/template\.db is missing/);
    expect(io.copy).not.toHaveBeenCalled();
  });

  it("gives worker threads that share a pid different database files", () => {
    const { io } = fakeIo(["/tmp/run/template.db"]);
    expect(prepareWorkerDb({ SPOONJOY_TEST_DB_DIR: "/tmp/run" }, 7, io, 1)).toBe("/tmp/run/worker-7-1.db");
    expect(prepareWorkerDb({ SPOONJOY_TEST_DB_DIR: "/tmp/run" }, 7, io, 2)).toBe("/tmp/run/worker-7-2.db");
  });

  it("copies once per process, so a second test file in the same process never overwrites an open database", () => {
    const { io } = fakeIo(["/tmp/run/template.db"]);
    const env: NodeJS.ProcessEnv = { SPOONJOY_TEST_DB_DIR: "/tmp/run" };
    prepareWorkerDb(env, 7, io, 0);
    expect(prepareWorkerDb(env, 7, io, 0)).toBe("/tmp/run/worker-7.db");
    expect(io.copy).toHaveBeenCalledTimes(1);
    expect(io.onExit).toHaveBeenCalledTimes(1);
  });

  it("copies the run's snapshot when there is one, after clearing a stale journal, and removes the copy on exit", () => {
    const { io, exit } = fakeIo(["/tmp/run/template.db"]);
    const path = prepareWorkerDb({ SPOONJOY_TEST_DB_DIR: "/tmp/run" }, 9, io, 0);

    expect(io.remove.mock.calls.map(([p]) => p)).toEqual([`${path}-journal`, `${path}-wal`, `${path}-shm`]);
    expect(io.remove.mock.invocationCallOrder[2]).toBeLessThan(io.copy.mock.invocationCallOrder[0]);
    expect(io.copy).toHaveBeenCalledWith("/tmp/run/template.db", path);

    io.remove.mockClear();
    exit();
    expect(io.remove.mock.calls.map(([p]) => p)).toEqual([path, `${path}-journal`, `${path}-wal`, `${path}-shm`]);
  });

  it("uses prisma/test.db directly when no run directory is set", () => {
    const { io } = fakeIo();
    expect(prepareWorkerDb({}, 1, io, 0)).toBe(template);
    expect(prepareWorkerDb({ SPOONJOY_TEST_DB_DIR: "" }, 1, io, 0)).toBe(template);
    expect(io.copy).not.toHaveBeenCalled();
    expect(io.onExit).not.toHaveBeenCalled();
    expect(workerDbPath({})).toBe(template);
  });

  it("gives a nested Vitest run its own directory, so the nested run's teardown leaves the parent's copies alone", () => {
    const remove = vi.fn();
    const parent: NodeJS.ProcessEnv = {};
    const parentDir = claimRunDbDir(parent, 10, () => "/tmp/parent");
    // A worker of the parent run has made its copy; a test in it starts a nested Vitest run,
    // which inherits that worker's environment.
    prepareWorkerDb(parent, 11, fakeIo(["/tmp/parent/template.db"]).io, 0);
    const nested: NodeJS.ProcessEnv = { ...parent };

    expect(claimRunDbDir(nested, 20, () => "/tmp/nested")).toBe("/tmp/nested");
    expect(nested.SPOONJOY_TEST_DB_PATH).toBeUndefined();
    expect(prepareWorkerDb(nested, 21, fakeIo(["/tmp/nested/template.db"]).io, 0)).toBe("/tmp/nested/worker-21.db");

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

  it("claims a fresh directory after a watch-mode teardown re-evaluates the config in the same process", () => {
    let made = 0;
    const makeDir = () => `/tmp/run-${++made}`;
    const env: NodeJS.ProcessEnv = {};
    expect(claimRunDbDir(env, 10, makeDir)).toBe("/tmp/run-1");
    releaseRunDbDir(env, 10, vi.fn());
    expect(env.SPOONJOY_TEST_DB_DIR).toBeUndefined();
    expect(env.SPOONJOY_TEST_DB_DIR_OWNER).toBeUndefined();
    expect(claimRunDbDir(env, 10, makeDir)).toBe("/tmp/run-2");
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

  it("snapshots prisma/test.db into the run directory with SQLite's online backup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spoonjoy-worker-db-test-"));
    const path = await snapshotTemplate({ SPOONJOY_TEST_DB_DIR: dir });

    expect(path).toBe(join(dir, "template.db"));
    expect(existsSync(path!)).toBe(true);
    const snapshot = new DatabaseSync(path!, { readonly: true });
    const live = new DatabaseSync(template, { readonly: true });
    try {
      const tables = (db: DatabaseSync) =>
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
      expect(tables(snapshot)).toEqual(tables(live));
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      snapshot.close();
      live.close();
      rmSync(dir, { recursive: true, force: true });
    }

    const backup = vi.fn(async () => undefined);
    expect(await snapshotTemplate({}, backup)).toBeUndefined();
    expect(backup).not.toHaveBeenCalled();
  });

  it("removes a real fork's copy when Vitest stops the fork with SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spoonjoy-worker-db-sigterm-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, SPOONJOY_TEST_DB_DIR: dir };
      delete env.SPOONJOY_TEST_DB_PATH;
      await snapshotTemplate(env);
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `const { prepareWorkerDb } = await import(${JSON.stringify(pathToFileURL(resolve(__dirname, "worker-db.ts")).href)});` +
            "prepareWorkerDb(); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);",
        ],
        { env, stdio: ["ignore", "pipe", "inherit"] },
      );
      await new Promise<void>((ready) => child.stdout!.on("data", (chunk) => String(chunk).includes("ready") && ready()));
      expect(readdirSync(dir).sort()).toEqual(["template.db", `worker-${child.pid}.db`]);

      const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
      child.kill("SIGTERM");
      expect(await exited).toBe(143);
      expect(readdirSync(dir)).toEqual(["template.db"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
