import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Every Vitest worker process gets its own copy of the schema-initialised prisma/test.db, so
// DB-backed test files can run in parallel. The copy is keyed by process id, not by Vitest's
// pool slot: Vitest frees a slot as soon as a file finishes and does not wait for the old fork
// to exit, so a slot-keyed file could be open in two live processes at once. Each process also
// opens its file through more than one SQLite library (Prisma, better-sqlite3, node:sqlite),
// whose POSIX locks do not survive one another's close, so sharing a file across live processes
// corrupts it ("database disk image is malformed").
//
// SPOONJOY_TEST_DB_DIR is set by vitest.config.ts (claimRunDbDir) for parallel runs. Without it
// (a bare script, or a run that sets it empty) tests keep using prisma/test.db directly.
const templatePath = resolve(__dirname, "../../prisma/test.db");

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

export function releaseRunDbDir(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  remove: (dir: string) => void = (dir) => rmSync(dir, { recursive: true, force: true }),
): void {
  const dir = env.SPOONJOY_TEST_DB_DIR;
  if (dir && env.SPOONJOY_TEST_DB_DIR_OWNER === String(pid)) remove(dir);
}

export function workerDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPOONJOY_TEST_DB_PATH || templatePath;
}

export function prepareWorkerDb(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  copy: (from: string, to: string) => void = copyFileSync,
): string {
  if (env.SPOONJOY_TEST_DB_PATH) return env.SPOONJOY_TEST_DB_PATH;
  const dir = env.SPOONJOY_TEST_DB_DIR;
  if (!dir) return templatePath;
  const path = join(dir, `worker-${pid}.db`);
  copy(templatePath, path);
  env.SPOONJOY_TEST_DB_PATH = path;
  return path;
}

export function workerDatabaseUrl(path: string): string {
  return `file:${path}?connection_limit=1&socket_timeout=60`;
}
