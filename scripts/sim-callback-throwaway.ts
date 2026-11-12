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
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import bcrypt from "bcryptjs";

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

/**
 * One count query per scanned table. Each row's columns are joined into one string, so a table costs three instr
 * calls however wide it is. Run 43214337309 showed D1 rejecting a query that ORed every column of 8 tables.
 */
export function scanQueries(columns: { table: string; column: string }[], needles: string[]): string[] {
  const byTable = new Map<string, string[]>();
  for (const { table, column } of columns) {
    if (SKIPPED_TABLE_PATTERN.test(table)) continue;
    byTable.set(table, [...(byTable.get(table) ?? []), column]);
  }
  return [...byTable].map(([table, tableColumns]) => {
    const row = tableColumns.map((column) => `coalesce(CAST(${quoteName(column)} AS TEXT), '')`).join(" || char(31) || ");
    const condition = needles.map((needle) => `instr(${row}, ${literal(needle)}) > 0`).join(" OR ");
    return `SELECT ${literal(table)} AS "t", count(*) AS "n" FROM ${quoteName(table)} WHERE ${condition}`;
  });
}

export const PROBE_APPLE_SUB_PATTERN = /^probe-apple-sub-[0-9a-f]{16}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const PENDING_LINK_ID_PATTERN = /^probepal[0-9a-f]{18}$/;
export const PENDING_APPLE_LINK_TTL_MS = 30 * 60 * 1000;

export interface ProbePendingLink {
  id: string;
  tokenHash: string;
  appleSub: string;
}

/** Validates a probe pending link; throws on any sub that is not the synthetic probe shape. */
export function probePendingLink({ id, tokenHash, appleSub }: Partial<ProbePendingLink>): ProbePendingLink {
  if (!PENDING_LINK_ID_PATTERN.test(id ?? "")) throw new Error("pending link id must look like probepal<18 hex>.");
  if (!TOKEN_HASH_PATTERN.test(tokenHash ?? "")) throw new Error("token hash must be 64 hex characters.");
  if (!PROBE_APPLE_SUB_PATTERN.test(appleSub ?? "")) throw new Error("Apple sub must look like probe-apple-sub-<16 hex>.");
  return { id: id!, tokenHash: tokenHash!, appleSub: appleSub! };
}

/** The pending link's token, made the way createPendingAppleLink makes it, and the SHA-256 hex the row keeps. */
export function makePendingLinkToken(random: (size: number) => Buffer = randomBytes) {
  const token = `pal_${random(32).toString("base64url")}`;
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") };
}

/** The row createPendingAppleLink writes: hash, sub, no name, thirty minutes to live. */
export function pendingLinkSeedSql(link: Partial<ProbePendingLink>, now: Date): string {
  const { id, tokenHash, appleSub } = probePendingLink(link);
  return renderStatement([
    `INSERT INTO "PendingAppleLink" ("id", "tokenHash", "appleSub", "providerUsername", "expiresAt", "consumedAt", "createdAt")
     VALUES (?, ?, ?, NULL, ?, NULL, ?)`,
    id,
    tokenHash,
    appleSub,
    new Date(now.getTime() + PENDING_APPLE_LINK_TTL_MS).toISOString(),
    now.toISOString(),
  ]);
}

export function pendingLinkReadSql(link: Partial<ProbePendingLink>): string {
  const { tokenHash, appleSub } = probePendingLink(link);
  return renderStatement([
    `SELECT "appleSub", "expiresAt", "consumedAt", "createdAt" FROM "PendingAppleLink" WHERE "tokenHash" = ? AND "appleSub" = ?`,
    tokenHash,
    appleSub,
  ]);
}

/** Apple links on the throwaway, and every account's links to the synthetic sub. */
export function appleLinkReadSql(account: Partial<ThrowawayAccount>, link: Partial<ProbePendingLink>): string {
  const { id } = throwawayAccount(account);
  const { appleSub } = probePendingLink(link);
  return renderStatement([
    `SELECT (SELECT count(*) FROM "OAuth" WHERE "userId" = ? AND "provider" = 'apple') AS "accountAppleLinks",
            (SELECT count(*) FROM "OAuth" WHERE "userId" = ? AND "provider" = 'apple' AND "providerUserId" = ?) AS "accountLinksToSub",
            (SELECT count(*) FROM "OAuth" WHERE "provider" = 'apple' AND "providerUserId" = ?) AS "allLinksToSub",
            (SELECT "providerUsername" FROM "OAuth" WHERE "userId" = ? AND "provider" = 'apple') AS "providerUsername"`,
    id,
    id,
    appleSub,
    appleSub,
    id,
  ]);
}

export function pendingLinkCleanupSql(link: Partial<ProbePendingLink>): string {
  const { tokenHash, appleSub } = probePendingLink(link);
  return renderStatement([`DELETE FROM "PendingAppleLink" WHERE "tokenHash" = ? AND "appleSub" = ?`, tokenHash, appleSub]);
}

export function pendingLinkLeftoverSql(link: Partial<ProbePendingLink>): string {
  const { tokenHash, appleSub } = probePendingLink(link);
  return renderStatement([
    `SELECT (SELECT count(*) FROM "PendingAppleLink" WHERE "tokenHash" = ? OR "appleSub" = ?)
          + (SELECT count(*) FROM "OAuth" WHERE "providerUserId" = ?) AS "n"`,
    tokenHash,
    appleSub,
    appleSub,
  ]);
}

export interface NativeSignInSummary {
  status: number;
  requestId: unknown;
  action: unknown;
  userId: unknown;
  appleLink: unknown;
  errorCode: unknown;
  /** The response's data keys, with every token value left out. */
  dataKeys: string[];
}

/** What a native sign-in answered, with no token in it. */
export function summarizeNativeSignIn(status: number, body: unknown): NativeSignInSummary {
  const json = (body ?? {}) as { requestId?: unknown; data?: Record<string, unknown>; error?: { code?: unknown } };
  const data = json.data ?? {};
  return {
    status,
    requestId: json.requestId ?? null,
    action: data.action ?? null,
    userId: data.userId ?? null,
    appleLink: data.appleLink ?? null,
    errorCode: json.error?.code ?? null,
    dataKeys: Object.keys(data).sort(),
  };
}

export const SPOONJOY_ORIGIN = "https://spoonjoy.app";

export interface ProofDeps {
  run: Run;
  runBatch: (sql: string) => Promise<unknown>;
  fetch: typeof fetch;
  random?: (size: number) => Buffer;
  hashPassword?: (password: string) => Promise<string>;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * Seeds the throwaway and one pending link, signs in twice with the link's token, reads the rows back, and
 * always cleans up. Fails unless the first sign-in links Apple, the second finds the link spent, and nothing
 * is left that mentions the sub or the token's hash.
 */
export async function pendingAppleLinkProof(account: Partial<ThrowawayAccount>, deps: ProofDeps) {
  const throwaway = throwawayAccount(account);
  const random = deps.random ?? randomBytes;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.log(line));
  const hashPassword = deps.hashPassword ?? ((password: string) => bcrypt.hash(password, 10));
  const step = (name: string, detail: unknown) => log(`${now().toISOString()} ${name} ${JSON.stringify(detail)}`);

  const password = random(24).toString("base64url");
  const { token, tokenHash } = makePendingLinkToken(random);
  const link = probePendingLink({
    id: `probepal${random(9).toString("hex")}`,
    tokenHash,
    appleSub: `probe-apple-sub-${random(8).toString("hex")}`,
  });
  const failures: string[] = [];
  const result: Record<string, unknown> = { account: throwaway.id, appleSub: link.appleSub, tokenHashPrefix: tokenHash.slice(0, 12) };

  const signIn = async () => {
    const response = await deps.fetch(`${SPOONJOY_ORIGIN}/api/v1/auth/password/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ emailOrUsername: throwaway.email, password, pendingAppleLinkToken: token }),
    });
    return summarizeNativeSignIn(response.status, await response.json().catch(() => null));
  };
  const userRows = async () =>
    Number((await deps.run(renderStatement([`SELECT count(*) AS "n" FROM "User" WHERE "id" = ?`, throwaway.id])))[0]?.n);

  try {
    await deps.run(seedSql(throwaway, await hashPassword(password), now()));
    if ((await userRows()) !== 1) throw new Error("The seeded user row is not there.");
    step("seeded account", { id: throwaway.id });
    await deps.run(pendingLinkSeedSql(link, now()));
    result.seededRow = (await deps.run(pendingLinkReadSql(link)))[0] ?? null;
    step("seeded pending link", { appleSub: link.appleSub, tokenHashPrefix: result.tokenHashPrefix, row: result.seededRow });

    const first = await signIn();
    step("first sign-in", first);
    result.first = first;
    if (first.status !== 201 || first.appleLink !== "linked") failures.push("The first sign-in did not answer 201 with appleLink linked.");
    result.afterFirst = { pendingLink: (await deps.run(pendingLinkReadSql(link)))[0] ?? null, oauth: (await deps.run(appleLinkReadSql(throwaway, link)))[0] ?? null };
    step("rows after first sign-in", result.afterFirst);
    const afterFirst = result.afterFirst as { pendingLink: { consumedAt?: unknown } | null; oauth: { accountLinksToSub?: unknown } | null };
    if (!afterFirst.pendingLink?.consumedAt) failures.push("The pending link was not spent.");
    if (Number(afterFirst.oauth?.accountLinksToSub) !== 1) failures.push("The Apple sub is not linked to the throwaway.");

    const second = await signIn();
    step("second sign-in, same token", second);
    result.second = second;
    if (second.status !== 201 || second.appleLink !== "consumed") failures.push("The second sign-in did not answer 201 with appleLink consumed.");
    result.afterSecond = { pendingLink: (await deps.run(pendingLinkReadSql(link)))[0] ?? null, oauth: (await deps.run(appleLinkReadSql(throwaway, link)))[0] ?? null };
    step("rows after second sign-in", result.afterSecond);
    const afterSecond = result.afterSecond as { oauth: { allLinksToSub?: unknown } | null };
    if (Number(afterSecond.oauth?.allLinksToSub) !== 1) failures.push("The second sign-in changed the Apple links.");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    await deps.run(pendingLinkCleanupSql(link));
    step("tokens before cleanup", (await deps.run(tokenCountSql(throwaway)))[0] ?? null);
    if ((await userRows()) === 1) await deps.runBatch(cleanupSql(throwaway, now()));
    if ((await userRows()) !== 0) failures.push("The user row is still there after cleanup.");
    const leftover = Number((await deps.run(pendingLinkLeftoverSql(link)))[0]?.n);
    const columns = (await deps.run(COLUMNS_SQL)) as { table: string; column: string }[];
    const hits: { table: string; rows: number }[] = [];
    for (const sql of scanQueries(columns, [link.appleSub, link.tokenHash])) {
      for (const row of await deps.run(sql)) if (Number(row.n) > 0) hits.push({ table: String(row.t), rows: Number(row.n) });
    }
    result.cleanup = { pendingLinkAndOAuthLeft: leftover, subAndHashScan: { tables: new Set(columns.map((c) => c.table)).size, hits } };
    step("cleanup", result.cleanup);
    if (leftover !== 0 || hits.length > 0) failures.push("Rows still mention the synthetic sub or the token's hash.");
  }
  log(`RESULT ${JSON.stringify(result)}`);
  if (failures.length > 0) throw new Error(failures.join(" "));
  return result;
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
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", DATABASE, "--remote", "--json", ...args],
      { maxBuffer: 1024 * 1024 * 16 },
    ));
  } catch (error) {
    // execFile's message is mostly the command line; D1's reason is in wrangler's own output.
    const failed = error as Error & { stdout?: string; stderr?: string };
    const output = [failed.stdout?.trim().slice(-600), failed.stderr?.trim().slice(-600)].filter(Boolean).join("\n");
    throw new Error(`wrangler d1 execute failed: ${output || failed.message.slice(0, 600)}`);
  }
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

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  run: Run = query,
  runBatch = batch,
  proofDeps: Partial<ProofDeps> = {},
) {
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
  if (action === "pending-apple-link-proof") {
    await pendingAppleLinkProof(account, { run, runBatch, fetch: globalThis.fetch, ...proofDeps });
    return;
  }
  throw new Error("action must be seed, cleanup, search-pending, scan or pending-apple-link-proof.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
