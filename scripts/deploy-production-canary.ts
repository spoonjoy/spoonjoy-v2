import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePostHogBuildHost } from "../app/lib/security-headers.server";
import { validateCspHeaderSet } from "./production-readiness";
import {
  POSTHOG_CLIENT_BUILD_METADATA_PATH,
  bundledPostHogHostMatches,
  createPostHogBuildContract,
  createPostHogBuildMetadata,
  readPostHogClientBundleSources as readDefaultPostHogClientBundleSources,
} from "./posthog-build-metadata";
import { findUnexpectedWarnings } from "./warning-gate";
import {
  PRODUCT_COMPATIBILITY_SOURCE_SHA,
  PRODUCT_COMPATIBILITY_VERSION_ID,
  PRODUCT_MIGRATION_NAME,
  PRODUCT_MIGRATION_SHA256,
  PRODUCT_PROTOCOL_BOUNDARY_SHA,
  PRODUCT_QA_COMPATIBILITY_SOURCE_SHA,
  PRODUCT_QA_COMPATIBILITY_VERSION_ID,
  assertProductCutoverArtifact,
  assertReviewedMigrationSql,
  readD1RecoveryBookmark,
  readExecutedSkewReceiptFile,
  readForwardRepairSkewReceiptFile,
  readPostRestorationApprovalFile,
  readPostRestorationChainStateFile,
  readProductCutoverSourceRecord as rebuildProductCutoverSourceRecord,
  productRuntimeBundleDigests,
  runProductCutover as executeProductCutover,
  writeProductCutoverArtifactFile,
  type CutoverAttempt,
  type CutoverDeploymentRecord,
  type CutoverEnvironment,
  type CutoverPredecessorRecord,
  type CutoverSourceRecord,
  type ProductCutoverArtifact,
  type ProductCutoverEffects,
} from "./product-cutover";

export * from "./product-cutover";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const TREE_HASH_PATTERN = /^[0-9a-f]{40}$/;
const WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEPLOYMENT_ID_PATTERN = WORKER_VERSION_PATTERN;
const WORKER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIGRATION_NAME_PATTERN = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;
const MIGRATION_FILE_PATTERN = /\b\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql\b/g;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const CLOUDFLARE_API_TOKEN_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const D1_MIGRATIONS_TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const NO_PENDING_MIGRATIONS_PATTERN = /no migrations to apply/i;
const RELEASE_ARTIFACT_NAME = "production-release.json";
const CSP_REPORT_ONLY_BREAK_GLASS_ACK = "ACK_REPORT_ONLY_CSP_ROLLBACK";
const DEFAULT_VERIFICATION_ATTEMPTS = 60;
const VERIFICATION_DELAY_MS = 1_000;
const PUBLIC_OBSERVATION_TIMEOUT_MS = 10_000;
const PROTOCOL_V1_BOUNDARY_MARKER = "workers/cook-session-protocol-v1-boundary";
const GENERATED_WORKER_CONFIG_PATH = "build/server/wrangler.json";
const DEFAULT_PRODUCT_CUTOVER_EVIDENCE_DIR = "product-cutover-evidence";
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
  | "post_build_posthog"
  | "post_build_provenance"
  | "migration_list"
  | "migration_review"
  | "migration_apply"
  | "full_preflight"
  | "current_deployment"
  | "deployment_revalidation"
  | "version_snapshot"
  | "version_upload"
  | "version_lookup"
  | "stage_revalidation"
  | "promotion_revalidation"
  | "rollback_version_lookup"
  | "rollback_current_deployment"
  | "rollback_already_active"
  | "protocol_ancestry"
  | "rollback_protocol_ancestry"
  | "active_version_mapping"
  | "rollback_active_version_mapping"
  | "stage"
  | "canary"
  | "candidate_csp"
  | "promote"
  | "atomic_deploy"
  | "verify_promotion"
  | "verify_rollback"
  | "bootstrap_probe"
  | "artifact"
  | "complete";

type ReleaseMode = "atomic-bootstrap" | "atomic-product-activation" | "protocol-v1-canary";
type DeploymentStrategy = "atomic" | "gradual";

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
  status:
    | "promoted"
    | "rollback_promoted"
    | "failed_before_stage"
    | "rolled_back"
    | "rollback_failed"
    | "forward_repair_required";
  sourceSha: string;
  releaseMode: ReleaseMode;
  deploymentStrategy: DeploymentStrategy;
  protocolV1BoundarySha?: string;
  phase: ReleasePhase;
  treeHash?: string;
  reviewedMigrations: string[];
  migrationApply: "not_started" | "not_needed" | "attempted" | "succeeded" | "failed";
  databaseRollbackSupported: false;
  previousVersionId?: string;
  candidateVersionId?: string;
  failure?: string;
  rollbackFailure?: string;
  cutover?: ProductCutoverArtifact;
}

interface RunProductionCanaryReleaseDeps extends Partial<
  Omit<ProductCutoverEffects, "runCommand" | "commandEnv">
> {
  artifactDir: string;
  d1Fetch?: typeof fetch;
  workerFetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  postHogHost: string;
  readBootstrapProbe?: (
    baseUrl: string,
    expectedVersionId: string,
  ) => Promise<BootstrapProbeResult>;
  readCandidateCspHeaders?: (baseUrl: string, candidateVersionId: string) => Promise<Headers>;
  readClientBuildMetadata?: () => Promise<Record<string, unknown>>;
  readClientBundleSources?: () => Promise<readonly string[]>;
  readGeneratedWorkerConfig?: () => Promise<Record<string, unknown>>;
  readPublicWorkerVersion: (baseUrl: string) => Promise<string | null>;
  releaseSha: string;
  releaseMode: ReleaseMode;
  protocolV1BoundarySha?: string;
  runCommand: ReleaseCommandRunner;
  sleep: (milliseconds: number) => Promise<void>;
  verificationAttempts?: number;
  writeReleaseArtifact: (artifact: ReleaseArtifact) => Promise<void>;
  readProductCutoverSourceRecord?: (
    environment: CutoverEnvironment,
    sourceSha: string,
    versionId: string | null,
  ) => Promise<CutoverSourceRecord>;
  resolveProductCutoverAttempt?: () => Promise<CutoverAttempt>;
  runProductCutover?: typeof executeProductCutover;
}

interface RunProductionRollbackDeps {
  artifactDir: string;
  env?: NodeJS.ProcessEnv;
  postHogHost: string;
  readCandidateCspHeaders: (baseUrl: string, candidateVersionId: string) => Promise<Headers>;
  readPublicWorkerVersion: (baseUrl: string) => Promise<string | null>;
  releaseSha: string;
  releaseMode: ReleaseMode;
  protocolV1BoundarySha?: string;
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

interface BootstrapProbeResult {
  status: number;
  workerVersionHeader: string | null;
  body: unknown;
}

interface ExecFileError extends Error {
  code?: number | string;
}

export type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8"; env?: NodeJS.ProcessEnv; maxBuffer: number },
  callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => unknown;

interface OutputEmitter {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
  on(event: "end" | "close", listener: () => void): unknown;
}

function requireReleaseSha(value: string): string {
  if (!RELEASE_SHA_PATTERN.test(value)) {
    throw new Error("Production releases require a 40-character lowercase Git SHA.");
  }
  return value;
}

function requireReleaseMode(value: unknown): ReleaseMode {
  if (
    value !== "atomic-bootstrap" &&
    value !== "atomic-product-activation" &&
    value !== "protocol-v1-canary"
  ) {
    throw new Error("Production release mode must be explicitly source-controlled.");
  }
  return value;
}

function requireVerificationAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_VERIFICATION_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Production verification attempts must be a positive integer.");
  }
  return attempts;
}

function requireProtocolBoundary(
  releaseMode: ReleaseMode,
  value: string | undefined,
): string | undefined {
  if (releaseMode === "protocol-v1-canary") {
    if (!value || !RELEASE_SHA_PATTERN.test(value)) {
      throw new Error("Protocol-v1 canary mode requires a valid protocol boundary SHA.");
    }
    return value;
  }
  if (value !== undefined && value !== "") {
    throw new Error("Atomic release modes cannot declare a protocol boundary SHA.");
  }
  return undefined;
}

function protocolFields(
  releaseMode: ReleaseMode,
  protocolV1BoundarySha?: string,
): {
  releaseMode: ReleaseMode;
  deploymentStrategy: DeploymentStrategy;
  protocolV1BoundarySha?: string;
} {
  return {
    releaseMode,
    deploymentStrategy: releaseMode === "protocol-v1-canary" ? "gradual" : "atomic",
    ...(protocolV1BoundarySha ? { protocolV1BoundarySha } : {}),
  };
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

async function boundedPublicObservation<T>(read: () => Promise<T>): Promise<T> {
  let timeout!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Public Worker observation timed out."));
        }, PUBLIC_OBSERVATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBootstrapProbe(
  baseUrl: string,
  _expectedVersionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BootstrapProbeResult> {
  const url = new URL("/.well-known/spoonjoy-cook-session-bootstrap", baseUrl);
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Length": "0",
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(PUBLIC_OBSERVATION_TIMEOUT_MS),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Cook-session bootstrap probe returned malformed JSON.");
  }
  return {
    status: response.status,
    workerVersionHeader: response.headers.get("X-Spoonjoy-Worker-Version"),
    body,
  };
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
    signal: AbortSignal.timeout(PUBLIC_OBSERVATION_TIMEOUT_MS),
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

function jsonObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} was not a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

async function readJsonObjectFile(filePath: string, context: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${context} could not be read as JSON: ${sanitizedFailure(error)}`);
  }
  return jsonObject(parsed, context);
}

async function readDefaultGeneratedWorkerConfig(): Promise<Record<string, unknown>> {
  return readJsonObjectFile(GENERATED_WORKER_CONFIG_PATH, "Generated Worker config");
}

async function readDefaultClientBuildMetadata(): Promise<Record<string, unknown>> {
  return readJsonObjectFile(POSTHOG_CLIENT_BUILD_METADATA_PATH, "Generated PostHog metadata");
}

async function validateProductionPostHogArtifacts(
  readGeneratedWorkerConfig: () => Promise<Record<string, unknown>>,
  readClientBuildMetadata: () => Promise<Record<string, unknown>>,
  readClientBundleSources: () => Promise<readonly string[]>,
): Promise<void> {
  const generatedWorkerConfig = await readGeneratedWorkerConfig();
  const clientMetadata = await readClientBuildMetadata();
  const clientBundleSources = await readClientBundleSources();
  const contract = createPostHogBuildContract(generatedWorkerConfig);
  const expectedMetadata = createPostHogBuildMetadata(contract);

  if (canonicalJson(clientMetadata) !== canonicalJson(expectedMetadata)) {
    throw new Error(
      `Generated PostHog metadata does not exactly match the production Worker config for ${contract.postHogHost}.`,
    );
  }
  if (!bundledPostHogHostMatches(clientBundleSources, contract.postHogHost)) {
    throw new Error(
      `Generated client bundle does not contain exactly one PostHog host matching ${contract.postHogHost}.`,
    );
  }
}

async function validateConfiguredPostHogArtifacts(deps: Pick<
  RunProductionCanaryReleaseDeps,
  "readGeneratedWorkerConfig" | "readClientBuildMetadata" | "readClientBundleSources"
>): Promise<void> {
  return validateProductionPostHogArtifacts(
    deps.readGeneratedWorkerConfig ?? readDefaultGeneratedWorkerConfig,
    deps.readClientBuildMetadata ?? readDefaultClientBuildMetadata,
    deps.readClientBundleSources ?? readDefaultPostHogClientBundleSources,
  );
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

interface ProductionTrafficVersion {
  versionId: string;
  percentage: number;
}

interface ProductionDeployment {
  id: string;
  createdAt: number;
  versions: ProductionTrafficVersion[];
}

function requireRfc3339UtcTimestamp(value: unknown, context: string): number {
  if (typeof value !== "string") {
    throw new Error(`${context} contained an invalid creation time.`);
  }
  const match = value.match(RFC3339_UTC_PATTERN);
  if (!match) {
    throw new Error(`${context} contained an invalid creation time.`);
  }
  const [, year, month, day, hour, minute, second, fractional = ""] = match;
  const milliseconds = Number((fractional + "000").slice(0, 3));
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  );
  const parsed = new Date(timestamp);
  if (
    !Number.isFinite(timestamp) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    throw new Error(`${context} contained an invalid creation time.`);
  }
  return timestamp;
}

function requireDeploymentId(value: unknown, context: string): string {
  if (typeof value !== "string" || !DEPLOYMENT_ID_PATTERN.test(value)) {
    throw new Error(`${context} did not contain a valid deployment ID.`);
  }
  return value;
}

function parseCurrentProductionDeployment(payload: string): ProductionDeployment {
  const deployments = parseJsonArray(payload, "Wrangler deployment output");
  if (deployments.length === 0) {
    throw new Error("Wrangler deployment output did not contain an active deployment.");
  }

  const parsed = deployments.map((row) => {
    const record = objectRecord(row, "Wrangler deployment output");
    const id = requireDeploymentId(record.id, "Wrangler deployment output");
    const createdAt = requireRfc3339UtcTimestamp(record.created_on, "Wrangler deployment output");
    if (!Array.isArray(record.versions)) {
      throw new Error("Wrangler deployment output contained an invalid versions list.");
    }
    return { id, createdAt, versions: record.versions };
  });

  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    throw new Error("Wrangler deployment output contained duplicate deployment IDs.");
  }

  parsed.sort((left, right) => right.createdAt - left.createdAt);
  if (
    parsed.length > 1 &&
    parsed[0].createdAt === parsed[1].createdAt
  ) {
    throw new Error("Newest production deployments have an ambiguous timestamp tie.");
  }
  const current = parsed[0];
  const versions = current.versions.map((row) => {
    const version = objectRecord(row, "Wrangler deployment output");
    if (
      typeof version.percentage !== "number" ||
      version.percentage < 0 ||
      version.percentage > 100
    ) {
      throw new Error("Wrangler deployment output contained an invalid traffic percentage.");
    }
    return {
      versionId: requireWorkerVersionId(version.version_id, "The active production deployment"),
      percentage: version.percentage,
    };
  });
  if (versions.length === 0 || new Set(versions.map(({ versionId }) => versionId)).size !== versions.length) {
    throw new Error("Wrangler deployment output contained an invalid active topology.");
  }
  if (versions.reduce((total, version) => total + version.percentage, 0) !== 100) {
    throw new Error("Wrangler deployment output traffic does not total 100 percent.");
  }
  return { id: current.id, createdAt: current.createdAt, versions };
}

function requireOwnedProductionDeployment(
  payload: string,
  expected: Pick<ProductionDeployment, "id" | "versions">,
  failure: string,
): ProductionDeployment {
  const actual = parseCurrentProductionDeployment(payload);
  if (
    actual.id !== expected.id ||
    !productionTopologyMatches(actual.versions, expected.versions)
  ) {
    throw new Error(failure);
  }
  return actual;
}

interface DeploymentMutationOutcome {
  disposition: "created" | "unchanged";
  deployment: ProductionDeployment;
}

async function observeDeploymentMutation(
  deps: ProductionVerificationDeps,
  predecessor: ProductionDeployment,
  expectedVersions: readonly ProductionTrafficVersion[],
  workersEnv: NodeJS.ProcessEnv,
  failure: string,
  forbiddenDeploymentIds: readonly string[] = [],
): Promise<DeploymentMutationOutcome> {
  const attempts = requireVerificationAttempts(deps.verificationAttempts);
  for (let attempt = 1; ; attempt += 1) {
    let result: ReleaseCommandResult;
    try {
      result = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--json"],
        { env: workersEnv },
      );
    } catch (error) {
      if (attempt >= attempts) throw error;
      await deps.sleep(VERIFICATION_DELAY_MS);
      continue;
    }
    let current: ProductionDeployment;
    try {
      current = parseCurrentProductionDeployment(result.stdout);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "Wrangler deployment output was not valid JSON." ||
        attempt >= attempts
      ) {
        throw error;
      }
      await deps.sleep(VERIFICATION_DELAY_MS);
      continue;
    }
    if (
      current.id === predecessor.id &&
      productionTopologyMatches(current.versions, predecessor.versions)
    ) {
      if (attempt < attempts) {
        await deps.sleep(VERIFICATION_DELAY_MS);
        continue;
      }
      return { disposition: "unchanged", deployment: current };
    }
    if (
      current.id === predecessor.id ||
      forbiddenDeploymentIds.includes(current.id) ||
      !productionTopologyMatches(current.versions, expectedVersions)
    ) {
      throw new Error(failure);
    }
    return { disposition: "created", deployment: current };
  }
}

function productionTopologyMatches(
  actual: readonly ProductionTrafficVersion[],
  expected: readonly ProductionTrafficVersion[],
): boolean {
  return actual.length === expected.length &&
    expected.every((expectedVersion) => actual.some((actualVersion) => (
      actualVersion.versionId === expectedVersion.versionId &&
      actualVersion.percentage === expectedVersion.percentage
    )));
}

function restorationDisposition(
  payload: string,
  previousDeployment: ProductionDeployment,
  candidateVersionId: string,
  ownedDeploymentId: string | undefined,
  allowStagedTopology: boolean,
  refusal: string,
): "already_restored" | "restore_required" {
  const actual = parseCurrentProductionDeployment(payload);
  if (
    actual.id === previousDeployment.id &&
    productionTopologyMatches(actual.versions, previousDeployment.versions)
  ) {
    return "already_restored";
  }
  if (
    actual.id === ownedDeploymentId &&
    (
      productionTopologyMatches(actual.versions, [{ versionId: candidateVersionId, percentage: 100 }]) ||
      (allowStagedTopology && productionTopologyMatches(actual.versions, [
      { versionId: candidateVersionId, percentage: 0 },
      { versionId: previousDeployment.versions[0].versionId, percentage: 100 },
      ]))
    )
  ) {
    return "restore_required";
  }
  throw new Error(refusal);
}

export function selectCurrentProductionVersion(payload: string): string {
  const versions = parseCurrentProductionDeployment(payload).versions;
  if (versions.length !== 1) {
    throw new Error("The active production deployment is not a single-version deployment.");
  }
  return versions[0].versionId;
}

interface WorkerVersionRow {
  id: string;
  tag: string | null | undefined;
}

interface WorkerVersionDetail extends WorkerVersionRow {
  createdAt: number;
  source: string;
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
    requireRfc3339UtcTimestamp(metadata.created_on, "Wrangler version output");
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

function parseWorkerVersionDetail(payload: string, expectedVersionId: string): WorkerVersionDetail {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Wrangler version output was not valid JSON.");
  }
  const record = objectRecord(parsed, "Wrangler version output");
  const id = requireWorkerVersionId(record.id, "Wrangler version output");
  if (id !== expectedVersionId) {
    throw new Error("Wrangler version output did not match the requested Worker version ID.");
  }
  if (typeof record.number !== "number" || !Number.isFinite(record.number)) {
    throw new Error("Wrangler version output contained an invalid version number.");
  }
  const annotations = objectRecord(record.annotations, "Wrangler version output annotations");
  const tag = annotations["workers/tag"];
  if (tag !== null && tag !== undefined && typeof tag !== "string") {
    throw new Error("Wrangler version output contained an invalid tag.");
  }
  const metadata = objectRecord(record.metadata, "Wrangler version output metadata");
  const createdAt = requireRfc3339UtcTimestamp(metadata.created_on, "Wrangler version output");
  if (typeof metadata.source !== "string" || metadata.source.trim() === "") {
    throw new Error("Wrangler version output contained an invalid source.");
  }
  return { id, tag, createdAt, source: metadata.source };
}

function selectExactVersionSourceSha(payload: string, versionId: string): string {
  try {
    const candidate = JSON.parse(payload) as unknown;
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      !("id" in candidate)
    ) {
      throw new Error("Active Worker version is missing from Worker version inventory.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("missing from Worker version inventory")) {
      throw error;
    }
  }
  const version = parseWorkerVersionDetail(payload, versionId);
  if (version.tag === null || version.tag === undefined || version.tag === "") {
    throw new Error("Active Worker version is not source-tagged.");
  }
  if (!RELEASE_SHA_PATTERN.test(version.tag)) {
    throw new Error("Active Worker version has a malformed source tag.");
  }
  return version.tag;
}

function requireExactTaggedVersion(
  payload: string,
  versionId: string,
  releaseSha: string,
): string {
  try {
    const candidate = JSON.parse(payload) as unknown;
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      !("id" in candidate)
    ) {
      throw new Error("Rollback target is not the exact source-tagged Worker version.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Rollback target")) throw error;
  }
  const version = parseWorkerVersionDetail(payload, versionId);
  if (version.tag !== releaseSha) {
    throw new Error("Rollback target is not the exact source-tagged Worker version.");
  }
  return version.id;
}

async function requireProtocolBoundaryMarker(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  configuredBoundarySha: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const result = await deps.runCommand("git", [
    "log",
    "--diff-filter=A",
    "--format=%H",
    "--reverse",
    "--",
    PROTOCOL_V1_BOUNDARY_MARKER,
  ], { env });
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1 || !RELEASE_SHA_PATTERN.test(lines[0])) {
    throw new Error("Git did not return one exact protocol-v1 boundary marker commit.");
  }
  if (lines[0] !== configuredBoundarySha) {
    throw new Error("Configured protocol-v1 boundary marker commit does not match Git history.");
  }
}

async function requireAncestor(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  boundarySha: string,
  sourceSha: string,
  env: NodeJS.ProcessEnv,
  failure: string,
): Promise<void> {
  try {
    await deps.runCommand(
      "git",
      ["merge-base", "--is-ancestor", boundarySha, sourceSha],
      { env },
    );
  } catch {
    throw new Error(failure);
  }
}

interface ReviewedMigration {
  name: string;
  sha256: string;
  sql: string;
}

interface ProductionD1Config {
  databaseId: string;
  migrationsTable: string;
}

function migrationContentHash(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

async function readImmutableMigration(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return (await deps.runCommand("git", ["show", `HEAD:migrations/${name}`], { env })).stdout;
}

function requireD1Config(
  payload: string,
  environment: CutoverEnvironment,
): ProductionD1Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    throw new Error("Immutable Wrangler configuration was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Immutable Wrangler configuration was not an object.");
  }
  const root = parsed as Record<string, unknown>;
  let config: Record<string, unknown> = root;
  if (environment === "qa") {
    const environments = objectRecord(root.env, "Immutable Wrangler QA environments");
    config = objectRecord(environments.qa, "Immutable Wrangler QA configuration");
  }
  const databases = config.d1_databases;
  if (!Array.isArray(databases)) {
    throw new Error(`Immutable Wrangler configuration did not declare ${environment} D1 bindings.`);
  }
  const productionBindings = databases.filter((entry) => (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>).binding === "DB"
  ));
  if (productionBindings.length !== 1) {
    throw new Error(`Immutable Wrangler configuration must declare exactly one ${environment} DB binding.`);
  }
  const binding = productionBindings[0] as Record<string, unknown>;
  const databaseId = binding.database_id;
  if (typeof databaseId !== "string" || !WORKER_VERSION_PATTERN.test(databaseId)) {
    throw new Error(`Immutable Wrangler configuration contained an invalid ${environment} D1 database UUID.`);
  }
  const migrationsTable = binding.migrations_table ?? "d1_migrations";
  if (typeof migrationsTable !== "string" || !D1_MIGRATIONS_TABLE_PATTERN.test(migrationsTable)) {
    throw new Error("Immutable Wrangler configuration contained an invalid D1 migrations table.");
  }
  return { databaseId, migrationsTable };
}

function requireProductionD1Config(payload: string): ProductionD1Config {
  return requireD1Config(payload, "production");
}

async function readImmutableProductionD1Config(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  env: NodeJS.ProcessEnv,
): Promise<ProductionD1Config> {
  const result = await deps.runCommand("git", ["show", "HEAD:wrangler.json"], { env });
  return requireProductionD1Config(result.stdout);
}

async function readImmutableD1Config(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  env: NodeJS.ProcessEnv,
  environment: CutoverEnvironment,
): Promise<ProductionD1Config> {
  const result = await deps.runCommand("git", ["show", "HEAD:wrangler.json"], { env });
  return requireD1Config(result.stdout, environment);
}

function requireProductionD1Credentials(env: NodeJS.ProcessEnv): {
  accountId: string;
  token: string;
} {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("Production D1 mutation requires a valid Cloudflare account ID.");
  }
  if (!token || !CLOUDFLARE_API_TOKEN_PATTERN.test(token)) {
    throw new Error("Production D1 mutation requires a valid scoped Cloudflare API token.");
  }
  return { accountId, token };
}

function migrationBatchQuery(
  migrations: readonly ReviewedMigration[],
  migrationsTable: string,
): string {
  return migrations.map((migration) => {
    const encodedName = migration.name.replaceAll("'", "''");
    return `${migration.sql}
								INSERT INTO ${migrationsTable} (name)
								values ('${encodedName}');
						`;
  }).join("\n");
}

async function applyReviewedMigrations(
  migrations: readonly ReviewedMigration[],
  config: ProductionD1Config,
  credentials: { accountId: string; token: string },
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/d1/database/${config.databaseId}/query`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: migrationBatchQuery(migrations, config.migrationsTable) }),
    });
  } catch {
    throw new Error("Cloudflare D1 migration query request failed.");
  }
  if (!response.ok) {
    throw new Error(`Cloudflare D1 migration query failed with HTTP ${response.status}.`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Cloudflare D1 migration query returned malformed JSON.");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    (payload as Record<string, unknown>).success !== true ||
    !Array.isArray((payload as Record<string, unknown>).errors) ||
    ((payload as Record<string, unknown>).errors as unknown[]).length !== 0 ||
    !Array.isArray((payload as Record<string, unknown>).result) ||
    ((payload as Record<string, unknown>).result as unknown[]).length === 0 ||
    ((payload as Record<string, unknown>).result as unknown[]).some((result) => (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      (result as Record<string, unknown>).success !== true
    ))
  ) {
    throw new Error("Cloudflare D1 migration query did not report complete success.");
  }
}

function migrationNamesMatch(
  actual: readonly string[],
  expected: readonly ReviewedMigration[],
): boolean {
  return actual.length === expected.length &&
    actual.every((name, index) => name === expected[index].name);
}

async function requireReviewedMigrationState(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  reviewed: readonly ReviewedMigration[],
  expectedTreeHash: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const currentTreeHash = requireTreeHash(
    (await deps.runCommand("git", ["rev-parse", "HEAD^{tree}"], { env })).stdout.trim(),
  );
  if (currentTreeHash !== expectedTreeHash) {
    throw new Error("Tracked release tree changed during D1 migration apply.");
  }
  const status = await deps.runCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { env },
  );
  if (status.stdout.trim()) {
    throw new Error("Tracked release files changed during D1 migration apply.");
  }
  for (const migration of reviewed) {
    const currentSql = await readImmutableMigration(deps, migration.name, env);
    if (migrationContentHash(currentSql) !== migration.sha256) {
      throw new Error("Reviewed migration bytes changed during D1 migration apply.");
    }
  }
}

function assertBootstrapProbe(
  result: BootstrapProbeResult,
  expectedVersionId: string,
): void {
  const body = result.body;
  const validBody = Boolean(
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).sort().join(",") === "ok,residue,storage,workerVersionId" &&
    (body as Record<string, unknown>).ok === true &&
    (body as Record<string, unknown>).storage === "sqlite" &&
    (body as Record<string, unknown>).residue === 0 &&
    (body as Record<string, unknown>).workerVersionId === expectedVersionId
  );
  if (
    result.status !== 200 ||
    result.workerVersionHeader !== expectedVersionId ||
    !validBody
  ) {
    throw new Error("Cook-session bootstrap probe did not match the deployed Worker version.");
  }
}

async function waitForBootstrapProbe(
  deps: Pick<
    RunProductionCanaryReleaseDeps,
    "readBootstrapProbe" | "sleep" | "verificationAttempts"
  >,
  baseUrl: string,
  expectedVersionId: string,
): Promise<void> {
  const attempts = requireVerificationAttempts(deps.verificationAttempts);
  const probe = deps.readBootstrapProbe ?? readBootstrapProbe;

  for (let observation = 0; observation < 2; observation += 1) {
    let observationVerified = false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        assertBootstrapProbe(
          await boundedPublicObservation(() => probe(baseUrl, expectedVersionId)),
          expectedVersionId,
        );
        observationVerified = true;
        break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts) await deps.sleep(VERIFICATION_DELAY_MS);
    }
    if (!observationVerified) throw lastError;
  }
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

export function buildWorkerVersionOverride(workerName: string, versionId: string): string {
  if (!WORKER_NAME_PATTERN.test(workerName)) {
    throw new Error("Worker name is not valid for a version override.");
  }
  requireWorkerVersionId(versionId, "Worker version override");
  return `${workerName}="${versionId}"`;
}

function cloudflareCredentialValues(env: NodeJS.ProcessEnv): string[] {
  return [...new Set(CLOUDFLARE_SECRET_ENV_NAMES
    .map((name) => env[name])
    .filter((value): value is string => typeof value === "string" && value.length > 0))]
    .sort((left, right) => right.length - left.length);
}

function redactSensitiveText(
  value: string,
  credentialValues: readonly string[] = [],
): string {
  let message = value;
  for (const credential of credentialValues) {
    message = message.split(credential).join("[REDACTED]");
  }
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(authorization)\s*[=:]\s*[^\r\n]+/gi, "$1=[REDACTED]")
    .replace(/\b(token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
}

function sanitizedFailure(error: unknown, credentialValues: readonly string[] = []): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message, credentialValues)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function isOutputEmitter(value: unknown): value is OutputEmitter {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { on?: unknown }).on === "function",
  );
}

function streamCommandOutput(
  stream: unknown,
  write: (chunk: string) => boolean,
): () => void {
  if (!isOutputEmitter(stream)) return () => undefined;
  let pending = "";

  const flush = () => {
    if (pending === "") return;
    write(redactSensitiveText(pending));
    pending = "";
  };

  stream.on("data", (chunk) => {
    pending += String(chunk);
    const finalNewline = pending.lastIndexOf("\n");
    if (finalNewline === -1) return;

    let complete = pending.slice(0, finalNewline + 1);
    pending = pending.slice(finalNewline + 1);
    const danglingCredentialPrefix = complete.match(
      /\b(?:Bearer\s+|(?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*)$/i,
    );
    if (danglingCredentialPrefix?.index !== undefined) {
      pending = complete.slice(danglingCredentialPrefix.index) + pending;
      complete = complete.slice(0, danglingCredentialPrefix.index);
    }
    if (complete !== "") write(redactSensitiveText(complete));
  });
  stream.on("end", flush);
  stream.on("close", flush);
  return flush;
}

async function writeFailureArtifact(
  writeReleaseArtifact: (artifact: ReleaseArtifact) => Promise<void>,
  artifact: ReleaseArtifact,
  originalError: unknown,
  sanitize: (error: unknown) => string,
): Promise<never> {
  try {
    await writeReleaseArtifact(artifact);
  } catch (artifactError) {
    throw new Error(
      `${sanitize(originalError)} Release artifact write also failed: ${sanitize(artifactError)}`,
    );
  }
  throw new Error(sanitize(originalError));
}

function isDeploymentOwnershipObservationFailure(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "Production deployment identity changed during verification." ||
    error.message.startsWith("Wrangler deployment output") ||
    error.message.startsWith("The active production deployment") ||
    error.message.startsWith("Newest production deployments")
  );
}

async function waitForProductionDeployment(
  deps: ProductionVerificationDeps,
  expectedDeployment: Pick<ProductionDeployment, "id" | "versions">,
  workersEnv: NodeJS.ProcessEnv,
  options: {
    requiredConsecutiveMatches?: number;
  } = {},
): Promise<void> {
  const expectedVersionId = expectedDeployment.versions[0]?.versionId;
  requireWorkerVersionId(expectedVersionId, "Production verification");
  const attempts = requireVerificationAttempts(deps.verificationAttempts);
  const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
  const requiredMatches = options.requiredConsecutiveMatches ?? 1;
  let consecutiveMatches = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let deploymentVersion: string | null = null;
    let publicVersion: string | null = null;
    let publicProbeSucceeded = false;
    let deployments: ReleaseCommandResult | undefined;
    try {
      deployments = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--json"],
        { env: workersEnv },
      );
    } catch {
      deployments = undefined;
    }
    if (deployments) {
      try {
        const deployment = parseCurrentProductionDeployment(deployments.stdout);
        if (deployment.id !== expectedDeployment.id) {
          throw new Error("Production deployment identity changed during verification.");
        }
        if (productionTopologyMatches(deployment.versions, expectedDeployment.versions)) {
          deploymentVersion = expectedVersionId;
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "Wrangler deployment output was not valid JSON."
        ) {
          throw error;
        }
      }
    }
    try {
      publicVersion = await boundedPublicObservation(() => deps.readPublicWorkerVersion(baseUrl));
      publicProbeSucceeded = true;
    } catch {
      publicVersion = null;
    }
    if (
      deploymentVersion === expectedVersionId &&
      publicProbeSucceeded &&
      publicVersion === expectedVersionId
    ) {
      consecutiveMatches += 1;
      if (consecutiveMatches >= requiredMatches) return;
    } else {
      consecutiveMatches = 0;
    }
    if (attempt < attempts) await deps.sleep(VERIFICATION_DELAY_MS);
  }

  throw new Error(`Production version did not converge to ${expectedVersionId}.`);
}

async function restoreOwnedProductionDeployment(
  deps: ProductionVerificationDeps,
  previousDeployment: ProductionDeployment,
  ownedDeployment: ProductionDeployment,
  workersEnv: NodeJS.ProcessEnv,
  message: string,
): Promise<void> {
  const previousVersionId = previousDeployment.versions[0]?.versionId;
  requireWorkerVersionId(previousVersionId, "Restoration target");
  let commandError: unknown;
  try {
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "deploy", `${previousVersionId}@100%`, "-y",
      "--message", message,
    ], { env: workersEnv });
  } catch (error) {
    commandError = error;
  }

  const outcome = await observeDeploymentMutation(
    deps,
    ownedDeployment,
    previousDeployment.versions,
    workersEnv,
    "Restoration did not create the expected production deployment.",
    [previousDeployment.id],
  );
  if (outcome.disposition === "unchanged") {
    if (commandError) throw commandError;
    throw new Error("Restoration did not create the expected production deployment.");
  }
  await waitForProductionDeployment(deps, outcome.deployment, workersEnv, {
    requiredConsecutiveMatches: 2,
  });
}

async function waitForCandidateCspHeaders(
  deps: RunProductionRollbackDeps,
  baseUrl: string,
  candidateVersionId: string,
): Promise<Headers> {
  const attempts = requireVerificationAttempts(deps.verificationAttempts);

  let lastError: unknown = new Error(
    "Rollback candidate identity could not be verified from the exact-version probe.",
  );
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = await boundedPublicObservation(() => (
        deps.readCandidateCspHeaders(baseUrl, candidateVersionId)
      ));
      const observedVersion = headers.get("X-Spoonjoy-Worker-Version");
      if (observedVersion?.toLowerCase() === candidateVersionId.toLowerCase()) return headers;
      lastError = new Error(
        "Rollback candidate identity could not be verified from the exact-version probe.",
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await deps.sleep(VERIFICATION_DELAY_MS);
  }

  throw lastError;
}

export async function runProductionRollback(
  deps: RunProductionRollbackDeps,
): Promise<ReleaseArtifact> {
  const releaseMode = requireReleaseMode(deps.releaseMode);
  if (releaseMode !== "protocol-v1-canary") {
    throw new Error("Production rollback is only available in protocol-v1-canary mode.");
  }
  const protocolV1BoundarySha = requireProtocolBoundary(
    releaseMode,
    deps.protocolV1BoundarySha,
  )!;
  const sourceSha = requireReleaseSha(deps.releaseSha);
  const rollbackVersionId = requireWorkerVersionId(deps.rollbackVersionId, "Rollback version");
  const metadata = protocolFields(releaseMode, protocolV1BoundarySha);
  let phase: ReleasePhase = "validate";
  let treeHash: string | undefined;
  let previousVersionId: string | undefined;
  let candidateVersionId: string | undefined;
  let previousDeployment: ProductionDeployment | undefined;
  let stagedDeployment: ProductionDeployment | undefined;
  let rollbackDeployment: ProductionDeployment | undefined;
  let staged = false;
  let rollbackMutationOwnershipLost = false;
  const baseEnv = { ...(deps.env ?? process.env) };
  const sanitize = (error: unknown) => sanitizedFailure(error, cloudflareCredentialValues(baseEnv));
  const cleanEnv = withoutCloudflareSecrets(baseEnv);
  delete cleanEnv.CLOUDFLARE_ACCOUNT_ID;
  const workersEnv = cloudflareCommandEnv(baseEnv, "workers");

  try {
    requireVerificationAttempts(deps.verificationAttempts);

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
    const provenanceTreeHash = requireTreeHash(
      (await deps.runCommand("git", ["rev-parse", "HEAD^{tree}"], { env: cleanEnv })).stdout.trim(),
    );
    await requireProtocolBoundaryMarker(deps, protocolV1BoundarySha, cleanEnv);
    treeHash = provenanceTreeHash;

    phase = "rollback_version_lookup";
    const candidateVersion = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "versions", "view", rollbackVersionId, "--json"],
      { env: workersEnv },
    );
    candidateVersionId = requireExactTaggedVersion(
      candidateVersion.stdout,
      rollbackVersionId,
      sourceSha,
    );

    phase = "rollback_current_deployment";
    const deployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    previousDeployment = parseCurrentProductionDeployment(deployments.stdout);
    previousVersionId = selectCurrentProductionVersion(deployments.stdout);
    if (candidateVersionId === previousVersionId) {
      phase = "rollback_already_active";
      throw new Error("The requested rollback version is already active in production.");
    }

    phase = "rollback_active_version_mapping";
    const previousVersion = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "versions", "view", previousVersionId, "--json"],
      { env: workersEnv },
    );
    const previousSourceSha = selectExactVersionSourceSha(previousVersion.stdout, previousVersionId);
    phase = "rollback_protocol_ancestry";
    await requireAncestor(
      deps,
      protocolV1BoundarySha,
      sourceSha,
      cleanEnv,
      "Rollback target source is below the protocol-v1 boundary.",
    );
    await requireAncestor(
      deps,
      protocolV1BoundarySha,
      previousSourceSha,
      cleanEnv,
      "Current Worker source is below the protocol-v1 boundary.",
    );

    phase = "rollback_current_deployment";
    const currentDeployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    requireOwnedProductionDeployment(
      currentDeployments.stdout,
      previousDeployment,
      "Active production version changed during rollback.",
    );

    phase = "stage";
    staged = true;
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "deploy",
      `${candidateVersionId}@0%`, `${previousVersionId}@100%`, "-y",
      "--message", `Stage rollback ${sourceSha} for inspection`,
    ], { env: workersEnv });
    let stageOutcome: DeploymentMutationOutcome;
    try {
      stageOutcome = await observeDeploymentMutation(
        deps,
        previousDeployment,
        [
          { versionId: candidateVersionId, percentage: 0 },
          { versionId: previousVersionId, percentage: 100 },
        ],
        workersEnv,
        "Rollback inspection stage did not create the expected production deployment.",
      );
    } catch (error) {
      rollbackMutationOwnershipLost = true;
      throw error;
    }
    if (stageOutcome.disposition === "unchanged") {
      throw new Error("Rollback inspection stage did not create the expected production deployment.");
    }
    stagedDeployment = stageOutcome.deployment;

    phase = "candidate_csp";
    const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
    const candidateCspHeaders = await waitForCandidateCspHeaders(
      deps,
      baseUrl,
      candidateVersionId,
    );
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

    phase = "promotion_revalidation";
    const prePromotionDeployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    requireOwnedProductionDeployment(
      prePromotionDeployments.stdout,
      stagedDeployment,
      "Rollback inspection topology changed before promotion.",
    );

    phase = "promote";
    await deps.runCommand("pnpm", [
      "exec", "wrangler", "versions", "deploy", `${candidateVersionId}@100%`, "-y",
      "--message", `Roll back to ${sourceSha}`,
    ], { env: workersEnv });
    let rollbackOutcome: DeploymentMutationOutcome;
    try {
      rollbackOutcome = await observeDeploymentMutation(
        deps,
        stagedDeployment,
        [{ versionId: candidateVersionId, percentage: 100 }],
        workersEnv,
        "Rollback did not create the expected production deployment.",
      );
    } catch (error) {
      rollbackMutationOwnershipLost = true;
      throw error;
    }
    if (rollbackOutcome.disposition === "unchanged") {
      throw new Error("Rollback did not create the expected production deployment.");
    }
    rollbackDeployment = rollbackOutcome.deployment;
    phase = "verify_promotion";
    await waitForProductionDeployment(deps, rollbackDeployment, workersEnv);

    const result: ReleaseArtifact = {
      status: "rollback_promoted",
      sourceSha,
      ...metadata,
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
    if (phase === "verify_promotion" && isDeploymentOwnershipObservationFailure(error)) {
      rollbackMutationOwnershipLost = true;
    }
    const failurePhase = phase;
    const failure = sanitize(error);
    const artifactBase = {
      sourceSha,
      ...metadata,
      phase: failurePhase,
      treeHash,
      reviewedMigrations: [],
      migrationApply: "not_needed" as const,
      databaseRollbackSupported: false as const,
      ...(previousVersionId ? { previousVersionId } : {}),
      ...(candidateVersionId ? { candidateVersionId } : {}),
      failure,
    };

    if (staged && previousVersionId && candidateVersionId && previousDeployment) {
      const restorationRefusal =
        "Automatic restoration refused because production no longer matched the rollback deployment.";
      let disposition: "already_restored" | "restore_required";
      try {
        if (rollbackMutationOwnershipLost) throw new Error(restorationRefusal);
        if (!stagedDeployment) {
          const stageOutcome = await observeDeploymentMutation(
            deps,
            previousDeployment,
            [
              { versionId: candidateVersionId, percentage: 0 },
              { versionId: previousVersionId, percentage: 100 },
            ],
            workersEnv,
            restorationRefusal,
          );
          if (stageOutcome.disposition === "unchanged") {
            staged = false;
          } else {
            stagedDeployment = stageOutcome.deployment;
          }
        }
        if (staged && stagedDeployment && !rollbackDeployment && phase === "promote") {
          const promotionOutcome = await observeDeploymentMutation(
            deps,
            stagedDeployment,
            [{ versionId: candidateVersionId, percentage: 100 }],
            workersEnv,
            restorationRefusal,
          );
          if (promotionOutcome.disposition === "created") {
            rollbackDeployment = promotionOutcome.deployment;
          }
        }
        if (staged) {
          const currentDeployments = await deps.runCommand(
            "pnpm",
            ["exec", "wrangler", "deployments", "list", "--json"],
            { env: workersEnv },
          );
          disposition = restorationDisposition(
            currentDeployments.stdout,
            previousDeployment,
            candidateVersionId,
            (rollbackDeployment ?? stagedDeployment)!.id,
            true,
            restorationRefusal,
          );
          if (disposition === "already_restored") staged = false;
        } else {
          disposition = "already_restored";
        }
      } catch {
        const artifact: ReleaseArtifact = {
          status: "rollback_failed",
          ...artifactBase,
          rollbackFailure: restorationRefusal,
        };
        try {
          await deps.writeReleaseArtifact(artifact);
        } catch (artifactError) {
          throw new Error(
            `${failure} Rollback failed: ${restorationRefusal}. Release artifact write also failed: ${sanitize(artifactError)}`,
          );
        }
        throw new Error(`${failure} Rollback failed: ${restorationRefusal}.`);
      }

      try {
        if (staged && disposition === "restore_required") {
          await restoreOwnedProductionDeployment(
            deps,
            previousDeployment,
            (rollbackDeployment ?? stagedDeployment)!,
            workersEnv,
            `Restore after failed rollback ${sourceSha}`,
          );
        } else {
          await waitForProductionDeployment(deps, previousDeployment, workersEnv, {
            requiredConsecutiveMatches: 2,
          });
        }
        phase = "verify_rollback";
      } catch (rollbackError) {
        const artifact: ReleaseArtifact = {
          status: "rollback_failed",
          ...artifactBase,
          rollbackFailure: sanitize(rollbackError),
        };
        try {
          await deps.writeReleaseArtifact(artifact);
        } catch (artifactError) {
          throw new Error(
            `${failure} Rollback failed: ${artifact.rollbackFailure}. Release artifact write also failed: ${sanitize(artifactError)}`,
          );
        }
        throw new Error(`${failure} Rollback failed: ${artifact.rollbackFailure}.`);
      }

      return writeFailureArtifact(deps.writeReleaseArtifact, {
        status: "rolled_back",
        ...artifactBase,
      }, error, sanitize);
    }

    return writeFailureArtifact(deps.writeReleaseArtifact, {
      status: "failed_before_stage",
      ...artifactBase,
    }, error, sanitize);
  }
}

async function readPersistedProductCutover(
  artifactDir: string,
  environment: CutoverEnvironment,
): Promise<ProductCutoverArtifact | null> {
  const filename = environment === "production"
    ? "production-product-cutover-state.json"
    : "qa-product-release.json";
  try {
    const envelope = objectRecord(
      JSON.parse(await readFile(path.join(artifactDir, filename), "utf8")),
      "Product cutover artifact",
    );
    if (envelope.cutover === undefined) return null;
    const artifact = envelope.cutover as ProductCutoverArtifact;
    assertProductCutoverArtifact(artifact);
    return artifact;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readProductProtocolBoundarySha(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await deps.runCommand("git", [
    "log", "--diff-filter=A", "--format=%H", "--reverse", "--", PROTOCOL_V1_BOUNDARY_MARKER,
  ], { env });
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return PRODUCT_PROTOCOL_BOUNDARY_SHA;
  if (lines.length !== 1) {
    throw new Error("Git did not return one exact product protocol boundary commit.");
  }
  return requireReleaseSha(lines[0]);
}

function exactPredecessor(source: CutoverSourceRecord): CutoverPredecessorRecord {
  return {
    relationship: "exact",
    canonicalSourceSha: source.sourceSha,
    canonicalTreeSha: source.treeSha,
    canonicalWorkerBundleSha256: source.workerBundleSha256,
    canonicalDurableObjectBundleSha256: source.durableObjectBundleSha256,
    lineageParentSourceSha: source.sourceSha,
    runtimeFloorSourceSha: null,
    originalFailedRestorationSourceSha: null,
  };
}

export function productCutoverEvidenceDir(env: NodeJS.ProcessEnv): string {
  const configured = env.SPOONJOY_PRODUCT_CUTOVER_EVIDENCE_DIR ??
    DEFAULT_PRODUCT_CUTOVER_EVIDENCE_DIR;
  if (configured.trim() === "" || configured.includes("\0")) {
    throw new Error("Product cutover evidence directory is invalid.");
  }
  return path.resolve(configured);
}

async function readWorkerScriptName(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand">,
  environment: CutoverEnvironment,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await deps.runCommand("git", ["show", "HEAD:wrangler.json"], { env });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Immutable Wrangler configuration was not valid JSON.");
  }
  const root = jsonObject(parsed, "Immutable Wrangler configuration");
  const rootName = root.name;
  if (typeof rootName !== "string" || !WORKER_NAME_PATTERN.test(rootName)) {
    throw new Error("Immutable Wrangler configuration contained an invalid Worker name.");
  }
  if (environment === "production") return rootName;
  const environments = objectRecord(root.env, "Immutable Wrangler environments");
  const qa = objectRecord(environments.qa, "Immutable Wrangler QA configuration");
  const qaName = qa.name ?? `${rootName}-qa`;
  if (typeof qaName !== "string" || !WORKER_NAME_PATTERN.test(qaName)) {
    throw new Error("Immutable Wrangler configuration contained an invalid QA Worker name.");
  }
  return qaName;
}

async function readDeployedProductRuntimeIdentity(
  deps: Pick<RunProductionCanaryReleaseDeps, "runCommand" | "workerFetch">,
  environment: CutoverEnvironment,
  versionId: string,
  cleanEnv: NodeJS.ProcessEnv,
  workersEnv: NodeJS.ProcessEnv,
): Promise<{ workerBundleSha256: string; durableObjectBundleSha256: string }> {
  const accountId = workersEnv.CLOUDFLARE_ACCOUNT_ID;
  const token = workersEnv.CLOUDFLARE_API_TOKEN;
  if (!accountId || !CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId) ||
      !token || !CLOUDFLARE_API_TOKEN_PATTERN.test(token)) {
    throw new Error("Worker runtime provenance requires valid scoped Cloudflare credentials.");
  }
  const scriptName = await readWorkerScriptName(deps, environment, cleanEnv);
  let response: Response;
  try {
    response = await (deps.workerFetch ?? fetch)(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/` +
      `${encodeURIComponent(scriptName)}/content/v2?version=${encodeURIComponent(versionId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    throw new Error("Cloudflare Worker runtime provenance request failed.");
  }
  if (!response.ok) {
    throw new Error(`Cloudflare Worker runtime provenance failed with HTTP ${response.status}.`);
  }
  if (!response.headers.get("content-type")?.startsWith("multipart/form-data")) {
    throw new Error("Cloudflare Worker runtime provenance was not a module upload.");
  }
  const entrypoint = response.headers.get("cf-entrypoint");
  if (!entrypoint) throw new Error("Cloudflare Worker runtime provenance omitted its entrypoint.");
  let form: FormData;
  try {
    form = await response.formData();
  } catch {
    throw new Error("Cloudflare Worker runtime provenance multipart body was invalid.");
  }
  const modules: { name: string; bytes: Uint8Array }[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      throw new Error("Cloudflare Worker runtime provenance contained a text field.");
    }
    if (value.type === "application/source-map") continue;
    modules.push({ name, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return productRuntimeBundleDigests(entrypoint, modules);
}

async function readLiveProductSourceRecord(
  deps: Omit<RunProductionCanaryReleaseDeps, "writeReleaseArtifact">,
  environment: CutoverEnvironment,
  versionId: string,
  cleanEnv: NodeJS.ProcessEnv,
  workersEnv: NodeJS.ProcessEnv,
): Promise<CutoverSourceRecord> {
  const environmentArgs = environment === "qa" ? ["--env", "qa"] : [];
  const activeVersion = await deps.runCommand(
    "pnpm",
    ["exec", "wrangler", "versions", "view", versionId, ...environmentArgs, "--json"],
    { env: workersEnv },
  );
  const sourceSha = selectExactVersionSourceSha(activeVersion.stdout, versionId);
  const runtimeIdentity = await readDeployedProductRuntimeIdentity(
    deps,
    environment,
    versionId,
    cleanEnv,
    workersEnv,
  );
  return rebuildProductCutoverSourceRecord(
    environment,
    sourceSha,
    versionId,
    deps.runCommand,
    cleanEnv,
    runtimeIdentity,
  );
}

export async function resolveDefaultProductCutoverAttempt(
  deps: Omit<RunProductionCanaryReleaseDeps, "writeReleaseArtifact">,
  environment: CutoverEnvironment,
  sourceSha: string,
  previousVersionId: string,
  reviewedMigrationState: readonly ReviewedMigration[],
  cleanEnv: NodeJS.ProcessEnv,
  workersEnv: NodeJS.ProcessEnv,
  evidenceDir: string,
): Promise<CutoverAttempt> {
  const readLocalSourceRecord = deps.readProductCutoverSourceRecord ?? (
    (environment: CutoverEnvironment, exactSourceSha: string, versionId: string | null) => (
      rebuildProductCutoverSourceRecord(
        environment,
        exactSourceSha,
        versionId,
        deps.runCommand,
        cleanEnv,
      )
    )
  );
  const activeBefore = deps.readProductCutoverSourceRecord
    ? await deps.readProductCutoverSourceRecord(environment, (
        selectExactVersionSourceSha((await deps.runCommand(
          "pnpm",
          [
            "exec", "wrangler", "versions", "view", previousVersionId,
            ...(environment === "qa" ? ["--env", "qa"] : []),
            "--json",
          ],
          { env: workersEnv },
        )).stdout, previousVersionId)
      ), previousVersionId)
    : await readLiveProductSourceRecord(
        deps,
        environment,
        previousVersionId,
        cleanEnv,
        workersEnv,
      );
  const activeSourceSha = activeBefore.sourceSha;
  const target = activeSourceSha === sourceSha
    ? activeBefore
    : await readLocalSourceRecord(environment, sourceSha, null);
  const compatibilitySourceSha = environment === "production"
    ? PRODUCT_COMPATIBILITY_SOURCE_SHA
    : PRODUCT_QA_COMPATIBILITY_SOURCE_SHA;
  const compatibilityVersionId = environment === "production"
    ? PRODUCT_COMPATIBILITY_VERSION_ID
    : PRODUCT_QA_COMPATIBILITY_VERSION_ID;
  const isInitial = activeBefore.sourceSha === compatibilitySourceSha;
  let liveCanonicalPredecessor = exactPredecessor(activeBefore);
  if (environment === "qa" && !isInitial && activeBefore.sourceSha !== sourceSha &&
      !deps.loadPredecessorBinding) {
    const productionPayload = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    const productionDeployment = parseCurrentProductionDeployment(productionPayload.stdout);
    if (productionDeployment.versions.length !== 1 ||
        productionDeployment.versions[0].percentage !== 100) {
      throw new Error("QA product repair requires one exact production predecessor version.");
    }
    const canonical = await readLiveProductSourceRecord(
      deps,
      "production",
      productionDeployment.versions[0].versionId,
      cleanEnv,
      workersEnv,
    );
    liveCanonicalPredecessor = {
      relationship: canonical.sourceSha === activeBefore.sourceSha
        ? "exact"
        : "same-build-alias",
      canonicalSourceSha: canonical.sourceSha,
      canonicalTreeSha: canonical.treeSha,
      canonicalWorkerBundleSha256: canonical.workerBundleSha256,
      canonicalDurableObjectBundleSha256: canonical.durableObjectBundleSha256,
      lineageParentSourceSha: canonical.sourceSha,
      runtimeFloorSourceSha: null,
      originalFailedRestorationSourceSha: null,
    };
  }
  const persisted = await readPersistedProductCutover(deps.artifactDir, environment);
  const persistedPostRestorationFailure = persisted?.transition ===
    "post-restoration-product-repair" && persisted.status === "failed"
    ? persisted
    : null;
  const persistedTargetActive = persistedPostRestorationFailure?.failure?.classification ===
    "canonical_health_failed" ||
    (persistedPostRestorationFailure?.deployment.trafficPercent ?? 0) > 0;
  const checkedInChain = !isInitial && activeBefore.sourceSha !== sourceSha &&
      target.baseSourceSha !==
      liveCanonicalPredecessor.canonicalSourceSha && !deps.loadPostRestorationChainState
    ? await readPostRestorationChainStateFile(evidenceDir, environment)
    : null;
  const checkedInLatest = checkedInChain?.latestFailedRepairArtifact ?? null;
  const durablePredecessor = deps.loadPredecessorBinding
    ? await deps.loadPredecessorBinding(environment)
    : checkedInChain
      ? {
          ...liveCanonicalPredecessor,
          lineageParentSourceSha: checkedInLatest?.target.sourceSha ??
            checkedInChain.originalFailedRestorationSourceSha,
          runtimeFloorSourceSha: checkedInChain.runtimeFloorSourceSha,
          originalFailedRestorationSourceSha:
            checkedInChain.originalFailedRestorationSourceSha,
        }
    : persistedPostRestorationFailure && !persistedTargetActive
      ? {
          ...exactPredecessor(activeBefore),
          lineageParentSourceSha: persistedPostRestorationFailure.target.sourceSha,
          runtimeFloorSourceSha:
            persistedPostRestorationFailure.predecessor.runtimeFloorSourceSha,
          originalFailedRestorationSourceSha:
            persistedPostRestorationFailure.predecessor.originalFailedRestorationSourceSha,
        }
    : persisted && persisted.target.sourceSha === activeBefore.sourceSha
      ? exactPredecessor(persisted.target)
      : liveCanonicalPredecessor;
  const chain = deps.loadPostRestorationChainState
    ? await deps.loadPostRestorationChainState(environment)
    : checkedInChain ??
      {
        runtimeFloorSourceSha: durablePredecessor.runtimeFloorSourceSha ?? activeBefore.sourceSha,
        originalFailedRestorationSourceSha:
          durablePredecessor.originalFailedRestorationSourceSha ?? activeBefore.sourceSha,
        latestFailedRepairArtifact: persistedPostRestorationFailure,
      };
  const latest = chain.latestFailedRepairArtifact;
  const latestTargetActive = latest?.failure?.classification === "canonical_health_failed" ||
    (latest?.deployment.trafficPercent ?? 0) > 0;
  const transition: CutoverAttempt["transition"] = isInitial
    ? "initial"
    : activeBefore.sourceSha === sourceSha
      ? "same-target-reconcile"
      : latestTargetActive
        ? "forward-repair"
        : durablePredecessor.runtimeFloorSourceSha !== null || latest !== null
          ? "post-restoration-product-repair"
          : "forward-repair";
  const predecessor = !deps.loadPredecessorBinding && transition === "same-target-reconcile"
    ? { ...durablePredecessor, lineageParentSourceSha: activeBefore.baseSourceSha }
    : durablePredecessor;
  const reviewedMigration = reviewedMigrationState.find(
    ({ name }) => name === PRODUCT_MIGRATION_NAME,
  );
  const migrationSql = reviewedMigration?.sql ?? await readImmutableMigration(
    deps,
    PRODUCT_MIGRATION_NAME,
    cleanEnv,
  );
  assertReviewedMigrationSql(PRODUCT_MIGRATION_NAME, migrationSql);
  return {
    environment,
    transition,
    activeBefore,
    target: transition === "same-target-reconcile"
      ? target
      : { ...target, versionId: null },
    predecessor,
    protocolBoundarySha: await readProductProtocolBoundarySha(deps, cleanEnv),
    compatibilitySourceSha,
    compatibilityVersionId,
    migrationName: PRODUCT_MIGRATION_NAME,
    migrationSha256: PRODUCT_MIGRATION_SHA256,
    migrationSql,
  };
}

export const PRODUCT_CUTOVER_PREFLIGHT_SQL = `WITH "normalized_memberships" AS (
  SELECT
    "Cookbook"."authorId" AS "userId",
    "RecipeInCookbook"."recipeId" AS "recipeId",
    CASE
      WHEN typeof("RecipeInCookbook"."createdAt") = 'integer'
        AND "RecipeInCookbook"."createdAt" BETWEEN -62167219200000 AND 253402300799999
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', "RecipeInCookbook"."createdAt" / 1000.0, 'unixepoch')
      WHEN typeof("RecipeInCookbook"."createdAt") = 'real'
        AND round("RecipeInCookbook"."createdAt") BETWEEN -62167219200000 AND 253402300799999
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', round("RecipeInCookbook"."createdAt") / 1000.0, 'unixepoch')
      WHEN typeof("RecipeInCookbook"."createdAt") = 'text'
        AND length("RecipeInCookbook"."createdAt") IN (19, 20, 24, 25, 29)
        AND length(CAST("RecipeInCookbook"."createdAt" AS BLOB)) = length("RecipeInCookbook"."createdAt")
        AND substr("RecipeInCookbook"."createdAt", 5, 1) = '-'
        AND substr("RecipeInCookbook"."createdAt", 8, 1) = '-'
        AND substr("RecipeInCookbook"."createdAt", 14, 1) = ':'
        AND substr("RecipeInCookbook"."createdAt", 17, 1) = ':'
        AND substr("RecipeInCookbook"."createdAt", 1, 4) NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 6, 2) NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 9, 2) NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 12, 2) NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 15, 2) NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 18, 2) NOT GLOB '*[^0-9]*'
        AND date(substr("RecipeInCookbook"."createdAt", 1, 10)) = substr("RecipeInCookbook"."createdAt", 1, 10)
        AND substr("RecipeInCookbook"."createdAt", 12, 2) BETWEEN '00' AND '23'
        AND substr("RecipeInCookbook"."createdAt", 15, 2) BETWEEN '00' AND '59'
        AND substr("RecipeInCookbook"."createdAt", 18, 2) BETWEEN '00' AND '59'
        AND (
          (length("RecipeInCookbook"."createdAt") = 19 AND substr("RecipeInCookbook"."createdAt", 11, 1) = ' ')
          OR (length("RecipeInCookbook"."createdAt") = 20
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) = 'Z')
          OR (length("RecipeInCookbook"."createdAt") = 24
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) = '.'
            AND substr("RecipeInCookbook"."createdAt", 21, 3) NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 24, 1) = 'Z')
          OR (length("RecipeInCookbook"."createdAt") = 25
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) IN ('+', '-')
            AND substr("RecipeInCookbook"."createdAt", 21, 2) NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 23, 1) = ':'
            AND substr("RecipeInCookbook"."createdAt", 24, 2) NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 24, 2) BETWEEN '00' AND '59'
            AND (substr("RecipeInCookbook"."createdAt", 21, 2) BETWEEN '00' AND '13'
              OR (substr("RecipeInCookbook"."createdAt", 21, 2) = '14'
                AND substr("RecipeInCookbook"."createdAt", 24, 2) = '00')))
          OR (length("RecipeInCookbook"."createdAt") = 29
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) = '.'
            AND substr("RecipeInCookbook"."createdAt", 21, 3) NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 24, 1) IN ('+', '-')
            AND substr("RecipeInCookbook"."createdAt", 25, 2) NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 27, 1) = ':'
            AND substr("RecipeInCookbook"."createdAt", 28, 2) NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 28, 2) BETWEEN '00' AND '59'
            AND (substr("RecipeInCookbook"."createdAt", 25, 2) BETWEEN '00' AND '13'
              OR (substr("RecipeInCookbook"."createdAt", 25, 2) = '14'
                AND substr("RecipeInCookbook"."createdAt", 28, 2) = '00')))
        )
        AND julianday("RecipeInCookbook"."createdAt") IS NOT NULL
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', "RecipeInCookbook"."createdAt")
      ELSE NULL
    END AS "savedAt"
  FROM "RecipeInCookbook"
  INNER JOIN "Cookbook" ON "Cookbook"."id" = "RecipeInCookbook"."cookbookId"
),
"latest_memberships" AS (
  SELECT "userId", "recipeId",
    CASE WHEN COUNT("savedAt") = COUNT(*) THEN MAX("savedAt") ELSE NULL END AS "savedAt"
  FROM "normalized_memberships"
  GROUP BY "userId", "recipeId"
)
SELECT
  0 AS duplicateSavedRecipePairs,
  (SELECT COUNT(*) FROM "latest_memberships" WHERE "savedAt" IS NULL) AS invalidSavedRecipeBackfillRows,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name = 'SavedRecipe') AS savedRecipeTableCount,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('CookSession', 'CookSessionParticipant', 'CookState')) AS cookStateTableCount;`;

const PRODUCT_CUTOVER_SAVED_RECIPE_PREFLIGHT_SQL = `SELECT COUNT(*) AS duplicateSavedRecipePairs
FROM (
  SELECT "userId", "recipeId"
  FROM "SavedRecipe"
  GROUP BY "userId", "recipeId"
  HAVING COUNT(*) > 1
);`;

async function executeProductD1Query(
  sql: string,
  config: ProductionD1Config,
  credentials: { accountId: string; token: string },
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/d1/database/${config.databaseId}/query`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    });
  } catch {
    throw new Error("Cloudflare D1 product cutover query request failed.");
  }
  if (!response.ok) {
    throw new Error(`Cloudflare D1 product cutover query failed with HTTP ${response.status}.`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Cloudflare D1 product cutover query returned malformed JSON.");
  }
  const root = objectRecord(payload, "Cloudflare D1 product cutover response");
  if (root.success !== true || !Array.isArray(root.result) || root.result.length === 0) {
    throw new Error("Cloudflare D1 product cutover query failed.");
  }
  const rows: Record<string, unknown>[] = [];
  for (const entry of root.result) {
    const result = objectRecord(entry, "Cloudflare D1 product cutover result");
    if (result.success !== true || !Array.isArray(result.results)) {
      throw new Error("Cloudflare D1 product cutover query failed.");
    }
    rows.push(...result.results.map((row) => (
      objectRecord(row, "Cloudflare D1 product cutover row")
    )));
  }
  return rows;
}

function requireNonnegativeInteger(value: unknown, context: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`Product cutover ${context} is invalid.`);
  }
  return Number(value);
}

export async function runReviewedProductCutover(
  deps: Omit<RunProductionCanaryReleaseDeps, "writeReleaseArtifact">,
  context: {
    environment: CutoverEnvironment;
    sourceSha: string;
    treeHash: string;
    previousVersionId: string;
    previousDeploymentId: string;
    versionsBefore: string;
    reviewedMigrationState: readonly ReviewedMigration[];
    cleanEnv: NodeJS.ProcessEnv;
    d1Env: NodeJS.ProcessEnv;
    workersEnv: NodeJS.ProcessEnv;
  },
): Promise<ProductCutoverArtifact> {
  const evidenceDir = productCutoverEvidenceDir(deps.env ?? process.env);
  const attempt = deps.resolveProductCutoverAttempt
    ? await deps.resolveProductCutoverAttempt()
    : await resolveDefaultProductCutoverAttempt(
        deps,
        context.environment,
        context.sourceSha,
        context.previousVersionId,
        context.reviewedMigrationState,
        context.cleanEnv,
        context.workersEnv,
        evidenceDir,
      );
  if (attempt.environment !== context.environment ||
      attempt.target.sourceSha !== context.sourceSha ||
      attempt.target.treeSha !== context.treeHash) {
    throw new Error("Product cutover attempt does not match the release environment or source.");
  }
  const defaultPredecessor = attempt.predecessor;
  let d1Context: Promise<{
    config: ProductionD1Config;
    credentials: { accountId: string; token: string };
  }> | undefined;
  const readD1Context = () => {
    d1Context ??= Promise.all([
      readImmutableD1Config(deps, context.cleanEnv, context.environment),
      Promise.resolve(requireProductionD1Credentials(context.d1Env)),
    ]).then(([config, credentials]) => ({ config, credentials }));
    return d1Context;
  };
  let candidateVersionId: string | null = null;
  let ownedDeploymentId = context.previousDeploymentId;
  const defaultObserveDeployment = async (): Promise<CutoverDeploymentRecord> => {
    const payload = await deps.runCommand(
      "pnpm",
      [
        "exec", "wrangler", "deployments", "list",
        ...(context.environment === "qa" ? ["--env", "qa"] : []),
        "--json",
      ],
      { env: context.workersEnv },
    );
    const deployment = parseCurrentProductionDeployment(payload.stdout);
    const selected = candidateVersionId
      ? deployment.versions.find(({ versionId }) => versionId === candidateVersionId) ??
        deployment.versions[0]
      : deployment.versions.find(({ versionId }) => versionId === context.previousVersionId) ??
        deployment.versions[0];
    const record = {
      deploymentId: deployment.id,
      versionId: selected.versionId,
      sourceSha: selected.versionId === candidateVersionId
        ? attempt.target.sourceSha
        : attempt.activeBefore.sourceSha,
      trafficPercent: selected.percentage,
    };
    if (candidateVersionId !== null && selected.versionId === candidateVersionId &&
        selected.percentage === 100) {
      ownedDeploymentId = deployment.id;
    }
    return record;
  };
  const effects: ProductCutoverEffects = {
    runCommand: deps.runCommand,
    commandEnv: context.cleanEnv,
    readEvidence: () => readPersistedProductCutover(
      deps.artifactDir,
      context.environment,
    ),
    loadPredecessorBinding: deps.loadPredecessorBinding ?? (async () => defaultPredecessor),
    loadPostRestorationChainState: deps.loadPostRestorationChainState ?? (async () => {
      if (attempt.transition === "post-restoration-product-repair") {
        const checkedInPath = path.join(
          evidenceDir,
          "product-repair-chain",
          `${context.environment}.json`,
        );
        try {
          await stat(checkedInPath);
          return await readPostRestorationChainStateFile(
            evidenceDir,
            context.environment,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const persisted = await readPersistedProductCutover(
        deps.artifactDir,
        context.environment,
      );
      const latest = persisted?.transition === "post-restoration-product-repair" &&
        persisted.status === "failed" ? persisted : null;
      return {
        runtimeFloorSourceSha: attempt.predecessor.runtimeFloorSourceSha ??
          latest?.predecessor.runtimeFloorSourceSha ?? attempt.activeBefore.sourceSha,
        originalFailedRestorationSourceSha:
          attempt.predecessor.originalFailedRestorationSourceSha ??
          latest?.predecessor.originalFailedRestorationSourceSha ??
          attempt.activeBefore.sourceSha,
        latestFailedRepairArtifact: latest,
      };
    }),
    loadPostRestorationApproval: deps.loadPostRestorationApproval ?? ((environment, lineageParentSha) => (
      readPostRestorationApprovalFile(evidenceDir, environment, lineageParentSha)
    )),
    loadForwardRepairSkewReceipt: deps.loadForwardRepairSkewReceipt ?? ((environment, lineageParentSha) => (
      readForwardRepairSkewReceiptFile(evidenceDir, environment, lineageParentSha)
    )),
    loadExecutedSkewReceipt: deps.loadExecutedSkewReceipt ?? ((digest) => (
      readExecutedSkewReceiptFile(evidenceDir, digest)
    )),
    readPreflight: deps.readPreflight ?? (async () => {
      const { config, credentials } = await readD1Context();
      const rows = await executeProductD1Query(
        PRODUCT_CUTOVER_PREFLIGHT_SQL,
        config,
        credentials,
        deps.d1Fetch ?? fetch,
      );
      if (rows.length !== 1) throw new Error("Product cutover preflight is invalid.");
      const row = rows[0];
      const savedRecipeTableCount = requireNonnegativeInteger(
        row.savedRecipeTableCount,
        "SavedRecipe table preflight",
      );
      if (savedRecipeTableCount > 1) {
        throw new Error("Product cutover SavedRecipe table preflight is invalid.");
      }
      let duplicateSavedRecipePairs = requireNonnegativeInteger(
        row.duplicateSavedRecipePairs,
        "duplicate preflight",
      );
      if (savedRecipeTableCount === 1) {
        const duplicateRows = await executeProductD1Query(
          PRODUCT_CUTOVER_SAVED_RECIPE_PREFLIGHT_SQL,
          config,
          credentials,
          deps.d1Fetch ?? fetch,
        );
        if (duplicateRows.length !== 1) {
          throw new Error("Product cutover SavedRecipe duplicate preflight is invalid.");
        }
        duplicateSavedRecipePairs = requireNonnegativeInteger(
          duplicateRows[0].duplicateSavedRecipePairs,
          "duplicate preflight",
        );
      }
      const cookStateTableCount = requireNonnegativeInteger(
        row.cookStateTableCount,
        "cook-state preflight",
      );
      return {
        duplicateSavedRecipePairs,
        invalidSavedRecipeBackfillRows: requireNonnegativeInteger(
          row.invalidSavedRecipeBackfillRows,
          "backfill preflight",
        ),
        cookStateTables: cookStateTableCount === 0 ? [] : ["unexpected-cook-state-table"],
      };
    }),
    readPendingMigrationNames: deps.readPendingMigrationNames ?? (async () => {
      const result = await deps.runCommand("pnpm", [
        "exec", "wrangler", "d1", "migrations", "list", "DB", "--remote",
        ...(context.environment === "qa" ? ["--env", "qa"] : []),
      ], { env: context.d1Env });
      return parsePendingMigrationNames(result.stdout);
    }),
    createRecoveryBookmark: deps.createRecoveryBookmark ?? (() => (
      readD1RecoveryBookmark(context.environment, deps.runCommand, context.d1Env)
    )),
    applyMigration: deps.applyMigration ?? (async (_environment, migration) => {
      const { config, credentials } = await readD1Context();
      await applyReviewedMigrations([migration], config, credentials, deps.d1Fetch ?? fetch);
    }),
    readTriggerInventory: deps.readTriggerInventory ?? (async () => {
      const { config, credentials } = await readD1Context();
      const rows = await executeProductD1Query([
        "SELECT name FROM sqlite_master",
        "WHERE type = 'trigger' AND name GLOB 'SavedRecipe_cutover_*' ORDER BY name;",
      ].join("\n"), config, credentials, deps.d1Fetch ?? fetch);
      return rows.map(({ name }) => {
        if (typeof name !== "string") throw new Error("Product cutover trigger row is invalid.");
        return name;
      });
    }),
    resolveTargetVersion: deps.resolveTargetVersion ?? (async (_environment, targetSha) => {
      if (attempt.transition === "same-target-reconcile") {
        candidateVersionId = attempt.target.versionId;
        if (!candidateVersionId) throw new Error("Product cutover target version is missing.");
        return candidateVersionId;
      }
      const versions = await deps.runCommand(
        "pnpm",
        [
          "exec", "wrangler", "versions", "list",
          ...(context.environment === "qa" ? ["--env", "qa"] : []),
          "--json",
        ],
        { env: context.workersEnv },
      );
      candidateVersionId = selectUploadedVersion(context.versionsBefore, versions.stdout, targetSha);
      return candidateVersionId;
    }),
    observeDeployment: deps.observeDeployment ?? defaultObserveDeployment,
    assertDeploymentOwnership: deps.assertDeploymentOwnership ?? (async (_environment, expected) => {
      if (expected.versionId === null) {
        throw new Error("Product cutover deployment ownership expected a concrete version.");
      }
      const assertOwnedTopology = async () => {
        const payload = await deps.runCommand(
          "pnpm",
          [
            "exec", "wrangler", "deployments", "list",
            ...(context.environment === "qa" ? ["--env", "qa"] : []),
            "--json",
          ],
          { env: context.workersEnv },
        );
        const deployment = parseCurrentProductionDeployment(payload.stdout);
        if (deployment.id !== ownedDeploymentId || deployment.versions.length !== 1 ||
            deployment.versions[0].versionId !== expected.versionId ||
            deployment.versions[0].percentage !== 100) {
          throw new Error(
            `Product cutover deployment ownership changed: expected ${ownedDeploymentId}/` +
            `${expected.versionId}, observed ${deployment.id}/` +
            `${deployment.versions.map(({ versionId, percentage }) => (
              `${versionId}@${percentage}`
            )).join(",")}.`,
          );
        }
      };
      await assertOwnedTopology();
      if (expected.sourceSha === attempt.target.sourceSha) {
        const liveTarget = await readLiveProductSourceRecord(
          deps,
          context.environment,
          expected.versionId,
          context.cleanEnv,
          context.workersEnv,
        );
        if (liveTarget.sourceSha !== expected.sourceSha ||
            liveTarget.treeSha !== expected.treeSha ||
            liveTarget.workerBundleSha256 !== expected.workerBundleSha256 ||
            liveTarget.durableObjectBundleSha256 !== expected.durableObjectBundleSha256 ||
            liveTarget.versionId !== expected.versionId) {
          throw new Error("Product cutover deployed target runtime does not match reviewed bytes.");
        }
      }
      await assertOwnedTopology();
    }),
    deployTarget: deps.deployTarget ?? (async (_environment, target) => {
      await deps.runCommand("pnpm", [
        "exec", "wrangler", "deploy", "--tag", target.sourceSha,
        "--message", `Spoonjoy atomic-product-activation ${target.sourceSha}`,
        ...(context.environment === "qa" ? ["--env", "qa"] : []),
      ], { env: context.workersEnv });
      return {
        deploymentId: null,
        versionId: null,
        sourceSha: target.sourceSha,
        trafficPercent: null,
      };
    }),
    verifyCanonicalHealth: deps.verifyCanonicalHealth ?? (async (_environment, deployment) => {
      const baseUrl = context.environment === "qa"
        ? deps.env?.SPOONJOY_QA_BASE_URL ??
          "https://spoonjoy-v2-qa.mendelow-studio.workers.dev"
        : deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
      if (deployment.versionId === null) return false;
      const attempts = requireVerificationAttempts(deps.verificationAttempts);
      for (let observation = 1; observation <= attempts; observation += 1) {
        try {
          if (await boundedPublicObservation(() => deps.readPublicWorkerVersion(baseUrl)) ===
              deployment.versionId) return true;
        } catch {
          // Edge propagation and transient probe failures are retried within the bounded window.
        }
        if (observation < attempts) await deps.sleep(VERIFICATION_DELAY_MS);
      }
      return false;
    }),
    applyUnlock: deps.applyUnlock ?? (async (_environment, statements) => {
      const { config, credentials } = await readD1Context();
      await executeProductD1Query(
        statements.join("\n"),
        config,
        credentials,
        deps.d1Fetch ?? fetch,
      );
    }),
    readQaActiveSource: deps.readQaActiveSource ?? (async () => {
      const payload = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--env", "qa", "--json"],
        { env: context.workersEnv },
      );
      const qaDeployment = parseCurrentProductionDeployment(payload.stdout);
      if (qaDeployment.versions.length !== 1 || qaDeployment.versions[0].percentage !== 100) {
        throw new Error("Product cutover QA deployment is not one exact 100% version.");
      }
      const qaSource = await readLiveProductSourceRecord(
        deps,
        "qa",
        qaDeployment.versions[0].versionId,
        context.cleanEnv,
        context.workersEnv,
      );
      const qaBaseUrl = deps.env?.SPOONJOY_QA_BASE_URL ??
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
      const attempts = requireVerificationAttempts(deps.verificationAttempts);
      for (let observation = 1; observation <= attempts; observation += 1) {
        try {
          if (await boundedPublicObservation(() => deps.readPublicWorkerVersion(qaBaseUrl)) ===
              qaSource.versionId) {
            return qaSource;
          }
        } catch {
          // The exact live version must converge within the bounded observation window.
        }
        if (observation < attempts) await deps.sleep(VERIFICATION_DELAY_MS);
      }
      throw new Error("Product cutover QA canonical health did not match its live version.");
    }),
    recordQaBinding: deps.recordQaBinding ?? (async (activeQaSource, predecessor) => {
      await mkdir(deps.artifactDir, { recursive: true });
      await writeFile(
        path.join(deps.artifactDir, "qa-product-binding.json"),
        `${JSON.stringify({ activeQaSource, predecessor }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    }),
    writeEvidence: deps.writeEvidence ?? ((artifact) => (
      writeProductCutoverArtifactFile(deps.artifactDir, artifact)
    )),
  };
  const result = await (deps.runProductCutover ?? executeProductCutover)(attempt, effects);
  assertProductCutoverArtifact(result);
  return result;
}

export async function runProductionCanaryRelease(
  deps: RunProductionCanaryReleaseDeps,
): Promise<ReleaseArtifact> {
  const releaseMode = requireReleaseMode(deps.releaseMode);
  const protocolV1BoundarySha = requireProtocolBoundary(
    releaseMode,
    deps.protocolV1BoundarySha,
  );
  const sourceSha = requireReleaseSha(deps.releaseSha);
  const metadata = protocolFields(releaseMode, protocolV1BoundarySha);
  let phase: ReleasePhase = "validate";
  let treeHash: string | undefined;
  let reviewedMigrations: string[] = [];
  let reviewedMigrationState: ReviewedMigration[] = [];
  let migrationApply: ReleaseArtifact["migrationApply"] = "not_started";
  let previousVersionId: string | undefined;
  let candidateVersionId: string | undefined;
  let previousDeployment: ProductionDeployment | undefined;
  let stagedDeployment: ProductionDeployment | undefined;
  let promotedDeployment: ProductionDeployment | undefined;
  let staged = false;
  let rollbackRefusal: string | undefined;
  let atomicMutationAttempted = false;
  let delegatedProductCutover = false;
  const baseEnv = { ...(deps.env ?? process.env) };
  const sanitize = (error: unknown) => sanitizedFailure(error, cloudflareCredentialValues(baseEnv));
  const cleanEnv = withoutCloudflareSecrets(baseEnv);
  delete cleanEnv.CLOUDFLARE_ACCOUNT_ID;
  const d1Env = cloudflareCommandEnv(baseEnv, "d1");
  const workersEnv = cloudflareCommandEnv(baseEnv, "workers");

  try {
    requireVerificationAttempts(deps.verificationAttempts);
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
    const provenanceTreeHash = requireTreeHash(
      (await deps.runCommand("git", ["rev-parse", "HEAD^{tree}"], { env: cleanEnv })).stdout.trim(),
    );
    if (releaseMode === "protocol-v1-canary") {
      await requireProtocolBoundaryMarker(deps, protocolV1BoundarySha!, cleanEnv);
    }
    treeHash = provenanceTreeHash;

    phase = "initial_preflight";
    await deps.runCommand("pnpm", ["run", "deploy:preflight"], { env: initialEnv });
    phase = "build";
    await deps.runCommand("pnpm", ["run", "build"], { env: cleanEnv });
    phase = "post_build_posthog";
    await validateConfiguredPostHogArtifacts(deps);
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
      const sql = await readImmutableMigration(deps, migration, cleanEnv);
      if (migration === PRODUCT_MIGRATION_NAME) {
        assertReviewedMigrationSql(migration, sql);
      } else {
        assertAdditiveMigrationSql(migration, sql);
      }
      reviewedMigrationState.push({ name: migration, sha256: migrationContentHash(sql), sql });
    }

    phase = "current_deployment";
    const deployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    previousDeployment = parseCurrentProductionDeployment(deployments.stdout);
    previousVersionId = selectCurrentProductionVersion(deployments.stdout);

    phase = "version_snapshot";
    const versionsBefore = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "versions", "list", "--json"],
      { env: workersEnv },
    );

    let targetSourceHasReviewedProductMigration = false;
    const productCutoverInjected = deps.resolveProductCutoverAttempt !== undefined ||
      deps.readProductCutoverSourceRecord !== undefined ||
      deps.runProductCutover !== undefined;
    if (releaseMode === "atomic-product-activation" &&
        !reviewedMigrations.includes(PRODUCT_MIGRATION_NAME) &&
        !productCutoverInjected) {
      const targetMigration = await deps.runCommand(
        "git",
        ["show", `${sourceSha}:migrations/${PRODUCT_MIGRATION_NAME}`],
        { env: cleanEnv },
      );
      if (targetMigration.stdout.length > 0) {
        assertReviewedMigrationSql(PRODUCT_MIGRATION_NAME, targetMigration.stdout);
        targetSourceHasReviewedProductMigration = true;
      }
    }
    const shouldDelegateProductCutover = releaseMode === "atomic-product-activation" && (
      reviewedMigrations.includes(PRODUCT_MIGRATION_NAME) ||
      productCutoverInjected ||
      targetSourceHasReviewedProductMigration
    );
    if (shouldDelegateProductCutover) {
      delegatedProductCutover = true;
      const cutover = await runReviewedProductCutover(deps, {
        environment: "production",
        sourceSha,
        treeHash,
        previousVersionId,
        previousDeploymentId: previousDeployment.id,
        versionsBefore: versionsBefore.stdout,
        reviewedMigrationState,
        cleanEnv,
        d1Env,
        workersEnv,
      });
      if (cutover.target.sourceSha !== sourceSha ||
          cutover.activeBefore.versionId !== previousVersionId ||
          cutover.target.versionId === null) {
        throw new Error("Product cutover returned a mismatched release identity.");
      }
      candidateVersionId = cutover.target.versionId;
      reviewedMigrations = cutover.transition === "initial" ? [PRODUCT_MIGRATION_NAME] : [];
      migrationApply = cutover.transition === "initial" ? "succeeded" : "not_needed";
      const result: ReleaseArtifact = {
        status: "promoted",
        sourceSha,
        ...metadata,
        phase: "complete",
        treeHash,
        reviewedMigrations,
        migrationApply,
        databaseRollbackSupported: false,
        previousVersionId,
        candidateVersionId,
        cutover,
      };
      phase = "artifact";
      await deps.writeReleaseArtifact(result);
      return result;
    }

    if (releaseMode === "protocol-v1-canary") {
      phase = "active_version_mapping";
      const previousVersion = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "versions", "view", previousVersionId, "--json"],
        { env: workersEnv },
      );
      const previousSourceSha = selectExactVersionSourceSha(previousVersion.stdout, previousVersionId);
      phase = "protocol_ancestry";
      await requireAncestor(
        deps,
        protocolV1BoundarySha!,
        sourceSha,
        cleanEnv,
        "Release source is below the protocol-v1 boundary.",
      );
      await requireAncestor(
        deps,
        protocolV1BoundarySha!,
        previousSourceSha,
        cleanEnv,
        "Active Worker source is below the protocol-v1 boundary.",
      );
    }

    if (reviewedMigrations.length === 0) {
      migrationApply = "not_needed";
    } else {
      phase = "migration_review";
      const pendingBeforeApply = await deps.runCommand("pnpm", [
        "exec", "wrangler", "d1", "migrations", "list", "DB", "--remote",
      ], { env: d1Env });
      if (!migrationNamesMatch(
        parsePendingMigrationNames(pendingBeforeApply.stdout),
        reviewedMigrationState,
      )) {
        throw new Error("Pending migrations changed before D1 migration apply.");
      }
      const productionD1Config = await readImmutableProductionD1Config(deps, cleanEnv);
      await requireReviewedMigrationState(
        deps,
        reviewedMigrationState,
        treeHash,
        cleanEnv,
      );
      const preMigrationDeployments = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--json"],
        { env: workersEnv },
      );
      requireOwnedProductionDeployment(
        preMigrationDeployments.stdout,
        previousDeployment,
        "Active production version changed before D1 migration apply.",
      );
      const productionD1Credentials = requireProductionD1Credentials(d1Env);

      phase = "migration_apply";
      migrationApply = "attempted";
      try {
        await applyReviewedMigrations(
          reviewedMigrationState,
          productionD1Config,
          productionD1Credentials,
          deps.d1Fetch ?? fetch,
        );
        migrationApply = "succeeded";
        phase = "full_preflight";
      } catch (error) {
        migrationApply = "failed";
        throw error;
      }
      const pendingAfterApply = await deps.runCommand("pnpm", [
        "exec", "wrangler", "d1", "migrations", "list", "DB", "--remote",
      ], { env: d1Env });
      if (parsePendingMigrationNames(pendingAfterApply.stdout).length !== 0) {
        throw new Error("D1 migration apply did not clear the reviewed pending migrations.");
      }
      await requireReviewedMigrationState(
        deps,
        reviewedMigrationState,
        treeHash,
        cleanEnv,
      );
      const postMigrationDeployments = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--json"],
        { env: workersEnv },
      );
      requireOwnedProductionDeployment(
        postMigrationDeployments.stdout,
        previousDeployment,
        "Active production version changed during D1 migration apply.",
      );
    }
    phase = "full_preflight";
    await deps.runCommand("pnpm", ["run", "deploy:preflight"], { env: d1Env });

    phase = "deployment_revalidation";
    const currentDeployments = await deps.runCommand(
      "pnpm",
      ["exec", "wrangler", "deployments", "list", "--json"],
      { env: workersEnv },
    );
    requireOwnedProductionDeployment(
      currentDeployments.stdout,
      previousDeployment,
      "Active production version changed during release.",
    );

    if (releaseMode === "protocol-v1-canary") {
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

      phase = "stage_revalidation";
      const preStageDeployments = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "deployments", "list", "--json"],
        { env: workersEnv },
      );
      requireOwnedProductionDeployment(
        preStageDeployments.stdout,
        previousDeployment,
        "Active production topology changed before canary staging.",
      );

      phase = "stage";
      staged = true;
      await deps.runCommand("pnpm", [
        "exec", "wrangler", "versions", "deploy", `${candidateVersionId}@0%`, `${previousVersionId}@100%`, "-y",
        "--message", `Stage ${sourceSha} for canary`,
      ], { env: workersEnv });

      phase = "promotion_revalidation";
      let stageOutcome: DeploymentMutationOutcome;
      try {
        stageOutcome = await observeDeploymentMutation(
          deps,
          previousDeployment,
          [
            { versionId: candidateVersionId, percentage: 0 },
            { versionId: previousVersionId, percentage: 100 },
          ],
          workersEnv,
          "Staged production topology changed before canary smoke.",
        );
      } catch (error) {
        rollbackRefusal = "Automatic restoration refused because production no longer matched the staged deployment.";
        throw error;
      }
      if (stageOutcome.disposition === "unchanged") {
        throw new Error("Staged production topology changed before canary smoke.");
      }
      stagedDeployment = stageOutcome.deployment;

      phase = "canary";
      await deps.runCommand("pnpm", [
        "run", "smoke:mcp:oauth", "--", "--out", deps.artifactDir, "--worker-version-id", candidateVersionId,
      ], { env: d1Env });

      phase = "candidate_csp";
      const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
      const candidateCspVersionId = candidateVersionId;
      const candidateCspReader = deps.readCandidateCspHeaders ?? readCandidateCspHeaders;
      const candidateCspHeaders = await boundedPublicObservation(() => (
        candidateCspReader(baseUrl, candidateCspVersionId)
      ));
      const cspFailures = validateCspHeaderSet(candidateCspHeaders, {
        expectedWorkerVersionId: candidateVersionId,
        postHogHost: deps.postHogHost,
        requireNonce: true,
      });
      if (cspFailures.length > 0) {
        throw new Error(`Candidate CSP validation failed: ${cspFailures.join(", ")}.`);
      }

      phase = "promotion_revalidation";
      try {
        const prePromotionDeployments = await deps.runCommand(
          "pnpm",
          ["exec", "wrangler", "deployments", "list", "--json"],
          { env: workersEnv },
        );
        requireOwnedProductionDeployment(
          prePromotionDeployments.stdout,
          stagedDeployment!,
          "Staged production topology changed before canary promotion.",
        );
      } catch (error) {
        rollbackRefusal = "Automatic restoration refused because production no longer matched the staged deployment.";
        throw error;
      }

      phase = "promote";
      await deps.runCommand("pnpm", [
        "exec", "wrangler", "versions", "deploy", `${candidateVersionId}@100%`, "-y",
        "--message", `Promote ${sourceSha}`,
      ], { env: workersEnv });
      let promotionOutcome: DeploymentMutationOutcome;
      try {
        promotionOutcome = await observeDeploymentMutation(
          deps,
          stagedDeployment!,
          [{ versionId: candidateVersionId, percentage: 100 }],
          workersEnv,
          "Canary promotion did not create the expected production deployment.",
        );
      } catch (error) {
        rollbackRefusal = "Automatic restoration refused because production no longer matched the staged deployment.";
        throw error;
      }
      if (promotionOutcome.disposition === "unchanged") {
        throw new Error("Canary promotion did not create the expected production deployment.");
      }
      promotedDeployment = promotionOutcome.deployment;
      phase = "verify_promotion";
      await waitForProductionDeployment(deps, promotedDeployment, workersEnv);
    } else {
      phase = "atomic_deploy";
      atomicMutationAttempted = true;
      await deps.runCommand("pnpm", [
        "exec", "wrangler", "deploy", "--tag", sourceSha,
        "--message", `Spoonjoy ${releaseMode} ${sourceSha}`,
      ], { env: workersEnv });
      phase = "version_lookup";
      const versions = await deps.runCommand(
        "pnpm",
        ["exec", "wrangler", "versions", "list", "--json"],
        { env: workersEnv },
      );
      candidateVersionId = selectUploadedVersion(versionsBefore.stdout, versions.stdout, sourceSha);
      phase = "verify_promotion";
      const atomicOutcome = await observeDeploymentMutation(
        deps,
        previousDeployment,
        [{ versionId: candidateVersionId, percentage: 100 }],
        workersEnv,
        "Atomic release did not create the expected production deployment.",
      );
      if (atomicOutcome.disposition === "unchanged") {
        throw new Error("Atomic release did not create the expected production deployment.");
      }
      promotedDeployment = atomicOutcome.deployment;
      phase = "verify_promotion";
      await waitForProductionDeployment(deps, promotedDeployment, workersEnv);

      if (releaseMode === "atomic-bootstrap") {
        phase = "bootstrap_probe";
        const baseUrl = deps.env?.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app";
        await waitForBootstrapProbe(deps, baseUrl, candidateVersionId);
      }
    }

    const result: ReleaseArtifact = {
      status: "promoted",
      sourceSha,
      ...metadata,
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
    if (phase === "verify_promotion" && isDeploymentOwnershipObservationFailure(error)) {
      rollbackRefusal =
        "Automatic restoration refused because production no longer matched the staged deployment.";
    }
    const failurePhase = phase;
    const failure = sanitize(error);

    if (delegatedProductCutover) {
      const cutover = await readPersistedProductCutover(deps.artifactDir, "production");
      if (cutover?.status === "failed" && treeHash && previousVersionId) {
        const initialMigration = cutover.transition === "initial";
        const cutoverMigrationApply: ReleaseArtifact["migrationApply"] = !initialMigration
          ? "not_needed"
          : cutover.migration.applyState === "failed"
            ? "failed"
            : cutover.migration.applyState === "not_started"
              ? "not_started"
              : "succeeded";
        await deps.writeReleaseArtifact({
          status: "forward_repair_required",
          sourceSha,
          ...metadata,
          phase: "artifact",
          treeHash,
          reviewedMigrations: initialMigration ? [PRODUCT_MIGRATION_NAME] : [],
          migrationApply: cutoverMigrationApply,
          databaseRollbackSupported: false,
          previousVersionId,
          ...(cutover.target.versionId
            ? { candidateVersionId: cutover.target.versionId }
            : {}),
          failure,
          cutover,
        });
      }
      throw new Error(failure);
    }

    if (staged && previousVersionId && candidateVersionId && previousDeployment) {
      if (!rollbackRefusal) {
        try {
          const restorationRefusal =
            "Automatic restoration refused because production no longer matched the staged deployment.";
          let ownershipReconciled = false;
          if (!stagedDeployment) {
            const stageOutcome = await observeDeploymentMutation(
              deps,
              previousDeployment,
              [
                { versionId: candidateVersionId, percentage: 0 },
                { versionId: previousVersionId, percentage: 100 },
              ],
              workersEnv,
              restorationRefusal,
            );
            if (stageOutcome.disposition === "unchanged") {
              staged = false;
            } else {
              stagedDeployment = stageOutcome.deployment;
            }
            ownershipReconciled = true;
          }
          if (staged && stagedDeployment && !promotedDeployment && phase === "promote") {
            const promotionOutcome = await observeDeploymentMutation(
              deps,
              stagedDeployment,
              [{ versionId: candidateVersionId, percentage: 100 }],
              workersEnv,
              restorationRefusal,
            );
            if (promotionOutcome.disposition === "created") {
              promotedDeployment = promotionOutcome.deployment;
            }
            ownershipReconciled = true;
          }
          if (staged && !ownershipReconciled) {
            const currentDeployments = await deps.runCommand(
              "pnpm",
              ["exec", "wrangler", "deployments", "list", "--json"],
              { env: workersEnv },
            );
            const disposition = restorationDisposition(
              currentDeployments.stdout,
              previousDeployment,
              candidateVersionId,
              (promotedDeployment ?? stagedDeployment)!.id,
              true,
              restorationRefusal,
            );
            if (disposition === "already_restored") staged = false;
          }
        } catch {
          rollbackRefusal =
            "Automatic restoration refused because production no longer matched the staged deployment.";
        }
      }
      if (rollbackRefusal) {
        const artifact: ReleaseArtifact = {
          status: "rollback_failed",
          sourceSha,
          ...metadata,
          phase: failurePhase,
          treeHash,
          reviewedMigrations,
          migrationApply,
          databaseRollbackSupported: false,
          previousVersionId,
          candidateVersionId,
          failure,
          rollbackFailure: rollbackRefusal,
        };
        try {
          await deps.writeReleaseArtifact(artifact);
        } catch (artifactError) {
          throw new Error(
            `${failure} Rollback failed: ${rollbackRefusal}. Release artifact write also failed: ${sanitize(artifactError)}`,
          );
        }
        throw new Error(`${failure} Rollback failed: ${rollbackRefusal}.`);
      }
      try {
        if (staged) {
          await restoreOwnedProductionDeployment(
            deps,
            previousDeployment,
            (promotedDeployment ?? stagedDeployment)!,
            workersEnv,
            `Restore after failed ${sourceSha}`,
          );
        } else {
          await waitForProductionDeployment(deps, previousDeployment, workersEnv, {
            requiredConsecutiveMatches: 2,
          });
        }
        phase = "verify_rollback";
      } catch (rollbackError) {
        const artifact: ReleaseArtifact = {
          status: "rollback_failed",
          sourceSha,
          ...metadata,
          phase: failurePhase,
          treeHash,
          reviewedMigrations,
          migrationApply,
          databaseRollbackSupported: false,
          previousVersionId,
          candidateVersionId,
          failure,
          rollbackFailure: sanitize(rollbackError),
        };
        try {
          await deps.writeReleaseArtifact(artifact);
        } catch (artifactError) {
          throw new Error(
            `${failure} Rollback failed: ${artifact.rollbackFailure}. Release artifact write also failed: ${sanitize(artifactError)}`,
          );
        }
        throw new Error(`${failure} Rollback failed: ${artifact.rollbackFailure}.`);
      }

      return writeFailureArtifact(deps.writeReleaseArtifact, {
        status: "rolled_back",
        sourceSha,
        ...metadata,
        phase: failurePhase,
        treeHash,
        reviewedMigrations,
        migrationApply,
        databaseRollbackSupported: false,
        previousVersionId,
        candidateVersionId,
        failure,
      }, error, sanitize);
    }

    const migrationMutationOccurred = migrationApply !== "not_started" && migrationApply !== "not_needed";
    const needsForwardRepair = atomicMutationAttempted || migrationMutationOccurred;
    return writeFailureArtifact(deps.writeReleaseArtifact, {
      status: needsForwardRepair ? "forward_repair_required" : "failed_before_stage",
      sourceSha,
      ...metadata,
      phase: failurePhase,
      ...(treeHash ? { treeHash } : {}),
      reviewedMigrations,
      migrationApply,
      databaseRollbackSupported: false,
      ...(previousVersionId ? { previousVersionId } : {}),
      ...(candidateVersionId ? { candidateVersionId } : {}),
      failure,
    }, error, sanitize);
  }
}

export function createReleaseCommandRunner(
  execFileImpl: ExecFileLike = nodeExecFile as unknown as ExecFileLike,
): ReleaseCommandRunner {
  return (command, args, options) => new Promise((resolve, reject) => {
    const credentialValues = cloudflareCredentialValues(options?.env ?? {});
    let flushStdout: () => void = () => undefined;
    let flushStderr: () => void = () => undefined;
    const child = execFileImpl(command, args, {
      encoding: "utf8",
      env: options?.env,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      flushStdout();
      flushStderr();
      if (error) {
        const exitCode = error.code === undefined ? "unknown" : String(error.code);
        reject(new Error(`Command failed with exit code ${exitCode}: ${command} ${args.join(" ")}`));
        return;
      }
      if (stderr.trim() !== "" || findUnexpectedWarnings(stdout).length > 0) {
        reject(new Error(`Command emitted unexpected warning output: ${command}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (child && typeof child === "object") {
      flushStdout = streamCommandOutput(
        (child as { stdout?: unknown }).stdout,
        (chunk) => process.stdout.write(redactSensitiveText(chunk, credentialValues)),
      );
      flushStderr = streamCommandOutput(
        (child as { stderr?: unknown }).stderr,
        (chunk) => process.stderr.write(redactSensitiveText(chunk, credentialValues)),
      );
    }
  });
}

export function assertReleaseArtifactLifecycle(artifact: ReleaseArtifact): void {
  const value = artifact as unknown as Record<string, unknown>;
  const present = (key: string): boolean => value[key] !== undefined;
  const phase = value.phase;
  const status = value.status;
  const releaseMode = value.releaseMode;
  const reviewedMigrationValue = value.reviewedMigrations;
  const migrationApply = value.migrationApply;
  const fail = (): never => {
    throw new Error(present("cutover")
      ? "Release cutover artifact is invalid."
      : "Release artifact lifecycle is invalid.");
  };
  const inSet = (candidate: unknown, options: readonly string[]): boolean => (
    typeof candidate === "string" && options.includes(candidate)
  );
  const reviewedMigrations = Array.isArray(reviewedMigrationValue)
    ? reviewedMigrationValue
    : fail();

  if (!RELEASE_SHA_PATTERN.test(String(value.sourceSha))) fail();
  if (!inSet(releaseMode, ["atomic-bootstrap", "atomic-product-activation", "protocol-v1-canary"])) fail();
  const isCanary = releaseMode === "protocol-v1-canary";
  if (value.deploymentStrategy !== (isCanary ? "gradual" : "atomic")) fail();
  if (isCanary) {
    if (!RELEASE_SHA_PATTERN.test(String(value.protocolV1BoundarySha))) fail();
  } else if (present("protocolV1BoundarySha")) fail();
  if (value.databaseRollbackSupported !== false) fail();
  if (!reviewedMigrations.every((name: unknown) => (
    typeof name === "string" && MIGRATION_NAME_PATTERN.test(name) && !name.includes("..")
  ))) fail();
  if (new Set(reviewedMigrations).size !== reviewedMigrations.length) fail();
  if (!inSet(migrationApply, ["not_started", "not_needed", "attempted", "succeeded", "failed"])) fail();
  if (migrationApply === "not_needed" && reviewedMigrations.length !== 0) fail();
  if (
    inSet(migrationApply, ["attempted", "succeeded", "failed"]) &&
    reviewedMigrations.length === 0
  ) fail();
  for (const key of ["treeHash", "previousVersionId", "candidateVersionId"] as const) {
    if (!present(key)) continue;
    const pattern = key === "treeHash" ? TREE_HASH_PATTERN : WORKER_VERSION_PATTERN;
    if (!pattern.test(String(value[key]))) fail();
  }
  for (const key of ["failure", "rollbackFailure"] as const) {
    if (present(key) && (typeof value[key] !== "string" || value[key].trim().length === 0)) fail();
  }
  if (present("previousVersionId") && present("candidateVersionId")) {
    const equal = value.previousVersionId === value.candidateVersionId;
    const sameTargetCutover = present("cutover") &&
      (value.cutover as { transition?: unknown }).transition === "same-target-reconcile";
    if (!sameTargetCutover && (phase === "rollback_already_active") !== equal) fail();
  }
  if (releaseMode === "atomic-product-activation" && status === "promoted" &&
      phase === "complete" && !present("cutover")) fail();
  if (present("cutover")) {
    if (releaseMode !== "atomic-product-activation") fail();
    try {
      assertProductCutoverArtifact(value.cutover as ProductCutoverArtifact);
    } catch {
      fail();
    }
    const cutover = value.cutover as ProductCutoverArtifact;
    if (cutover.environment !== "production" || cutover.target.sourceSha !== value.sourceSha ||
        cutover.target.treeSha !== value.treeHash ||
        cutover.activeBefore.versionId !== value.previousVersionId) fail();
    if (cutover.target.versionId === null) {
      if (present("candidateVersionId")) fail();
    } else if (cutover.target.versionId !== value.candidateVersionId) fail();
    const initialMigration = cutover.transition === "initial";
    if (initialMigration) {
      if (reviewedMigrations.length !== 1 || reviewedMigrations[0] !== PRODUCT_MIGRATION_NAME) fail();
      const expectedMigrationApply = cutover.migration.applyState === "failed"
        ? "failed"
        : cutover.migration.applyState === "not_started"
          ? "not_started"
          : "succeeded";
      if (migrationApply !== expectedMigrationApply) fail();
    } else if (reviewedMigrations.length !== 0 || migrationApply !== "not_needed") fail();
    if (cutover.status === "failed") {
      if (status !== "forward_repair_required" || phase !== "artifact" ||
          !present("failure") || present("rollbackFailure")) fail();
      return;
    }
    if (cutover.phase !== "verified" || cutover.status !== "succeeded" ||
        status !== "promoted" || phase !== "complete") fail();
  }

  const preDiscoveryPhases = [
    "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
    "post_build_posthog", "migration_list",
  ];
  if (inSet(phase, preDiscoveryPhases) && reviewedMigrations.length !== 0) fail();
  if (phase === "migration_review" && reviewedMigrations.length === 0) fail();

  if (
    isCanary &&
    status === "failed_before_stage" &&
    !inSet(migrationApply, ["not_started", "not_needed"])
  ) fail();

  if (!isCanary) {
    if (inSet(status, ["rollback_promoted", "rolled_back", "rollback_failed"])) fail();
    if (phase === "bootstrap_probe" && releaseMode !== "atomic-bootstrap") fail();
    if (status === "failed_before_stage") {
      const atomicEarly = [
        "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
        "post_build_posthog", "migration_list", "migration_review", "current_deployment",
        "version_snapshot",
      ];
      if (!(
        inSet(phase, atomicEarly) ||
        (phase === "full_preflight" && migrationApply === "not_needed") ||
        (phase === "deployment_revalidation" && inSet(migrationApply, ["not_started", "not_needed"]))
      )) {
        fail();
      }
    }
  }

  const noFailures = (): boolean => !present("failure") && !present("rollbackFailure");
  const completeFields = (): boolean => (
    phase === "complete" && present("treeHash") && present("previousVersionId") &&
    present("candidateVersionId") && noFailures()
  );

  if (status === "promoted") {
    if (!completeFields() || !inSet(migrationApply, ["not_needed", "succeeded"])) fail();
    return;
  }
  if (status === "rollback_promoted") {
    if (!isCanary || !completeFields() || migrationApply !== "not_needed" || reviewedMigrations.length !== 0) fail();
    return;
  }
  if (status === "rolled_back" || status === "rollback_failed") {
    if (
      !isCanary ||
      !inSet(phase, [
        "stage", "canary", "candidate_csp", "promotion_revalidation", "promote",
        "verify_promotion", "artifact",
      ]) ||
      !present("treeHash") ||
      !present("previousVersionId") ||
      !present("candidateVersionId") ||
      !present("failure") ||
      !inSet(migrationApply, ["not_needed", "succeeded"])
    ) fail();
    if ((status === "rollback_failed") !== present("rollbackFailure")) fail();
    return;
  }
  if (status === "forward_repair_required") {
    const migrationRepairPhase = inSet(phase, [
      "migration_apply", "full_preflight", "deployment_revalidation",
    ]) || (
      isCanary && inSet(phase, ["version_upload", "version_lookup", "stage_revalidation"])
    );
    const atomicRepairPhase = !isCanary && inSet(phase, [
      "atomic_deploy", "version_lookup", "verify_promotion", "bootstrap_probe", "artifact",
    ]);
    if (
      (!migrationRepairPhase && !atomicRepairPhase) ||
      !present("treeHash") ||
      !present("previousVersionId") ||
      !present("failure") ||
      present("rollbackFailure")
    ) fail();
    const needsCandidate = (
      isCanary && phase === "stage_revalidation"
    ) || (
      !isCanary && inSet(phase, ["verify_promotion", "bootstrap_probe", "artifact"])
    );
    if (needsCandidate !== present("candidateVersionId")) fail();
    if (phase === "migration_apply" && migrationApply !== "failed") fail();
    if (inSet(phase, ["full_preflight", "deployment_revalidation"]) && migrationApply !== "succeeded") fail();
    if (
      isCanary &&
      inSet(phase, ["version_upload", "version_lookup", "stage_revalidation"]) &&
      migrationApply !== "succeeded"
    ) fail();
    if (
      phase !== "migration_apply" &&
      phase !== "full_preflight" &&
      phase !== "deployment_revalidation" &&
      phase !== "version_upload" &&
      phase !== "version_lookup" &&
      phase !== "stage_revalidation" &&
      !inSet(migrationApply, ["not_needed", "succeeded"])
    ) fail();
    return;
  }
  if (status !== "failed_before_stage" || !present("failure") || present("rollbackFailure")) fail();

  const allowedFailurePhases = [
    "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
    "post_build_posthog", "migration_list", "migration_review", "full_preflight",
    "current_deployment", "deployment_revalidation", "version_snapshot", "version_upload", "version_lookup",
    "stage_revalidation",
    "rollback_version_lookup", "rollback_current_deployment", "rollback_already_active",
    "protocol_ancestry", "rollback_protocol_ancestry", "active_version_mapping",
    "rollback_active_version_mapping",
  ];
  if (!inSet(phase, allowedFailurePhases)) fail();

  if (inSet(phase, ["protocol_ancestry", "active_version_mapping"])) {
    if (migrationApply !== "not_started") fail();
  } else if (inSet(phase, [
    "rollback_version_lookup", "rollback_current_deployment", "rollback_already_active",
    "rollback_protocol_ancestry", "rollback_active_version_mapping",
  ])) {
    if (migrationApply !== "not_needed") fail();
  } else if (inSet(phase, ["validate", "provenance"])) {
    if (!inSet(migrationApply, isCanary ? ["not_started", "not_needed"] : ["not_started"])) fail();
  } else if (inSet(phase, [
    "initial_preflight", "build", "post_build_provenance", "post_build_posthog",
    "migration_list", "migration_review", "current_deployment", "version_snapshot",
  ])) {
    if (migrationApply !== "not_started") fail();
  }

  const treeRequired = inSet(phase, [
    "initial_preflight", "build", "post_build_provenance", "post_build_posthog",
    "migration_list", "migration_review", "migration_apply", "full_preflight",
    "current_deployment", "deployment_revalidation", "version_snapshot",
    "version_upload", "version_lookup", "stage_revalidation", "rollback_version_lookup", "rollback_current_deployment",
    "rollback_already_active", "protocol_ancestry", "rollback_protocol_ancestry",
    "active_version_mapping", "rollback_active_version_mapping",
  ]);
  if (treeRequired !== present("treeHash")) fail();

  const previousOptional = phase === "rollback_current_deployment" || phase === "migration_review";
  const previousRequired = inSet(phase, [
    "version_snapshot", "migration_apply", "full_preflight", "deployment_revalidation", "version_upload", "version_lookup",
    "stage_revalidation", "rollback_already_active", "protocol_ancestry", "rollback_protocol_ancestry",
    "active_version_mapping", "rollback_active_version_mapping",
  ]);
  if (!previousOptional && previousRequired !== present("previousVersionId")) fail();

  const candidateRequired = inSet(phase, [
    "stage_revalidation", "rollback_current_deployment", "rollback_already_active", "rollback_protocol_ancestry",
    "rollback_active_version_mapping",
  ]);
  if (candidateRequired !== present("candidateVersionId")) fail();
}

export async function writeReleaseArtifactFile(
  artifactDir: string,
  artifact: ReleaseArtifact,
): Promise<void> {
  assertReleaseArtifactLifecycle(artifact);
  const sanitized: ReleaseArtifact = {
    status: artifact.status,
    sourceSha: artifact.sourceSha,
    releaseMode: artifact.releaseMode,
    deploymentStrategy: artifact.deploymentStrategy,
    ...(artifact.protocolV1BoundarySha
      ? { protocolV1BoundarySha: artifact.protocolV1BoundarySha }
      : {}),
    phase: artifact.phase,
    ...(artifact.treeHash ? { treeHash: artifact.treeHash } : {}),
    reviewedMigrations: [...artifact.reviewedMigrations],
    migrationApply: artifact.migrationApply,
    databaseRollbackSupported: false,
    ...(artifact.previousVersionId ? { previousVersionId: artifact.previousVersionId } : {}),
    ...(artifact.candidateVersionId ? { candidateVersionId: artifact.candidateVersionId } : {}),
    ...(artifact.failure ? { failure: sanitizedFailure(artifact.failure) } : {}),
    ...(artifact.rollbackFailure ? { rollbackFailure: sanitizedFailure(artifact.rollbackFailure) } : {}),
    ...(artifact.cutover ? { cutover: structuredClone(artifact.cutover) } : {}),
  };
  assertReleaseArtifactLifecycle(sanitized);
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
  releaseMode: ReleaseMode;
  protocolV1BoundarySha?: string;
  rollbackVersionId?: string;
}

export function parseReleaseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv): ReleaseCliOptions {
  let artifactDir = "mcp-oauth-canary-artifacts";
  let releaseSha = env.SOURCE_SHA ?? env.GITHUB_SHA ?? "";
  const releaseModeValue: unknown = env.SPOONJOY_RELEASE_MODE;
  const protocolV1BoundarySha = env.SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA;
  let rollbackVersionId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      option === "--source-sha" ||
      option === "--artifact-dir" ||
      option === "--rollback-version-id"
    ) {
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
      if (option === "--source-sha") releaseSha = value;
      else if (option === "--artifact-dir") artifactDir = value;
      else {
        rollbackVersionId = requireWorkerVersionId(value, "Rollback version");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown production release option: ${option}`);
  }

  const releaseMode = requireReleaseMode(releaseModeValue);
  const boundary = requireProtocolBoundary(releaseMode, protocolV1BoundarySha);
  if (rollbackVersionId && releaseMode !== "protocol-v1-canary") {
    throw new Error("Production rollback is forbidden in atomic release modes.");
  }
  return {
    artifactDir,
    releaseMode,
    releaseSha: requireReleaseSha(releaseSha),
    ...(boundary ? { protocolV1BoundarySha: boundary } : {}),
    ...(rollbackVersionId ? { rollbackVersionId } : {}),
  };
}

interface ReleaseCliDeps {
  argv?: readonly string[];
  d1Fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  execFileImpl?: ExecFileLike;
  readBootstrapProbe?: (
    baseUrl: string,
    expectedVersionId: string,
  ) => Promise<BootstrapProbeResult>;
  readClientBuildMetadata?: () => Promise<Record<string, unknown>>;
  readClientBundleSources?: () => Promise<readonly string[]>;
  readGeneratedWorkerConfig?: () => Promise<Record<string, unknown>>;
  readWranglerConfig?: () => Promise<Record<string, unknown>>;
  readCandidateCspHeaders?: (baseUrl: string, candidateVersionId: string) => Promise<Headers>;
  readPublicWorkerVersion?: (baseUrl: string) => Promise<string | null>;
  runCommand?: ReleaseCommandRunner;
  sleep?: (milliseconds: number) => Promise<void>;
  verificationAttempts?: number;
  writeReleaseArtifact?: (artifactDir: string, artifact: ReleaseArtifact) => Promise<void>;
}

interface QaProductCutoverCliOptions {
  artifactDir: string;
  releaseSha: string | null;
}

export function parseQaProductCutoverCliOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): QaProductCutoverCliOptions {
  let artifactDir = "qa-product-cutover-artifacts";
  let releaseSha = env.SOURCE_SHA ?? env.GITHUB_SHA ?? null;
  let sawEnvironment = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === "--environment" || option === "--source-sha" ||
        option === "--artifact-dir") {
      if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
      if (option === "--environment") {
        if (value !== "qa") throw new Error("The product cutover QA entrypoint only accepts QA.");
        sawEnvironment = true;
      } else if (option === "--source-sha") {
        releaseSha = requireReleaseSha(value);
      } else {
        artifactDir = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown QA product cutover option: ${option}`);
  }
  if (!sawEnvironment) throw new Error("The product cutover QA entrypoint requires --environment qa.");
  if (releaseSha !== null) requireReleaseSha(releaseSha);
  return { artifactDir, releaseSha };
}

interface QaProductCutoverCliDeps extends ReleaseCliDeps, Partial<
  Omit<RunProductionCanaryReleaseDeps,
    "artifactDir" | "env" | "postHogHost" | "readPublicWorkerVersion" | "releaseSha" |
    "releaseMode" | "runCommand" | "sleep" | "writeReleaseArtifact">
> {}

export async function runQaProductCutoverCli(
  deps: QaProductCutoverCliDeps = {},
): Promise<ProductCutoverArtifact> {
  const env = deps.env ?? process.env;
  const options = parseQaProductCutoverCliOptions(deps.argv ?? [], env);
  const runCommand = deps.runCommand ?? createReleaseCommandRunner(deps.execFileImpl);
  const cleanEnv = withoutCloudflareSecrets(env);
  delete cleanEnv.CLOUDFLARE_ACCOUNT_ID;
  const d1Env = cloudflareCommandEnv(env, "d1");
  const workersEnv = cloudflareCommandEnv(env, "workers");
  const head = requireReleaseSha((await runCommand(
    "git",
    ["rev-parse", "HEAD"],
    { env: cleanEnv },
  )).stdout.trim());
  if (options.releaseSha !== null && options.releaseSha !== head) {
    throw new Error("Checked-out HEAD does not match QA release SHA.");
  }
  const status = await runCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { env: cleanEnv },
  );
  if (status.stdout.trim()) throw new Error("QA release checkout has tracked changes.");
  const treeHash = requireTreeHash((await runCommand(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    { env: cleanEnv },
  )).stdout.trim());

  await runCommand("pnpm", ["run", "qa:preflight"], {
    env: { ...cleanEnv, SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1" },
  });
  await runCommand("pnpm", ["run", "build"], {
    env: { ...cleanEnv, CLOUDFLARE_ENV: "qa" },
  });
  const wrangler = await (
    deps.readWranglerConfig ?? (async () => JSON.parse(
      await readFile("wrangler.json", "utf8"),
    ) as Record<string, unknown>)
  )();
  await validateConfiguredPostHogArtifacts(deps);
  const postBuildStatus = await runCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { env: cleanEnv },
  );
  if (postBuildStatus.stdout.trim()) throw new Error("QA build changed tracked files.");

  const migrationList = await runCommand("pnpm", [
    "exec", "wrangler", "d1", "migrations", "list", "DB", "--remote", "--env", "qa",
  ], { env: d1Env });
  const pendingMigrations = parsePendingMigrationNames(migrationList.stdout);
  if (pendingMigrations.length > 1 ||
      (pendingMigrations.length === 1 && pendingMigrations[0] !== PRODUCT_MIGRATION_NAME)) {
    throw new Error("QA product cutover has unreviewed pending migrations.");
  }
  const migrationSql = await readImmutableMigration(
    { runCommand },
    PRODUCT_MIGRATION_NAME,
    cleanEnv,
  );
  assertReviewedMigrationSql(PRODUCT_MIGRATION_NAME, migrationSql);
  const reviewedMigrationState: ReviewedMigration[] = [{
    name: PRODUCT_MIGRATION_NAME,
    sha256: migrationContentHash(migrationSql),
    sql: migrationSql,
  }];

  const deployments = await runCommand(
    "pnpm",
    ["exec", "wrangler", "deployments", "list", "--env", "qa", "--json"],
    { env: workersEnv },
  );
  const previousDeployment = parseCurrentProductionDeployment(deployments.stdout);
  const previousVersionId = selectCurrentProductionVersion(deployments.stdout);
  const versionsBefore = await runCommand(
    "pnpm",
    ["exec", "wrangler", "versions", "list", "--env", "qa", "--json"],
    { env: workersEnv },
  );
  const cutoverDeps: Omit<RunProductionCanaryReleaseDeps, "writeReleaseArtifact"> = {
    ...deps,
    artifactDir: options.artifactDir,
    env,
    postHogHost: resolvePostHogBuildHost(wrangler, "qa"),
    readPublicWorkerVersion: deps.readPublicWorkerVersion ?? readPublicWorkerVersion,
    releaseSha: head,
    releaseMode: "atomic-product-activation",
    runCommand,
    sleep: deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
  };
  return runReviewedProductCutover(cutoverDeps, {
    environment: "qa",
    sourceSha: head,
    treeHash,
    previousVersionId,
    previousDeploymentId: previousDeployment.id,
    versionsBefore: versionsBefore.stdout,
    reviewedMigrationState,
    cleanEnv,
    d1Env,
    workersEnv,
  });
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
    readBootstrapProbe: deps.readBootstrapProbe,
    readClientBuildMetadata: deps.readClientBuildMetadata,
    readClientBundleSources: deps.readClientBundleSources,
    readCandidateCspHeaders: deps.readCandidateCspHeaders ?? readCandidateCspHeaders,
    readGeneratedWorkerConfig: deps.readGeneratedWorkerConfig,
    readPublicWorkerVersion: deps.readPublicWorkerVersion ?? readPublicWorkerVersion,
    releaseSha: options.releaseSha,
    releaseMode: options.releaseMode,
    ...(options.protocolV1BoundarySha
      ? { protocolV1BoundarySha: options.protocolV1BoundarySha }
      : {}),
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
    ...(deps.d1Fetch ? { d1Fetch: deps.d1Fetch } : {}),
  });
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the fully tested function above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const command = argv.includes("--environment")
    ? runQaProductCutoverCli({ argv })
    : runProductionReleaseCli({ argv });
  command.catch((error) => {
    console.error(sanitizedFailure(error, cloudflareCredentialValues(process.env)));
    process.exitCode = 1;
  });
}
