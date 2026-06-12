import { execFileSync } from "node:child_process";

import {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  QA_BASE_URL,
  QA_R2_BUCKET,
  arg,
  resolveScriptTarget,
  usesLocalD1,
} from "./script-environment.mjs";

export {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  QA_BASE_URL,
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

function d1TargetArgs(targetEnv) {
  if (targetEnv === "local") return resolveScriptTarget({ argv: ["--base-url", "http://localhost"], defaultBaseUrl: "http://localhost" }).d1Args;
  if (targetEnv === "qa") return resolveScriptTarget({ argv: ["--target-env", "qa", "--base-url", QA_BASE_URL] }).d1Args;
  if (targetEnv === "production") return resolveScriptTarget({ argv: ["--target-env", "production", "--base-url", DEFAULT_PRODUCTION_BASE_URL] }).d1Args;
  throw new Error("D1 smoke operation requires targetEnv local, qa, or production.");
}

export function buildCleanupD1Args(email, { targetEnv }) {
  const command = `DELETE FROM "User" WHERE email = ${sqlString(email)};`;
  return ["exec", "wrangler", "d1", "execute", "DB", ...d1TargetArgs(targetEnv), "--command", command];
}

export function buildUserCountD1Args(email, { targetEnv }) {
  const command = `SELECT COUNT(*) AS count FROM "User" WHERE email = ${sqlString(email)};`;
  return ["exec", "wrangler", "d1", "execute", "DB", ...d1TargetArgs(targetEnv), "--command", command];
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
