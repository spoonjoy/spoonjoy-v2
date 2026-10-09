import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Every Vitest worker process gets its own copy of the schema-initialised prisma/test.db, so
// DB-backed test files can run in parallel. The copy is keyed by process id, not by Vitest's
// pool slot: Vitest frees a slot as soon as a file finishes and does not wait for the old fork
// to exit, so a slot-keyed file could be open in two live processes at once. Each process also
// opens its file through more than one SQLite library (Prisma, better-sqlite3, node:sqlite),
// whose POSIX locks do not survive one another's close, so sharing a file across live processes
// corrupts it ("database disk image is malformed").
//
// SPOONJOY_TEST_DB_DIR is set by vitest.config.ts for parallel runs. Without it (a bare script,
// or a run that sets it empty) tests keep using prisma/test.db directly.
const templatePath = resolve(__dirname, "../../prisma/test.db");

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
