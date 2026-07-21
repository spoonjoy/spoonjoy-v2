export const TARGET_ENVS = ["local", "qa", "production"];

export const DEFAULT_PRODUCTION_BASE_URL = "https://spoonjoy-v2.mendelow-studio.workers.dev";
export const PRODUCTION_BASE_URLS = [DEFAULT_PRODUCTION_BASE_URL, "https://spoonjoy.app"];
export const QA_ENV_NAME = "qa";
export const QA_BASE_URL = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
export const PRODUCTION_D1_DATABASE_NAME = "spoonjoy";
export const QA_D1_DATABASE_NAME = "spoonjoy-qa";
export const QA_D1_DATABASE_ID = "c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34";
export const QA_R2_BUCKET = "spoonjoy-photos-qa";
export const PRODUCTION_R2_BUCKET = "spoonjoy-photos";

const TARGET_METADATA = {
  local: {
    d1Target: "local D1 (--local)",
    d1Args: ["--local"],
    r2Target: `local R2 ${PRODUCTION_R2_BUCKET} (--local)`,
    r2Bucket: PRODUCTION_R2_BUCKET,
    destructiveScope: "local disposable test data only",
  },
  qa: {
    d1Target: "QA D1 spoonjoy-qa (--remote --env qa)",
    d1Args: ["--remote", "--env", "qa"],
    r2Target: "QA R2 spoonjoy-photos-qa (--remote)",
    r2Bucket: QA_R2_BUCKET,
    destructiveScope: "QA disposable test data only",
  },
  production: {
    d1Target: "production D1 spoonjoy (--remote)",
    d1Args: ["--remote"],
    r2Target: "production R2 spoonjoy-photos (--remote)",
    r2Bucket: PRODUCTION_R2_BUCKET,
    destructiveScope: "production read-only by default; exact smoke cleanup only",
  },
};

export function arg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

export function usesLocalD1(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function parseBaseUrl(rawBaseUrl) {
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim() === "") {
    throw new Error("Script base URL is required.");
  }

  const baseUrl = rawBaseUrl.trim();
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Script base URL must be a valid URL.");
  }

  return { baseUrl, origin: parsed.origin };
}

function validateTargetOrigin(targetEnv, baseUrl, origin) {
  if (targetEnv === "local" && !usesLocalD1(baseUrl)) {
    throw new Error("Local target mismatch. Local smoke target must use a localhost or loopback URL.");
  }
  if (targetEnv === "qa" && origin !== QA_BASE_URL) {
    throw new Error(`QA target mismatch. QA smoke must target ${QA_BASE_URL}.`);
  }
  if (targetEnv === "production" && !PRODUCTION_BASE_URLS.includes(origin)) {
    throw new Error(`Production target mismatch. Production smoke must target one of: ${PRODUCTION_BASE_URLS.join(", ")}.`);
  }
}

export function resolveScriptTarget({
  argv = [],
  env = {},
  defaultBaseUrl = DEFAULT_PRODUCTION_BASE_URL,
  defaultTargetEnv,
  baseUrlFlag = "--base-url",
  targetEnvFlag = "--target-env",
} = {}) {
  const { baseUrl, origin } = parseBaseUrl(arg(argv, baseUrlFlag, defaultBaseUrl));
  const explicitTargetEnv = arg(argv, targetEnvFlag, undefined);
  const targetEnv = explicitTargetEnv ?? defaultTargetEnv ?? (usesLocalD1(baseUrl) ? "local" : undefined);

  if (!targetEnv) {
    throw new Error("Remote smoke runs require explicit --target-env qa or --target-env production.");
  }
  if (!TARGET_ENVS.includes(targetEnv)) {
    throw new Error("Script target env must be one of local, qa, or production.");
  }

  validateTargetOrigin(targetEnv, baseUrl, origin);
  const metadata = TARGET_METADATA[targetEnv];

  return {
    targetEnv,
    baseUrl,
    origin,
    isRemote: targetEnv !== "local",
    d1Target: metadata.d1Target,
    d1Args: [...metadata.d1Args],
    r2Target: metadata.r2Target,
    r2Bucket: metadata.r2Bucket,
    destructiveScope: metadata.destructiveScope,
  };
}

export function scriptTargetSummary(target) {
  return [
    `Target environment: ${target.targetEnv}`,
    `Base URL: ${target.baseUrl}`,
    `D1 target: ${target.d1Target}`,
    `R2 target: ${target.r2Target}`,
    `Destructive scope: ${target.destructiveScope}`,
  ];
}
