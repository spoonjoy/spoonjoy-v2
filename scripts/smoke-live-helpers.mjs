export const DEFAULT_PRODUCTION_BASE_URL = "https://spoonjoy-v2.mendelow-studio.workers.dev";
export const QA_BASE_URL = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";

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
  if (targetEnv === "qa" && new URL(baseUrl).origin !== QA_BASE_URL) {
    throw new Error(`QA smoke must target ${QA_BASE_URL}.`);
  }
  if (targetEnv === "production" && usesLocalD1(baseUrl)) {
    throw new Error("Production smoke cannot target a local URL.");
  }

  return {
    baseUrl,
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
