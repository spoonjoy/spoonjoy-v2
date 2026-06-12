export const DEFAULT_PRODUCTION_BASE_URL = "https://spoonjoy-v2.mendelow-studio.workers.dev";
export const PRODUCTION_BASE_URLS = [DEFAULT_PRODUCTION_BASE_URL, "https://spoonjoy.app"];
export const QA_BASE_URL = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
export const QA_R2_BUCKET = "spoonjoy-photos-qa";
export const IMAGE_COVER_SMOKE_FLAG = "--include-image-cover-smoke";

export function arg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

export function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function usesLocalD1(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function shouldRunAppleOAuthCheck(targetEnv) {
  return targetEnv === "production";
}

export function parseSmokeArgs(argv = process.argv.slice(2), env = process.env) {
  const baseUrl = arg(argv, "--base-url", env.SPOONJOY_SMOKE_BASE_URL ?? DEFAULT_PRODUCTION_BASE_URL);
  const outDir = arg(argv, "--out", "live-smoke-artifacts");
  const explicitTargetEnv = arg(argv, "--target-env", undefined);
  const targetEnv = explicitTargetEnv ?? (usesLocalD1(baseUrl) ? "local" : undefined);

  if (!targetEnv) {
    throw new Error("Remote smoke runs require explicit `--target-env qa` or `--target-env production`.");
  }
  if (!["local", "qa", "production"].includes(targetEnv)) {
    throw new Error("Smoke target env must be one of local, qa, or production.");
  }
  if (targetEnv === "local" && !usesLocalD1(baseUrl)) {
    throw new Error("Local smoke must target a localhost or loopback URL.");
  }
  if (targetEnv === "qa" && new URL(baseUrl).origin !== QA_BASE_URL) {
    throw new Error(`QA smoke must target ${QA_BASE_URL}.`);
  }
  if (targetEnv === "production" && !PRODUCTION_BASE_URLS.includes(new URL(baseUrl).origin)) {
    throw new Error(`Production smoke must target one of: ${PRODUCTION_BASE_URLS.join(", ")}.`);
  }
  const includeImageCoverSmoke = argv.includes(IMAGE_COVER_SMOKE_FLAG);
  if (includeImageCoverSmoke && targetEnv !== "qa") {
    throw new Error("The image-cover smoke is QA-only and must use `--target-env qa`.");
  }

  return {
    baseUrl,
    includeImageCoverSmoke,
    outDir,
    targetEnv,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
  };
}

function d1TargetArgs(targetEnv) {
  if (targetEnv === "local") return ["--local"];
  if (targetEnv === "qa") return ["--remote", "--env", "qa"];
  if (targetEnv === "production") return ["--remote"];
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
