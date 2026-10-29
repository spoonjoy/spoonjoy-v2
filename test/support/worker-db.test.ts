// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import {
  claimRunDbDir,
  prepareWorkerDb,
  processAlive,
  releaseRunDbDir,
  releaseRunDbDirOnExit,
  sweepStaleRunDbDirs,
  snapshotTemplate,
  workerDatabaseUrl,
  workerDbPath,
  type SweepIo,
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

describe("run directories left behind", () => {
  const HOUR = 60 * 60 * 1000;

  it("names a run's directory after the process that claimed it", () => {
    const env: NodeJS.ProcessEnv = {};
    const dir = claimRunDbDir(env, 4242)!;
    try {
      expect(dir.startsWith(tmpdir())).toBe(true);
      expect(dir.slice(tmpdir().length).replace(/^\//, "")).toMatch(/^spoonjoy-vitest-db-4242-[^-]+$/);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes the directories of runs whose process has gone, and pid-less ones untouched for a day", () => {
    const removed: string[] = [];
    const io: SweepIo = {
      list: () => [
        "unrelated",
        "spoonjoy-vitest-db-111-dead01",
        "spoonjoy-vitest-db-222-live01",
        "spoonjoy-vitest-db-OLD123",
        "spoonjoy-vitest-db-NEW123",
      ],
      alive: (pid) => pid === 222,
      modifiedMs: (path) => (path.endsWith("OLD123") ? 0 : 30 * HOUR),
      remove: (path) => removed.push(path),
    };

    expect(sweepStaleRunDbDirs("/root", io, 25 * HOUR + 1)).toEqual(["/root/spoonjoy-vitest-db-111-dead01", "/root/spoonjoy-vitest-db-OLD123"]);
    expect(removed).toEqual(["/root/spoonjoy-vitest-db-111-dead01", "/root/spoonjoy-vitest-db-OLD123"]);
  });

  it("sweeps a real directory, keeping a live run's", () => {
    const root = mkdtempSync(join(tmpdir(), "spoonjoy-worker-db-sweep-"));
    try {
      const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
      for (const name of [`spoonjoy-vitest-db-${gone}-abc123`, `spoonjoy-vitest-db-${process.pid}-abc123`, "spoonjoy-vitest-db-old123", "spoonjoy-vitest-db-new123"]) {
        mkdirSync(join(root, name));
        writeFileSync(join(root, name, "template.db"), "");
      }
      const dayAndAMinuteAgo = (Date.now() - 24 * HOUR - 60_000) / 1000;
      utimesSync(join(root, "spoonjoy-vitest-db-old123"), dayAndAMinuteAgo, dayAndAMinuteAgo);

      sweepStaleRunDbDirs(root);
      expect(readdirSync(root).sort()).toEqual([`spoonjoy-vitest-db-${process.pid}-abc123`, "spoonjoy-vitest-db-new123"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts a process another user runs as alive", () => {
    const fail = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(1, () => true)).toBe(true);
    expect(processAlive(1, fail("EPERM"))).toBe(true);
    expect(processAlive(1, fail("ESRCH"))).toBe(false);
  });

  it("releases the run's directory at exit, listening once however often the config is evaluated", () => {
    const once = vi.fn();
    const proc = { once } as unknown as NodeJS.Process;
    const release = vi.fn();
    releaseRunDbDirOnExit(proc, release);
    releaseRunDbDirOnExit(proc, release);
    expect(once).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith("exit", release);
  });

  it("leaves no run directory behind once a real Vitest run ends", () => {
    const root = mkdtempSync(join(tmpdir(), "spoonjoy-worker-db-run-"));
    const seen = join(root, "seen.txt");
    const path = "test/support/__worker-db-cleanup-generated.test.ts";
    writeFileSync(
      path,
      `import { writeFileSync } from "node:fs";\nimport { test } from "vitest";\n` +
        `test("records its run directory", () => writeFileSync(${JSON.stringify(seen)}, process.env.SPOONJOY_TEST_DB_DIR ?? ""));\n`,
    );
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: root };
      for (const key of Object.keys(env)) {
        if (key === "VITEST" || key.startsWith("VITEST_") || key.startsWith("SPOONJOY_TEST_DB_")) delete env[key];
      }
      const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", path], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
        timeout: 90_000,
      });
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const dir = readFileSync(seen, "utf8");
      expect(dir.startsWith(root)).toBe(true);
      expect(existsSync(dir)).toBe(false);
      expect(readdirSync(root).filter((name) => name.startsWith("spoonjoy-vitest-db-"))).toEqual([]);
    } finally {
      unlinkSync(path);
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
