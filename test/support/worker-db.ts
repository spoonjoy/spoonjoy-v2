import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { threadId } from "node:worker_threads";

// Every Vitest worker gets its own copy of the schema-initialised prisma/test.db, so DB-backed
// test files can run in parallel. The copy is keyed by process id (and thread id, for the thread
// pools, whose workers share one pid), not by Vitest's pool slot: Vitest frees a slot as soon as
// a file finishes and does not wait for the old fork to exit, so a slot-keyed file could be open
// in two live processes at once. Each process also opens its file through more than one SQLite
// library (Prisma, better-sqlite3, node:sqlite), whose POSIX locks do not survive one another's
// close, so sharing a file across live processes corrupts it ("database disk image is
// malformed").
//
// SPOONJOY_TEST_DB_DIR is set by vitest.config.ts (claimRunDbDir) for parallel runs. Without it
// (a bare script, or a run that sets it empty, which vitest.config.ts then runs serially) tests
// keep using prisma/test.db directly.
// Resolved from this module, so it works under Vitest (CommonJS-style __dirname) and plain ESM.
const templatePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../prisma/test.db");
const SNAPSHOT_NAME = "template.db";

// Each Vitest run owns one directory, recorded with the pid of the Vitest process that made it.
// A test that starts a nested Vitest run (test/config/warning-policy.test.ts does) passes on its
// worker's environment, so the nested run would otherwise reuse the parent's directory, and its
// global teardown would delete it while the parent's later worker processes still need it. A
// nested run therefore makes a directory of its own and drops the inherited database path, and
// a teardown only removes the directory its own process created.
//
// The directory's name carries the claiming process's pid (spoonjoy-vitest-db-<pid>-XXXXXX), so a
// later run can tell a directory whose run was killed before its teardown (a SIGKILL, or a SIGTERM
// Vitest does not handle) from one a live run still uses, and remove it: sweepStaleRunDbDirs.
const RUN_DIR_PREFIX = "spoonjoy-vitest-db-";

export function claimRunDbDir(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  makeDir: () => string = () => mkdtempSync(join(tmpdir(), `${RUN_DIR_PREFIX}${pid}-`)),
): string | undefined {
  if (env.SPOONJOY_TEST_DB_DIR === "") return undefined;
  if (env.SPOONJOY_TEST_DB_DIR && env.SPOONJOY_TEST_DB_DIR_OWNER === String(pid)) return env.SPOONJOY_TEST_DB_DIR;
  const dir = makeDir();
  env.SPOONJOY_TEST_DB_DIR = dir;
  env.SPOONJOY_TEST_DB_DIR_OWNER = String(pid);
  delete env.SPOONJOY_TEST_DB_PATH;
  return dir;
}

// Watch mode tears down and then re-evaluates the config in the same process, so the claim is
// forgotten along with the directory and the next evaluation claims a fresh one.
export function releaseRunDbDir(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  remove: (dir: string) => void = (dir) => rmSync(dir, { recursive: true, force: true }),
): void {
  const dir = env.SPOONJOY_TEST_DB_DIR;
  if (!dir || env.SPOONJOY_TEST_DB_DIR_OWNER !== String(pid)) return;
  remove(dir);
  delete env.SPOONJOY_TEST_DB_DIR;
  delete env.SPOONJOY_TEST_DB_DIR_OWNER;
}

// The global teardown removes the run's directory, but a run that ends another way skips it.
// Releasing on "exit" too covers a run that ends through process.exit before its teardown (a
// startup error, or Ctrl-C, which Vitest turns into an exit). The listener is added once per
// process, however many times watch mode re-evaluates the config.
const RELEASE_ON_EXIT = Symbol.for("spoonjoy.vitest-db.release-on-exit");

export function releaseRunDbDirOnExit(
  proc: Pick<NodeJS.Process, "once"> & { [RELEASE_ON_EXIT]?: true } = process,
  release: () => void = () => releaseRunDbDir(),
): void {
  if (proc[RELEASE_ON_EXIT]) return;
  proc[RELEASE_ON_EXIT] = true;
  proc.once("exit", release);
}

export interface SweepIo {
  list(root: string): string[];
  alive(pid: number): boolean;
  modifiedMs(path: string): number;
  remove(path: string): void;
}

// Directories named before the pid was recorded (spoonjoy-vitest-db-XXXXXX) cannot name their
// owner; one untouched for a day belongs to no run still going.
const UNNAMED_OWNER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Whether a process with this pid is running. EPERM means it is, under another user.
export function processAlive(pid: number, kill: (pid: number, signal: 0) => unknown = process.kill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const fsSweepIo: SweepIo = {
  list: (root) => readdirSync(root),
  alive: (pid) => processAlive(pid),
  modifiedMs: (path) => statSync(path).mtimeMs,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
};

// Removes the run directories left in `root` by runs that ended without their teardown: those whose
// owning process has gone, and pid-less ones untouched for a day. Returns what it removed.
export function sweepStaleRunDbDirs(root: string = tmpdir(), io: SweepIo = fsSweepIo, now: number = Date.now()): string[] {
  const removed: string[] = [];
  for (const name of io.list(root)) {
    if (!name.startsWith(RUN_DIR_PREFIX)) continue;
    const path = join(root, name);
    const owner = /^spoonjoy-vitest-db-(\d+)-[^-]+$/.exec(name);
    const stale = owner ? !io.alive(Number(owner[1])) : now - io.modifiedMs(path) > UNNAMED_OWNER_MAX_AGE_MS;
    if (!stale) continue;
    io.remove(path);
    removed.push(path);
  }
  return removed;
}

// The global setup takes one consistent snapshot of prisma/test.db into the run directory (the
// better-sqlite3 online backup, which honours SQLite's locks), and every worker copies that
// snapshot. A plain file copy of prisma/test.db could catch it mid-write, or miss a hot journal
// left beside it, and nothing would roll the copy back.
export function snapshotPath(dir: string): string {
  return join(dir, SNAPSHOT_NAME);
}

export async function snapshotTemplate(
  env: NodeJS.ProcessEnv = process.env,
  backup: (from: string, to: string) => Promise<unknown> = backupWithBetterSqlite,
): Promise<string | undefined> {
  const dir = env.SPOONJOY_TEST_DB_DIR;
  if (!dir) return undefined;
  const path = snapshotPath(dir);
  await backup(templatePath, path);
  return path;
}

async function backupWithBetterSqlite(from: string, to: string): Promise<void> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(from, { readonly: true, fileMustExist: true });
  try {
    await db.backup(to);
  } catch (error) {
    // A read-only handle cannot roll back a hot journal left beside prisma/test.db by a crashed
    // writer, so the snapshot fails here rather than giving workers a torn copy.
    throw new Error(
      `Could not snapshot ${from} for this run's test databases; if a crashed process left ` +
        `${from}-journal beside it, recreate the test database. ${(error as Error).message}`,
      { cause: error },
    );
  } finally {
    db.close();
  }
}

export function workerDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPOONJOY_TEST_DB_PATH || templatePath;
}

export interface WorkerDbIo {
  copy(from: string, to: string): void;
  exists(path: string): boolean;
  remove(path: string): void;
  onExit(cleanup: () => void): void;
}

const fsIo: WorkerDbIo = {
  copy: copyFileSync,
  exists: existsSync,
  remove: (path) => rmSync(path, { force: true }),
  onExit: (cleanup) => {
    process.once("exit", cleanup);
    // Vitest stops an isolated fork with a bare SIGTERM, and Node does not emit "exit" when a
    // signal kills it, so the copy is also removed on SIGTERM before exiting as the signal would.
    process.once("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });
  },
};

const SQLITE_SIDE_FILES = ["-journal", "-wal", "-shm"];

export function prepareWorkerDb(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  io: WorkerDbIo = fsIo,
  thread: number = threadId,
): string {
  if (env.SPOONJOY_TEST_DB_PATH) return env.SPOONJOY_TEST_DB_PATH;
  const dir = env.SPOONJOY_TEST_DB_DIR;
  if (!dir) return templatePath;
  const path = join(dir, thread ? `worker-${pid}-${thread}.db` : `worker-${pid}.db`);
  // A fork killed mid-transaction can leave a journal under a name a later process reuses; a
  // stale journal beside a fresh copy would be rolled into it.
  for (const suffix of SQLITE_SIDE_FILES) io.remove(path + suffix);
  const snapshot = snapshotPath(dir);
  if (!io.exists(snapshot)) {
    throw new Error(
      `${snapshot} is missing: test/support/global-setup.ts takes it before workers start, so ` +
        "this run's config claimed SPOONJOY_TEST_DB_DIR without that global setup.",
    );
  }
  io.copy(snapshot, path);
  env.SPOONJOY_TEST_DB_PATH = path;
  // Isolated forks exit after each file, so removing the copy on exit keeps the run directory
  // to the live workers' copies instead of one per test file.
  io.onExit(() => {
    for (const suffix of ["", ...SQLITE_SIDE_FILES]) io.remove(path + suffix);
  });
  return path;
}

export function workerDatabaseUrl(path: string): string {
  return `file:${path}?connection_limit=1&socket_timeout=60`;
}
