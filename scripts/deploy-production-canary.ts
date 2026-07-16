import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePostHogBuildHost } from "../app/lib/security-headers.server";
import { validateCspHeaderSet } from "./production-readiness";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const TREE_HASH_PATTERN = /^[0-9a-f]{40}$/;
const WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIGRATION_NAME_PATTERN = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;
const MIGRATION_FILE_PATTERN = /\b\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql\b/g;
const NO_PENDING_MIGRATIONS_PATTERN = /no migrations to apply/i;
const RELEASE_ARTIFACT_NAME = "production-release.json";
const CSP_REPORT_ONLY_BREAK_GLASS_ACK = "ACK_REPORT_ONLY_CSP_ROLLBACK";
const DEFAULT_VERIFICATION_ATTEMPTS = 60;
const VERIFICATION_DELAY_MS = 1_000;
const CLOUDFLARE_SECRET_ENV_NAMES = [
  "CF_API_KEY",
  "CF_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_D1_API_TOKEN",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_WORKERS_API_TOKEN",
] as const;

type ReleasePhase =
  | "validate"
  | "provenance"
  | "initial_preflight"
  | "build"
  | "post_build_provenance"
  | "migration_list"
  | "migration_review"
  | "migration_apply"
  | "full_preflight"
  | "current_deployment"
  | "version_snapshot"
  | "version_upload"
  | "version_lookup"
  | "stage"
  | "canary"
  | "candidate_csp"
  | "promote"
  | "verify_promotion"
  | "verify_rollback"
  | "artifact"
  | "complete";

export interface ReleaseCommandResult {
  stdout: string;
  stderr: string;
}

export interface ReleaseCommandOptions {
  env?: NodeJS.ProcessEnv;
}

export type ReleaseCommandRunner = (
  command: string,
  args: readonly string[],
  options?: ReleaseCommandOptions,
) => Promise<ReleaseCommandResult>;

export interface ReleaseArtifact {
  status: "promoted" | "rollback_promoted" | "failed_before_stage" | "rolled_back" | "rollback_failed";
  sourceSha: string;
  phase: ReleasePhase;
  treeHash?: string;
  reviewedMigrations: string[];
  migrationApply: "not_started" | "not_needed" | "attempted" | "succeeded" | "failed";
  databaseRollbackSupported: false;
  previousVersionId?: string;
  candidateVersionId?: string;
  failure?: string;
  rollbackFailure?: string;
}

interface RunProductionCanaryReleaseDeps {
  artifactDir: string;
  env?: NodeJS.ProcessEnv;
  postHogHost: string;
  readCandidateCspHeaders?: (baseUrl: string, candidateVersionId: string) => Promise<Headers>;
  readMigrationFile: (filePath: string) => Promise<string>;
  readPublicWorkerVersion: (baseUrl: string) => Promise<string | null>;
  releaseSha: string;
  runCommand: ReleaseCommandRunner;
  sleep: (milliseconds: number) => Promise<void>;
  verificationAttempts?: number;
  writeReleaseArtifact: (artifact: ReleaseArtifact) => Promise<void>;
}

interface RunProductionRollbackDeps {
  artifactDir: string;
  env?: NodeJS.ProcessEnv;
  postHogHost: string;
  readCandidateCspHeaders: (baseUrl: string, candidateVersionId: string) => Promise<Headers>;
  readPublicWorkerVersion: (baseUrl: string) => Promise<string | null>;
  releaseSha: string;
  rollbackVersionId: string;
  runCommand: ReleaseCommandRunner;
  sleep: (milliseconds: number) => Promise<void>;
  verificationAttempts?: number;
  writeReleaseArtifact: (artifact: ReleaseArtifact) => Promise<void>;
}

type ProductionVerificationDeps = Pick<
  RunProductionCanaryReleaseDeps,
  "env" | "readPublicWorkerVersion" | "runCommand" | "sleep" | "verificationAttempts"
>;

interface ExecFileError extends Error {
  code?: number | string;
}

export type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8"; env?: NodeJS.ProcessEnv; maxBuffer: number },
  callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => unknown;

function requireReleaseSha(value: string): string {
  if (!RELEASE_SHA_PATTERN.test(value)) {
    throw new Error("Production releases require a 40-character lowercase Git SHA.");
  }
  return value;
}

function requireTreeHash(value: string): string {
  if (!TREE_HASH_PATTERN.test(value)) {
    throw new Error("Git did not return a valid lowercase tree hash.");
  }
  return value;
}

function withoutCloudflareSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const name of CLOUDFLARE_SECRET_ENV_NAMES) delete sanitized[name];
  return sanitized;
}

function cloudflareCommandEnv(
  env: NodeJS.ProcessEnv,
  scope: "d1" | "workers",
): NodeJS.ProcessEnv {
  const unifiedToken = env.CLOUDFLARE_API_TOKEN;
  const scopedToken = scope === "d1"
    ? env.CLOUDFLARE_D1_API_TOKEN
    : env.CLOUDFLARE_WORKERS_API_TOKEN;
  const scoped = withoutCloudflareSecrets(env);
  const token = scopedToken ?? unifiedToken;
  if (token) scoped.CLOUDFLARE_API_TOKEN = token;
  return scoped;
}

export async function readPublicWorkerVersion(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const healthUrl = new URL("/health", baseUrl);
  healthUrl.searchParams.set("release_verification", String(Date.now()));
  const response = await fetchImpl(healthUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Public release verification failed with HTTP ${response.status}.`);
  }
  const headerName = "X-Spoonjoy-Worker-Version";
  if (!response.headers.has(headerName)) return null;
  return requireWorkerVersionId(response.headers.get(headerName), "Public release verification");
}

export async function readCandidateCspHeaders(
  baseUrl: string,
  candidateVersionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Headers> {
  requireWorkerVersionId(candidateVersionId, "Candidate CSP verification");
  const verificationUrl = new URL("/", baseUrl);
  verificationUrl.searchParams.set("candidate_csp_verification", "1");
  const response = await fetchImpl(verificationUrl, {
    cache: "no-store",
    headers: {
      Accept: "text/html",
      "Cloudflare-Workers-Version-Overrides": buildWorkerVersionOverride("spoonjoy-v2", candidateVersionId),
    },
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Candidate CSP verification failed with HTTP ${response.status}.`);
  }
  return response.headers;
}

function requireWorkerVersionId(value: unknown, context: string): string {
  if (typeof value !== "string" || !WORKER_VERSION_PATTERN.test(value)) {
    throw new Error(`${context} did not contain a valid Worker version ID.`);
  }
  return value;
}

function parseJsonArray(payload: string, context: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`${context} was not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${context} was not a JSON array.`);
  }
  return parsed;
}

function objectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} contained an invalid row.`);
  }
  return value as Record<string, unknown>;
}

export function parsePendingMigrationNames(payload: string): string[] {
  const trimmed = payload.trim();
  let names: string[];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    names = parseJsonArray(trimmed, "Wrangler migration output").map((row) => {
      const record = objectRecord(row, "Wrangler migration output");
      if (typeof record.Name !== "string") {
        throw new Error("Wrangler migration output contained a row without a Name.");
      }
      return record.Name;
    });
  } else {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const markerIndexes = lines.flatMap((line, index) => (
      line === "Migrations to be applied:" ? [index] : []
    ));
    const mentionedFiles = trimmed.match(MIGRATION_FILE_PATTERN) ?? [];
    if (NO_PENDING_MIGRATIONS_PATTERN.test(trimmed)) {
      if (markerIndexes.length !== 0 || mentionedFiles.length !== 0) {
        throw new Error("Wrangler migration output combined incompatible migration states.");
      }
      names = [];
    } else {
      if (markerIndexes.length !== 1) {
        throw new Error("Wrangler migration output did not contain one exact migration table.");
      }
      const table = lines.slice(markerIndexes[0] + 1);
      const topBorder = /^┌─+┐$/;
      const middleBorder = /^├─+┤$/;
      const bottomBorder = /^└─+┘$/;
      const headerRow = /^│\s*Name\s*│$/;
      if (
        table.length < 5 ||
        !topBorder.test(table[0]) ||
        !headerRow.test(table[1]) ||
        !middleBorder.test(table[2]) ||
        !bottomBorder.test(table.at(-1)!)
      ) {
        throw new Error("Wrangler migration output contained a malformed migration table.");
      }
      names = [];
      for (let index = 3; index < table.length - 1; index += 2) {
        const row = table[index].match(/^│\s*(\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql)\s*│$/);
        if (!row) {
          throw new Error("Wrangler migration output contained a malformed migration row.");
        }
        names.push(row[1]);
        const separator = table[index + 1];
        const isLastSeparator = index + 1 === table.length - 1;
        if (!(isLastSeparator ? bottomBorder : middleBorder).test(separator)) {
          throw new Error("Wrangler migration output contained a malformed migration separator.");
        }
      }
      if (
        mentionedFiles.length !== names.length ||
        mentionedFiles.some((name, index) => name !== names[index])
      ) {
        throw new Error("Wrangler migration output mentioned files outside the validated migration table.");
      }
    }
  }

  const uniqueNames = Array.from(new Set(names));
  for (const name of uniqueNames) {
    if (
      !MIGRATION_NAME_PATTERN.test(name) ||
      name.includes("..")
    ) {
      throw new Error("Wrangler migration output contained an unsafe migration filename.");
    }
  }
  return uniqueNames;
}

interface SanitizedSql {
  sql: string;
  identifiers: Map<string, string>;
}

function sanitizeMigrationSql(sql: string): SanitizedSql {
  let output = "";
  let index = 0;
  let identifierIndex = 0;
  const identifiers = new Map<string, string>();

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) throw new Error("Migration SQL contained an unterminated block comment.");
      output += " ";
      index = end + 2;
      continue;
    }
    if (current === "'") {
      const quote = current;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error("Migration SQL contained an unterminated quoted value.");
      output += " __literal__ ";
      continue;
    }
    if (current === '"' || current === "`" || current === "[") {
      const quote = current;
      const close = current === "[" ? "]" : current;
      let value = "";
      let closed = false;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === close) {
          if (sql[index + 1] === close) {
            value += close;
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += sql[index];
        index += 1;
      }
      if (!closed) {
        const kind = quote === "[" ? "quoted identifier" : "quoted identifier";
        throw new Error(`Migration SQL contained an unterminated ${kind}.`);
      }
      const token = `__identifier_${identifierIndex}__`;
      identifierIndex += 1;
      identifiers.set(token, value.toLowerCase());
      output += ` ${token} `;
      continue;
    }

    output += current;
    index += 1;
  }

  return { sql: output, identifiers };
}

export function assertAdditiveMigrationSql(filename: string, sql: string): void {
  const sanitized = sanitizeMigrationSql(sql);
  const executableSql = sanitized.sql;
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  if (statements.length === 0) {
    throw new Error(`Pending migration ${filename} is not additive and cannot be released automatically.`);
  }

  const identifier = "(?:__identifier_\\d+__|[A-Za-z_][A-Za-z0-9_$]*)";
  const createTable = new RegExp(
    `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${identifier})\\s*\\([\\s\\S]+\\)\\s*(?:(?:WITHOUT\\s+ROWID|STRICT)(?:\\s*,\\s*(?:WITHOUT\\s+ROWID|STRICT))?)?$`,
    "i",
  );
  const createVirtualTable = new RegExp(
    `^CREATE\\s+VIRTUAL\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${identifier})\\s+USING\\s+${identifier}\\s*\\([\\s\\S]+\\)$`,
    "i",
  );
  const createIndex = new RegExp(
    `^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s+ON\\s+(${identifier})\\s*\\([\\s\\S]+\\)(?:\\s+WHERE\\s+[\\s\\S]+)?$`,
    "i",
  );
  const alterAddColumn = new RegExp(
    `^ALTER\\s+TABLE\\s+${identifier}\\s+ADD\\s+(?:COLUMN\\s+)?${identifier}` +
      `(?:\\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|BOOLEAN|DATETIME|BIGINT))?` +
      `(?:\\s+(?:NOT\\s+NULL\\s+)?DEFAULT\\s+(?:__literal__|NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|[-+]?\\d+(?:\\.\\d+)?))?$`,
    "i",
  );
  const canonicalIdentifier = (value: string): string => sanitized.identifiers.get(value) ?? value.toLowerCase();
  const createdTables = new Set<string>();

  for (const statement of statements) {
    const tableMatch = statement.match(createTable) ?? statement.match(createVirtualTable);
    if (tableMatch) createdTables.add(canonicalIdentifier(tableMatch[1]));
  }

  for (const statement of statements) {
    if (createTable.test(statement) || createVirtualTable.test(statement) || alterAddColumn.test(statement)) continue;
    const indexMatch = statement.match(createIndex);
    if (indexMatch) {
      const unique = Boolean(indexMatch[1]);
      const table = canonicalIdentifier(indexMatch[2]);
      if (!unique || createdTables.has(table)) continue;
    }
    throw new Error(`Pending migration ${filename} is not additive and cannot be released automatically.`);
  }
}

export function selectCurrentProductionVersion(payload: string): string {
  const deployments = parseJsonArray(payload, "Wrangler deployment output");
  if (deployments.length === 0) {
    throw new Error("Wrangler deployment output did not contain an active deployment.");
  }

  const parsed = deployments.map((row) => {
    const record = objectRecord(row, "Wrangler deployment output");
    if (typeof record.created_on !== "string" || !Number.isFinite(Date.parse(record.created_on))) {
      throw new Error("Wrangler deployment output contained an invalid creation time.");
    }
    if (!Array.isArray(record.versions)) {
      throw new Error("Wrangler deployment output contained an invalid versions list.");
    }
    return { createdOn: record.created_on, versions: record.versions };
  });

  parsed.sort((left, right) => Date.parse(right.createdOn) - Date.parse(left.createdOn));
  const current = parsed[0];
  if (current.versions.length !== 1) {
    throw new Error("The active production deployment is not a single-version deployment.");
  }

  const version = objectRecord(current.versions[0], "Wrangler deployment output");
  if (version.percentage !== 100) {
    throw new Error("The active production deployment is not serving one version at 100% traffic.");
  }
  return requireWorkerVersionId(version.version_id, "The active production deployment");
}

interface WorkerVersionRow {
  id: string;
  tag: string | null | undefined;
}

function parseWorkerVersions(payload: string): WorkerVersionRow[] {
  const versions = parseJsonArray(payload, "Wrangler version output");
  const parsed = versions.map((row) => {
    const record = objectRecord(row, "Wrangler version output");
    const id = requireWorkerVersionId(record.id, "Wrangler version output");
    const annotations = objectRecord(record.annotations, "Wrangler version output annotations");
    const tag = annotations["workers/tag"];
    if (tag !== null && tag !== undefined && typeof tag !== "string") {
      throw new Error("Wrangler version output contained an invalid tag.");
    }
    const metadata = objectRecord(record.metadata, "Wrangler version output metadata");
    if (typeof metadata.created_on !== "string" || !Number.isFinite(Date.parse(metadata.created_on))) {
      throw new Error("Wrangler version output contained an invalid creation time.");
    }
    if (record.number !== undefined && (typeof record.number !== "number" || !Number.isFinite(record.number))) {
      throw new Error("Wrangler version output contained an invalid version number.");
    }
    return { id, tag };
  });
  if (new Set(parsed.map((version) => version.id)).size !== parsed.length) {
    throw new Error("Wrangler version output contained duplicate version IDs.");
  }
  return parsed;
}

export function selectUploadedVersion(
  beforePayload: string,
  afterPayload: string,
  releaseSha: string,
): string {
  requireReleaseSha(releaseSha);
  const beforeIds = new Set(parseWorkerVersions(beforePayload).map((version) => version.id));
  const candidates = parseWorkerVersions(afterPayload).filter((version) => (
    !beforeIds.has(version.id) && version.tag === releaseSha
  ));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one new Worker version tagged ${releaseSha}.`);
  }
  return candidates[0].id;
}

export function selectKnownTaggedVersion(
  payload: string,
  versionId: string,
  releaseSha: string,
): string {
  requireReleaseSha(releaseSha);
  requireWorkerVersionId(versionId, "Rollback version");
  const matches = parseWorkerVersions(payload).filter((version) => (
    version.id === versionId && version.tag === releaseSha
  ));
  if (matches.length !== 1) {
    throw new Error("Rollback target is not the exact source-tagged Worker version.");
  }
  return matches[0].id;
}

export function buildWorkerVersionOverride(workerName: string, versionId: string): string {
  if (!WORKER_NAME_PATTERN.test(workerName)) {
    throw new Error("Worker name is not valid for a version override.");
  }
  requireWorkerVersionId(versionId, "Worker version override");
  return `${workerName}="${versionId}"`;
}

function sanitizedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function writeFailureArtifact(
  writeReleaseArtifact: (artifact: ReleaseArtifact) => Promise<void>,
  artifact: ReleaseArtifact,
  originalError: unknown,
): Promise<never> {
  try {
    await writeReleaseArtifact(artifact);
  } catch (artifactError) {
    throw new Error(
      `${sanitizedFailure(originalError)} Release artifact write also failed: ${sanitizedFailure(artifactError)}`,
    );
  }
  throw originalError;
}

async function waitForProductionVersion(
  deps: ProductionVerificationDeps,
  expectedVersionId: string,
  workersEnv: NodeJS.ProcessEnv,
  options: { allowLegacyMissingPublicVersion?: boolean } = {},
): Promise<void> {
  requireWorkerVersionId(expectedVersionId, "Production verification");
  const attempts = deps.verificationAttempts ?? DEFAULT_VERIFICATION_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Production verification attempts must be a positive integer.");
  }
  const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
  let consecutiveLegacyControlPlaneMatches = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let deploymentVersion: string | null = null;
    let publicVersion: string | null = null;
    let publicProbeSucceeded = false;
    try {
      const deployments = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--json"],
        { env: workersEnv },
      );
      deploymentVersion = selectCurrentProductionVersion(deployments.stdout);
    } catch {
      deploymentVersion = null;
    }
    try {
      publicVersion = await deps.readPublicWorkerVersion(baseUrl);
      publicProbeSucceeded = true;
    } catch {
      publicVersion = null;
    }
    if (deploymentVersion === expectedVersionId && publicVersion === expectedVersionId) return;
    if (
      options.allowLegacyMissingPublicVersion === true
      && deploymentVersion === expectedVersionId
      && publicProbeSucceeded
      && publicVersion === null
    ) {
      consecutiveLegacyControlPlaneMatches += 1;
      if (consecutiveLegacyControlPlaneMatches >= 2) return;
    } else {
      consecutiveLegacyControlPlaneMatches = 0;
    }
    if (attempt < attempts) await deps.sleep(VERIFICATION_DELAY_MS);
  }

  throw new Error(`Production version did not converge to ${expectedVersionId}.`);
}

export async function runProductionRollback(
  deps: RunProductionRollbackDeps,
): Promise<ReleaseArtifact> {
  let phase: ReleasePhase = "validate";
  let treeHash: string | undefined;
  let previousVersionId: string | undefined;
  let candidateVersionId: string | undefined;
  let deployed = false;
  const baseEnv = { ...(deps.env ?? process.env) };
  const cleanEnv = withoutCloudflareSecrets(baseEnv);
  delete cleanEnv.CLOUDFLARE_ACCOUNT_ID;
  const workersEnv = cloudflareCommandEnv(baseEnv, "workers");

  try {
    const sourceSha = requireReleaseSha(deps.releaseSha);
    const rollbackVersionId = requireWorkerVersionId(deps.rollbackVersionId, "Rollback version");

    phase = "provenance";
    const toolingHead = requireReleaseSha(
      (await deps.runCommand("git", ["rev-parse", "HEAD"], { env: cleanEnv })).stdout.trim(),
    );
    const mainHead = requireReleaseSha(
      (await deps.runCommand("git", ["rev-parse", "origin/main"], { env: cleanEnv })).stdout.trim(),
    );
    if (toolingHead !== mainHead) {
      throw new Error("Rollback tooling is not checked out at current origin/main.");
    }
    const status = await deps.runCommand(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { env: cleanEnv },
    );
    if (status.stdout.trim()) {
      throw new Error("Rollback tooling checkout has tracked changes.");
    }
    treeHash = requireTreeHash(
      (await deps.runCommand("git", ["rev-parse", "HEAD^{tree}"], { env: cleanEnv })).stdout.trim(),
    );

    phase = "version_lookup";
    const versions = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "versions", "list", "--json"],
      { env: workersEnv },
    );
    candidateVersionId = selectKnownTaggedVersion(versions.stdout, rollbackVersionId, sourceSha);

    phase = "current_deployment";
    const deployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    previousVersionId = selectCurrentProductionVersion(deployments.stdout);
    if (candidateVersionId === previousVersionId) {
      throw new Error("The requested rollback version is already active in production.");
    }

    phase = "candidate_csp";
    const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
    const candidateCspHeaders = await deps.readCandidateCspHeaders(baseUrl, candidateVersionId);
    const observedCandidateVersion = candidateCspHeaders.get("X-Spoonjoy-Worker-Version");
    if (observedCandidateVersion?.toLowerCase() !== candidateVersionId.toLowerCase()) {
      throw new Error("Rollback candidate identity could not be verified from the exact-version probe.");
    }
    const cspFailures = validateCspHeaderSet(candidateCspHeaders, {
      expectedWorkerVersionId: candidateVersionId,
      postHogHost: deps.postHogHost,
      requireNonce: true,
    });
    if (
      cspFailures.length > 0 &&
      baseEnv.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS !== CSP_REPORT_ONLY_BREAK_GLASS_ACK
    ) {
      throw new Error(
        `Rollback candidate CSP validation failed: ${cspFailures.join(", ")}. ` +
        `Set SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS=${CSP_REPORT_ONLY_BREAK_GLASS_ACK} only for an intentional insecure-CSP rollback.`,
      );
    }

    phase = "promote";
    deployed = true;
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "deploy", `${candidateVersionId}@100%`, "-y",
      "--message", `Roll back to ${sourceSha}`,
    ], { env: workersEnv });
    phase = "verify_promotion";
    await waitForProductionVersion(deps, candidateVersionId, workersEnv);

    const result: ReleaseArtifact = {
      status: "rollback_promoted",
      sourceSha,
      phase: "complete",
      treeHash,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId,
      candidateVersionId,
    };
    phase = "artifact";
    await deps.writeReleaseArtifact(result);
    return result;
  } catch (error) {
    const sourceSha = RELEASE_SHA_PATTERN.test(deps.releaseSha) ? deps.releaseSha : "invalid";
    const failurePhase = phase;
    const failure = sanitizedFailure(error);
    const artifactBase = {
      sourceSha,
      phase: failurePhase,
      treeHash,
      reviewedMigrations: [],
      migrationApply: "not_needed" as const,
      databaseRollbackSupported: false as const,
      ...(previousVersionId ? { previousVersionId } : {}),
      ...(candidateVersionId ? { candidateVersionId } : {}),
      failure,
    };

    if (deployed && previousVersionId) {
      try {
        await deps.runCommand("pnpm", [
          "exec", "wrangler", "versions", "deploy", `${previousVersionId}@100%`, "-y",
          "--message", `Restore after failed rollback ${sourceSha}`,
        ], { env: workersEnv });
        phase = "verify_rollback";
        await waitForProductionVersion(deps, previousVersionId, workersEnv, {
          allowLegacyMissingPublicVersion: true,
        });
      } catch (rollbackError) {
        const artifact: ReleaseArtifact = {
          status: "rollback_failed",
          ...artifactBase,
          rollbackFailure: sanitizedFailure(rollbackError),
        };
        try {
          await deps.writeReleaseArtifact(artifact);
        } catch (artifactError) {
          throw new Error(
            `${failure} Rollback failed: ${artifact.rollbackFailure}. Release artifact write also failed: ${sanitizedFailure(artifactError)}`,
          );
        }
        throw new Error(`${failure} Rollback failed: ${artifact.rollbackFailure}.`);
      }

      return writeFailureArtifact(deps.writeReleaseArtifact, {
        status: "rolled_back",
        ...artifactBase,
      }, error);
    }

    return writeFailureArtifact(deps.writeReleaseArtifact, {
      status: "failed_before_stage",
      ...artifactBase,
    }, error);
  }
}

export async function runProductionCanaryRelease(
  deps: RunProductionCanaryReleaseDeps,
): Promise<ReleaseArtifact> {
  let phase: ReleasePhase = "validate";
  let treeHash: string | undefined;
  let reviewedMigrations: string[] = [];
  let migrationApply: ReleaseArtifact["migrationApply"] = "not_started";
  let previousVersionId: string | undefined;
  let candidateVersionId: string | undefined;
  let staged = false;
  const baseEnv = { ...(deps.env ?? process.env) };
  const cleanEnv = withoutCloudflareSecrets(baseEnv);
  delete cleanEnv.CLOUDFLARE_ACCOUNT_ID;
  const d1Env = cloudflareCommandEnv(baseEnv, "d1");
  const workersEnv = cloudflareCommandEnv(baseEnv, "workers");

  try {
    const sourceSha = requireReleaseSha(deps.releaseSha);
    const initialEnv = { ...cleanEnv, SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1" };

    phase = "provenance";
    const checkedOutHead = (await deps.runCommand("git", ["rev-parse", "HEAD"], { env: cleanEnv })).stdout.trim();
    if (checkedOutHead !== sourceSha) {
      throw new Error("Checked-out HEAD does not match release SHA.");
    }
    const initialStatus = await deps.runCommand(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { env: cleanEnv },
    );
    if (initialStatus.stdout.trim()) {
      throw new Error("Release checkout has tracked changes.");
    }
    treeHash = requireTreeHash(
      (await deps.runCommand("git", ["rev-parse", "HEAD^{tree}"], { env: cleanEnv })).stdout.trim(),
    );

    phase = "initial_preflight";
    await deps.runCommand("pnpm", ["run", "deploy:preflight"], { env: initialEnv });
    phase = "build";
    await deps.runCommand("pnpm", ["run", "build"], { env: cleanEnv });
    phase = "post_build_provenance";
    const postBuildStatus = await deps.runCommand(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { env: cleanEnv },
    );
    if (postBuildStatus.stdout.trim()) {
      throw new Error("Production build changed tracked files.");
    }

    phase = "migration_list";
    const migrationList = await deps.runCommand("pnpm", [
      "exec", "wrangler", "d1", "migrations", "list", "DB", "--remote",
    ], { env: d1Env });
    reviewedMigrations = parsePendingMigrationNames(migrationList.stdout);
    phase = "migration_review";
    for (const migration of reviewedMigrations) {
      const sql = await deps.readMigrationFile(path.posix.join("migrations", migration));
      assertAdditiveMigrationSql(migration, sql);
    }

    if (reviewedMigrations.length === 0) {
      migrationApply = "not_needed";
    } else {
      phase = "migration_apply";
      migrationApply = "attempted";
      try {
        await deps.runCommand(
          "pnpm",
          ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--remote"],
          { env: d1Env },
        );
        migrationApply = "succeeded";
      } catch (error) {
        migrationApply = "failed";
        throw error;
      }
    }
    phase = "full_preflight";
    await deps.runCommand("pnpm", ["run", "deploy:preflight"], { env: d1Env });

    phase = "current_deployment";
    const deployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    previousVersionId = selectCurrentProductionVersion(deployments.stdout);

    phase = "version_snapshot";
    const versionsBefore = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "versions", "list", "--json"],
      { env: workersEnv },
    );
    phase = "version_upload";
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "upload", "--tag", sourceSha,
      "--message", `Spoonjoy source ${sourceSha}`,
    ], { env: workersEnv });
    phase = "version_lookup";
    const versions = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "versions", "list", "--json"],
      { env: workersEnv },
    );
    candidateVersionId = selectUploadedVersion(versionsBefore.stdout, versions.stdout, sourceSha);
    if (candidateVersionId === previousVersionId) {
      throw new Error("The uploaded candidate is already the active production version.");
    }

    phase = "stage";
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "deploy", `${candidateVersionId}@0%`, `${previousVersionId}@100%`, "-y",
      "--message", `Stage ${sourceSha} for canary`,
    ], { env: workersEnv });
    staged = true;

    phase = "canary";
    await deps.runCommand("pnpm", [
      "run", "smoke:mcp:oauth", "--", "--out", deps.artifactDir, "--worker-version-id", candidateVersionId,
    ], { env: d1Env });

    phase = "candidate_csp";
    const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
    const candidateCspHeaders = await (
      deps.readCandidateCspHeaders ?? readCandidateCspHeaders
    )(baseUrl, candidateVersionId);
    const cspFailures = validateCspHeaderSet(candidateCspHeaders, {
      expectedWorkerVersionId: candidateVersionId,
      postHogHost: deps.postHogHost,
      requireNonce: true,
    });
    if (cspFailures.length > 0) {
      throw new Error(`Candidate CSP validation failed: ${cspFailures.join(", ")}.`);
    }

    phase = "promote";
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "deploy", `${candidateVersionId}@100%`, "-y",
      "--message", `Promote ${sourceSha}`,
    ], { env: workersEnv });
    phase = "verify_promotion";
    await waitForProductionVersion(deps, candidateVersionId, workersEnv);

    const result: ReleaseArtifact = {
      status: "promoted",
      sourceSha,
      phase: "complete",
      treeHash,
      reviewedMigrations,
      migrationApply,
      databaseRollbackSupported: false,
      previousVersionId,
      candidateVersionId,
    };
    phase = "artifact";
    await deps.writeReleaseArtifact(result);
    return result;
  } catch (error) {
    const sourceSha = RELEASE_SHA_PATTERN.test(deps.releaseSha) ? deps.releaseSha : "invalid";
    const failurePhase = phase;
    const failure = sanitizedFailure(error);

    if (staged && previousVersionId) {
      try {
        await deps.runCommand("pnpm", [
          "exec", "wrangler", "versions", "deploy", `${previousVersionId}@100%`, "-y",
          "--message", `Restore after failed ${sourceSha}`,
        ], { env: workersEnv });
        phase = "verify_rollback";
        await waitForProductionVersion(deps, previousVersionId, workersEnv, {
          allowLegacyMissingPublicVersion: true,
        });
      } catch (rollbackError) {
        const artifact: ReleaseArtifact = {
          status: "rollback_failed",
          sourceSha,
          phase: failurePhase,
          treeHash,
          reviewedMigrations,
          migrationApply,
          databaseRollbackSupported: false,
          previousVersionId,
          candidateVersionId,
          failure,
          rollbackFailure: sanitizedFailure(rollbackError),
        };
        try {
          await deps.writeReleaseArtifact(artifact);
        } catch (artifactError) {
          throw new Error(
            `${failure} Rollback failed: ${artifact.rollbackFailure}. Release artifact write also failed: ${sanitizedFailure(artifactError)}`,
          );
        }
        throw new Error(`${failure} Rollback failed: ${artifact.rollbackFailure}.`);
      }

      return writeFailureArtifact(deps.writeReleaseArtifact, {
        status: "rolled_back",
        sourceSha,
        phase: failurePhase,
        treeHash,
        reviewedMigrations,
        migrationApply,
        databaseRollbackSupported: false,
        previousVersionId,
        candidateVersionId,
        failure,
      }, error);
    }

    return writeFailureArtifact(deps.writeReleaseArtifact, {
      status: "failed_before_stage",
      sourceSha,
      phase: failurePhase,
      ...(treeHash ? { treeHash } : {}),
      reviewedMigrations,
      migrationApply,
      databaseRollbackSupported: false,
      ...(previousVersionId ? { previousVersionId } : {}),
      ...(candidateVersionId ? { candidateVersionId } : {}),
      failure,
    }, error);
  }
}

export function createReleaseCommandRunner(
  execFileImpl: ExecFileLike = nodeExecFile as unknown as ExecFileLike,
): ReleaseCommandRunner {
  return (command, args, options) => new Promise((resolve, reject) => {
    execFileImpl(command, args, {
      encoding: "utf8",
      env: options?.env,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const exitCode = error.code === undefined ? "unknown" : String(error.code);
        reject(new Error(`Command failed with exit code ${exitCode}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function writeReleaseArtifactFile(
  artifactDir: string,
  artifact: ReleaseArtifact,
): Promise<void> {
  const sanitized: ReleaseArtifact = {
    status: artifact.status,
    sourceSha: artifact.sourceSha,
    phase: artifact.phase,
    ...(artifact.treeHash ? { treeHash: artifact.treeHash } : {}),
    reviewedMigrations: [...artifact.reviewedMigrations],
    migrationApply: artifact.migrationApply,
    databaseRollbackSupported: false,
    ...(artifact.previousVersionId ? { previousVersionId: artifact.previousVersionId } : {}),
    ...(artifact.candidateVersionId ? { candidateVersionId: artifact.candidateVersionId } : {}),
    ...(artifact.failure ? { failure: sanitizedFailure(artifact.failure) } : {}),
    ...(artifact.rollbackFailure ? { rollbackFailure: sanitizedFailure(artifact.rollbackFailure) } : {}),
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, RELEASE_ARTIFACT_NAME),
    `${JSON.stringify(sanitized, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

interface ReleaseCliOptions {
  artifactDir: string;
  releaseSha: string;
  rollbackVersionId?: string;
}

export function parseReleaseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv): ReleaseCliOptions {
  let artifactDir = "mcp-oauth-canary-artifacts";
  let releaseSha = env.SOURCE_SHA ?? env.GITHUB_SHA ?? "";
  let rollbackVersionId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === "--source-sha" || option === "--artifact-dir" || option === "--rollback-version-id") {
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
      if (option === "--source-sha") releaseSha = value;
      else if (option === "--artifact-dir") artifactDir = value;
      else rollbackVersionId = requireWorkerVersionId(value, "Rollback version");
      index += 1;
      continue;
    }
    throw new Error(`Unknown production release option: ${option}`);
  }

  return {
    artifactDir,
    releaseSha: requireReleaseSha(releaseSha),
    ...(rollbackVersionId ? { rollbackVersionId } : {}),
  };
}

interface ReleaseCliDeps {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  execFileImpl?: ExecFileLike;
  readWranglerConfig?: () => Promise<Record<string, unknown>>;
  readCandidateCspHeaders?: (baseUrl: string, candidateVersionId: string) => Promise<Headers>;
  readMigrationFile?: (filePath: string) => Promise<string>;
  readPublicWorkerVersion?: (baseUrl: string) => Promise<string | null>;
  runCommand?: ReleaseCommandRunner;
  sleep?: (milliseconds: number) => Promise<void>;
  verificationAttempts?: number;
  writeReleaseArtifact?: (artifactDir: string, artifact: ReleaseArtifact) => Promise<void>;
}

export async function runProductionReleaseCli(deps: ReleaseCliDeps): Promise<ReleaseArtifact> {
  const env = deps.env ?? process.env;
  const options = parseReleaseCliOptions(deps.argv ?? [], env);
  const wrangler = await (
    deps.readWranglerConfig ?? (async () => JSON.parse(
      await readFile("wrangler.json", "utf8"),
    ) as Record<string, unknown>)
  )();
  const shared = {
    artifactDir: options.artifactDir,
    env,
    postHogHost: resolvePostHogBuildHost(wrangler),
    readCandidateCspHeaders: deps.readCandidateCspHeaders ?? readCandidateCspHeaders,
    readPublicWorkerVersion: deps.readPublicWorkerVersion ?? readPublicWorkerVersion,
    releaseSha: options.releaseSha,
    runCommand: deps.runCommand ?? createReleaseCommandRunner(deps.execFileImpl),
    sleep: deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    ...(deps.verificationAttempts === undefined ? {} : { verificationAttempts: deps.verificationAttempts }),
    writeReleaseArtifact: (artifact: ReleaseArtifact) => (
      deps.writeReleaseArtifact ?? writeReleaseArtifactFile
    )(options.artifactDir, artifact),
  };
  if (options.rollbackVersionId) {
    return runProductionRollback({ ...shared, rollbackVersionId: options.rollbackVersionId });
  }
  return runProductionCanaryRelease({
    ...shared,
    readMigrationFile: deps.readMigrationFile ?? ((filePath) => readFile(filePath, "utf8")),
  });
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the fully tested function above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  runProductionReleaseCli({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(sanitizedFailure(error));
    process.exitCode = 1;
  });
}
