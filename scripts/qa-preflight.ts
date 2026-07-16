import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWranglerRunner,
  formatCheck,
  validateDeploymentConfig,
  type DeploymentPreflightResult,
  type PreflightCheck,
  type RunWrangler,
} from "./deployment-preflight";
import {
  QA_BASE_URL as SHARED_QA_BASE_URL,
  QA_D1_DATABASE_ID as SHARED_QA_D1_DATABASE_ID,
  QA_ENV_NAME as SHARED_QA_ENV_NAME,
  QA_R2_BUCKET as SHARED_QA_R2_BUCKET,
} from "./script-environment.mjs";

export const QA_ENV_NAME = SHARED_QA_ENV_NAME;
export const QA_BASE_URL = SHARED_QA_BASE_URL;
export const QA_R2_BUCKET = SHARED_QA_R2_BUCKET;
export const QA_D1_DATABASE_ID = SHARED_QA_D1_DATABASE_ID;
export const QA_R2_PROBE_BODY = "spoonjoy qa preflight";
export const REQUIRED_QA_SECRETS = [
  "SESSION_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;
export const REQUIRED_QA_RATE_LIMIT_BINDINGS = [
  "API_TOKEN_RATE_LIMITER",
  "API_IP_RATE_LIMITER",
  "AUTH_IP_RATE_LIMITER",
] as const;

const AUTH_ERROR_PATTERN = /auth|oauth|login|unauthenticated|api token|10000/i;
const NO_PENDING_MIGRATIONS_PATTERN = /no migrations to apply|no pending migrations/i;
const MIGRATION_FILE_PATTERN = /\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g;

export interface ProbeFile {
  path: string;
  body: string;
  cleanup: () => Promise<void>;
}

export interface QaPreflightDeps {
  runWrangler?: RunWrangler;
  createProbeFile?: () => Promise<ProbeFile>;
  readGeneratedBuildConfig?: () => Promise<Record<string, unknown>>;
  env?: NodeJS.ProcessEnv;
}

function check(name: string, ok: boolean, message: string, severity: "error" | "warning" = "error"): PreflightCheck {
  return { name, ok, message, severity };
}

function severityForRemoteMessage(message: string): "error" | "warning" {
  return AUTH_ERROR_PATTERN.test(message) ? "warning" : "error";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bindingRecord(bindings: unknown, bindingName: string): Record<string, unknown> | null {
  if (!Array.isArray(bindings)) return null;
  for (const entry of bindings) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.binding === bindingName) return record;
  }
  return null;
}

function rateLimitNamesAndIds(ratelimits: unknown): { names: string[]; namespaceIds: string[] } {
  if (!Array.isArray(ratelimits)) return { names: [], namespaceIds: [] };
  const names: string[] = [];
  const namespaceIds: string[] = [];
  for (const entry of ratelimits) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name === "string" && record.name !== "") names.push(record.name);
    if (typeof record.namespace_id === "string" && record.namespace_id !== "") namespaceIds.push(record.namespace_id);
  }
  return { names, namespaceIds };
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

export function buildQaMigrationListArgs(): string[] {
  return ["d1", "migrations", "list", "DB", "--remote", "--env", QA_ENV_NAME];
}

export function buildQaSecretListArgs(): string[] {
  return ["secret", "list", "--env", QA_ENV_NAME];
}

export function buildQaR2PutArgs(key: string, filePath: string): string[] {
  return ["r2", "object", "put", `${QA_R2_BUCKET}/${key}`, "--remote", "--file", filePath];
}

export function buildQaR2GetArgs(key: string): string[] {
  return ["r2", "object", "get", `${QA_R2_BUCKET}/${key}`, "--remote", "--pipe"];
}

export function buildQaR2DeleteArgs(key: string): string[] {
  return ["r2", "object", "delete", `${QA_R2_BUCKET}/${key}`, "--remote", "--force"];
}

export function parseWranglerSecretNames(stdout: string): string[] | { error: string } {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    return { error: "Wrangler secret output did not contain a JSON array." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    const message = String(error);
    return { error: `Could not parse Wrangler secret JSON: ${message}` };
  }

  const names = (parsed as unknown[])
    .map((row) => (row && typeof row === "object" && "name" in row ? row.name : null))
    .filter((name): name is string => typeof name === "string" && name !== "");
  return names;
}

function parsePendingMigrations(stdout: string): string[] | { error: string } {
  const trimmed = stdout.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  if (NO_PENDING_MIGRATIONS_PATTERN.test(stdout)) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = String(error);
      return { error: `Could not parse Wrangler migration JSON: ${message}` };
    }
    if (!Array.isArray(parsed)) {
      return { error: "Wrangler migration output JSON was not an array." };
    }
    const pending = parsed
      .map((row) => (row && typeof row === "object" && "Name" in row ? row.Name : null))
      .filter((name): name is string => typeof name === "string" && name !== "");
    return pending;
  }

  const filenames = Array.from(new Set(stdout.match(MIGRATION_FILE_PATTERN) ?? []));
  if (filenames.length > 0) return filenames;
  return { error: "Could not parse Wrangler migration output." };
}

async function createDefaultProbeFile(): Promise<ProbeFile> {
  const dir = await mkdtemp(path.join(tmpdir(), "spoonjoy-qa-preflight-"));
  const filePath = path.join(dir, "probe.txt");
  await writeFile(filePath, QA_R2_PROBE_BODY, "utf8");
  return {
    path: filePath,
    body: QA_R2_PROBE_BODY,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function checkStaticConfig(rootDir: string): Promise<PreflightCheck> {
  const [
    wrangler,
    packageJson,
    ciWorkflow,
    productionDeployWorkflow,
    qaImageCoverSmokeWorkflow,
    storybookWorkflow,
    gitignore,
    pnpmWorkspace,
    cloudflareEnvDts,
    readme,
    deploymentDoc,
    vitestConfig,
    tsconfigScripts,
    migrationFiles,
  ] = await Promise.all([
    readJsonFile(path.join(rootDir, "wrangler.json")),
    readJsonFile(path.join(rootDir, "package.json")),
    readFile(path.join(rootDir, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/production-deploy.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/qa-image-cover-smoke.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/storybook.yml"), "utf8"),
    readFile(path.join(rootDir, ".gitignore"), "utf8"),
    readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8"),
    readFile(path.join(rootDir, "app/cloudflare-env.d.ts"), "utf8"),
    readFile(path.join(rootDir, "README.md"), "utf8"),
    readFile(path.join(rootDir, "docs/deployment.md"), "utf8"),
    readFile(path.join(rootDir, "vitest.config.ts"), "utf8"),
    readFile(path.join(rootDir, "tsconfig.scripts.json"), "utf8"),
    readdir(path.join(rootDir, "migrations")),
  ]);

  const result = validateDeploymentConfig({
    wrangler,
    packageJson,
    ciWorkflow,
    productionDeployWorkflow,
    qaImageCoverSmokeWorkflow,
    storybookWorkflow,
    gitignore,
    pnpmWorkspace,
    cloudflareEnvDts,
    readme,
    deploymentDoc,
    vitestConfig,
    tsconfigScripts,
    migrationFiles,
  });

  if (result.errors.length > 0) {
    return check(
      "QA static config",
      false,
      `Static deployment config has ${result.errors.length} error(s): ${result.errors.map((item) => item.name).join(", ")}`,
    );
  }

  return check("QA static config", true, `QA static config targets ${QA_BASE_URL}.`);
}

export function validateQaGeneratedBuildConfig(config: Record<string, unknown>): PreflightCheck {
  const vars = objectRecord(config.vars);
  const db = bindingRecord(config.d1_databases, "DB");
  const photos = bindingRecord(config.r2_buckets, "PHOTOS");
  const rateLimits = rateLimitNamesAndIds(config.ratelimits);
  const hasExpectedRateLimitBindings =
    rateLimits.names.length === REQUIRED_QA_RATE_LIMIT_BINDINGS.length &&
    rateLimits.namespaceIds.length === REQUIRED_QA_RATE_LIMIT_BINDINGS.length &&
    new Set(rateLimits.names).size === REQUIRED_QA_RATE_LIMIT_BINDINGS.length &&
    new Set(rateLimits.namespaceIds).size === REQUIRED_QA_RATE_LIMIT_BINDINGS.length &&
    REQUIRED_QA_RATE_LIMIT_BINDINGS.every((name) => rateLimits.names.includes(name));

  const ok =
    config.name === "spoonjoy-v2-qa" &&
    vars.SPOONJOY_BASE_URL === QA_BASE_URL &&
    vars.SPOONJOY_CSP_MODE === "enforce" &&
    db?.database_name === "spoonjoy-qa" &&
    db.database_id === QA_D1_DATABASE_ID &&
    photos?.bucket_name === QA_R2_BUCKET &&
    hasExpectedRateLimitBindings &&
    rateLimits.namespaceIds.every((id) => ["2001", "2002", "2003"].includes(id));

  return check(
    "QA generated build config",
    ok,
    ok
      ? "Generated Worker config uses QA Worker name, base URL, D1, R2, and rate-limit bindings."
      : "Generated Worker config is not isolated to QA or is missing SPOONJOY_CSP_MODE=enforce. Rebuild with `CLOUDFLARE_ENV=qa pnpm run build` before `wrangler deploy --env qa`.",
  );
}

async function readDefaultGeneratedBuildConfig(rootDir: string): Promise<Record<string, unknown>> {
  return readJsonFile(path.join(rootDir, "build/server/wrangler.json"));
}

async function checkQaMigrations(runWrangler: RunWrangler, env: NodeJS.ProcessEnv): Promise<PreflightCheck> {
  if (env.SPOONJOY_PREFLIGHT_SKIP_REMOTE === "1") {
    return check("QA D1 migrations", true, "Skipped QA D1 migration check (SPOONJOY_PREFLIGHT_SKIP_REMOTE=1).", "warning");
  }

  const result = await runWrangler(buildQaMigrationListArgs());
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || result.stdout.trim();
    return check(
      "QA D1 migrations",
      false,
      `Could not verify QA D1 migrations: ${message}`,
      severityForRemoteMessage(message),
    );
  }

  const pending = parsePendingMigrations(result.stdout);
  if ("error" in pending) {
    return check("QA D1 migrations", false, pending.error);
  }

  if (pending.length > 0) {
    return check("QA D1 migrations", false, `QA D1 has ${pending.length} pending migration(s): ${pending.join(", ")}`);
  }

  return check("QA D1 migrations", true, "QA D1 has no pending migrations.");
}

async function checkQaSecrets(runWrangler: RunWrangler, env: NodeJS.ProcessEnv): Promise<PreflightCheck> {
  if (env.SPOONJOY_PREFLIGHT_SKIP_REMOTE === "1") {
    return check("QA secrets", true, "Skipped QA secret check (SPOONJOY_PREFLIGHT_SKIP_REMOTE=1).", "warning");
  }

  const result = await runWrangler(buildQaSecretListArgs());
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || result.stdout.trim();
    return check(
      "QA secrets",
      false,
      `Could not verify QA secrets: ${message}`,
      severityForRemoteMessage(message),
    );
  }

  const parsed = parseWranglerSecretNames(result.stdout);
  if ("error" in parsed) {
    return check("QA secrets", false, parsed.error);
  }

  const names = new Set(parsed);
  const missing = REQUIRED_QA_SECRETS.filter((secret) => !names.has(secret));
  if (missing.length > 0) {
    return check("QA secrets", false, `QA Worker is missing required secret(s): ${missing.join(", ")}`);
  }

  return check("QA secrets", true, "QA Worker has required runtime secrets.");
}

async function checkQaR2RoundTrip(runWrangler: RunWrangler, createProbeFile: () => Promise<ProbeFile>, env: NodeJS.ProcessEnv): Promise<PreflightCheck> {
  if (env.SPOONJOY_PREFLIGHT_SKIP_REMOTE === "1") {
    return check("QA R2 round trip", true, "Skipped QA R2 round trip (SPOONJOY_PREFLIGHT_SKIP_REMOTE=1).", "warning");
  }

  const probe = await createProbeFile();
  const key = `preflight/${Date.now().toString(36)}-probe.txt`;
  let uploaded = false;
  try {
    const put = await runWrangler(buildQaR2PutArgs(key, probe.path));
    if (put.exitCode !== 0) {
      const message = put.stderr.trim() || put.stdout.trim();
      return check(
        "QA R2 round trip",
        false,
        `Could not write QA R2 probe: ${message}`,
        severityForRemoteMessage(message),
      );
    }
    uploaded = true;

    const get = await runWrangler(buildQaR2GetArgs(key));
    if (get.exitCode !== 0) {
      const message = get.stderr.trim() || get.stdout.trim();
      const deleteResult = await runWrangler(buildQaR2DeleteArgs(key));
      uploaded = false;
      if (deleteResult.exitCode !== 0) {
        const deleteMessage = deleteResult.stderr.trim() || deleteResult.stdout.trim();
        return check(
          "QA R2 round trip",
          false,
          `Could not delete QA R2 probe after read failure: ${deleteMessage}`,
          severityForRemoteMessage(deleteMessage),
        );
      }
      return check(
        "QA R2 round trip",
        false,
        `Could not read QA R2 probe: ${message}`,
        severityForRemoteMessage(message),
      );
    }
    if (get.stdout !== probe.body) {
      const deleteResult = await runWrangler(buildQaR2DeleteArgs(key));
      uploaded = false;
      if (deleteResult.exitCode !== 0) {
        const deleteMessage = deleteResult.stderr.trim() || deleteResult.stdout.trim();
        return check(
          "QA R2 round trip",
          false,
          `Could not delete QA R2 probe after readback mismatch: ${deleteMessage}`,
          severityForRemoteMessage(deleteMessage),
        );
      }
      return check("QA R2 round trip", false, "QA R2 readback did not match the uploaded probe body.");
    }

    const deleteResult = await runWrangler(buildQaR2DeleteArgs(key));
    uploaded = false;
    if (deleteResult.exitCode !== 0) {
      const message = deleteResult.stderr.trim() || deleteResult.stdout.trim();
      return check(
        "QA R2 round trip",
        false,
        `Could not delete QA R2 probe: ${message}`,
        severityForRemoteMessage(message),
      );
    }
    return check("QA R2 round trip", true, "QA R2 write/read/delete probe passed.");
  } finally {
    if (uploaded) {
      await runWrangler(buildQaR2DeleteArgs(key));
    }
    await probe.cleanup();
  }
}

export async function runQaPreflight(rootDir = process.cwd(), deps: QaPreflightDeps = {}): Promise<DeploymentPreflightResult> {
  const runWrangler = deps.runWrangler ?? createWranglerRunner();
  const env = deps.env ?? process.env;
  const createProbeFile = deps.createProbeFile ?? createDefaultProbeFile;
  const readGeneratedBuildConfig = deps.readGeneratedBuildConfig ?? (() => readDefaultGeneratedBuildConfig(rootDir));

  const checks = [
    await checkStaticConfig(rootDir),
    ...(env.SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG === "1"
      ? [validateQaGeneratedBuildConfig(await readGeneratedBuildConfig())]
      : []),
    await checkQaMigrations(runWrangler, env),
    await checkQaSecrets(runWrangler, env),
    await checkQaR2RoundTrip(runWrangler, createProbeFile, env),
  ];

  return {
    checks,
    errors: checks.filter((item) => !item.ok && item.severity === "error"),
    warnings: checks.filter((item) => !item.ok && item.severity === "warning"),
  };
}

export interface QaCliIO {
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
}

export interface QaMainDeps extends QaPreflightDeps {
  io?: QaCliIO;
}

export async function main(deps: QaMainDeps = {}): Promise<void> {
  const io: QaCliIO = deps.io ?? {
    log: (message) => console.log(message),
    error: (message) => console.error(message),
    exit: (code) => process.exit(code),
  };

  const result = await runQaPreflight(process.cwd(), {
    runWrangler: deps.runWrangler,
    createProbeFile: deps.createProbeFile,
    readGeneratedBuildConfig: deps.readGeneratedBuildConfig,
    env: deps.env,
  });
  for (const item of result.checks) {
    io.log(formatCheck(item));
  }

  if (result.errors.length > 0) {
    io.error(`QA preflight failed with ${result.errors.length} error(s).`);
    io.exit(1);
    return;
  }

  const warningSuffix = result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : "";
  io.log(`QA preflight passed${warningSuffix}.`);
}

export function isCliEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  return path.resolve(argv1) === fileURLToPath(moduleUrl);
}

export interface RunQaCliIfEntryDeps {
  argv1?: string;
  moduleUrl: string;
  runMain?: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export function runCliIfEntry(deps: RunQaCliIfEntryDeps): boolean {
  if (!isCliEntry(deps.argv1, deps.moduleUrl)) {
    return false;
  }
  const runMain = deps.runMain ?? main;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      const message = String(error);
      console.error(`QA preflight failed: ${message}`);
      process.exit(1);
    });
  runMain().catch(onError);
  return true;
}

runCliIfEntry({ argv1: process.argv[1], moduleUrl: import.meta.url });
