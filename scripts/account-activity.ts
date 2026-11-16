// Read-only answer to "has this person got back in?": an account's last sign-in (time and method)
// and when it was last seen, from production D1. Never prints an email address.
//
//   pnpm exec tsx scripts/account-activity.ts <username or user id>
//   pnpm exec tsx scripts/account-activity.ts --recent   (the 20 most recent sign-ins)
//
// Uses CLOUDFLARE_D1_API_TOKEN and CLOUDFLARE_ACCOUNT_ID when set, else Wrangler's own login.
// Without either, run it in CI: gh workflow run account-activity.yml -R spoonjoy/spoonjoy-v2 --ref main -f account=<ref>
import { createWranglerRunner, wranglerEnv, type WranglerRunner } from "./production-image-key";

const ACCOUNT_REF = /^[A-Za-z0-9_.-]{1,64}$/;
const COLUMNS = `"id", "username", "createdAt", "lastSignInAt", "lastSignInMethod", "lastSeenAt"`;

export interface AccountActivityRow {
  id: string;
  username: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  lastSignInMethod: string | null;
  lastSeenAt: string | null;
}

/** The SELECT for one account (by exact username or id), or for the most recent sign-ins. */
export function accountActivitySql(ref: string): string {
  if (ref === "--recent") {
    return `SELECT ${COLUMNS} FROM "User" WHERE "lastSignInAt" IS NOT NULL ORDER BY "lastSignInAt" DESC LIMIT 20`;
  }
  if (!ACCOUNT_REF.test(ref)) throw new Error("Give a username or user id (letters, digits, _ . -), or --recent.");
  return `SELECT ${COLUMNS} FROM "User" WHERE "username" = '${ref}' OR "id" = '${ref}' LIMIT 2`;
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function accountActivityRows(payload: string): AccountActivityRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Wrangler d1 execute was not valid JSON.");
  }
  const results = Array.isArray(parsed) ? (parsed[0] as { results?: unknown })?.results : undefined;
  if (!Array.isArray(results)) throw new Error("Wrangler d1 execute returned no results.");
  return results.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    username: String(row.username),
    createdAt: text(row.createdAt),
    lastSignInAt: text(row.lastSignInAt),
    lastSignInMethod: text(row.lastSignInMethod),
    lastSeenAt: text(row.lastSeenAt),
  }));
}

export function formatAccountActivity(rows: readonly AccountActivityRow[]): string[] {
  if (rows.length === 0) return ["No matching account."];
  return rows.map((row) => [
    `${row.username} (${row.id})`,
    `  created       ${row.createdAt ?? "unknown"}`,
    `  last sign-in  ${row.lastSignInAt ? `${row.lastSignInAt} via ${row.lastSignInMethod ?? "unknown"}` : "none recorded"}`,
    `  last seen     ${row.lastSeenAt ?? "none recorded"}`,
  ].join("\n"));
}

/* istanbul ignore next -- @preserve default parameter branches: the CLI passes nothing, tests pass every dependency. */
export async function main(
  argv: readonly string[],
  { env = process.env, run = createWranglerRunner(), log = console.log }: {
    env?: NodeJS.ProcessEnv;
    run?: WranglerRunner;
    log?: (line: string) => void;
  } = {},
): Promise<AccountActivityRow[]> {
  const [ref] = argv;
  if (!ref) throw new Error("Usage: account-activity.ts <username or user id | --recent>");
  const sql = accountActivitySql(ref);
  const d1Env = env.CLOUDFLARE_D1_API_TOKEN ? wranglerEnv(env, "CLOUDFLARE_D1_API_TOKEN") : env;
  const rows = accountActivityRows(await run(["d1", "execute", "DB", "--remote", "--json", "--command", sql], { env: d1Env }));
  for (const line of formatAccountActivity(rows)) log(line);
  return rows;
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the tested main above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
