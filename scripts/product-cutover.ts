import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type { ReleaseCommandRunner } from "./deploy-production-canary";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const CANDIDATE_SOURCE_REF = "candidate";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PRODUCT_MIGRATION_NAME = "0025_clem_feedback_product.sql";
export const PRODUCT_MIGRATION_SHA256 =
  "151009d5410997365ec56c249a50c75b7aeecadd0841b677f1b0bd7a9ab2c6e6";
export const PRODUCT_COMPATIBILITY_SOURCE_SHA = "40b8f4c85f85f0fa1f807e150013bc7b9675eff5";
export const PRODUCT_COMPATIBILITY_VERSION_ID = "144bd85d-d0c8-41ea-ae3a-9abf0dbcb6aa";
export const PRODUCT_QA_COMPATIBILITY_SOURCE_SHA = "3f79172ff802305ff8180af536a78ecbf5d39712";
export const PRODUCT_QA_COMPATIBILITY_VERSION_ID = "aa058075-115e-4cb9-aaec-af49027eb314";
export const PRODUCT_PROTOCOL_BOUNDARY_SHA = "0a473a6b55a9cb0edaf8867b29d2b473c2cf15db";
const PRODUCT_COMPATIBILITY_TREE_SHA = "82c49a457a547dbfb4effbccf458fbb98e251f8e";
const PRODUCT_COMPATIBILITY_BASE_SHA = "60c46277c01fc1065901a6fba24b9ff8cb15129d";
const PRODUCT_COMPATIBILITY_WORKER_BUNDLE_SHA256 =
  "eaadd8a4aa477879bbb478d399ef02933a54a76dbb03033aa4174389d9581e94";
const PRODUCT_COMPATIBILITY_DO_BUNDLE_SHA256 =
  "cd7a4aa239af644cce7b4f9f0d3cddbba608028ad65bf8f664a3e68b7fd3e0d4";
const PRODUCT_QA_COMPATIBILITY_TREE_SHA = "6dc720e8d4af087277c73240d0336d522e1c5aaa";
const PRODUCT_QA_COMPATIBILITY_BASE_SHA = "d242c37dd0edb3ed0a2452c9f96ce1e7d6e1487c";
const MIGRATION_NAME = PRODUCT_MIGRATION_NAME;
const MIGRATION_SHA256 = PRODUCT_MIGRATION_SHA256;
const INSERT_TRIGGER = "SavedRecipe_cutover_block_membership_insert";
const DELETE_TRIGGER = "SavedRecipe_cutover_block_membership_delete";
const BOTH_TRIGGERS = [DELETE_TRIGGER, INSERT_TRIGGER] as const;
export const PRODUCT_UNLOCK_STATEMENTS = [
  `DROP TRIGGER IF EXISTS ${INSERT_TRIGGER};`,
  `DROP TRIGGER IF EXISTS ${DELETE_TRIGGER};`,
] as const;
const UNLOCK_STATEMENTS_SHA256 = createHash("sha256")
  .update(PRODUCT_UNLOCK_STATEMENTS.join("\n"), "utf8")
  .digest("hex");
const REVIEWED_REPAIR_PATHS = [
  ".github/workflows/production-deploy.yml",
  "scripts/deploy-production-canary.ts",
  "test/scripts/deploy-production-canary.test.ts",
] as const;
const PROTOCOL_BOUNDARY_MARKER_PATH = "workers/cook-session-protocol-v1-boundary";

export type CutoverEnvironment = "qa" | "production";
export type CutoverTransition =
  | "initial"
  | "same-target-reconcile"
  | "forward-repair"
  | "post-restoration-product-repair";
export type CutoverPhase = "precheck" | "migration" | "deployment" | "unlock" | "verified";
export type CutoverStatus = "pending" | "succeeded" | "failed" | "ambiguous_reconciled";
export type ProductReleaseMode =
  | "atomic-bootstrap"
  | "atomic-product-activation"
  | "protocol-v1-canary";

export interface CutoverSourceRecord {
  sourceSha: string;
  treeSha: string;
  workerBundleSha256: string;
  durableObjectBundleSha256: string;
  versionId: string | null;
  releaseMode: ProductReleaseMode;
  baseSourceSha: string;
}

export interface CutoverPredecessorRecord {
  relationship: "exact" | "same-build-alias";
  canonicalSourceSha: string;
  canonicalTreeSha: string;
  canonicalWorkerBundleSha256: string;
  canonicalDurableObjectBundleSha256: string;
  lineageParentSourceSha: string;
  runtimeFloorSourceSha: string | null;
  originalFailedRestorationSourceSha: string | null;
}

export interface CutoverAttempt {
  environment: CutoverEnvironment;
  transition: CutoverTransition;
  activeBefore: CutoverSourceRecord;
  target: CutoverSourceRecord;
  predecessor: CutoverPredecessorRecord;
  protocolBoundarySha: string;
  compatibilitySourceSha: string;
  compatibilityVersionId: string;
  migrationName: string;
  migrationSha256: string;
  migrationSql: string;
}

export interface CutoverDeploymentRecord {
  deploymentId: string | null;
  versionId: string | null;
  sourceSha: string;
  trafficPercent: number | null;
}

export type ProductCutoverFailureClassification =
  | "precondition_mismatch"
  | "predecessor_binding_mismatch"
  | "recovery_bookmark_failed"
  | "migration_rejected"
  | "migration_apply_failed"
  | "migration_state_ambiguous"
  | "deployment_failed"
  | "deployment_state_ambiguous"
  | "target_identity_mismatch"
  | "canonical_health_failed"
  | "trigger_inventory_mismatch"
  | "unlock_apply_failed"
  | "unlock_state_ambiguous"
  | "artifact_invalid";

export interface ProductCutoverArtifact {
  schemaVersion: 1;
  environment: CutoverEnvironment;
  transition: CutoverTransition;
  phase: CutoverPhase;
  status: CutoverStatus;
  activeBefore: CutoverSourceRecord;
  target: CutoverSourceRecord;
  predecessor: CutoverPredecessorRecord;
  protocolBoundarySha: string;
  compatibilitySourceSha: string;
  migration: {
    name: string;
    sha256: string;
    recoveryBookmarkId: string | null;
    applyState: "not_started" | "applied" | "already_applied" | "ambiguous_reconciled" | "failed";
    triggerInventory: string[] | null;
  };
  deployment: CutoverDeploymentRecord;
  unlock: {
    inventoryBefore: string[] | null;
    statementsSha256: string;
    applyState: "not_started" | "applied" | "already_absent" | "ambiguous_reconciled" | "failed";
    inventoryAfter: string[] | null;
  };
  failure: {
    phase: CutoverPhase;
    classification: ProductCutoverFailureClassification;
  } | null;
}

export interface ProductCutoverPreflight {
  duplicateSavedRecipePairs: number;
  invalidSavedRecipeBackfillRows: number;
  cookStateTables: string[];
}

export interface PostRestorationChainState {
  runtimeFloorSourceSha: string;
  originalFailedRestorationSourceSha: string;
  latestFailedRepairArtifact: ProductCutoverArtifact | null;
}

export interface ExactSourceBundleManifest {
  mergeSha: string;
  treeSha: string;
  sourcePath: string;
  sourceBlobOid: string;
  sourceSha256: string;
  bundleSha256: string;
  buildCommand: string;
}

export interface BidirectionalSkewReceipt {
  schemaVersion: 1;
  environment: CutoverEnvironment;
  evidenceMode: "executed" | "reused-byte-identical";
  reusedExecutedReceiptSha256: string | null;
  predecessorSourceSha: string;
  candidateSourceSha: string;
  predecessorWorkerBundleSha256: string;
  predecessorDurableObjectBundleSha256: string;
  candidateWorkerBundleSha256: string;
  candidateDurableObjectBundleSha256: string;
  predecessorWorkerManifest: ExactSourceBundleManifest;
  predecessorDurableObjectManifest: ExactSourceBundleManifest;
  candidateWorkerManifest: ExactSourceBundleManifest;
  candidateDurableObjectManifest: ExactSourceBundleManifest;
  candidateWorkerWithPredecessorDoBundleSha256: string;
  predecessorWorkerWithCandidateDoBundleSha256: string;
}

export interface PostRestorationApproval {
  schemaVersion: 1;
  environment: CutoverEnvironment;
  runtimeFloorSourceSha: string;
  originalFailedRestorationSourceSha: string;
  lineageParentSourceSha: string;
  targetSourceSha: string;
  changedPathsSha256: string;
  reviewedPaths: string[];
  skewReceipt: BidirectionalSkewReceipt;
}

export interface CutoverVerificationEffects {
  runCommand: ReleaseCommandRunner;
  commandEnv?: NodeJS.ProcessEnv;
  loadPredecessorBinding: (environment: CutoverEnvironment) => Promise<CutoverPredecessorRecord>;
  loadPostRestorationChainState: (environment: CutoverEnvironment) => Promise<PostRestorationChainState>;
  loadPostRestorationApproval: (
    environment: CutoverEnvironment,
    lineageParentSourceSha: string,
  ) => Promise<PostRestorationApproval>;
  loadForwardRepairSkewReceipt: (
    environment: CutoverEnvironment,
    lineageParentSourceSha: string,
  ) => Promise<BidirectionalSkewReceipt>;
  loadExecutedSkewReceipt: (receiptSha256: string) => Promise<BidirectionalSkewReceipt>;
}

export interface ProductCutoverEffects extends CutoverVerificationEffects {
  readEvidence?: () => Promise<ProductCutoverArtifact | null>;
  readPreflight: (environment: CutoverEnvironment) => Promise<ProductCutoverPreflight>;
  readPendingMigrationNames: (environment: CutoverEnvironment) => Promise<string[]>;
  createRecoveryBookmark: (environment: CutoverEnvironment) => Promise<string>;
  applyMigration: (
    environment: CutoverEnvironment,
    migration: { name: string; sha256: string; sql: string },
  ) => Promise<void>;
  readTriggerInventory: (environment: CutoverEnvironment) => Promise<string[]>;
  resolveTargetVersion: (environment: CutoverEnvironment, targetSourceSha: string) => Promise<string>;
  observeDeployment: (environment: CutoverEnvironment) => Promise<CutoverDeploymentRecord>;
  assertDeploymentOwnership: (
    environment: CutoverEnvironment,
    expected: CutoverSourceRecord,
  ) => Promise<void>;
  deployTarget: (
    environment: CutoverEnvironment,
    target: CutoverSourceRecord,
  ) => Promise<CutoverDeploymentRecord>;
  verifyCanonicalHealth: (
    environment: CutoverEnvironment,
    deployment: CutoverDeploymentRecord,
  ) => Promise<boolean>;
  applyUnlock: (environment: CutoverEnvironment, statements: readonly string[]) => Promise<void>;
  readQaActiveSource: () => Promise<CutoverSourceRecord>;
  recordQaBinding: (
    activeQaSource: CutoverSourceRecord,
    predecessor: CutoverPredecessorRecord,
  ) => Promise<void>;
  writeEvidence: (artifact: ProductCutoverArtifact) => Promise<void>;
}

function compatibilityIdentity(environment: CutoverEnvironment): {
  sourceSha: string;
  versionId: string;
  treeSha: string;
  workerBundleSha256: string;
  durableObjectBundleSha256: string;
  baseSourceSha: string;
} {
  return environment === "production"
    ? {
        sourceSha: PRODUCT_COMPATIBILITY_SOURCE_SHA,
        versionId: PRODUCT_COMPATIBILITY_VERSION_ID,
        treeSha: PRODUCT_COMPATIBILITY_TREE_SHA,
        workerBundleSha256: PRODUCT_COMPATIBILITY_WORKER_BUNDLE_SHA256,
        durableObjectBundleSha256: PRODUCT_COMPATIBILITY_DO_BUNDLE_SHA256,
        baseSourceSha: PRODUCT_COMPATIBILITY_BASE_SHA,
      }
    : {
        sourceSha: PRODUCT_QA_COMPATIBILITY_SOURCE_SHA,
        versionId: PRODUCT_QA_COMPATIBILITY_VERSION_ID,
        treeSha: PRODUCT_QA_COMPATIBILITY_TREE_SHA,
        workerBundleSha256: PRODUCT_COMPATIBILITY_WORKER_BUNDLE_SHA256,
        durableObjectBundleSha256: PRODUCT_COMPATIBILITY_DO_BUNDLE_SHA256,
        baseSourceSha: PRODUCT_QA_COMPATIBILITY_BASE_SHA,
      };
}

function compatibilityIdentities(environment: CutoverEnvironment): ReturnType<
  typeof compatibilityIdentity
>[] {
  const primary = compatibilityIdentity(environment);
  return environment === "production"
    ? [primary]
    : [primary, compatibilityIdentity("production")];
}

function fail(context: string): never {
  throw new Error(`Product cutover artifact ${context} is invalid.`);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(context);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(context);
  }
}

function inSet<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function requireSha40(value: unknown, context: string): string {
  if (typeof value !== "string" || !SHA40.test(value)) fail(context);
  return value;
}

function requireSha64(value: unknown, context: string): string {
  if (typeof value !== "string" || !SHA64.test(value)) fail(context);
  return value;
}

function requireVersion(value: unknown, nullable: boolean, context: string): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) fail(context);
  return value;
}

function requireInventory(value: unknown, nullable: false, context: string): string[];
function requireInventory(value: unknown, nullable: true, context: string): string[] | null;
function requireInventory(value: unknown, nullable: boolean, context: string): string[] | null {
  if (nullable && value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => (
    typeof entry !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entry)
  ))) fail(context);
  const inventory = value as string[];
  if (new Set(inventory).size !== inventory.length) fail(context);
  if (inventory.some((entry, index) => index > 0 && inventory[index - 1] > entry)) fail(context);
  return inventory;
}

function requireSource(value: unknown, context: string): CutoverSourceRecord {
  const source = record(value, `${context} artifact`);
  exactKeys(source, [
    "sourceSha", "treeSha", "workerBundleSha256", "durableObjectBundleSha256",
    "versionId", "releaseMode", "baseSourceSha",
  ], `${context} artifact`);
  requireSha40(source.sourceSha, `${context} source`);
  requireSha40(source.treeSha, `${context} tree`);
  requireSha64(source.workerBundleSha256, `${context} Worker bundle`);
  requireSha64(source.durableObjectBundleSha256, `${context} Durable Object bundle`);
  requireVersion(source.versionId, true, `${context} version`);
  if (!inSet(source.releaseMode, [
    "atomic-bootstrap", "atomic-product-activation", "protocol-v1-canary",
  ] as const)) fail(`${context} mode`);
  requireSha40(source.baseSourceSha, `${context} base`);
  return source as unknown as CutoverSourceRecord;
}

function requirePredecessor(value: unknown): CutoverPredecessorRecord {
  const predecessor = record(value, "predecessor artifact");
  exactKeys(predecessor, [
    "relationship", "canonicalSourceSha", "canonicalTreeSha",
    "canonicalWorkerBundleSha256", "canonicalDurableObjectBundleSha256",
    "lineageParentSourceSha", "runtimeFloorSourceSha",
    "originalFailedRestorationSourceSha",
  ], "predecessor artifact");
  if (!inSet(predecessor.relationship, ["exact", "same-build-alias"] as const)) {
    fail("predecessor relationship artifact");
  }
  requireSha40(predecessor.canonicalSourceSha, "predecessor source artifact");
  requireSha40(predecessor.canonicalTreeSha, "predecessor tree artifact");
  requireSha64(predecessor.canonicalWorkerBundleSha256, "predecessor Worker artifact");
  requireSha64(predecessor.canonicalDurableObjectBundleSha256, "predecessor DO artifact");
  requireSha40(predecessor.lineageParentSourceSha, "predecessor lineage artifact");
  if (predecessor.runtimeFloorSourceSha !== null) {
    requireSha40(predecessor.runtimeFloorSourceSha, "runtime floor artifact");
  }
  if (predecessor.originalFailedRestorationSourceSha !== null) {
    requireSha40(predecessor.originalFailedRestorationSourceSha, "restoration artifact");
  }
  return predecessor as unknown as CutoverPredecessorRecord;
}

function sameSource(
  source: CutoverSourceRecord,
  predecessor: CutoverPredecessorRecord,
): boolean {
  return source.sourceSha === predecessor.canonicalSourceSha &&
    source.treeSha === predecessor.canonicalTreeSha &&
    source.workerBundleSha256 === predecessor.canonicalWorkerBundleSha256 &&
    source.durableObjectBundleSha256 === predecessor.canonicalDurableObjectBundleSha256;
}

function canonicalEvidenceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalEvidenceJson(object[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function evidenceSha256(value: unknown): string {
  return createHash("sha256").update(canonicalEvidenceJson(value), "utf8").digest("hex");
}

export function assertReviewedMigrationSql(filename: string, sql: string): void {
  if (filename === MIGRATION_NAME) {
    const digest = createHash("sha256").update(sql, "utf8").digest("hex");
    if (digest !== MIGRATION_SHA256) throw new Error("reviewed migration bytes are invalid.");
    return;
  }
  // Loaded lazily to avoid a runtime import cycle with the production orchestrator.
  const sanitized = sql.replace(/--[^\n]*(?:\n|$)/g, " ");
  if (/\b(?:DROP|DELETE|UPDATE|INSERT|REPLACE|TRIGGER)\b/i.test(sanitized)) {
    throw new Error("reviewed migration identity is invalid.");
  }
}

interface RuntimeModuleBytes {
  name: string;
  bytes: Uint8Array;
}

export function productRuntimeBundleDigests(
  entrypoint: string,
  modules: readonly RuntimeModuleBytes[],
): { workerBundleSha256: string; durableObjectBundleSha256: string } {
  if (!entrypoint || modules.length === 0 ||
      modules.some(({ name, bytes }) => !name || bytes.byteLength === 0) ||
      new Set(modules.map(({ name }) => name)).size !== modules.length ||
      !modules.some(({ name }) => name === entrypoint)) {
    throw new Error("Product cutover deployed runtime modules are invalid.");
  }
  const digest = createHash("sha256");
  digest.update("spoonjoy-worker-runtime-v1\0", "utf8");
  digest.update(entrypoint, "utf8");
  digest.update("\0", "utf8");
  for (const module of [...modules].sort((left, right) => (
    Buffer.from(left.name).compare(Buffer.from(right.name))
  ))) {
    digest.update(module.name, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(module.bytes.byteLength), "utf8");
    digest.update("\0", "utf8");
    digest.update(module.bytes);
  }
  const workerBundleSha256 = digest.digest("hex");
  const durableObjectBundleSha256 = createHash("sha256")
    .update("spoonjoy-cook-session-deployed-runtime-v1\0", "utf8")
    .update(workerBundleSha256, "utf8")
    .digest("hex");
  return { workerBundleSha256, durableObjectBundleSha256 };
}

async function readDryRunRuntimeModules(
  root: string,
  relative = "",
): Promise<RuntimeModuleBytes[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const modules: RuntimeModuleBytes[] = [];
  for (const entry of entries) {
    const name = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      modules.push(...await readDryRunRuntimeModules(root, name));
    } else if (entry.isFile() && name !== "README.md") {
      modules.push({ name, bytes: await readFile(path.join(root, name)) });
    } else if (!entry.isFile()) {
      throw new Error("Product cutover dry-run runtime contains an unsupported entry.");
    }
  }
  return modules;
}

export async function readProductCutoverSourceRecord(
  environment: CutoverEnvironment,
  sourceSha: string,
  versionId: string | null,
  runCommand: ReleaseCommandRunner,
  env?: NodeJS.ProcessEnv,
  deployedRuntimeIdentity?: {
    workerBundleSha256: string;
    durableObjectBundleSha256: string;
  },
): Promise<CutoverSourceRecord> {
  if (!inSet(environment, ["qa", "production"] as const) || !SHA40.test(sourceSha) ||
      (versionId !== null && !UUID.test(versionId))) {
    throw new Error("Product cutover source record identity is invalid.");
  }
  const compatibility = compatibilityIdentity(environment);
  if (sourceSha === compatibility.sourceSha && deployedRuntimeIdentity === undefined) {
    if (versionId !== compatibility.versionId) {
      throw new Error("Product cutover source record compatibility version is invalid.");
    }
    return {
      sourceSha,
      treeSha: compatibility.treeSha,
      workerBundleSha256: compatibility.workerBundleSha256,
      durableObjectBundleSha256: compatibility.durableObjectBundleSha256,
      versionId,
      releaseMode: "atomic-bootstrap",
      baseSourceSha: compatibility.baseSourceSha,
    };
  }

  const commandOptions = { env };
  if (deployedRuntimeIdentity) {
    requireSha64(deployedRuntimeIdentity.workerBundleSha256, "deployed Worker runtime");
    requireSha64(deployedRuntimeIdentity.durableObjectBundleSha256, "deployed DO runtime");
  }
  const [treeResult, baseResult, workflowResult] =
    await Promise.all([
      runCommand("git", ["rev-parse", `${sourceSha}^{tree}`], commandOptions),
      runCommand("git", ["rev-parse", `${sourceSha}^`], commandOptions),
      runCommand("git", [
        "show", `${sourceSha}:.github/workflows/production-deploy.yml`,
      ], commandOptions),
    ]);
  const treeSha = treeResult.stdout.trim();
  const baseSourceSha = baseResult.stdout.trim();
  if (!SHA40.test(treeSha) || !SHA40.test(baseSourceSha)) {
    throw new Error("Product cutover source record Git evidence is invalid.");
  }
  if (deployedRuntimeIdentity) {
    return {
      sourceSha,
      treeSha,
      ...deployedRuntimeIdentity,
      versionId,
      releaseMode: releaseModeFromWorkflow(workflowResult.stdout),
      baseSourceSha,
    };
  }

  const checkedOutHead = (await runCommand("git", ["rev-parse", "HEAD"], commandOptions))
    .stdout.trim();
  if (checkedOutHead !== sourceSha || versionId !== null) {
    throw new Error("Product cutover local runtime source is not the checked-out target.");
  }
  const temporaryDir = await mkdtemp(path.join(process.cwd(), ".product-cutover-runtime-"));
  try {
    await runCommand("pnpm", [
      "exec", "wrangler", "deploy", "--dry-run", "--outdir", temporaryDir,
      ...(environment === "qa" ? ["--env", "qa"] : []),
    ], commandOptions);
    const runtimeIdentity = productRuntimeBundleDigests(
      "_worker.js",
      await readDryRunRuntimeModules(temporaryDir),
    );
    return {
      sourceSha,
      treeSha,
      ...runtimeIdentity,
      versionId,
      releaseMode: releaseModeFromWorkflow(workflowResult.stdout),
      baseSourceSha,
    };
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

export async function readD1RecoveryBookmark(
  environment: CutoverEnvironment,
  runCommand: ReleaseCommandRunner,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const args = ["exec", "wrangler", "d1", "time-travel", "info", "DB"];
  if (environment === "qa") args.push("--env", "qa");
  args.push("--json");
  const result = await runCommand("pnpm", args, { env });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("D1 recovery bookmark output is invalid.");
  }
  const value = record(parsed, "recovery bookmark");
  exactKeys(value, ["bookmark"], "recovery bookmark");
  if (typeof value.bookmark !== "string" || value.bookmark.length === 0) {
    throw new Error("D1 recovery bookmark is invalid.");
  }
  return value.bookmark;
}

function assertManifest(
  value: unknown,
  context: string,
  allowCandidateReference = false,
): ExactSourceBundleManifest {
  const manifest = record(value, `${context} skew manifest`);
  exactKeys(manifest, [
    "mergeSha", "treeSha", "sourcePath", "sourceBlobOid", "sourceSha256",
    "bundleSha256", "buildCommand",
  ], `${context} skew manifest`);
  const candidateReference = allowCandidateReference &&
    manifest.mergeSha === CANDIDATE_SOURCE_REF && manifest.treeSha === CANDIDATE_SOURCE_REF;
  if (!candidateReference) {
    requireSha40(manifest.mergeSha, `${context} skew manifest merge`);
    requireSha40(manifest.treeSha, `${context} skew manifest tree`);
  }
  requireSha40(manifest.sourceBlobOid, `${context} skew manifest blob`);
  requireSha64(manifest.sourceSha256, `${context} skew manifest source`);
  requireSha64(manifest.bundleSha256, `${context} skew manifest bundle`);
  if (typeof manifest.sourcePath !== "string" || ![
    "workers/app.ts", "workers/cook-session.ts",
  ].includes(manifest.sourcePath)) fail(`${context} skew manifest path`);
  if (typeof manifest.buildCommand !== "string" || manifest.buildCommand.trim() === "") {
    fail(`${context} skew manifest build command`);
  }
  return manifest as unknown as ExactSourceBundleManifest;
}

function assertSkewReceipt(value: unknown): BidirectionalSkewReceipt {
  const receipt = record(value, "skew receipt");
  exactKeys(receipt, [
    "schemaVersion", "environment", "evidenceMode", "reusedExecutedReceiptSha256",
    "predecessorSourceSha", "candidateSourceSha", "predecessorWorkerBundleSha256",
    "predecessorDurableObjectBundleSha256", "candidateWorkerBundleSha256",
    "candidateDurableObjectBundleSha256", "predecessorWorkerManifest",
    "predecessorDurableObjectManifest", "candidateWorkerManifest",
    "candidateDurableObjectManifest", "candidateWorkerWithPredecessorDoBundleSha256",
    "predecessorWorkerWithCandidateDoBundleSha256",
  ], "skew receipt");
  if (receipt.schemaVersion !== 1) fail("skew receipt schema");
  if (!inSet(receipt.environment, ["qa", "production"] as const)) fail("skew receipt environment");
  if (!inSet(receipt.evidenceMode, ["executed", "reused-byte-identical"] as const)) {
    fail("skew receipt evidence mode");
  }
  requireSha40(receipt.predecessorSourceSha, "skew receipt predecessorSourceSha");
  if (receipt.candidateSourceSha !== CANDIDATE_SOURCE_REF) {
    requireSha40(receipt.candidateSourceSha, "skew receipt candidateSourceSha");
  }
  for (const key of [
    "predecessorWorkerBundleSha256", "predecessorDurableObjectBundleSha256",
    "candidateWorkerBundleSha256", "candidateDurableObjectBundleSha256",
    "candidateWorkerWithPredecessorDoBundleSha256",
    "predecessorWorkerWithCandidateDoBundleSha256",
  ] as const) requireSha64(receipt[key], `skew receipt ${key}`);
  const predecessorWorker = assertManifest(receipt.predecessorWorkerManifest, "predecessor Worker");
  const predecessorDo = assertManifest(receipt.predecessorDurableObjectManifest, "predecessor DO");
  const candidateWorker = assertManifest(
    receipt.candidateWorkerManifest,
    "candidate Worker",
    true,
  );
  const candidateDo = assertManifest(
    receipt.candidateDurableObjectManifest,
    "candidate DO",
    true,
  );
  if (
    predecessorWorker.sourcePath !== "workers/app.ts" ||
    predecessorDo.sourcePath !== "workers/cook-session.ts" ||
    candidateWorker.sourcePath !== "workers/app.ts" ||
    candidateDo.sourcePath !== "workers/cook-session.ts"
  ) fail("skew receipt manifest kind");
  const expected = [
    [predecessorWorker, receipt.predecessorSourceSha],
    [predecessorDo, receipt.predecessorSourceSha],
    [candidateWorker, receipt.candidateSourceSha],
    [candidateDo, receipt.candidateSourceSha],
  ] as const;
  for (const [manifest, sourceSha] of expected) {
    if (manifest.mergeSha !== sourceSha) {
      fail("skew receipt manifest identity");
    }
  }
  const executed = receipt.evidenceMode === "executed";
  if (executed) {
    if (receipt.reusedExecutedReceiptSha256 !== null) fail("skew receipt execution coupling");
  } else if (
    typeof receipt.reusedExecutedReceiptSha256 !== "string" ||
    !SHA64.test(receipt.reusedExecutedReceiptSha256)
  ) fail("skew receipt reuse coupling");
  return receipt as unknown as BidirectionalSkewReceipt;
}

function assertApproval(value: unknown): PostRestorationApproval {
  const approval = record(value, "approval");
  exactKeys(approval, [
    "schemaVersion", "environment", "runtimeFloorSourceSha",
    "originalFailedRestorationSourceSha", "lineageParentSourceSha", "targetSourceSha",
    "changedPathsSha256", "reviewedPaths", "skewReceipt",
  ], "approval");
  if (approval.schemaVersion !== 1 ||
      !inSet(approval.environment, ["qa", "production"] as const)) fail("approval");
  for (const key of [
    "runtimeFloorSourceSha", "originalFailedRestorationSourceSha",
    "lineageParentSourceSha",
  ] as const) requireSha40(approval[key], `approval ${key}`);
  if (approval.targetSourceSha !== CANDIDATE_SOURCE_REF) {
    requireSha40(approval.targetSourceSha, "approval targetSourceSha");
  }
  requireSha64(approval.changedPathsSha256, "approval changed paths digest");
  if (!Array.isArray(approval.reviewedPaths) ||
      approval.reviewedPaths.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      new Set(approval.reviewedPaths).size !== approval.reviewedPaths.length ||
      approval.reviewedPaths.some((entry, index, values) => index > 0 && values[index - 1] > entry)) {
    fail("approval reviewed paths");
  }
  if (createHash("sha256").update(approval.reviewedPaths.join("\n"), "utf8").digest("hex") !==
      approval.changedPathsSha256) fail("approval changed paths digest");
  assertSkewReceipt(approval.skewReceipt);
  return approval as unknown as PostRestorationApproval;
}

async function readJsonFile(filePath: string, context: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`Product cutover ${context} is invalid.`);
  }
}

export async function readPostRestorationApprovalFile(
  artifactDir: string,
  environment: CutoverEnvironment,
  lineageParentSourceSha: string,
): Promise<PostRestorationApproval> {
  requireSha40(lineageParentSourceSha, "approval lineage parent");
  const filePath = path.join(
    artifactDir,
    "product-repair-approvals",
    `${environment}-from-${lineageParentSourceSha}.json`,
  );
  const approval = assertApproval(await readJsonFile(filePath, "approval"));
  if (approval.environment !== environment ||
      approval.lineageParentSourceSha !== lineageParentSourceSha) {
    fail("approval");
  }
  return approval;
}

export async function readForwardRepairSkewReceiptFile(
  artifactDir: string,
  environment: CutoverEnvironment,
  lineageParentSourceSha: string,
): Promise<BidirectionalSkewReceipt> {
  requireSha40(lineageParentSourceSha, "skew lineage parent");
  const value = assertSkewReceipt(await readJsonFile(path.join(
    artifactDir,
    "product-skew-receipts",
    `${environment}-from-${lineageParentSourceSha}.json`,
  ), "skew receipt"));
  if (value.environment !== environment ||
      value.predecessorSourceSha !== lineageParentSourceSha) {
    fail("skew receipt binding");
  }
  return value;
}

export async function readExecutedSkewReceiptFile(
  artifactDir: string,
  receiptSha256: string,
): Promise<BidirectionalSkewReceipt> {
  if (!SHA64.test(receiptSha256)) throw new Error("Executed skew receipt digest is invalid.");
  const value = assertSkewReceipt(await readJsonFile(path.join(
    artifactDir,
    "product-skew-receipts",
    `executed-${receiptSha256}.json`,
  ), "skew receipt"));
  if (value.evidenceMode !== "executed" ||
      value.candidateSourceSha === CANDIDATE_SOURCE_REF ||
      evidenceSha256(value) !== receiptSha256) {
    fail("skew receipt digest");
  }
  return value;
}

export async function readPostRestorationChainStateFile(
  evidenceDir: string,
  environment: CutoverEnvironment,
): Promise<PostRestorationChainState> {
  const value = record(await readJsonFile(path.join(
    evidenceDir,
    "product-repair-chain",
    `${environment}.json`,
  ), "post-restoration chain"), "post-restoration chain");
  exactKeys(value, [
    "runtimeFloorSourceSha",
    "originalFailedRestorationSourceSha",
    "latestFailedRepairArtifact",
  ], "post-restoration chain");
  const runtimeFloorSourceSha = requireSha40(
    value.runtimeFloorSourceSha,
    "post-restoration runtime floor",
  );
  const originalFailedRestorationSourceSha = requireSha40(
    value.originalFailedRestorationSourceSha,
    "post-restoration original failure",
  );
  let latestFailedRepairArtifact: ProductCutoverArtifact | null = null;
  if (value.latestFailedRepairArtifact !== null) {
    latestFailedRepairArtifact = value.latestFailedRepairArtifact as ProductCutoverArtifact;
    assertProductCutoverArtifact(latestFailedRepairArtifact);
    if (latestFailedRepairArtifact.environment !== environment ||
        latestFailedRepairArtifact.transition !== "post-restoration-product-repair" ||
        latestFailedRepairArtifact.status !== "failed" ||
        latestFailedRepairArtifact.predecessor.runtimeFloorSourceSha !== runtimeFloorSourceSha ||
        latestFailedRepairArtifact.predecessor.originalFailedRestorationSourceSha !==
          originalFailedRestorationSourceSha) {
      fail("post-restoration chain binding");
    }
  }
  return {
    runtimeFloorSourceSha,
    originalFailedRestorationSourceSha,
    latestFailedRepairArtifact,
  };
}

function requireArtifactBasics(value: unknown): ProductCutoverArtifact {
  const artifact = record(value, "artifact");
  exactKeys(artifact, [
    "schemaVersion", "environment", "transition", "phase", "status", "activeBefore",
    "target", "predecessor", "protocolBoundarySha", "compatibilitySourceSha",
    "migration", "deployment", "unlock", "failure",
  ], "artifact");
  if (artifact.schemaVersion !== 1) fail("artifact schema");
  if (!inSet(artifact.environment, ["qa", "production"] as const)) fail("artifact environment");
  if (!inSet(artifact.transition, [
    "initial", "same-target-reconcile", "forward-repair", "post-restoration-product-repair",
  ] as const)) fail("artifact transition");
  if (!inSet(artifact.phase, ["precheck", "migration", "deployment", "unlock", "verified"] as const)) {
    fail("artifact phase");
  }
  if (!inSet(artifact.status, ["pending", "succeeded", "failed", "ambiguous_reconciled"] as const)) {
    fail("artifact status");
  }
  const active = requireSource(artifact.activeBefore, "active");
  const target = requireSource(artifact.target, "target");
  const predecessor = requirePredecessor(artifact.predecessor);
  requireSha40(artifact.protocolBoundarySha, "protocol boundary artifact");
  requireSha40(artifact.compatibilitySourceSha, "compatibility artifact");

  const migration = record(artifact.migration, "migration artifact");
  exactKeys(migration, [
    "name", "sha256", "recoveryBookmarkId", "applyState", "triggerInventory",
  ], "migration artifact");
  if (migration.name !== MIGRATION_NAME || migration.sha256 !== MIGRATION_SHA256) {
    fail("migration identity artifact");
  }
  if (migration.recoveryBookmarkId !== null &&
      (typeof migration.recoveryBookmarkId !== "string" ||
       !/^[0-9a-z][0-9a-z._:-]*$/.test(migration.recoveryBookmarkId))) {
    fail("migration bookmark artifact");
  }
  if (!inSet(migration.applyState, [
    "not_started", "applied", "already_applied", "ambiguous_reconciled", "failed",
  ] as const)) fail("migration state artifact");
  const triggerInventory = requireInventory(migration.triggerInventory, true, "migration inventory artifact");

  const deployment = record(artifact.deployment, "deployment artifact");
  exactKeys(deployment, ["deploymentId", "versionId", "sourceSha", "trafficPercent"], "deployment artifact");
  const deploymentId = requireVersion(deployment.deploymentId, true, "deployment id artifact");
  const deploymentVersion = requireVersion(deployment.versionId, true, "deployment version artifact");
  const trafficPercent = deployment.trafficPercent;
  const flexibleDeploymentFailure = artifact.phase === "deployment" &&
    artifact.status === "failed" && artifact.failure !== null &&
    typeof artifact.failure === "object" && "classification" in artifact.failure && [
      "deployment_failed", "deployment_state_ambiguous", "target_identity_mismatch",
    ].includes(String(artifact.failure.classification));
  const partialTargetIdentityFailure = flexibleDeploymentFailure &&
    (artifact.failure as { classification?: unknown }).classification === "target_identity_mismatch";
  requireSha40(deployment.sourceSha, "deployment source artifact");
  if (deployment.sourceSha !== target.sourceSha && !flexibleDeploymentFailure) {
    fail("deployment target artifact");
  }
  if (trafficPercent !== null &&
      (typeof trafficPercent !== "number" || !Number.isInteger(trafficPercent) ||
       trafficPercent < 0 || trafficPercent > 100)) fail("deployment traffic artifact");
  const observedParts = [deploymentId, deploymentVersion, trafficPercent];
  if (observedParts.some((part) => part === null) && observedParts.some((part) => part !== null) &&
      !partialTargetIdentityFailure) {
    fail("deployment tuple artifact");
  }
  if (deploymentVersion !== null && target.versionId !== deploymentVersion &&
      !flexibleDeploymentFailure) fail("deployment version artifact");

  const unlock = record(artifact.unlock, "unlock artifact");
  exactKeys(unlock, [
    "inventoryBefore", "statementsSha256", "applyState", "inventoryAfter",
  ], "unlock artifact");
  const inventoryBefore = requireInventory(unlock.inventoryBefore, true, "unlock inventoryBefore artifact");
  const inventoryAfter = requireInventory(unlock.inventoryAfter, true, "unlock inventoryAfter artifact");
  if (unlock.statementsSha256 !== UNLOCK_STATEMENTS_SHA256) fail("unlock digest artifact");
  if (!inSet(unlock.applyState, [
    "not_started", "applied", "already_absent", "ambiguous_reconciled", "failed",
  ] as const)) fail("unlock state artifact");

  let failureClassification: ProductCutoverFailureClassification | null = null;
  let failurePhase: Exclude<CutoverPhase, "verified"> | null = null;
  if (artifact.failure !== null) {
    const failure = record(artifact.failure, "failure artifact");
    exactKeys(failure, ["phase", "classification"], "failure artifact");
    if (!inSet(failure.phase, ["precheck", "migration", "deployment", "unlock"] as const) ||
        !inSet(failure.classification, [
          "precondition_mismatch", "predecessor_binding_mismatch", "recovery_bookmark_failed",
          "migration_rejected", "migration_apply_failed", "migration_state_ambiguous",
          "deployment_failed", "deployment_state_ambiguous", "target_identity_mismatch",
          "canonical_health_failed", "trigger_inventory_mismatch", "unlock_apply_failed",
          "unlock_state_ambiguous", "artifact_invalid",
        ] as const)) fail("failure artifact");
    failureClassification = failure.classification as ProductCutoverFailureClassification;
    failurePhase = failure.phase as Exclude<CutoverPhase, "verified">;
  }
  const inventoryIsReviewed = (inventory: readonly string[] | null) => (
    inventory === null || inventory.every(
      (name) => BOTH_TRIGGERS.some((trigger) => trigger === name),
    )
  );
  if (failureClassification !== "trigger_inventory_mismatch" &&
      !inventoryIsReviewed(triggerInventory)) fail("migration inventory artifact");
  if (unlock.applyState !== "failed" &&
      (!inventoryIsReviewed(inventoryBefore) || !inventoryIsReviewed(inventoryAfter))) {
    fail("unlock inventory artifact");
  }

  if (predecessor.relationship === "same-build-alias") {
    if (artifact.environment !== "qa" || active.sourceSha === predecessor.canonicalSourceSha ||
        active.treeSha !== predecessor.canonicalTreeSha ||
        active.workerBundleSha256 !== predecessor.canonicalWorkerBundleSha256 ||
        active.durableObjectBundleSha256 !== predecessor.canonicalDurableObjectBundleSha256) {
      fail("predecessor alias artifact");
    }
  } else if (!sameSource(active, predecessor)) fail("predecessor binding artifact");

  if (artifact.transition === "initial") {
    const compatibility = compatibilityIdentities(artifact.environment).find(({ sourceSha }) => (
      sourceSha === artifact.compatibilitySourceSha
    ));
    if (!compatibility ||
        active.sourceSha !== compatibility.sourceSha ||
        active.versionId !== compatibility.versionId ||
        active.releaseMode !== "atomic-bootstrap" ||
        predecessor.lineageParentSourceSha !== compatibility.sourceSha ||
        predecessor.runtimeFloorSourceSha !== null ||
        predecessor.originalFailedRestorationSourceSha !== null) fail("initial identity artifact");
  } else if (artifact.transition === "same-target-reconcile") {
    if (!sameSource(active, predecessor) || active.sourceSha !== target.sourceSha ||
        active.versionId !== target.versionId || active.treeSha !== target.treeSha ||
        active.workerBundleSha256 !== target.workerBundleSha256 ||
        active.durableObjectBundleSha256 !== target.durableObjectBundleSha256 ||
        predecessor.lineageParentSourceSha !== target.baseSourceSha ||
        predecessor.runtimeFloorSourceSha !== null ||
        predecessor.originalFailedRestorationSourceSha !== null) fail("same-target artifact");
  } else {
    if (target.baseSourceSha !== predecessor.lineageParentSourceSha) fail("repair lineage artifact");
    if (artifact.transition === "forward-repair") {
      if (predecessor.runtimeFloorSourceSha !== null ||
          predecessor.originalFailedRestorationSourceSha !== null ||
          predecessor.lineageParentSourceSha !== predecessor.canonicalSourceSha ||
          active.releaseMode !== "atomic-product-activation") fail("forward repair artifact");
    } else if (predecessor.runtimeFloorSourceSha === null ||
               predecessor.originalFailedRestorationSourceSha === null) {
      fail("post-restoration artifact");
    } else if (predecessor.relationship === "exact" &&
               predecessor.canonicalSourceSha !== predecessor.runtimeFloorSourceSha) {
      fail("post-restoration runtime floor artifact");
    }
  }
  if (target.releaseMode !== "atomic-product-activation") fail("target mode artifact");

  const classificationsByPhase: Record<Exclude<CutoverPhase, "verified">,
    readonly ProductCutoverFailureClassification[]> = {
    precheck: ["precondition_mismatch", "predecessor_binding_mismatch"],
    migration: [
      "recovery_bookmark_failed", "migration_rejected", "migration_apply_failed",
      "migration_state_ambiguous", "trigger_inventory_mismatch",
    ],
    deployment: [
      "deployment_failed", "deployment_state_ambiguous", "target_identity_mismatch",
      "canonical_health_failed",
    ],
    unlock: ["unlock_apply_failed", "unlock_state_ambiguous", "artifact_invalid"],
  };
  if (failureClassification !== null &&
      (artifact.phase === "verified" ||
       !classificationsByPhase[artifact.phase].includes(failureClassification))) {
    fail("failure classification artifact");
  }

  if (migration.applyState === "not_started") {
    const durablePreMutationBookmark = migration.recoveryBookmarkId !== null &&
      (artifact.phase === "precheck" ||
       (artifact.phase === "migration" && artifact.status === "pending"));
    if ((!durablePreMutationBookmark && migration.recoveryBookmarkId !== null) ||
        triggerInventory !== null) fail("migration state artifact");
  } else if (migration.applyState === "failed") {
    const readbackWithoutBookmark = failureClassification === "migration_state_ambiguous" &&
      migration.recoveryBookmarkId === null;
    if ((!readbackWithoutBookmark && migration.recoveryBookmarkId === null) ||
        triggerInventory !== null) fail("migration state artifact");
  } else if (triggerInventory === null) fail("migration state artifact");

  const migrationFinished = ["succeeded", "ambiguous_reconciled"].includes(artifact.status) &&
    artifact.phase === "migration" || ["deployment", "unlock", "verified"].includes(artifact.phase);
  if (migrationFinished) {
    if (artifact.transition === "initial") {
      const appliedNow = inSet(migration.applyState, ["applied", "ambiguous_reconciled"] as const) &&
        migration.recoveryBookmarkId !== null;
      const resumedApplied = migration.applyState === "already_applied";
      if ((!appliedNow && !resumedApplied) ||
          !sameJson(triggerInventory, [...BOTH_TRIGGERS])) {
        fail("initial migration state artifact");
      }
    } else if (migration.applyState !== "already_applied" || triggerInventory === null ||
               (migration.recoveryBookmarkId !== null &&
                !sameJson(triggerInventory, [...BOTH_TRIGGERS]))) {
      fail("repair migration state artifact");
    }
  }

  if (artifact.phase === "migration" && artifact.status === "failed") {
    const notStarted = migration.applyState === "not_started" &&
      migration.recoveryBookmarkId === null && triggerInventory === null;
    const applyFailed = migration.applyState === "failed" && triggerInventory === null &&
      (migration.recoveryBookmarkId !== null ||
       failureClassification === "migration_state_ambiguous");
    const triggerMismatch = triggerInventory !== null &&
      (artifact.transition === "initial"
        ? ((migration.applyState === "applied" && migration.recoveryBookmarkId !== null) ||
           migration.applyState === "already_applied") &&
          !sameJson(triggerInventory, [...BOTH_TRIGGERS])
        : migration.applyState === "already_applied" && triggerInventory.length > 0);
    const validFailureState =
      (["recovery_bookmark_failed", "migration_rejected"].includes(failureClassification ?? "") &&
       notStarted) ||
      (["migration_apply_failed", "migration_state_ambiguous"].includes(
        failureClassification ?? "",
      ) && applyFailed) ||
      (failureClassification === "trigger_inventory_mismatch" && triggerMismatch);
    if (!validFailureState) fail("migration failure state artifact");
  }

  if (unlock.applyState === "not_started") {
    if (inventoryBefore !== null || inventoryAfter !== null) fail("unlock state artifact");
  } else if (unlock.applyState === "failed") {
    if (inventoryBefore === null) fail("unlock state artifact");
  } else if (inventoryBefore === null || inventoryAfter === null || inventoryAfter.length !== 0) {
    fail("unlock state artifact");
  }

  const hasFailure = artifact.failure !== null;
  if ((artifact.status === "failed") !== hasFailure) fail("status artifact");
  if (failurePhase !== null && failurePhase !== artifact.phase) fail("failure phase artifact");
  if (artifact.phase === "verified" && artifact.status !== "succeeded") fail("verified artifact");
  if (artifact.phase === "precheck" && artifact.status === "ambiguous_reconciled") {
    fail("precheck status artifact");
  }

  if (artifact.phase === "deployment" && artifact.status === "failed") {
    const tupleComplete = deploymentId !== null && deploymentVersion !== null &&
      deployment.trafficPercent !== null;
    const exactTarget = tupleComplete && deployment.sourceSha === target.sourceSha &&
      deploymentVersion === target.versionId && deployment.trafficPercent === 100;
    const partialTuple = !tupleComplete && observedParts.some((part) => part !== null);
    if (failureClassification === "canonical_health_failed") {
      if (!exactTarget) fail("canonical health failure artifact");
    } else if (["deployment_failed", "deployment_state_ambiguous"].includes(
      failureClassification ?? "",
    )) {
      if (exactTarget || partialTuple ||
          (tupleComplete && deployment.sourceSha === target.sourceSha &&
           deploymentVersion !== target.versionId)) {
        fail("deployment failure observation artifact");
      }
    } else if (failureClassification === "target_identity_mismatch" && exactTarget) {
      fail("target identity failure artifact");
    }
  }
  return artifact as unknown as ProductCutoverArtifact;
}

function assertArtifactReachedState(artifact: ProductCutoverArtifact): void {
  const phaseIndex = ["precheck", "migration", "deployment", "unlock", "verified"]
    .indexOf(artifact.phase);
  const flexibleFailedDeployment = artifact.phase === "deployment" &&
    artifact.status === "failed" && [
      "deployment_failed", "deployment_state_ambiguous", "target_identity_mismatch",
    ].includes(artifact.failure?.classification ?? "");
  const targetVersionRequired = artifact.transition === "same-target-reconcile" || phaseIndex > 2 ||
    (artifact.phase === "deployment" && ["succeeded", "ambiguous_reconciled"]
      .includes(artifact.status)) ||
    (artifact.phase === "deployment" && artifact.failure?.classification === "canonical_health_failed");
  if (!flexibleFailedDeployment && targetVersionRequired !== (artifact.target.versionId !== null)) {
    fail("target version artifact");
  }
  const observed = artifact.deployment.deploymentId !== null;
  if (flexibleFailedDeployment) {
    if (artifact.failure?.classification !== "target_identity_mismatch" &&
        (artifact.target.versionId !== null) !== observed) fail("deployment reached state artifact");
  } else {
    const deploymentRequired = phaseIndex > 2 ||
      (artifact.phase === "deployment" && ["succeeded", "ambiguous_reconciled"]
        .includes(artifact.status)) ||
      (artifact.phase === "deployment" && artifact.failure?.classification === "canonical_health_failed");
    if (deploymentRequired !== observed) fail("deployment reached state artifact");
  }
  if (observed && artifact.deployment.trafficPercent !== 100) {
    if (!(
      artifact.phase === "deployment" && artifact.status === "failed" &&
      ["deployment_failed", "deployment_state_ambiguous", "target_identity_mismatch"]
        .includes(artifact.failure?.classification ?? "")
    )) fail("deployment traffic artifact");
  }
  if (phaseIndex < 1 && artifact.migration.applyState !== "not_started") fail("migration reached state artifact");
  if (phaseIndex > 1 && ["not_started", "failed"].includes(artifact.migration.applyState)) {
    fail("migration reached state artifact");
  }
  if (phaseIndex < 3 && artifact.unlock.applyState !== "not_started") fail("unlock reached state artifact");
  if (phaseIndex > 3 && ![
    "applied", "already_absent", "ambiguous_reconciled",
  ].includes(artifact.unlock.applyState)) fail("unlock reached state artifact");
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalEvidenceJson(left) === canonicalEvidenceJson(right);
}

export function assertProductCutoverArtifact(
  value: ProductCutoverArtifact,
  previous?: ProductCutoverArtifact,
): void {
  const artifact = requireArtifactBasics(value);
  assertArtifactReachedState(artifact);
  if (!previous) return;
  const prior = requireArtifactBasics(previous);
  assertArtifactReachedState(prior);
  const immutableKeys = [
    "environment", "transition", "activeBefore", "predecessor",
    "protocolBoundarySha", "compatibilitySourceSha",
  ] as const;
  for (const key of immutableKeys) {
    if (!sameJson(artifact[key], prior[key])) fail("cross-phase artifact");
  }
  const targetIdentity = ({ versionId: _versionId, ...identity }: CutoverSourceRecord) => identity;
  if (!sameJson(targetIdentity(artifact.target), targetIdentity(prior.target))) {
    fail("cross-phase artifact");
  }
  if (prior.target.versionId !== null && artifact.target.versionId !== prior.target.versionId) {
    fail("cross-phase target version artifact");
  }
  if (artifact.migration.name !== prior.migration.name ||
      artifact.migration.sha256 !== prior.migration.sha256 ||
      artifact.unlock.statementsSha256 !== prior.unlock.statementsSha256) fail("cross-phase artifact");
  const previousKey = `${prior.phase}:${prior.status}`;
  const currentKey = `${artifact.phase}:${artifact.status}`;
  const legalEdges = new Set([
    "precheck:pending>precheck:succeeded",
    "precheck:pending>precheck:failed",
    "precheck:succeeded>migration:pending",
    "migration:pending>migration:pending",
    "migration:pending>migration:succeeded",
    "migration:pending>migration:failed",
    "migration:pending>migration:ambiguous_reconciled",
    "migration:succeeded>deployment:pending",
    "migration:ambiguous_reconciled>deployment:pending",
    "deployment:pending>deployment:succeeded",
    "deployment:pending>deployment:failed",
    "deployment:pending>deployment:ambiguous_reconciled",
    "deployment:succeeded>unlock:pending",
    "deployment:ambiguous_reconciled>unlock:pending",
    "unlock:pending>unlock:succeeded",
    "unlock:pending>unlock:failed",
    "unlock:pending>unlock:ambiguous_reconciled",
    "unlock:succeeded>unlock:failed",
    "unlock:ambiguous_reconciled>unlock:failed",
    "unlock:succeeded>verified:succeeded",
    "unlock:ambiguous_reconciled>verified:succeeded",
  ]);
  if (!legalEdges.has(`${previousKey}>${currentKey}`)) fail("lifecycle artifact");

  const priorPhaseIndex = ["precheck", "migration", "deployment", "unlock", "verified"]
    .indexOf(prior.phase);
  const priorPhaseFinished = prior.status === "succeeded" ||
    prior.status === "ambiguous_reconciled";
  if ((priorPhaseIndex > 1 || (prior.phase === "migration" && priorPhaseFinished)) &&
      !sameJson(artifact.migration, prior.migration)) {
    fail("cross-phase migration artifact");
  }
  if ((priorPhaseIndex > 2 || (prior.phase === "deployment" && priorPhaseFinished)) &&
      (!sameJson(artifact.target.versionId, prior.target.versionId) ||
       !sameJson(artifact.deployment, prior.deployment))) {
    fail("cross-phase deployment artifact");
  }
  if ((priorPhaseIndex > 3 || (prior.phase === "unlock" && priorPhaseFinished)) &&
      !sameJson(artifact.unlock, prior.unlock)) {
    fail("cross-phase unlock artifact");
  }
}

async function runGit(
  effects: CutoverVerificationEffects,
  args: readonly string[],
): Promise<string> {
  return (await effects.runCommand("git", args, { env: effects.commandEnv })).stdout.trim();
}

async function requireAncestor(
  effects: CutoverVerificationEffects,
  ancestor: string,
  descendant: string,
  context: string,
): Promise<void> {
  try {
    await effects.runCommand("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      env: effects.commandEnv,
    });
  } catch {
    throw new Error(`Product cutover ${context} ancestry is invalid.`);
  }
}

function exactPredecessor(
  actual: CutoverPredecessorRecord,
  expected: CutoverPredecessorRecord,
): boolean {
  return sameJson(actual, expected);
}

interface PreparedManifestBuild {
  command: string;
  args: string[];
  bundleSha: string;
  sourceFixturePath: string;
  durableObjectFixturePath: string | null;
}

function safeFixturePath(value: string): boolean {
  return value.startsWith("test/fixtures/product-cutover/") &&
    !path.isAbsolute(value) &&
    !value.split("/").includes("..") &&
    !/[;&|`$\\]/.test(value);
}

async function prepareManifestVerification(
  effects: CutoverVerificationEffects,
  manifest: ExactSourceBundleManifest,
  sourceSha: string,
  treeSha: string,
  expectedPath: string,
  allowCandidateReference = false,
): Promise<PreparedManifestBuild> {
  try {
    assertManifest(manifest, "runtime", allowCandidateReference);
    const candidateReference = allowCandidateReference &&
      manifest.mergeSha === CANDIDATE_SOURCE_REF && manifest.treeSha === CANDIDATE_SOURCE_REF;
    if ((!candidateReference &&
         (manifest.mergeSha !== sourceSha || manifest.treeSha !== treeSha)) ||
        manifest.sourcePath !== expectedPath) {
      fail("skew manifest");
    }
    const source = (await effects.runCommand(
      "git",
      ["show", `${sourceSha}:${expectedPath}`],
      { env: effects.commandEnv },
    )).stdout;
    const sourceBytes = Buffer.from(source, "utf8");
    const blobOid = createHash("sha1")
      .update(`blob ${sourceBytes.byteLength}\0`, "utf8")
      .update(sourceBytes)
      .digest("hex");
    if (blobOid !== manifest.sourceBlobOid ||
        createHash("sha256").update(sourceBytes).digest("hex") !== manifest.sourceSha256 ||
        await runGit(effects, ["rev-parse", `${sourceSha}^{tree}`]) !== treeSha ||
        await runGit(effects, ["rev-parse", `${sourceSha}:${expectedPath}`]) !== manifest.sourceBlobOid) {
      fail("skew manifest evidence");
    }
    const [command, ...args] = manifest.buildCommand.split(" ");
    const isWorker = expectedPath === "workers/app.ts";
    const expectedLength = isWorker ? 4 : 2;
    if (command !== "node" ||
        args[0] !== "test/fixtures/product-cutover/build-runtime-bundle.mjs" ||
        args.length !== expectedLength || !safeFixturePath(args[1]) ||
        (isWorker && (args[2] !== "--durable-object" || !safeFixturePath(args[3])))) {
      fail("skew build command");
    }
    const fixtureSource = await readFile(args[1]);
    if (!fixtureSource.equals(sourceBytes) ||
        createHash("sha256").update(fixtureSource).digest("hex") !== manifest.sourceSha256) {
      fail("skew build source identity");
    }
    if (isWorker) await readFile(args[3]);
    return {
      command,
      args,
      bundleSha: manifest.bundleSha256,
      sourceFixturePath: args[1],
      durableObjectFixturePath: isWorker ? args[3] : null,
    };
  } catch (error) {
    if (error instanceof Error && /skew/i.test(error.message)) throw error;
    throw new Error("Product cutover skew manifest evidence is invalid.");
  }
}

async function executeManifestBuild(
  effects: CutoverVerificationEffects,
  build: PreparedManifestBuild,
): Promise<void> {
  try {
    const built = record(JSON.parse((await effects.runCommand(build.command, build.args, {
      env: effects.commandEnv,
    })).stdout), "skew build output");
    exactKeys(built, ["bundleSha256"], "skew build output");
    if (built.bundleSha256 !== build.bundleSha) fail("skew build output");
  } catch (error) {
    if (error instanceof Error && /skew/i.test(error.message)) throw error;
    throw new Error("Product cutover skew build output is invalid.");
  }
}

async function verifySkewReceipt(
  attempt: CutoverAttempt,
  effects: CutoverVerificationEffects,
  receiptValue: BidirectionalSkewReceipt,
): Promise<void> {
  const receipt = assertSkewReceipt(receiptValue);
  if (receipt.environment !== attempt.environment ||
      receipt.predecessorSourceSha !== attempt.predecessor.canonicalSourceSha ||
      receipt.candidateSourceSha !== CANDIDATE_SOURCE_REF ||
      receipt.predecessorWorkerBundleSha256 !== attempt.predecessor.canonicalWorkerBundleSha256 ||
      receipt.predecessorDurableObjectBundleSha256 !==
        attempt.predecessor.canonicalDurableObjectBundleSha256 ||
      receipt.candidateWorkerBundleSha256 !== attempt.target.workerBundleSha256 ||
      receipt.candidateDurableObjectBundleSha256 !== attempt.target.durableObjectBundleSha256) {
    fail("skew receipt attempt binding");
  }
  const runtimeChanged =
    receipt.predecessorWorkerBundleSha256 !== receipt.candidateWorkerBundleSha256 ||
    receipt.predecessorDurableObjectBundleSha256 !== receipt.candidateDurableObjectBundleSha256;
  if (runtimeChanged && receipt.evidenceMode !== "executed") fail("skew receipt mode");
  const builds = await Promise.all([
    prepareManifestVerification(effects, receipt.predecessorWorkerManifest,
      attempt.predecessor.canonicalSourceSha, attempt.predecessor.canonicalTreeSha,
      "workers/app.ts"),
    prepareManifestVerification(effects, receipt.predecessorDurableObjectManifest,
      attempt.predecessor.canonicalSourceSha, attempt.predecessor.canonicalTreeSha,
      "workers/cook-session.ts"),
    prepareManifestVerification(effects, receipt.candidateWorkerManifest,
      attempt.target.sourceSha, attempt.target.treeSha,
      "workers/app.ts", true),
    prepareManifestVerification(effects, receipt.candidateDurableObjectManifest,
      attempt.target.sourceSha, attempt.target.treeSha,
      "workers/cook-session.ts", true),
  ]);
  const [predecessorWorker, predecessorDo, candidateWorker, candidateDo] = builds;
  if (predecessorWorker.durableObjectFixturePath !== predecessorDo.sourceFixturePath ||
      candidateWorker.durableObjectFixturePath !== candidateDo.sourceFixturePath) {
    fail("skew manifest runtime pairing");
  }
  if (receipt.evidenceMode === "reused-byte-identical") {
    const prior = await effects.loadExecutedSkewReceipt(receipt.reusedExecutedReceiptSha256!);
    const executed = assertSkewReceipt(prior);
    if (executed.evidenceMode !== "executed" || evidenceSha256(executed) !==
        receipt.reusedExecutedReceiptSha256 || executed.environment !== attempt.environment ||
        executed.candidateSourceSha !== attempt.predecessor.canonicalSourceSha ||
        executed.candidateWorkerBundleSha256 !== receipt.predecessorWorkerBundleSha256 ||
        executed.candidateDurableObjectBundleSha256 !== receipt.predecessorDurableObjectBundleSha256 ||
        executed.candidateWorkerWithPredecessorDoBundleSha256 !==
          receipt.candidateWorkerWithPredecessorDoBundleSha256 ||
        executed.predecessorWorkerWithCandidateDoBundleSha256 !==
          receipt.predecessorWorkerWithCandidateDoBundleSha256) {
      fail("skew receipt reuse");
    }
  }
  for (const build of builds) await executeManifestBuild(effects, build);
  if (receipt.evidenceMode === "executed") {
    await executeManifestBuild(effects, {
      ...candidateWorker,
      args: candidateWorker.args.map((arg, index) => (
        index === 3 ? predecessorDo.sourceFixturePath : arg
      )),
      bundleSha: receipt.candidateWorkerWithPredecessorDoBundleSha256,
      durableObjectFixturePath: predecessorDo.sourceFixturePath,
    });
    await executeManifestBuild(effects, {
      ...predecessorWorker,
      args: predecessorWorker.args.map((arg, index) => (
        index === 3 ? candidateDo.sourceFixturePath : arg
      )),
      bundleSha: receipt.predecessorWorkerWithCandidateDoBundleSha256,
      durableObjectFixturePath: candidateDo.sourceFixturePath,
    });
  }
}

function releaseModeFromWorkflow(source: string): ProductReleaseMode {
  const document = parseDocument(source);
  if (document.errors.length > 0) fail("release mode evidence");
  const root = document.toJS() as unknown;
  const workflow = record(root, "release mode workflow");
  const environment = record(workflow.env, "release mode workflow environment");
  const mode = environment.SPOONJOY_RELEASE_MODE;
  if (!inSet(mode, [
    "atomic-bootstrap", "atomic-product-activation", "protocol-v1-canary",
  ] as const)) fail("release mode evidence");
  return mode;
}

export async function assertProductCutoverPreconditions(
  attempt: CutoverAttempt,
  effects: CutoverVerificationEffects,
): Promise<void> {
  const compatibility = compatibilityIdentities(attempt.environment).find((identity) => (
    attempt.compatibilitySourceSha === identity.sourceSha &&
    attempt.compatibilityVersionId === identity.versionId
  ));
  if (!compatibility) {
    throw new Error("reviewed compatibility identity is invalid.");
  }
  if (attempt.migrationName !== MIGRATION_NAME || attempt.migrationSha256 !== MIGRATION_SHA256) {
    throw new Error("Reviewed migration identity is invalid.");
  }
  assertReviewedMigrationSql(attempt.migrationName, attempt.migrationSql);
  requireSource(attempt.activeBefore, "active precondition");
  requireSource(attempt.target, "target precondition");
  requirePredecessor(attempt.predecessor);
  requireSha40(attempt.protocolBoundarySha, "protocol boundary precondition");

  const durableBinding = await effects.loadPredecessorBinding(attempt.environment);
  if (!exactPredecessor(durableBinding, attempt.predecessor)) {
    throw new Error("Product cutover predecessor binding is invalid.");
  }
  if (attempt.predecessor.relationship === "same-build-alias") {
    if (attempt.environment !== "qa") throw new Error("production predecessor aliases are forbidden.");
    if (attempt.activeBefore.sourceSha === attempt.predecessor.canonicalSourceSha ||
        attempt.activeBefore.treeSha !== attempt.predecessor.canonicalTreeSha ||
        attempt.activeBefore.workerBundleSha256 !== attempt.predecessor.canonicalWorkerBundleSha256 ||
        attempt.activeBefore.durableObjectBundleSha256 !==
          attempt.predecessor.canonicalDurableObjectBundleSha256) {
      throw new Error("QA predecessor alias is invalid.");
    }
  } else if (!sameSource(attempt.activeBefore, attempt.predecessor)) {
      throw new Error("Product cutover compatibility predecessor is invalid.");
  }

  if (attempt.transition === "initial") {
    if (attempt.activeBefore.sourceSha !== compatibility.sourceSha ||
        attempt.activeBefore.versionId !== compatibility.versionId ||
        attempt.activeBefore.releaseMode !== "atomic-bootstrap") {
      throw new Error("Product cutover compatibility source is invalid.");
    }
    await requireAncestor(effects, compatibility.sourceSha, attempt.target.sourceSha,
      "compatibility");
    return;
  }
  if (attempt.transition === "same-target-reconcile") {
    if (attempt.activeBefore.sourceSha !== attempt.target.sourceSha ||
        attempt.activeBefore.versionId !== attempt.target.versionId ||
        attempt.target.baseSourceSha !== attempt.predecessor.lineageParentSourceSha ||
        !sameSource(attempt.activeBefore, attempt.predecessor)) {
      throw new Error("Same-target predecessor binding is invalid.");
    }
    return;
  }

  if (attempt.target.baseSourceSha !== attempt.predecessor.lineageParentSourceSha) {
    throw new Error("Product cutover repair lineage is invalid.");
  }
  if (releaseModeFromWorkflow(await runGit(effects, [
    "show", `${attempt.predecessor.canonicalSourceSha}:.github/workflows/production-deploy.yml`,
  ])) !== "atomic-product-activation" || releaseModeFromWorkflow(await runGit(effects, [
    "show", `${attempt.target.sourceSha}:.github/workflows/production-deploy.yml`,
  ])) !== "atomic-product-activation") fail("repair release mode");
  await requireAncestor(effects, attempt.protocolBoundarySha,
    attempt.predecessor.canonicalSourceSha, "protocol boundary");
  await requireAncestor(effects, attempt.protocolBoundarySha, attempt.target.sourceSha,
    "protocol boundary");
  await requireAncestor(effects, attempt.predecessor.canonicalSourceSha,
    attempt.target.sourceSha, "forward repair");
  if (await runGit(effects, ["rev-parse", `${attempt.target.sourceSha}^`]) !==
      attempt.predecessor.lineageParentSourceSha) fail("repair first parent");

  if (attempt.transition === "forward-repair") {
    if (attempt.predecessor.runtimeFloorSourceSha !== null ||
        attempt.predecessor.originalFailedRestorationSourceSha !== null ||
        attempt.predecessor.lineageParentSourceSha !==
          attempt.predecessor.canonicalSourceSha) {
      throw new Error("Forward repair predecessor lineage is invalid.");
    }
    const receipt = await effects.loadForwardRepairSkewReceipt(
      attempt.environment,
      attempt.predecessor.lineageParentSourceSha,
    );
    await verifySkewReceipt(attempt, effects, receipt);
    return;
  }

  const chain = await effects.loadPostRestorationChainState(attempt.environment);
  if (attempt.predecessor.runtimeFloorSourceSha !== chain.runtimeFloorSourceSha ||
      attempt.predecessor.originalFailedRestorationSourceSha !==
        chain.originalFailedRestorationSourceSha) {
    throw new Error("Post-restoration durable identity is invalid.");
  }
  const latest = chain.latestFailedRepairArtifact;
  if (latest) {
    if (latest.status !== "failed") {
      if (latest.target.versionId !== null && latest.deployment.trafficPercent === 100) {
        throw new Error("Active post-restoration target requires ordinary forward repair.");
      }
      throw new Error("Post-restoration durable artifact is invalid.");
    }
    try {
      assertProductCutoverArtifact(latest);
    } catch {
      throw new Error("Post-restoration durable artifact is invalid.");
    }
    if ((attempt.environment === "production" && latest.environment !== "production") ||
        latest.transition !== "post-restoration-product-repair" ||
        latest.predecessor.runtimeFloorSourceSha !== chain.runtimeFloorSourceSha ||
        latest.predecessor.originalFailedRestorationSourceSha !==
          chain.originalFailedRestorationSourceSha ||
        latest.activeBefore.sourceSha !== chain.runtimeFloorSourceSha) {
      throw new Error("Post-restoration durable artifact is invalid.");
    }
    if (latest.failure?.classification === "canonical_health_failed") {
      throw new Error("Active post-restoration target requires ordinary forward repair.");
    }
    if ((latest.deployment.trafficPercent ?? 0) > 0) {
      throw new Error("Post-restoration activation evidence forbids restoration mode.");
    }
  }
  const expectedLineage = latest?.target.sourceSha ?? chain.originalFailedRestorationSourceSha;
  if (attempt.predecessor.lineageParentSourceSha !== expectedLineage) {
    throw new Error("Post-restoration lineage is invalid.");
  }
  const expectedCanonicalSource = attempt.environment === "qa" &&
    attempt.predecessor.relationship === "same-build-alias" && latest
    ? latest.target.sourceSha
    : chain.runtimeFloorSourceSha;
  if (attempt.predecessor.canonicalSourceSha !== expectedCanonicalSource) {
    throw new Error("Post-restoration durable identity is invalid.");
  }
  await requireAncestor(effects, chain.runtimeFloorSourceSha, attempt.target.sourceSha,
    "runtime floor restoration");
  await requireAncestor(effects, chain.originalFailedRestorationSourceSha,
    attempt.target.sourceSha, "original restoration");
  await requireAncestor(effects, expectedLineage, attempt.target.sourceSha,
    "latest restoration lineage");
  if (releaseModeFromWorkflow(await runGit(effects, [
    "show", `${chain.originalFailedRestorationSourceSha}:.github/workflows/production-deploy.yml`,
  ])) !== "protocol-v1-canary") fail("failed restoration mode");
  const changedPathOutput = (await effects.runCommand("git", [
    "diff", "--name-only", `${chain.runtimeFloorSourceSha}...${attempt.target.sourceSha}`,
  ], { env: effects.commandEnv })).stdout;
  const changedPaths = (
    changedPathOutput.endsWith("\n") ? changedPathOutput.slice(0, -1) : changedPathOutput
  ).split("\n");
  if (changedPaths.some((entry) => entry.length === 0) ||
      new Set(changedPaths).size !== changedPaths.length ||
      changedPaths.some((entry, index) => index > 0 && changedPaths[index - 1] > entry)) {
    throw new Error("Post-restoration diff evidence is invalid.");
  }
  if (changedPaths.includes(PROTOCOL_BOUNDARY_MARKER_PATH)) {
    throw new Error("Post-restoration protocol boundary is immutable.");
  }
  const approval = assertApproval(await effects.loadPostRestorationApproval(
    attempt.environment,
    expectedLineage,
  ));
  if (approval.schemaVersion !== 1 || approval.environment !== attempt.environment ||
      approval.runtimeFloorSourceSha !== chain.runtimeFloorSourceSha ||
      approval.originalFailedRestorationSourceSha !== chain.originalFailedRestorationSourceSha ||
      approval.lineageParentSourceSha !== expectedLineage ||
      approval.targetSourceSha !== CANDIDATE_SOURCE_REF ||
      !sameJson(approval.reviewedPaths, changedPaths) ||
      approval.changedPathsSha256 !== createHash("sha256")
        .update(changedPaths.join("\n"), "utf8").digest("hex")) {
    throw new Error("Post-restoration diff approval is invalid.");
  }
  await verifySkewReceipt(attempt, effects, approval.skewReceipt);
}

function baseArtifact(attempt: CutoverAttempt): ProductCutoverArtifact {
  return {
    schemaVersion: 1,
    environment: attempt.environment,
    transition: attempt.transition,
    phase: "precheck",
    status: "pending",
    activeBefore: structuredClone(attempt.activeBefore),
    target: {
      ...structuredClone(attempt.target),
      versionId: attempt.transition === "same-target-reconcile"
        ? attempt.target.versionId
        : null,
    },
    predecessor: structuredClone(attempt.predecessor),
    protocolBoundarySha: attempt.protocolBoundarySha,
    compatibilitySourceSha: attempt.compatibilitySourceSha,
    migration: {
      name: attempt.migrationName,
      sha256: attempt.migrationSha256,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    },
    deployment: {
      deploymentId: null,
      versionId: null,
      sourceSha: attempt.target.sourceSha,
      trafficPercent: null,
    },
    unlock: {
      inventoryBefore: null,
      statementsSha256: UNLOCK_STATEMENTS_SHA256,
      applyState: "not_started",
      inventoryAfter: null,
    },
    failure: null,
  };
}

function classifiedError(error: unknown, fallback: ProductCutoverFailureClassification) {
  const classification = error && typeof error === "object" &&
    "classification" in error && typeof error.classification === "string"
    ? error.classification as ProductCutoverFailureClassification
    : fallback;
  return classification;
}

function classifiedFailure(
  message: string,
  classification: ProductCutoverFailureClassification,
): Error {
  return Object.assign(new Error(message), { classification });
}

function observedTriggerInventory(value: string[]): string[] {
  try {
    return requireInventory(value, false, "observed trigger inventory");
  } catch {
    throw classifiedFailure("Product cutover trigger inventory mismatch.",
      "trigger_inventory_mismatch");
  }
}

function isExactDeployment(
  deployment: CutoverDeploymentRecord,
  sourceSha: string,
  versionId: string,
): boolean {
  return deployment.deploymentId !== null &&
    deployment.sourceSha === sourceSha &&
    deployment.versionId === versionId &&
    deployment.trafficPercent === 100;
}

function qaBindingForTarget(
  activeQaSource: CutoverSourceRecord,
  target: CutoverSourceRecord,
  predecessor: CutoverPredecessorRecord,
): CutoverPredecessorRecord {
  let qaSource: CutoverSourceRecord;
  try {
    qaSource = requireSource(activeQaSource, "QA active source");
  } catch {
    throw new Error("Product cutover QA active source is invalid.");
  }
  if (qaSource.versionId === null || qaSource.releaseMode !== "atomic-product-activation" ||
      qaSource.treeSha !== target.treeSha ||
      qaSource.workerBundleSha256 !== target.workerBundleSha256 ||
      qaSource.durableObjectBundleSha256 !== target.durableObjectBundleSha256) {
    throw new Error("Product cutover QA active source does not match target runtime bytes.");
  }
  return {
    relationship: qaSource.sourceSha === target.sourceSha ? "exact" : "same-build-alias",
    canonicalSourceSha: target.sourceSha,
    canonicalTreeSha: target.treeSha,
    canonicalWorkerBundleSha256: target.workerBundleSha256,
    canonicalDurableObjectBundleSha256: target.durableObjectBundleSha256,
    lineageParentSourceSha: target.sourceSha,
    runtimeFloorSourceSha: predecessor.runtimeFloorSourceSha,
    originalFailedRestorationSourceSha: predecessor.originalFailedRestorationSourceSha,
  };
}

export async function runProductCutover(
  attempt: CutoverAttempt,
  effects: ProductCutoverEffects,
): Promise<ProductCutoverArtifact> {
  let evidence = baseArtifact(attempt);
  const previousEvidence = await effects.readEvidence?.();
  if (previousEvidence) {
    assertProductCutoverArtifact(previousEvidence);
    if (sameAttemptIdentity(previousEvidence, evidence)) {
      evidence.migration.recoveryBookmarkId =
        previousEvidence.migration.recoveryBookmarkId;
    }
  }
  let shouldRecordQaBinding = false;
  const write = async () => effects.writeEvidence(structuredClone(evidence));
  const failPhase = async (
    phase: Exclude<CutoverPhase, "verified">,
    classification: ProductCutoverFailureClassification,
    error: unknown,
  ): Promise<never> => {
    evidence.phase = phase;
    evidence.status = "failed";
    evidence.failure = { phase, classification };
    await write();
    throw error;
  };

  await write();
  try {
    await assertProductCutoverPreconditions(attempt, effects);
    const preflight = await effects.readPreflight(attempt.environment);
    if (!Number.isInteger(preflight.duplicateSavedRecipePairs) ||
        preflight.duplicateSavedRecipePairs !== 0 ||
        !Number.isInteger(preflight.invalidSavedRecipeBackfillRows) ||
        preflight.invalidSavedRecipeBackfillRows !== 0 ||
        preflight.cookStateTables.length !== 0) {
      throw new Error("Product cutover preflight failed.");
    }
    if (attempt.environment === "production") {
      const source = await effects.readQaActiveSource();
      qaBindingForTarget(source, evidence.target, evidence.predecessor);
      shouldRecordQaBinding = true;
    }
  } catch (error) {
    const classification = /predecessor|binding/i.test(String(error))
      ? "predecessor_binding_mismatch"
      : "precondition_mismatch";
    return failPhase("precheck", classification, error);
  }
  evidence.status = "succeeded";
  await write();

  evidence.phase = "migration";
  evidence.status = "pending";
  await write();
  let migrationStatus: CutoverStatus = "succeeded";
  try {
    await effects.assertDeploymentOwnership(attempt.environment, attempt.activeBefore);
    const pending = await effects.readPendingMigrationNames(attempt.environment);
    if (attempt.transition === "initial") {
      if (sameJson(pending, [])) {
        evidence.migration.applyState = "already_applied";
      } else if (!sameJson(pending, [attempt.migrationName])) {
        throw classifiedFailure("Product cutover migration state changed.",
          "migration_rejected");
      } else {
        try {
          evidence.migration.recoveryBookmarkId = await effects.createRecoveryBookmark(
            attempt.environment,
          );
        } catch (error) {
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            classification: "recovery_bookmark_failed",
          });
        }
        await write();
        try {
          await effects.applyMigration(attempt.environment, {
            name: attempt.migrationName,
            sha256: attempt.migrationSha256,
            sql: attempt.migrationSql,
          });
          evidence.migration.applyState = "applied";
        } catch {
          let pendingAfter: string[];
          let inventoryAfter: string[];
          try {
            pendingAfter = await effects.readPendingMigrationNames(attempt.environment);
            inventoryAfter = observedTriggerInventory(
              await effects.readTriggerInventory(attempt.environment),
            );
          } catch {
            evidence.migration.applyState = "failed";
            evidence.migration.triggerInventory = null;
            throw classifiedFailure("Product cutover migration state is ambiguous.",
              "migration_state_ambiguous");
          }
          if (!sameJson(pendingAfter, []) || !sameJson(inventoryAfter, [...BOTH_TRIGGERS])) {
            evidence.migration.applyState = "failed";
            throw classifiedFailure("Product cutover migration state is ambiguous.",
              "migration_state_ambiguous");
          }
          evidence.migration.applyState = "ambiguous_reconciled";
          evidence.migration.triggerInventory = inventoryAfter;
          migrationStatus = "ambiguous_reconciled";
        }
      }
    } else {
      if (pending.length !== 0) {
        throw classifiedFailure("Product cutover migration state changed.",
          "migration_rejected");
      }
      evidence.migration.applyState = "already_applied";
    }
    if (evidence.migration.triggerInventory === null) {
      if (attempt.transition === "initial") {
        let pendingAfter: string[];
        try {
          pendingAfter = await effects.readPendingMigrationNames(attempt.environment);
        } catch {
          evidence.migration.applyState = "failed";
          evidence.migration.triggerInventory = null;
          throw classifiedFailure("Product cutover migration state is ambiguous.",
            "migration_state_ambiguous");
        }
        if (pendingAfter.length !== 0) {
          evidence.migration.applyState = "failed";
          throw classifiedFailure("Product cutover migration state is ambiguous.",
            "migration_state_ambiguous");
        }
      }
      try {
        evidence.migration.triggerInventory = observedTriggerInventory(
          await effects.readTriggerInventory(attempt.environment),
        );
      } catch {
        evidence.migration.applyState = "failed";
        evidence.migration.triggerInventory = null;
        throw classifiedFailure("Product cutover trigger inventory evidence is invalid.",
          "migration_state_ambiguous");
      }
    }
    const requiresClosedFence = attempt.transition === "initial";
    const requiresOpenFence = attempt.transition === "post-restoration-product-repair";
    const hasUnexpectedTrigger = evidence.migration.triggerInventory.some(
      (name) => !BOTH_TRIGGERS.some((trigger) => trigger === name),
    );
    if (hasUnexpectedTrigger || (requiresClosedFence &&
         !sameJson(evidence.migration.triggerInventory, [...BOTH_TRIGGERS])) ||
        (requiresOpenFence && evidence.migration.triggerInventory.length !== 0)) {
      throw classifiedFailure("Product cutover trigger inventory mismatch.",
        "trigger_inventory_mismatch");
    }
  } catch (error) {
    return failPhase("migration", classifiedError(error, "migration_rejected"), error);
  }
  evidence.status = migrationStatus;
  await write();

  evidence.phase = "deployment";
  evidence.status = "pending";
  await write();
  let deploymentStatus: CutoverStatus = "succeeded";
  try {
    await effects.assertDeploymentOwnership(attempt.environment, attempt.activeBefore);
    let deploymentError = false;
    let deploymentAttempted = false;
    if (attempt.transition !== "same-target-reconcile") {
      deploymentAttempted = true;
      try {
        await effects.deployTarget(attempt.environment, attempt.target);
      } catch {
        deploymentError = true;
      }
    }
    let versionId: string;
    try {
      versionId = await effects.resolveTargetVersion(
        attempt.environment,
        attempt.target.sourceSha,
      );
    } catch (error) {
      if (deploymentError || deploymentAttempted) {
        throw classifiedFailure("Product cutover deployment state is ambiguous.",
          "deployment_state_ambiguous");
      }
      throw error;
    }
    evidence.target.versionId = versionId;
    try {
      evidence.deployment = structuredClone(await effects.observeDeployment(attempt.environment));
    } catch {
      evidence.target.versionId = null;
      evidence.deployment = {
        deploymentId: null,
        versionId: null,
        sourceSha: attempt.target.sourceSha,
        trafficPercent: null,
      };
      throw classifiedFailure("Product cutover deployment state is ambiguous.",
        "deployment_state_ambiguous");
    }
    if (deploymentError) {
      if (!isExactDeployment(evidence.deployment, attempt.target.sourceSha, versionId)) {
        throw classifiedFailure("Product cutover deployment state is ambiguous.",
          "deployment_state_ambiguous");
      }
      deploymentStatus = "ambiguous_reconciled";
    }
    if (!isExactDeployment(evidence.deployment, attempt.target.sourceSha, versionId)) {
      throw classifiedFailure("Product cutover target deployment identity mismatch.",
        "target_identity_mismatch");
    }
    if (!await effects.verifyCanonicalHealth(attempt.environment, evidence.deployment)) {
      throw classifiedFailure("Product cutover canonical health failed.",
        "canonical_health_failed");
    }
  } catch (error) {
    return failPhase("deployment", classifiedError(error, "deployment_failed"), error);
  }
  evidence.status = deploymentStatus;
  await write();

  evidence.phase = "unlock";
  evidence.status = "pending";
  await write();
  let unlockStatus: CutoverStatus = "succeeded";
  try {
    await effects.assertDeploymentOwnership(attempt.environment, evidence.target);
    evidence.unlock.inventoryBefore = structuredClone(evidence.migration.triggerInventory);
    await effects.assertDeploymentOwnership(attempt.environment, evidence.target);
    try {
      await effects.applyUnlock(attempt.environment, PRODUCT_UNLOCK_STATEMENTS);
      evidence.unlock.applyState = evidence.unlock.inventoryBefore.length === 0
        ? "already_absent"
        : "applied";
    } catch {
      try {
        evidence.unlock.inventoryAfter = observedTriggerInventory(
          await effects.readTriggerInventory(attempt.environment),
        );
      } catch {
        evidence.unlock.applyState = "failed";
        evidence.unlock.inventoryAfter = null;
        throw classifiedFailure("Product cutover unlock state is ambiguous.",
          "unlock_state_ambiguous");
      }
      if (evidence.unlock.inventoryAfter.length !== 0) {
        evidence.unlock.applyState = "failed";
        throw classifiedFailure("Product cutover unlock state is ambiguous.",
          "unlock_state_ambiguous");
      }
      evidence.unlock.applyState = "ambiguous_reconciled";
      unlockStatus = "ambiguous_reconciled";
    }
    if (evidence.unlock.inventoryAfter === null) {
      try {
        evidence.unlock.inventoryAfter = observedTriggerInventory(
          await effects.readTriggerInventory(attempt.environment),
        );
      } catch {
        evidence.unlock.applyState = "failed";
        evidence.unlock.inventoryAfter = null;
        throw classifiedFailure("Product cutover unlock state is ambiguous.",
          "unlock_state_ambiguous");
      }
    }
    if (evidence.unlock.inventoryAfter.length !== 0) {
      evidence.unlock.applyState = "failed";
      throw classifiedFailure("Product cutover unlock state is ambiguous.",
        "unlock_state_ambiguous");
    }
  } catch (error) {
    if (evidence.unlock.inventoryBefore !== null &&
        evidence.unlock.applyState === "not_started") {
      evidence.unlock.applyState = "failed";
    }
    return failPhase("unlock", classifiedError(error, "unlock_state_ambiguous"), error);
  }
  evidence.status = unlockStatus;
  await write();

  if (shouldRecordQaBinding) {
    try {
      const activeQaSource = await effects.readQaActiveSource();
      await effects.recordQaBinding(
        activeQaSource,
        qaBindingForTarget(activeQaSource, evidence.target, evidence.predecessor),
      );
    } catch (error) {
      return failPhase("unlock", "artifact_invalid", error);
    }
  }
  evidence.phase = "verified";
  evidence.status = "succeeded";
  try {
    await write();
  } catch (error) {
    evidence.phase = "unlock";
    evidence.status = "failed";
    evidence.failure = { phase: "unlock", classification: "artifact_invalid" };
    await write();
    throw error;
  }
  return evidence;
}

function isTerminalSuccess(artifact: ProductCutoverArtifact): boolean {
  return (artifact.phase === "unlock" || artifact.phase === "verified") &&
    (artifact.status === "succeeded" || artifact.status === "ambiguous_reconciled");
}

function isNewAttemptStart(artifact: ProductCutoverArtifact): boolean {
  return artifact.phase === "precheck" && artifact.status === "pending" &&
    artifact.failure === null;
}

function sameAttemptIdentity(
  previous: ProductCutoverArtifact,
  current: ProductCutoverArtifact,
): boolean {
  const normalizedTarget = (source: CutoverSourceRecord): CutoverSourceRecord => ({
    ...source,
    versionId: null,
  });
  return previous.transition === current.transition &&
    previous.environment === current.environment &&
    sameJson(previous.activeBefore, current.activeBefore) &&
    sameJson(normalizedTarget(previous.target), normalizedTarget(current.target)) &&
    sameJson(previous.predecessor, current.predecessor) &&
    previous.protocolBoundarySha === current.protocolBoundarySha &&
    previous.compatibilitySourceSha === current.compatibilitySourceSha &&
    previous.migration.name === current.migration.name &&
    previous.migration.sha256 === current.migration.sha256;
}

function isAllowedAttemptRestart(
  previous: ProductCutoverArtifact,
  current: ProductCutoverArtifact,
): boolean {
  if (!isNewAttemptStart(current) || previous.environment !== current.environment) return false;

  const normalizedTarget = (source: CutoverSourceRecord): CutoverSourceRecord => ({
    ...source,
    versionId: null,
  });
  const sameAttempt = sameAttemptIdentity(previous, current);
  const restartableNonterminalSuccess =
    (previous.phase === "precheck" && previous.status === "succeeded") ||
    (previous.phase === "migration" &&
      inSet(previous.status, ["succeeded", "ambiguous_reconciled"] as const));
  if ((previous.status === "pending" || previous.status === "failed" ||
       restartableNonterminalSuccess) && sameAttempt) return true;

  const topologyAdvancedToTarget = current.transition === "same-target-reconcile" &&
    (previous.phase === "deployment" || previous.phase === "unlock") &&
    sameJson(normalizedTarget(current.activeBefore), normalizedTarget(previous.target)) &&
    current.activeBefore.versionId !== null &&
    sameJson(current.target, current.activeBefore) &&
    current.predecessor.relationship === "exact" &&
    sameSource(current.activeBefore, current.predecessor);
  if (topologyAdvancedToTarget) return true;

  if (current.transition === "same-target-reconcile" && isTerminalSuccess(previous)) {
    return sameJson(current.activeBefore, previous.target) &&
      sameJson(current.target, previous.target) &&
      current.predecessor.relationship === "exact" &&
      sameSource(current.activeBefore, current.predecessor);
  }

  if (current.transition === "forward-repair" && isTerminalSuccess(previous)) {
    return sameJson(current.activeBefore, previous.target) &&
      current.predecessor.relationship === "exact" &&
      sameSource(current.activeBefore, current.predecessor) &&
      current.predecessor.lineageParentSourceSha === previous.target.sourceSha &&
      current.target.baseSourceSha === previous.target.sourceSha;
  }

  if (previous.transition !== "post-restoration-product-repair" ||
      previous.status !== "failed") return false;
  const previousTargetActive = previous.failure?.classification === "canonical_health_failed" ||
    (previous.deployment.trafficPercent ?? 0) > 0;
  if (current.transition === "post-restoration-product-repair" && !previousTargetActive) {
    return current.predecessor.runtimeFloorSourceSha ===
        previous.predecessor.runtimeFloorSourceSha &&
      current.predecessor.originalFailedRestorationSourceSha ===
        previous.predecessor.originalFailedRestorationSourceSha &&
      current.predecessor.lineageParentSourceSha === previous.target.sourceSha &&
      current.target.baseSourceSha === previous.target.sourceSha;
  }
  if (current.transition === "forward-repair" && previousTargetActive) {
    return sameJson(current.activeBefore, previous.target) &&
      current.predecessor.relationship === "exact" &&
      sameSource(current.activeBefore, current.predecessor) &&
      current.predecessor.lineageParentSourceSha === previous.target.sourceSha &&
      current.target.baseSourceSha === previous.target.sourceSha;
  }
  return false;
}

export async function writeProductCutoverArtifactFile(
  artifactDir: string,
  artifact: ProductCutoverArtifact,
): Promise<void> {
  assertProductCutoverArtifact(artifact);
  const filename = artifact.environment === "production"
    ? "production-product-cutover-state.json"
    : "qa-product-release.json";
  const filePath = path.join(artifactDir, filename);
  let previous: ProductCutoverArtifact | undefined;
  try {
    const parsed = record(JSON.parse(await readFile(filePath, "utf8")), "artifact envelope");
    exactKeys(parsed, ["cutover"], "artifact envelope");
    if (parsed.cutover !== undefined) {
      previous = parsed.cutover as ProductCutoverArtifact;
      assertProductCutoverArtifact(previous);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    previous &&
    sameAttemptIdentity(previous, artifact) &&
    previous.migration.recoveryBookmarkId !== null &&
    artifact.migration.recoveryBookmarkId !== previous.migration.recoveryBookmarkId
  ) {
    fail("recovery bookmark continuity");
  }
  if (!previous) {
    if (!isNewAttemptStart(artifact)) fail("first durable lifecycle state");
  } else if (!isAllowedAttemptRestart(previous, artifact)) {
    assertProductCutoverArtifact(artifact, previous);
  }
  await mkdir(artifactDir, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ cutover: artifact }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function validateProductCutoverStateFile(
  filePath: string,
  expectedEnvironment: CutoverEnvironment,
): Promise<ProductCutoverArtifact> {
  const envelope = record(await readJsonFile(filePath, "state file"), "state file");
  exactKeys(envelope, ["cutover"], "state file");
  const artifact = envelope.cutover as ProductCutoverArtifact;
  assertProductCutoverArtifact(artifact);
  if (artifact.environment !== expectedEnvironment) fail("state file environment");
  return artifact;
}
