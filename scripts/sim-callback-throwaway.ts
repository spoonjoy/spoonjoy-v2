// Seeds or removes one throwaway account for spoonjoy-apple's browser sign-in callback proof
// (BrowserSignInCallbackUITests), on production D1, through .github/workflows/sim-callback-throwaway.yml.
//
// Only accounts shaped like the proof's own throwaways are accepted: id probecb<18 hex>, username
// simcallbackprobe<8 hex>, email sim-callback-probe-<YYYYMMDD>-<same 8 hex>@example.com. The caller makes the
// password and passes only its bcrypt hash, so the password never reaches this repository or its logs.
//
// cleanup runs the app's own account deletion (accountDeletionStatements, which knows the foreign-key order),
// behind a guard that the account exists with exactly this email, then removes the account's chef search
// document and its key. scan then looks for the id, username and email in every column of every table.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { accountDeletionStatements } from "~/lib/account-deletion.server";
import type { D1Query } from "~/lib/d1-read.server";
import { d1Guard } from "~/lib/d1-write.server";

const execFileAsync = promisify(execFile);

export const DATABASE = "spoonjoy";
const ID_PATTERN = /^probecb[0-9a-f]{18}$/;
const EMAIL_PATTERN = /^sim-callback-probe-[0-9]{8}-([0-9a-f]{8})@example\.com$/;
const USERNAME_PATTERN = /^simcallbackprobe([0-9a-f]{8})$/;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/;
// FTS5 keeps SearchDocument's terms in shadow tables until a merge; SearchDocument itself is scanned.
const SKIPPED_TABLE_PATTERN = /^(sqlite_|_cf_|d1_|SearchDocument_)/;

export interface ThrowawayAccount {
  id: string;
  email: string;
  username: string;
}

/** Validates a throwaway's identity; throws on anything that is not the proof's own account shape. */
export function throwawayAccount({ id, email, username }: Partial<ThrowawayAccount>): ThrowawayAccount {
  if (!ID_PATTERN.test(id ?? "")) throw new Error("account id must look like probecb<18 hex>.");
  const emailTag = EMAIL_PATTERN.exec(email ?? "")?.[1];
  if (!emailTag) throw new Error("email must look like sim-callback-probe-<YYYYMMDD>-<8 hex>@example.com.");
  const usernameTag = USERNAME_PATTERN.exec(username ?? "")?.[1];
  if (!usernameTag) throw new Error("username must look like simcallbackprobe<8 hex>.");
  if (emailTag !== usernameTag) throw new Error("email and username must carry the same tag.");
  return { id: id!, email: email!, username: username! };
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  throw new Error(`Cannot write ${typeof value} as SQL.`);
}

/** Writes a bound statement as plain SQL, for `wrangler d1 execute --file`. */
export function renderStatement([sql, ...values]: D1Query): string {
  const parts = sql.split("?");
  if (parts.length - 1 !== values.length) throw new Error("Statement placeholders and values differ.");
  return `${parts.map((part, index) => (index === 0 ? part : literal(values[index - 1]) + part)).join("").trim()};`;
}

export function seedSql(account: Partial<ThrowawayAccount>, passwordHash: string | undefined, now: Date): string {
  if (!BCRYPT_HASH_PATTERN.test(passwordHash ?? "")) throw new Error("password hash must be a bcrypt cost-10 hash.");
  const { id, email, username } = throwawayAccount(account);
  const at = now.toISOString();
  return renderStatement([
    `INSERT INTO "User" ("id", "email", "username", "hashedPassword", "salt", "createdAt", "updatedAt", "sessionVersion", "emailVerifiedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    email,
    username,
    passwordHash!,
    passwordHash!.slice(0, 29),
    at,
    at,
    at,
  ]);
}

export function tokenCountSql(account: Partial<ThrowawayAccount>): string {
  const { id } = throwawayAccount(account);
  return renderStatement([
    `SELECT (SELECT count(*) FROM "OAuthRefreshToken" WHERE "userId" = ?) AS "refreshTokens",
            (SELECT count(*) FROM "OAuthGrant" WHERE "userId" = ?) AS "grants",
            (SELECT count(*) FROM "ApiCredential" WHERE "userId" = ?) AS "apiCredentials"`,
    id,
    id,
    id,
  ]);
}

/** The whole cleanup as one batch: nothing runs unless the account exists with exactly this email. */
export function cleanupSql(account: Partial<ThrowawayAccount>, now: Date): string {
  const { id, email } = throwawayAccount(account);
  const statements: D1Query[] = [
    d1Guard(`EXISTS (SELECT 1 FROM "User" WHERE "id" = ? AND "email" = ?)`, id, email),
    ...accountDeletionStatements(id, now),
    // The search drain finds a document through its key, so the document goes first, then the key.
    [`DELETE FROM "SearchDocument" WHERE "entityType" = 'chef' AND "entityId" = ?`, id],
    [`DELETE FROM "SearchDocumentKey" WHERE "docKey" = ?`, `chef:${id}`],
  ];
  return statements.map(renderStatement).join("\n");
}

export const COLUMNS_SQL = `SELECT m."name" AS "table", p."name" AS "column"
  FROM sqlite_master AS m, pragma_table_info(m."name") AS p
  WHERE m."type" = 'table' AND m."name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m."name" NOT LIKE '\\_cf\\_%' ESCAPE '\\'
    AND m."name" NOT LIKE 'd1\\_%' ESCAPE '\\' AND m."name" NOT LIKE 'SearchDocument\\_%' ESCAPE '\\'
  ORDER BY m."name", p."cid"`;

const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Count queries over every column of every scanned table, a few tables per query. */
export function scanQueries(columns: { table: string; column: string }[], needles: string[], tablesPerQuery = 8): string[] {
  const byTable = new Map<string, string[]>();
  for (const { table, column } of columns) {
    if (SKIPPED_TABLE_PATTERN.test(table)) continue;
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  const selects = [...byTable].map(([table, tableColumns]) => {
    const condition = tableColumns
      .flatMap((column) => needles.map((needle) => `instr(CAST(${quoteName(column)} AS TEXT), ${literal(needle)}) > 0`))
      .join(" OR ");
    return `SELECT ${literal(table)} AS "t", count(*) AS "n" FROM ${quoteName(table)} WHERE ${condition}`;
  });
  const queries: string[] = [];
  for (let index = 0; index < selects.length; index += tablesPerQuery) {
    queries.push(selects.slice(index, index + tablesPerQuery).join(" UNION ALL "));
  }
  return queries;
}

export function parseWranglerJson(stdout: string): Record<string, unknown>[] {
  // wrangler's --json output is one array; banners or warnings may come before it on their own lines.
  const start = stdout.startsWith("[") ? 0 : stdout.indexOf("\n[") + 1;
  if (start === 0 && !stdout.startsWith("[")) throw new Error(`wrangler printed no JSON: ${stdout.slice(0, 300)}`);
  const parsed = JSON.parse(stdout.slice(start)) as { results?: Record<string, unknown>[] }[];
  return parsed.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []));
}

type Run = (sql: string) => Promise<Record<string, unknown>[]>;

async function d1(args: string[]) {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", DATABASE, "--remote", "--json", ...args],
    { maxBuffer: 1024 * 1024 * 16 },
  );
  return parseWranglerJson(stdout);
}

const query: Run = (sql) => d1(["--command", sql]);

// --command sends the statements to D1's query endpoint as one batch, so a failed guard or statement leaves
// nothing half-done; --file would go through D1's import path instead.
const batch = (sql: string) => d1(["--command", sql]);

/** Rows still waiting for the search drain, or still in the search index, for this account. */
export function searchPendingSql(account: Partial<ThrowawayAccount>): string {
  const { id } = throwawayAccount(account);
  return renderStatement([
    `SELECT (SELECT count(*) FROM "SearchDirtyEntity" WHERE instr("entityId", ?) > 0)
          + (SELECT count(*) FROM "SearchDocument" WHERE "entityId" = ? OR "ownerId" = ?) AS "n"`,
    id,
    id,
    id,
  ]);
}

export async function scan(account: Partial<ThrowawayAccount>, run: Run = query) {
  const { id, email, username } = throwawayAccount(account);
  const columns = (await run(COLUMNS_SQL)) as { table: string; column: string }[];
  const hits: { table: string; rows: number }[] = [];
  const queries = scanQueries(columns, [id, username, email]);
  for (const sql of queries) {
    for (const row of await run(sql)) {
      if (Number(row.n) > 0) hits.push({ table: String(row.t), rows: Number(row.n) });
    }
  }
  return { tables: new Set(columns.map((column) => column.table)).size, queries: queries.length, hits };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, run: Run = query, runBatch = batch) {
  const action = argv[0];
  const account = throwawayAccount({ id: env.ACCOUNT_ID, email: env.ACCOUNT_EMAIL, username: env.ACCOUNT_USERNAME });
  const userRows = async () =>
    Number((await run(renderStatement([`SELECT count(*) AS "n" FROM "User" WHERE "id" = ?`, account.id])))[0]?.n);
  if (action === "seed") {
    await run(seedSql(account, env.PASSWORD_HASH, new Date()));
    if ((await userRows()) !== 1) throw new Error("The seeded user row is not there.");
    console.log(`Seeded ${account.id}.`);
    return;
  }
  if (action === "cleanup") {
    console.log(`Tokens before cleanup: ${JSON.stringify((await run(tokenCountSql(account)))[0])}`);
    await runBatch(cleanupSql(account, new Date()));
    if ((await userRows()) !== 0) throw new Error("The user row is still there after cleanup.");
    console.log(`Deleted ${account.id}.`);
    return;
  }
  if (action === "search-pending") {
    const pending = Number((await run(searchPendingSql(account)))[0]?.n);
    console.log(`Search rows pending for ${account.id}: ${pending}`);
    if (pending !== 0) throw new Error("Search still has rows for the account.");
    return;
  }
  if (action === "scan") {
    const result = await scan(account, run);
    console.log(JSON.stringify(result));
    if (result.hits.length > 0) throw new Error(`Rows still mention ${account.id}, its username or its email.`);
    return;
  }
  throw new Error("action must be seed, cleanup, search-pending or scan.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
