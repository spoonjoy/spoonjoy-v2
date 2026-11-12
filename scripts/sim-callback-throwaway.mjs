// Seeds or removes one throwaway account for spoonjoy-apple's browser sign-in callback proof
// (BrowserSignInCallbackUITests), on production D1, through .github/workflows/sim-callback-throwaway.yml.
//
// Only accounts shaped like the proof's own throwaways are accepted: id probecb<18 hex>, username
// simcallbackprobe<8 hex>, email sim-callback-probe-<YYYYMMDD>-<same 8 hex>@example.com. The caller makes the
// password and passes only its bcrypt hash, so the password never reaches this repository or its logs.
//
// cleanup deletes the account's rows (credentials, tokens, grants, OAuth links, the user, its chef search
// document and key), then scans every text column of every table for the id and the tag and fails if any row
// still matches. Tokens are counted before deletion so the log says whether any were ever issued.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DATABASE = "spoonjoy";
const ID_PATTERN = /^probecb[0-9a-f]{18}$/;
const TAG_PATTERN = /^[0-9a-f]{8}$/;
const EMAIL_PATTERN = /^sim-callback-probe-[0-9]{8}-([0-9a-f]{8})@example\.com$/;
const USERNAME_PATTERN = /^simcallbackprobe([0-9a-f]{8})$/;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/;
const BCRYPT_SALT_PATTERN = /^\$2[aby]\$10\$[./A-Za-z0-9]{22}$/;

/** Validates a throwaway's identity and returns it with its tag; throws on anything else. */
export function throwawayAccount({ id, email, username }) {
  if (!ID_PATTERN.test(id ?? "")) throw new Error("account id must look like probecb<18 hex>.");
  const emailTag = EMAIL_PATTERN.exec(email ?? "")?.[1];
  if (!emailTag) throw new Error("email must look like sim-callback-probe-<YYYYMMDD>-<8 hex>@example.com.");
  const usernameTag = USERNAME_PATTERN.exec(username ?? "")?.[1];
  if (!usernameTag) throw new Error("username must look like simcallbackprobe<8 hex>.");
  if (emailTag !== usernameTag) throw new Error("email and username must carry the same tag.");
  if (!TAG_PATTERN.test(emailTag)) throw new Error("tag must be 8 hex characters.");
  return { id, email, username, tag: emailTag };
}

export function seedSql(account, { passwordHash, salt, now }) {
  if (!BCRYPT_HASH_PATTERN.test(passwordHash ?? "")) throw new Error("password hash must be a bcrypt cost-10 hash.");
  if (!BCRYPT_SALT_PATTERN.test(salt ?? "") || !passwordHash.startsWith(salt)) {
    throw new Error("salt must be the bcrypt salt the hash was made with.");
  }
  const { id, email, username } = throwawayAccount(account);
  return (
    "INSERT INTO User (id,email,username,hashedPassword,salt,createdAt,updatedAt,sessionVersion,emailVerifiedAt) " +
    `VALUES ('${id}','${email}','${username}','${passwordHash}','${salt}','${now}','${now}',0,'${now}');`
  );
}

export function tokenCountSql(account) {
  const { id } = throwawayAccount(account);
  return (
    `SELECT (SELECT count(*) FROM OAuthRefreshToken WHERE userId='${id}') AS refreshTokens, ` +
    `(SELECT count(*) FROM OAuthGrant WHERE userId='${id}') AS grants, ` +
    `(SELECT count(*) FROM ApiCredential WHERE userId='${id}') AS apiCredentials`
  );
}

export function cleanupSql(account) {
  const { id, email } = throwawayAccount(account);
  return [
    `DELETE FROM ApiCredential WHERE userId='${id}';`,
    `DELETE FROM OAuthRefreshToken WHERE userId='${id}';`,
    `DELETE FROM OAuthGrant WHERE userId='${id}';`,
    `DELETE FROM UserCredential WHERE userId='${id}';`,
    `DELETE FROM OAuth WHERE userId='${id}';`,
    `DELETE FROM User WHERE id='${id}' AND email='${email}';`,
    // The search drain finds a document through its key, so the document goes first, then the key.
    `DELETE FROM SearchDocument WHERE entityType='chef' AND entityId='${id}';`,
    `DELETE FROM SearchDocumentKey WHERE docKey='chef:${id}';`,
  ].join("\n");
}

export const TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'";

export function columnsSql(table) {
  return `SELECT name, type FROM pragma_table_info('${table.replaceAll("'", "''")}')`;
}

/** One count query per table over its text columns, or null when the table has none. */
export function tableScanSql(table, columns, needles) {
  const textColumns = columns.filter((column) => ["TEXT", ""].includes(String(column.type).toUpperCase()));
  if (textColumns.length === 0) return null;
  const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
  const condition = textColumns
    .flatMap((column) => needles.map((needle) => `instr(${quoted(column.name)},'${needle}')>0`))
    .join(" OR ");
  return `SELECT '${table.replaceAll("'", "''")}' AS t, count(*) AS n FROM ${quoted(table)} WHERE ${condition}`;
}

export function parseWranglerJson(stdout) {
  const start = stdout.indexOf("[");
  const parsed = JSON.parse(stdout.slice(start));
  return parsed.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []));
}

async function d1(args) {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", DATABASE, "--remote", "--json", ...args],
    { maxBuffer: 1024 * 1024 * 16 },
  );
  return parseWranglerJson(stdout);
}

const query = (sql) => d1(["--command", sql]);

export async function scan(account, run = query) {
  const { id, tag } = throwawayAccount(account);
  const tables = (await run(TABLES_SQL)).map((row) => row.name);
  const hits = [];
  let scanned = 0;
  for (const table of tables) {
    const sql = tableScanSql(table, await run(columnsSql(table)), [id, tag]);
    if (!sql) continue;
    scanned += 1;
    const [row] = await run(sql);
    if (row && Number(row.n) > 0) hits.push({ table, rows: Number(row.n) });
  }
  return { tables: tables.length, scanned, hits };
}

async function main(argv, env) {
  const action = argv[0];
  const account = throwawayAccount({ id: env.ACCOUNT_ID, email: env.ACCOUNT_EMAIL, username: env.ACCOUNT_USERNAME });
  if (action === "seed") {
    await query(seedSql(account, { passwordHash: env.PASSWORD_HASH, salt: env.PASSWORD_SALT, now: new Date().toISOString() }));
    const [row] = await query(`SELECT count(*) AS n FROM User WHERE id='${account.id}'`);
    console.log(`Seeded ${account.id}: ${row?.n} user row.`);
    if (Number(row?.n) !== 1) throw new Error("The seeded user row is not there.");
    return;
  }
  if (action === "cleanup") {
    console.log(`Tokens before cleanup: ${JSON.stringify((await query(tokenCountSql(account)))[0])}`);
    await query(cleanupSql(account));
    console.log(`Deleted the rows of ${account.id}.`);
    return;
  }
  if (action === "scan") {
    const result = await scan(account);
    console.log(JSON.stringify(result));
    if (result.hits.length > 0) throw new Error(`Rows still mention ${account.id} or ${account.tag}.`);
    return;
  }
  throw new Error("action must be seed, cleanup or scan.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
