import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const templatePath = resolve(__dirname, "../../prisma/test.db");
const SNAPSHOT_NAME = "template.db";

// Each Vitest run owns one directory, recorded with the pid of the Vitest process that made it.
// A test that starts a nested Vitest run (test/config/warning-policy.test.ts does) passes on its
// worker's environment, so the nested run would otherwise reuse the parent's directory, and its
// global teardown would delete it while the parent's later worker processes still need it. A
// nested run therefore makes a directory of its own and drops the inherited database path, and
// a teardown only removes the directory its own process created.
export function claimRunDbDir(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  makeDir: () => string = () => mkdtempSync(join(tmpdir(), "spoonjoy-vitest-db-")),
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
  onExit: (cleanup) => process.once("exit", cleanup),
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
  io.copy(io.exists(snapshot) ? snapshot : templatePath, path);
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
