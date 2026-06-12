#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  QA_BASE_URL,
  arg,
  resolveScriptTarget,
  scriptTargetSummary,
} from "./script-environment.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCAL_BASE_URL = "http://localhost:5173";
const DEFAULT_PRODUCTION_CLEANUP_BASE_URL = "https://spoonjoy.app";
const MAX_WRANGLER_BUFFER = 1024 * 1024 * 8;

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

export function wranglerD1Args(dbName, sql, target) {
  return ["exec", "wrangler", "d1", "execute", dbName, ...target.d1Args, "--command", sql];
}

function requiredArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function defaultBaseUrlForTarget(targetEnv) {
  if (targetEnv === "local") return DEFAULT_LOCAL_BASE_URL;
  if (targetEnv === "qa") return QA_BASE_URL;
  if (targetEnv === "production") return DEFAULT_PRODUCTION_CLEANUP_BASE_URL;
  return DEFAULT_LOCAL_BASE_URL;
}

export function parseCleanupArgs(argv = process.argv.slice(2)) {
  if (argv.includes("--remote")) {
    throw new Error("Refusing ambiguous --remote. Use --target-env qa or --target-env production.");
  }

  const explicitTargetEnv = requiredArgValue(argv, "--target-env");
  const targetEnv = explicitTargetEnv ?? "local";
  const explicitBaseUrl = arg(argv, "--base-url", undefined);
  const baseUrl = explicitBaseUrl ?? defaultBaseUrlForTarget(targetEnv);
  const target = resolveScriptTarget({
    argv: ["--target-env", targetEnv, "--base-url", baseUrl],
    defaultBaseUrl: baseUrl,
  });

  return {
    apply: argv.includes("--apply"),
    dbName: requiredArgValue(argv, "--db") ?? "DB",
    target,
  };
}

export function formatCleanupTargetSummary(target) {
  return scriptTargetSummary(target);
}

function printHelp(stdout = process.stdout) {
  stdout.write(`Usage: node scripts/cleanup-local-qa-data.mjs [--target-env local|qa|production] [--apply] [--db DB]

Dry-runs by default. Missing --target-env remains a backwards-compatible local
dry-run. Local apply mutates only local disposable QA data. QA apply is disabled
until D1/R2 safety checks are installed. Production broad cleanup is read-only
and refuses --apply.
`);
}

export async function runCleanupCli({
  argv = process.argv.slice(2),
  runCommand = execFileAsync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp(stdout);
    return;
  }

  const options = parseCleanupArgs(argv);
  for (const line of formatCleanupTargetSummary(options.target)) {
    stdout.write(`${line}\n`);
  }

  if (options.apply && options.target.targetEnv === "qa") {
    throw new Error("remote QA apply not enabled until D1/R2 safety checks are installed.");
  }
  if (options.apply && options.target.targetEnv === "production") {
    throw new Error("Refusing broad production cleanup. Production cleanup is read-only outside exact smoke cleanup.");
  }
  if (options.target.targetEnv === "production") {
    stdout.write("Production cleanup is read-only for broad disposable sweeps.\n");
  }

  const sql = options.apply ? buildApplySql() : buildDryRunSql();
  const args = wranglerD1Args(options.dbName, sql, options.target);
  const result = await runCommand("pnpm", args, {
    encoding: "utf8",
    maxBuffer: MAX_WRANGLER_BUFFER,
  });

  stdout.write(options.apply ? "Applied local QA cleanup.\n" : "Dry run only. Pass --apply to mutate local D1.\n");
  if (result.stdout) stdout.write(result.stdout);
  if (result.stderr) stderr.write(result.stderr);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCleanupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
