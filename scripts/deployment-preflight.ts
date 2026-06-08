import { execFile as nodeExecFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type PreflightSeverity = "error" | "warning";

export interface PreflightCheck {
  name: string;
  ok: boolean;
  severity: PreflightSeverity;
  message: string;
}

export interface DeploymentPreflightInputs {
  wrangler: Record<string, unknown>;
  packageJson: Record<string, unknown>;
  cloudflareEnvDts: string;
  readme: string;
  deploymentDoc: string;
  migrationFiles: string[];
}

export interface DeploymentPreflightResult {
  checks: PreflightCheck[];
  errors: PreflightCheck[];
  warnings: PreflightCheck[];
}

const REQUIRED_SECRET_NAMES = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
  "OPENAI_API_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

const TELEMETRY_SERVER_ENV_NAMES = [
  "POSTHOG_KEY",
  "POSTHOG_HOST",
  "POSTHOG_DISABLED",
] as const;

const TELEMETRY_CLIENT_ENV_NAMES = [
  "VITE_POSTHOG_KEY",
  "VITE_POSTHOG_HOST",
  "VITE_POSTHOG_DISABLED",
] as const;

const IMAGE_PROVIDER_ENV_NAMES = [
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_IMAGE_MODEL",
  "GEMINI_IMAGE_TIMEOUT_MS",
  "IMAGE_PROVIDER_PRIMARY",
  "IMAGE_PROVIDER_FALLBACKS",
] as const;

const REQUIRED_PACKAGE_SCRIPTS = [
  "build",
  "deploy",
  "deploy:auto",
  "deploy:preflight",
  "typecheck",
  "test:coverage",
  "test:e2e",
  "smoke:api",
  "db:seed",
] as const;

function hasBinding(
  bindings: unknown,
  bindingName: string,
  requiredKeys: string[]
): boolean {
  if (!Array.isArray(bindings)) return false;
  return bindings.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return record.binding === bindingName && requiredKeys.every((key) => typeof record[key] === "string" && record[key] !== "");
  });
}

function packageScripts(packageJson: Record<string, unknown>): Record<string, string> {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object") return {};
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function check(name: string, ok: boolean, message: string, severity: PreflightSeverity = "error"): PreflightCheck {
  return { name, ok, severity, message };
}

export function validateDeploymentConfig(inputs: DeploymentPreflightInputs): DeploymentPreflightResult {
  const scripts = packageScripts(inputs.packageJson);
  const readmeAndDeploymentDoc = `${inputs.readme}\n${inputs.deploymentDoc}`;

  const checks: PreflightCheck[] = [
    check(
      "wrangler app entry",
      typeof inputs.wrangler.name === "string" &&
        typeof inputs.wrangler.main === "string" &&
        typeof (inputs.wrangler.assets as Record<string, unknown> | undefined)?.directory === "string",
      "wrangler.json must define app name, Worker entrypoint, and built asset directory."
    ),
    check(
      "node compatibility",
      Array.isArray(inputs.wrangler.compatibility_flags) && inputs.wrangler.compatibility_flags.includes("nodejs_compat"),
      "wrangler.json must keep nodejs_compat enabled for Prisma, OAuth, and MCP runtime compatibility."
    ),
    check(
      "D1 binding",
      hasBinding(inputs.wrangler.d1_databases, "DB", ["database_name", "database_id"]),
      "wrangler.json must bind Cloudflare D1 as DB with database_name and database_id."
    ),
    check(
      "R2 photos binding",
      hasBinding(inputs.wrangler.r2_buckets, "PHOTOS", ["bucket_name"]),
      "wrangler.json must bind the recipe/profile photo bucket as PHOTOS."
    ),
    check(
      "production node env",
      (inputs.wrangler.vars as Record<string, unknown> | undefined)?.NODE_ENV === "production",
      "wrangler.json vars should set NODE_ENV=production for deploy builds.",
      "warning"
    ),
    check(
      "package scripts",
      REQUIRED_PACKAGE_SCRIPTS.every((script) => script in scripts),
      `package.json must include scripts: ${REQUIRED_PACKAGE_SCRIPTS.join(", ")}.`
    ),
    check(
      "deploy script",
      typeof scripts.deploy === "string" && scripts.deploy.includes("pnpm run build") && scripts.deploy.includes("wrangler deploy"),
      "package.json deploy script must build first and deploy with wrangler. Use pnpm run deploy; bare pnpm deploy is pnpm's workspace deploy command."
    ),
    check(
      "deploy:auto script",
      typeof scripts["deploy:auto"] === "string" &&
        scripts["deploy:auto"].includes("SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight") &&
        scripts["deploy:auto"].includes("pnpm run build") &&
        scripts["deploy:auto"].includes("pnpm exec wrangler d1 migrations apply DB --remote") &&
        scripts["deploy:auto"].includes("pnpm exec wrangler deploy") &&
        scripts["deploy:auto"].indexOf("pnpm exec wrangler d1 migrations apply DB --remote") <
          scripts["deploy:auto"].lastIndexOf("pnpm run deploy:preflight"),
      "package.json deploy:auto must skip only the initial remote preflight, apply D1 migrations, rerun full preflight, then deploy."
    ),
    check(
      "preflight script",
      typeof scripts["deploy:preflight"] === "string" && scripts["deploy:preflight"].includes("deployment-preflight"),
      "package.json must expose deploy:preflight for local and CI production-readiness checks."
    ),
    check(
      "Cloudflare Env typing",
      ["DB", "PHOTOS", ...REQUIRED_SECRET_NAMES, ...IMAGE_PROVIDER_ENV_NAMES].every((name) => inputs.cloudflareEnvDts.includes(`${name}?`)),
      "app/cloudflare-env.d.ts must type all Cloudflare bindings and documented secrets."
    ),
    check(
      "secret documentation",
      REQUIRED_SECRET_NAMES.every((name) => readmeAndDeploymentDoc.includes(name)),
      `README/deployment docs must mention every secret: ${REQUIRED_SECRET_NAMES.join(", ")}.`
    ),
    check(
      "deployment commands",
      [
        "pnpm run deploy:preflight",
        "wrangler d1 migrations apply DB --remote",
        "wrangler r2 bucket create spoonjoy-photos",
        "wrangler secret put SESSION_SECRET",
      ].every((command) => readmeAndDeploymentDoc.includes(command)),
      "Deployment docs must include preflight, D1 migration, R2 bucket, and secret commands."
    ),
    check(
      "telemetry env typing",
      TELEMETRY_SERVER_ENV_NAMES.every((name) => inputs.cloudflareEnvDts.includes(`${name}?`)),
      `app/cloudflare-env.d.ts must type optional telemetry runtime env: ${TELEMETRY_SERVER_ENV_NAMES.join(", ")}.`
    ),
    check(
      "telemetry documentation",
      [
        ...TELEMETRY_CLIENT_ENV_NAMES,
        ...TELEMETRY_SERVER_ENV_NAMES,
        "docs/analytics-privacy.md",
        "server lifecycle telemetry",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "README/deployment docs must explain optional PostHog client and server lifecycle telemetry setup."
    ),
    check(
      "telemetry deployment commands",
      [
        "wrangler secret put POSTHOG_KEY",
        "VITE_POSTHOG_KEY",
        "POSTHOG_DISABLED",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "Deployment docs must show how to enable or intentionally disable PostHog without printing secret values."
    ),
    check(
      "image provider documentation",
      [
        ...IMAGE_PROVIDER_ENV_NAMES,
        "IMAGE_PROVIDER_PRIMARY",
        "IMAGE_PROVIDER_FALLBACKS",
        "gemini-3.1-flash-image",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "README/deployment docs must explain image provider fallback env and Gemini setup."
    ),
    check(
      "migration files",
      inputs.migrationFiles.some((file) => /^\d{4}_.+\.sql$/.test(file)),
      "migrations/ must contain numbered SQL migrations before production deploy."
    ),
  ];

  return {
    checks,
    errors: checks.filter((item) => !item.ok && item.severity === "error"),
    warnings: checks.filter((item) => !item.ok && item.severity === "warning"),
  };
}

export interface WranglerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type RunWrangler = (args: string[]) => Promise<WranglerRunResult>;

export interface RemoteMigrationCheckDeps {
  runWrangler: RunWrangler;
  env?: NodeJS.ProcessEnv;
}

type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
  callback: (
    error: (Error & { code?: number | string }) | null,
    stdout: string,
    stderr: string,
  ) => void,
) => unknown;

export function createWranglerRunner(
  execFileImpl: ExecFileLike = nodeExecFile as unknown as ExecFileLike,
): RunWrangler {
  return (args) =>
    new Promise<WranglerRunResult>((resolve, reject) => {
      execFileImpl("pnpm", ["exec", "wrangler", ...args], {}, (error, stdout, stderr) => {
        if (error) {
          if (typeof error.code === "number") {
            resolve({ stdout, stderr, exitCode: error.code });
            return;
          }
          reject(error);
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      });
    });
}

const RemoteMigrationListSchema = z.array(z.object({ Name: z.string() }));

const AUTH_ERROR_PATTERN = /auth|oauth|login|unauthenticated|api token|10000/i;
const NO_PENDING_MIGRATIONS_PATTERN = /no migrations to apply/i;
const MIGRATION_FILE_PATTERN = /\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g;

function parseRemoteMigrationList(stdout: string): { migrations: { Name: string }[]; error?: string } {
  const trimmed = stdout.trim();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { migrations: [], error: `Could not parse wrangler JSON output: ${message}` };
    }

    const shape = RemoteMigrationListSchema.safeParse(parsedJson);
    if (!shape.success) {
      return {
        migrations: [],
        error: `Unexpected wrangler JSON shape: ${shape.error.issues.map((issue) => issue.message).join("; ")}`,
      };
    }

    return { migrations: shape.data };
  }

  if (NO_PENDING_MIGRATIONS_PATTERN.test(stdout)) {
    return { migrations: [] };
  }

  const names = Array.from(new Set(stdout.match(MIGRATION_FILE_PATTERN) ?? []));
  if (names.length > 0) {
    return { migrations: names.map((Name) => ({ Name })) };
  }

  return {
    migrations: [],
    error: "Could not parse wrangler migration output: expected JSON, a no-migrations message, or migration filenames.",
  };
}

export async function checkRemoteMigrations(deps: RemoteMigrationCheckDeps): Promise<PreflightCheck> {
  const env = deps.env ?? process.env;
  if (env.SPOONJOY_PREFLIGHT_SKIP_REMOTE === "1") {
    return check(
      "remote D1 migrations",
      true,
      "Skipped remote D1 migration check (SPOONJOY_PREFLIGHT_SKIP_REMOTE=1).",
      "warning",
    );
  }

  let result: WranglerRunResult;
  try {
    result = await deps.runWrangler(["d1", "migrations", "list", "DB", "--remote"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return check("remote D1 migrations", false, `Failed to invoke wrangler: ${message}`);
  }

  if (result.exitCode !== 0) {
    if (AUTH_ERROR_PATTERN.test(result.stderr)) {
      return check(
        "remote D1 migrations",
        false,
        `Could not verify remote D1 migrations (wrangler auth error): ${result.stderr.trim()}`,
        "warning",
      );
    }
    return check(
      "remote D1 migrations",
      false,
      `wrangler exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }

  const parsed = parseRemoteMigrationList(result.stdout);
  if (parsed.error) {
    return check("remote D1 migrations", false, parsed.error);
  }

  const pending = parsed.migrations;
  if (pending.length === 0) {
    return check("remote D1 migrations", true, "Remote D1 is up to date — no pending migrations.");
  }

  const names = pending.map((migration) => migration.Name).join(", ");
  return check(
    "remote D1 migrations",
    false,
    `Remote D1 has ${pending.length} pending migration(s): ${names}. Run \`pnpm exec wrangler d1 migrations apply DB --remote\` (or use \`pnpm deploy:auto\`).`,
  );
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

export interface RunDeploymentPreflightDeps {
  runWrangler?: RunWrangler;
  env?: NodeJS.ProcessEnv;
}

export async function runDeploymentPreflight(
  rootDir = process.cwd(),
  deps: RunDeploymentPreflightDeps = {},
): Promise<DeploymentPreflightResult> {
  const [wrangler, packageJson, cloudflareEnvDts, readme, deploymentDoc, migrationFiles] = await Promise.all([
    readJsonFile(path.join(rootDir, "wrangler.json")),
    readJsonFile(path.join(rootDir, "package.json")),
    readFile(path.join(rootDir, "app/cloudflare-env.d.ts"), "utf8"),
    readFile(path.join(rootDir, "README.md"), "utf8"),
    readFile(path.join(rootDir, "docs/deployment.md"), "utf8"),
    readdir(path.join(rootDir, "migrations")),
  ]);

  const baseResult = validateDeploymentConfig({
    wrangler,
    packageJson,
    cloudflareEnvDts,
    readme,
    deploymentDoc,
    migrationFiles,
  });

  const runWrangler = deps.runWrangler ?? createWranglerRunner();
  const remoteCheck = await checkRemoteMigrations({ runWrangler, env: deps.env });

  const checks = [...baseResult.checks, remoteCheck];
  return {
    checks,
    errors: checks.filter((item) => !item.ok && item.severity === "error"),
    warnings: checks.filter((item) => !item.ok && item.severity === "warning"),
  };
}

export function formatCheck(item: PreflightCheck): string {
  const prefix = item.ok ? "PASS" : item.severity === "warning" ? "WARN" : "FAIL";
  return `${prefix} ${item.name}: ${item.message}`;
}

export interface CliIO {
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
}

export interface MainDeps extends RunDeploymentPreflightDeps {
  io?: CliIO;
}

export async function main(deps: MainDeps = {}): Promise<void> {
  const io: CliIO = deps.io ?? {
    log: (message) => {
      console.log(message);
    },
    error: (message) => {
      console.error(message);
    },
    exit: (code) => {
      process.exit(code);
    },
  };

  const result = await runDeploymentPreflight(process.cwd(), {
    runWrangler: deps.runWrangler,
    env: deps.env,
  });
  for (const item of result.checks) {
    io.log(formatCheck(item));
  }

  if (result.errors.length > 0) {
    io.error(`Deployment preflight failed with ${result.errors.length} error(s).`);
    io.exit(1);
    return;
  }

  const warningSuffix = result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : "";
  io.log(`Deployment preflight passed${warningSuffix}.`);
}

export function isCliEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  return path.resolve(argv1) === fileURLToPath(moduleUrl);
}

export interface RunCliIfEntryDeps {
  argv1?: string;
  moduleUrl: string;
  runMain?: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export function runCliIfEntry(deps: RunCliIfEntryDeps): boolean {
  if (!isCliEntry(deps.argv1, deps.moduleUrl)) {
    return false;
  }
  const runMain = deps.runMain ?? main;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Deployment preflight failed: ${message}`);
      process.exit(1);
    });
  runMain().catch(onError);
  return true;
}

runCliIfEntry({ argv1: process.argv[1], moduleUrl: import.meta.url });
