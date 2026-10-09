import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Copy the schema-initialised prisma/test.db into one file per worker slot before the run,
// so every worker starts from the same empty schema and never shares a SQLite file.
export default function setup(): void {
  const template = resolve(__dirname, "../../prisma/test.db");
  if (!existsSync(template)) return;
  const workers = Number(process.env.VITEST_DB_WORKERS ?? 8);
  for (let id = 1; id <= workers; id += 1) {
    copyFileSync(template, resolve(__dirname, `../../prisma/test-${id}.db`));
  }
}
