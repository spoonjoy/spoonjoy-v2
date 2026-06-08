#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SUSPICIOUS_RECIPE_WHERE = [
  "lower(title) LIKE 'e2e %'",
  "lower(title) LIKE 'mobile dock save%'",
  "lower(title) LIKE '%(variation %'",
  "lower(title) LIKE 'codex %'",
  "lower(title) LIKE 'codex-smoke-%'",
].join("\n    OR ");

export const DISPOSABLE_USER_WHERE = [
  "email LIKE 'codex-%'",
  "email LIKE 'e2e-passkey-%'",
  "username LIKE 'codex_%'",
  "username LIKE 'e2e_passkey_%'",
].join("\n    OR ");

export const DISPOSABLE_SPOON_WHERE = [
  "lower(coalesce(note,'')) LIKE 'e2e %'",
  "lower(coalesce(note,'')) LIKE 'codex %'",
  "lower(coalesce(note,'')) LIKE 'playwright%'",
].join("\n    OR ");

export function buildDryRunSql() {
  return `
SELECT 'active suspicious recipes' AS item, COUNT(*) AS count
FROM Recipe
WHERE deletedAt IS NULL AND (${SUSPICIOUS_RECIPE_WHERE});

SELECT 'already deleted suspicious recipes' AS item, COUNT(*) AS count
FROM Recipe
WHERE deletedAt IS NOT NULL AND (${SUSPICIOUS_RECIPE_WHERE});

SELECT 'disposable users' AS item, COUNT(*) AS count
FROM User
WHERE ${DISPOSABLE_USER_WHERE};

SELECT 'disposable spoons' AS item, COUNT(*) AS count
FROM RecipeSpoon
WHERE ${DISPOSABLE_SPOON_WHERE};

SELECT 'e2e oauth clients' AS item, COUNT(*) AS count
FROM OAuthClient
WHERE clientName = 'E2E OAuth Client';
`.trim();
}

export function buildApplySql() {
  return `
PRAGMA foreign_keys=ON;

DELETE FROM RecipeInCookbook
WHERE recipeId IN (
  SELECT id FROM Recipe WHERE ${SUSPICIOUS_RECIPE_WHERE}
)
OR recipeId IN (
  SELECT id FROM Recipe WHERE chefId IN (SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE})
)
OR addedById IN (
  SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
);

UPDATE Recipe
SET deletedAt = CURRENT_TIMESTAMP
WHERE deletedAt IS NULL AND (${SUSPICIOUS_RECIPE_WHERE});

DELETE FROM RecipeSpoon
WHERE ${DISPOSABLE_SPOON_WHERE};

DELETE FROM OAuthAuthCode
WHERE clientId IN (SELECT id FROM OAuthClient WHERE clientName = 'E2E OAuth Client');

DELETE FROM OAuthClient
WHERE clientName = 'E2E OAuth Client';

DELETE FROM OAuth
WHERE userId IN (SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE});

DELETE FROM UserCredential
WHERE userId IN (SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE});

DELETE FROM User
WHERE ${DISPOSABLE_USER_WHERE};
`.trim();
}

export function wranglerLocalD1Args(dbName, sql) {
  return ["exec", "wrangler", "d1", "execute", dbName, "--local", "--command", sql];
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function printHelp() {
  console.log(`Usage: node scripts/cleanup-local-qa-data.mjs [--apply] [--db DB]

Dry-runs by default. With --apply, soft-deletes local e2e/Codex recipe rows and
deletes local disposable users, e2e OAuth clients/codes, passkeys, and e2e spoon
rows. This script always uses wrangler d1 execute --local and never touches
remote D1.`);
}

async function run() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (process.argv.includes("--remote")) {
    throw new Error("Refusing --remote. This cleanup script is local-only.");
  }

  const apply = process.argv.includes("--apply");
  const dbName = argValue("--db", "DB");
  const sql = apply ? buildApplySql() : buildDryRunSql();
  const args = wranglerLocalD1Args(dbName, sql);
  const { stdout, stderr } = await execFileAsync("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });

  process.stdout.write(apply ? "Applied local QA cleanup.\n" : "Dry run only. Pass --apply to mutate local D1.\n");
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
