// Opens the other app's admin backup zip: finds database.json (at the root, or inside the one folder
// a re-zipped backup adds), reads it, and hands out the files beside it by their path under the
// backup's root. The server's signing secret, database copies and logs are never read.
import { ArchiveError, openZip, type RangeSource, type ZipArchive } from "../../archive/zip";
import { MoveInError } from "../../../model/move-in-error";
import { readMealieDatabase, type MealieDatabase } from "./database";

/** The largest database.json move-in reads into memory; a Worker has 128 MB in all. */
export const DATABASE_MAX_BYTES = 64 * 1024 * 1024;
/** The other app's own per-file limit for what is inside an archive. */
export const FILE_MAX_BYTES = 100 * 1024 * 1024;

const NEVER_READ = [/(^|\/)\.secret$/, /\.db$/, /\.log(\.\d+)?$/];

export interface MealieBackup {
  database: MealieDatabase;
  /** A file under the backup's root (for example `data/recipes/<id>/images/original.webp`), or null. */
  readFile(path: string): Promise<Uint8Array | null>;
}

function asMoveInError(error: unknown): unknown {
  if (!(error instanceof ArchiveError)) return error;
  const tooLarge = error.code === "too-large" || error.code === "entry-too-large";
  return new MoveInError(tooLarge ? "backup-too-large" : "broken-zip", error.message);
}

function findRoot(archive: ZipArchive): string {
  const roots = archive.entries
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("__MACOSX/") && /^([^/]+\/)?database\.json$/.test(name))
    .map((name) => name.slice(0, -"database.json".length));
  if (roots.length !== 1) throw new MoveInError("not-a-backup", roots.length ? "several database.json files" : "no database.json");
  return roots[0];
}

function cleanPath(path: string): string {
  return path.split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
}

export async function openMealieBackup(source: RangeSource): Promise<MealieBackup> {
  try {
    const archive = await openZip(source);
    const root = findRoot(archive);
    const bytes = await archive.read(archive.get(`${root}database.json`)!, { maxBytes: DATABASE_MAX_BYTES });
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new MoveInError("broken-zip", "database.json is not JSON");
    }
    const database = readMealieDatabase(json);
    return {
      database,
      async readFile(path) {
        const clean = cleanPath(path);
        if (clean.split("/").includes("..") || NEVER_READ.some((pattern) => pattern.test(clean))) return null;
        const entry = archive.get(`${root}${clean}`);
        if (!entry) return null;
        try {
          return await archive.read(entry, { maxBytes: FILE_MAX_BYTES });
        } catch (error) {
          throw asMoveInError(error);
        }
      },
    };
  } catch (error) {
    throw asMoveInError(error);
  }
}
