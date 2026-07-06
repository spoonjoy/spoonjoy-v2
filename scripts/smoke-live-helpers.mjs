import { execFileSync } from "node:child_process";

import {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  PRODUCTION_D1_DATABASE_NAME,
  QA_BASE_URL,
  QA_D1_DATABASE_NAME,
  QA_R2_BUCKET,
  arg,
  resolveScriptTarget,
  usesLocalD1,
} from "./script-environment.mjs";

export {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  PRODUCTION_D1_DATABASE_NAME,
  QA_BASE_URL,
  QA_D1_DATABASE_NAME,
  QA_R2_BUCKET,
  arg,
  usesLocalD1,
};

export const IMAGE_COVER_SMOKE_FLAG = "--include-image-cover-smoke";

export function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function shouldRunAppleOAuthCheck(targetEnv) {
  return targetEnv === "production";
}

export function parseSmokeArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_SMOKE_BASE_URL ?? DEFAULT_PRODUCTION_BASE_URL,
  });
  const { baseUrl, targetEnv } = target;
  const outDir = arg(argv, "--out", "live-smoke-artifacts");
  const includeImageCoverSmoke = argv.includes(IMAGE_COVER_SMOKE_FLAG);
  if (includeImageCoverSmoke && targetEnv !== "qa") {
    throw new Error("The image-cover smoke is QA-only and must use `--target-env qa`.");
  }

  return {
    baseUrl,
    includeImageCoverSmoke,
    outDir,
    targetEnv,
    target,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
  };
}

export function parseMcpCanaryArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app",
  });
  return {
    baseUrl: target.baseUrl,
    outDir: arg(argv, "--out", "mcp-oauth-canary-artifacts"),
    targetEnv: target.targetEnv,
    target,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
    includeLegacyDbProbe: !argv.includes("--skip-legacy-db-probe"),
  };
}

function d1ExecuteTarget(targetEnv) {
  if (targetEnv === "local") {
    return {
      database: "DB",
      args: resolveScriptTarget({ argv: ["--base-url", "http://localhost"], defaultBaseUrl: "http://localhost" }).d1Args,
    };
  }
  if (targetEnv === "qa") {
    return { database: QA_D1_DATABASE_NAME, args: ["--remote"] };
  }
  if (targetEnv === "production") {
    return { database: PRODUCTION_D1_DATABASE_NAME, args: ["--remote"] };
  }
  throw new Error("D1 smoke operation requires targetEnv local, qa, or production.");
}

export function buildCleanupD1Args(email, { targetEnv }) {
  const command = `DELETE FROM "User" WHERE email = ${sqlString(email)};`;
  return buildD1CommandArgs(command, { targetEnv });
}

export function buildD1CommandArgs(command, { targetEnv }) {
  const target = d1ExecuteTarget(targetEnv);
  return ["exec", "wrangler", "d1", "execute", target.database, ...target.args, "--command", command];
}

export function buildUserCountD1Args(email, { targetEnv }) {
  const command = `SELECT COUNT(*) AS count FROM "User" WHERE email = ${sqlString(email)};`;
  return buildD1CommandArgs(command, { targetEnv });
}

export function buildMcpCanaryUserLookupD1Args(email, { targetEnv }) {
  return buildD1CommandArgs(`SELECT id FROM "User" WHERE email = ${sqlString(email)} LIMIT 1;`, { targetEnv });
}

export function buildMcpCanaryLegacyRefreshInsertD1Args(input, { targetEnv }) {
  return buildD1CommandArgs([
    `INSERT INTO "OAuthRefreshToken" (id, tokenHash, userId, clientId, scope, resource, connectionKey, revokedAt, createdAt)`,
    `VALUES (${sqlString(input.id)}, ${sqlString(input.tokenHash)}, ${sqlString(input.userId)}, ${sqlString(input.clientId)}, ${sqlString(input.scope)}, NULL, ${sqlString(input.connectionKey)}, NULL, CURRENT_TIMESTAMP);`,
  ].join(" "), { targetEnv });
}

export function buildMcpCanaryConnectionResourceD1Args(input, { targetEnv }) {
  return buildD1CommandArgs([
    `SELECT resource FROM "OAuthRefreshToken"`,
    `WHERE userId = ${sqlString(input.userId)} AND clientId = ${sqlString(input.clientId)} AND connectionKey = ${sqlString(input.connectionKey)} AND revokedAt IS NULL`,
    `ORDER BY createdAt DESC LIMIT 1;`,
  ].join(" "), { targetEnv });
}

export function buildMcpCanaryCleanupD1Args(input, { targetEnv }) {
  const commands = [
    `DELETE FROM "OAuthRefreshToken" WHERE connectionKey = ${sqlString(input.connectionKey)};`,
  ];
  if (input.clientId) {
    commands.push(`DELETE FROM "OAuthClient" WHERE id = ${sqlString(input.clientId)};`);
  }
  commands.push(`DELETE FROM "User" WHERE email = ${sqlString(input.email)};`);
  return buildD1CommandArgs(commands.join(" "), { targetEnv });
}

export function buildQaR2GetArgs(key) {
  return ["exec", "wrangler", "r2", "object", "get", `${QA_R2_BUCKET}/${key}`, "--remote", "--pipe"];
}

export function buildQaR2DeleteArgs(key) {
  return ["exec", "wrangler", "r2", "object", "delete", `${QA_R2_BUCKET}/${key}`, "--remote", "--force"];
}

function errorText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

export function isQaR2ObjectMissingError(error) {
  const parts = [];
  if (typeof error === "string") parts.push(error);
  if (error instanceof Error) parts.push(error.message);
  if (typeof error === "object" && error !== null) {
    for (const key of ["stdout", "stderr", "output"]) {
      if (key in error) parts.push(errorText(error[key]));
    }
  }
  return /(?:the specified key does not exist|nosuchkey|not found)/i.test(parts.join("\n"));
}

export function parseD1CountOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler D1 count output did not contain a JSON array.");
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  const first = parsed?.[0];
  const row = first?.results?.[0];
  const count = row?.count ?? row?.["COUNT(*)"] ?? row?.["count(*)"];
  if (typeof count === "number") return count;
  if (typeof count === "string" && /^\d+$/.test(count)) return Number(count);
  throw new Error("Wrangler D1 count output did not include a numeric count.");
}

export function parseD1RowsOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler D1 output did not contain a JSON array.");
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  const rows = parsed?.[0]?.results;
  if (Array.isArray(rows)) return rows;
  throw new Error("Wrangler D1 output did not include a results array.");
}

export function readGitMetadata(runCommand = execFileSync) {
  const read = (args) => {
    try {
      return String(runCommand("git", args, { encoding: "utf8" })).trim() || "unknown";
    } catch {
      return "unknown";
    }
  };
  return {
    branch: read(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: read(["rev-parse", "--short=12", "HEAD"]),
  };
}

function environmentReport(target) {
  return {
    targetEnv: target.targetEnv,
    baseUrl: target.baseUrl,
    d1Target: target.d1Target,
    r2Target: target.r2Target,
    destructiveScope: target.destructiveScope,
  };
}

function r2ReportFrom(imageCoverSmoke) {
  const r2 = imageCoverSmoke?.r2 ?? {};
  const report = {
    retainedKeys: Array.isArray(r2.retainedKeys) ? r2.retainedKeys : [],
    deletedKeys: Array.isArray(r2.deletedKeys) ? r2.deletedKeys : [],
    verifiedDeletedKeys: Array.isArray(r2.verifiedDeletedKeys) ? r2.verifiedDeletedKeys : [],
  };
  if (Array.isArray(r2.generatedCoverKeys)) {
    report.generatedCoverKeys = r2.generatedCoverKeys;
  }
  return report;
}

export function buildSmokeReport({
  generatedAt,
  target,
  git,
  created,
  screenshots = [],
  consoleErrors = [],
  pageErrors = [],
  cleanup = null,
  cleanupVerification = null,
  imageCoverSmoke = null,
  apple = null,
  pushPublicKeyStatus,
}) {
  return {
    baseUrl: target.baseUrl,
    generatedAt,
    email: created.email,
    username: created.username,
    recipeTitle: created.recipeTitle,
    recipeId: created.recipeId,
    screenshots,
    consoleErrors,
    pageErrors,
    cleanup,
    cleanupVerification,
    imageCoverSmoke,
    targetEnv: target.targetEnv,
    apple,
    pushPublicKeyStatus,
    environment: environmentReport(target),
    git,
    created,
    r2: r2ReportFrom(imageCoverSmoke),
  };
}
