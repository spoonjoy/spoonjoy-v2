import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as releaseModule from "../../scripts/deploy-production-canary";
import {
  assertAdditiveMigrationSql,
  type ReleaseCommandRunner,
} from "../../scripts/deploy-production-canary";

const MIGRATION_NAME = "0025_clem_feedback_product.sql";
const REVIEWED_MIGRATION_SQL = readFileSync(
  path.resolve("migrations", MIGRATION_NAME),
  "utf8",
);
const MIGRATION_SHA256 = "151009d5410997365ec56c249a50c75b7aeecadd0841b677f1b0bd7a9ab2c6e6";
const RUNTIME_FIXTURE_DIR = "test/fixtures/product-cutover";
const RUNTIME_BUNDLE_BUILDER_PATH = `${RUNTIME_FIXTURE_DIR}/build-runtime-bundle.mjs`;
const CANDIDATE_SOURCE_REF = "candidate";
const RELEASE_TOPOLOGY = JSON.parse(readFileSync(
  path.resolve(RUNTIME_FIXTURE_DIR, "release-topology.json"),
  "utf8",
)) as ReleaseTopology;
const COMPATIBILITY_SOURCE_SHA = "40b8f4c85f85f0fa1f807e150013bc7b9675eff5";
const COMPATIBILITY_BASE_SHA = "60c46277c01fc1065901a6fba24b9ff8cb15129d";
const QA_COMPATIBILITY_SOURCE_SHA = "3f79172ff802305ff8180af536a78ecbf5d39712";
const QA_COMPATIBILITY_BASE_SHA = "d242c37dd0edb3ed0a2452c9f96ce1e7d6e1487c";
const QA_COMPATIBILITY_TREE_SHA = "6dc720e8d4af087277c73240d0336d522e1c5aaa";
const QA_COMPATIBILITY_VERSION_ID = "aa058075-115e-4cb9-aaec-af49027eb314";
const PROTOCOL_BOUNDARY_SHA = "0a473a6b55a9cb0edaf8867b29d2b473c2cf15db";
const TARGET_SOURCE_SHA = "5de4856aef7d4d9376f9b2ccfa767557da5792b7";
const TARGET_BASE_SHA = "40fe91b7f21b567aed19ccc2c202bf78ebcab282";
const REPAIR_SOURCE_SHA = RELEASE_TOPOLOGY.ordinaryWorkerRepair.sourceSha;
const FAILED_RESTORATION_SHA = RELEASE_TOPOLOGY.failedRestoration.sourceSha;
const FAILED_REPAIR_SHA = RELEASE_TOPOLOGY.failedPostRestorationRepair.sourceSha;
const RUNTIME_FLOOR_SHA = RELEASE_TOPOLOGY.runtimeFloor.sourceSha;
const QA_ALIAS_SHA = RELEASE_TOPOLOGY.qaAlias.sourceSha;
const QA_POST_ALIAS_SHA = RELEASE_TOPOLOGY.qaPostAlias.sourceSha;
const NEXT_REPAIR_SHA = RELEASE_TOPOLOGY.nextPostRestorationRepair.sourceSha;
const POST_REPAIR_SOURCE_SHA = RELEASE_TOPOLOGY.postRestorationRepair.sourceSha;
const POST_WORKER_REPAIR_SOURCE_SHA = RELEASE_TOPOLOGY.postRestorationWorkerRepair.sourceSha;
const POST_BOTH_REPAIR_SOURCE_SHA = RELEASE_TOPOLOGY.postRestorationBothRepair.sourceSha;
const TOPOLOGY_PROTOCOL_BOUNDARY_SHA = RELEASE_TOPOLOGY.protocolBoundary.sourceSha;
const TREE_SHA = "82c49a457a547dbfb4effbccf458fbb98e251f8e";
const TARGET_TREE_SHA = "9ed82b8965f14741f5ef6c0cb6cfd143dea85040";
const RUNTIME_FLOOR_TREE_SHA = RELEASE_TOPOLOGY.runtimeFloor.treeSha;
const REPAIR_TREE_SHA = RELEASE_TOPOLOGY.ordinaryWorkerRepair.treeSha;
const FAILED_RESTORATION_TREE_SHA = RELEASE_TOPOLOGY.failedRestoration.treeSha;
const FAILED_REPAIR_TREE_SHA = RELEASE_TOPOLOGY.failedPostRestorationRepair.treeSha;
const NEXT_REPAIR_TREE_SHA = RELEASE_TOPOLOGY.nextPostRestorationRepair.treeSha;
const POST_REPAIR_TREE_SHA = RELEASE_TOPOLOGY.postRestorationRepair.treeSha;
const POST_WORKER_REPAIR_TREE_SHA = RELEASE_TOPOLOGY.postRestorationWorkerRepair.treeSha;
const POST_BOTH_REPAIR_TREE_SHA = RELEASE_TOPOLOGY.postRestorationBothRepair.treeSha;
const OTHER_TREE_SHA = "f".repeat(40);
const WORKER_BUNDLE_SHA256 = "eaadd8a4aa477879bbb478d399ef02933a54a76dbb03033aa4174389d9581e94";
const DO_BUNDLE_SHA256 = "cd7a4aa239af644cce7b4f9f0d3cddbba608028ad65bf8f664a3e68b7fd3e0d4";
const PRODUCT_WORKER_BUNDLE_SHA256 =
  "b8f5bb6dab268ee2dda73099716bd676812a1375ba8102d5fac8866ed1b19034";
const RUNTIME_FLOOR_WORKER_BUNDLE_SHA256 =
  "04b3f3f9e48dc1166991286d805d7d61c1ea9a3c4ae88ebc16037e62f3f89438";
const RUNTIME_FLOOR_DO_BUNDLE_SHA256 =
  "02c04af16fb1f6923436855955289cebd90ad15b5c5a99430601792f6b5cb721";
const CANDIDATE_WORKER_BUNDLE_SHA256 =
  "a3d50b03cdf441485fc15626b1630db4ca168151d70426620307275d5547cffa";
const CANDIDATE_DO_BUNDLE_SHA256 =
  "efcc98dd201a0858650a56cc08b37d0cec03ea07ed98a46c2b58b2ebbeeb47d2";
const OTHER_BUNDLE_SHA256 = "d".repeat(64);
const ACTIVE_VERSION_ID = "144bd85d-d0c8-41ea-ae3a-9abf0dbcb6aa";
const TARGET_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
const RECOVERY_BOOKMARK_ID = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
const INSERT_TRIGGER = "SavedRecipe_cutover_block_membership_insert";
const DELETE_TRIGGER = "SavedRecipe_cutover_block_membership_delete";
const BOTH_TRIGGERS = [DELETE_TRIGGER, INSERT_TRIGGER] as const;
const UNLOCK_STATEMENTS = [
  `DROP TRIGGER IF EXISTS ${INSERT_TRIGGER};`,
  `DROP TRIGGER IF EXISTS ${DELETE_TRIGGER};`,
] as const;
const UNLOCK_STATEMENTS_SHA256 = createHash("sha256")
  .update(UNLOCK_STATEMENTS.join("\n"), "utf8")
  .digest("hex");
const REVIEWED_REPAIR_PATHS = [
  ".github/workflows/production-deploy.yml",
  "scripts/deploy-production-canary.ts",
  "test/scripts/deploy-production-canary.test.ts",
] as const;
const NEXT_REPAIR_FLOOR_CHANGED_PATHS =
  RELEASE_TOPOLOGY.nextPostRestorationRepair.runtimeFloorChangedPaths!;
const PROTOCOL_BOUNDARY_MARKER_PATH = "workers/cook-session-protocol-v1-boundary";
const EXACT_RUNTIME_MANIFESTS = JSON.parse(readFileSync(
  path.resolve(RUNTIME_FIXTURE_DIR, "exact-runtime-manifests.json"),
  "utf8",
)) as ExactRuntimeFixtureManifest[];
const TOPOLOGY_RUNTIME_MANIFESTS = JSON.parse(readFileSync(
  path.resolve(RUNTIME_FIXTURE_DIR, "release-topology-runtime-manifests.json"),
  "utf8",
)) as ExactRuntimeFixtureManifest[];
const ALL_RUNTIME_MANIFESTS = [...EXACT_RUNTIME_MANIFESTS, ...TOPOLOGY_RUNTIME_MANIFESTS];
const RUNTIME_BUILD_DIGEST_CACHE = new Map<string, string>();

type CutoverEnvironment = "qa" | "production";
type CutoverTransition =
  | "initial"
  | "same-target-reconcile"
  | "forward-repair"
  | "post-restoration-product-repair";
type CutoverPhase = "precheck" | "migration" | "deployment" | "unlock" | "verified";
type CutoverStatus = "pending" | "succeeded" | "failed" | "ambiguous_reconciled";
type ReleaseMode = "atomic-bootstrap" | "atomic-product-activation" | "protocol-v1-canary";

interface CutoverSourceRecord {
  sourceSha: string;
  treeSha: string;
  workerBundleSha256: string;
  durableObjectBundleSha256: string;
  versionId: string | null;
  releaseMode: ReleaseMode;
  baseSourceSha: string;
}

interface CutoverPredecessorRecord {
  relationship: "exact" | "same-build-alias";
  canonicalSourceSha: string;
  canonicalTreeSha: string;
  canonicalWorkerBundleSha256: string;
  canonicalDurableObjectBundleSha256: string;
  lineageParentSourceSha: string;
  runtimeFloorSourceSha: string | null;
  originalFailedRestorationSourceSha: string | null;
}

interface CutoverAttempt {
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

interface CutoverDeploymentRecord {
  deploymentId: string | null;
  versionId: string | null;
  sourceSha: string;
  trafficPercent: number | null;
}

interface ProductCutoverArtifact {
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
    classification:
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
  } | null;
}

interface ProductCutoverPreflight {
  duplicateSavedRecipePairs: number;
  invalidSavedRecipeBackfillRows: number;
  cookStateTables: string[];
}

interface PostRestorationChainState {
  runtimeFloorSourceSha: string;
  originalFailedRestorationSourceSha: string;
  latestFailedRepairArtifact: ProductCutoverArtifact | null;
}

interface ExactSourceBundleManifest {
  mergeSha: string;
  treeSha: string;
  sourcePath: string;
  sourceBlobOid: string;
  sourceSha256: string;
  bundleSha256: string;
  buildCommand: string;
}

interface ExactRuntimeFixtureManifest extends ExactSourceBundleManifest {
  id: string;
  kind: "worker" | "durable-object";
  fixturePath: string;
  bundlePath: string;
}

interface ReleaseTopologyRecord {
  changedPaths: string[];
  durableObjectBlobOid: string;
  firstParentSha: string | null;
  mode: ReleaseMode;
  protocolBoundaryBlobOid: string | null;
  runtimeFloorChangedPaths: string[] | null;
  sourceSha: string;
  treeSha: string;
  workerBlobOid: string;
}

interface ReleaseTopology {
  compatibility: ReleaseTopologyRecord;
  failedPostRestorationRepair: ReleaseTopologyRecord;
  failedRestoration: ReleaseTopologyRecord;
  nextPostRestorationRepair: ReleaseTopologyRecord;
  ordinaryBothRepair: ReleaseTopologyRecord;
  ordinaryDoRepair: ReleaseTopologyRecord;
  ordinaryWorkerRepair: ReleaseTopologyRecord;
  postRestorationBothRepair: ReleaseTopologyRecord;
  postRestorationRepair: ReleaseTopologyRecord;
  postRestorationWorkerRepair: ReleaseTopologyRecord;
  protocolBoundary: ReleaseTopologyRecord;
  productTarget: ReleaseTopologyRecord;
  qaAlias: ReleaseTopologyRecord;
  qaPostAlias: ReleaseTopologyRecord;
  runtimeFloor: ReleaseTopologyRecord;
}

interface BidirectionalSkewReceipt {
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

interface PostRestorationApproval {
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

interface CutoverVerificationEffects {
  runCommand: ReleaseCommandRunner;
  commandEnv?: NodeJS.ProcessEnv;
  loadPredecessorBinding: (
    environment: CutoverEnvironment,
  ) => Promise<CutoverPredecessorRecord>;
  loadPostRestorationChainState: (
    environment: CutoverEnvironment,
  ) => Promise<PostRestorationChainState>;
  loadPostRestorationApproval: (
    environment: CutoverEnvironment,
    targetSourceSha: string,
  ) => Promise<PostRestorationApproval>;
  loadForwardRepairSkewReceipt: (
    environment: CutoverEnvironment,
    targetSourceSha: string,
  ) => Promise<BidirectionalSkewReceipt>;
  loadExecutedSkewReceipt: (receiptSha256: string) => Promise<BidirectionalSkewReceipt>;
}

interface ProductCutoverEffects extends CutoverVerificationEffects {
  readEvidence?: () => Promise<ProductCutoverArtifact | null>;
  readPreflight: (environment: CutoverEnvironment) => Promise<ProductCutoverPreflight>;
  readPendingMigrationNames: (environment: CutoverEnvironment) => Promise<string[]>;
  createRecoveryBookmark: (environment: CutoverEnvironment) => Promise<string>;
  applyMigration: (
    environment: CutoverEnvironment,
    migration: { name: string; sha256: string; sql: string },
  ) => Promise<void>;
  readTriggerInventory: (environment: CutoverEnvironment) => Promise<string[]>;
  resolveTargetVersion: (
    environment: CutoverEnvironment,
    targetSourceSha: string,
  ) => Promise<string>;
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
  applyUnlock: (
    environment: CutoverEnvironment,
    statements: readonly string[],
  ) => Promise<void>;
  readQaActiveSource: () => Promise<CutoverSourceRecord>;
  recordQaBinding: (
    activeQaSource: CutoverSourceRecord,
    predecessor: CutoverPredecessorRecord,
  ) => Promise<void>;
  writeEvidence: (artifact: ProductCutoverArtifact) => Promise<void>;
}

interface ProductCutoverApi {
  productRuntimeBundleDigests: (
    entrypoint: string,
    modules: readonly { name: string; bytes: Uint8Array }[],
  ) => { workerBundleSha256: string; durableObjectBundleSha256: string };
  assertReviewedMigrationSql: (filename: string, sql: string) => void;
  readProductCutoverSourceRecord: (
    environment: CutoverEnvironment,
    sourceSha: string,
    versionId: string | null,
    runCommand: ReleaseCommandRunner,
    env?: NodeJS.ProcessEnv,
    deployedRuntimeIdentity?: {
      workerBundleSha256: string;
      durableObjectBundleSha256: string;
    },
  ) => Promise<CutoverSourceRecord>;
  readD1RecoveryBookmark: (
    environment: CutoverEnvironment,
    runCommand: ReleaseCommandRunner,
    env?: NodeJS.ProcessEnv,
  ) => Promise<string>;
  assertProductCutoverPreconditions: (
    attempt: CutoverAttempt,
    effects: CutoverVerificationEffects,
  ) => Promise<void>;
  assertProductCutoverArtifact: (
    artifact: ProductCutoverArtifact,
    previous?: ProductCutoverArtifact,
  ) => void;
  writeProductCutoverArtifactFile: (
    artifactDir: string,
    artifact: ProductCutoverArtifact,
  ) => Promise<void>;
  validateProductCutoverStateFile: (
    filePath: string,
    environment: CutoverEnvironment,
  ) => Promise<ProductCutoverArtifact>;
  readPostRestorationApprovalFile: (
    artifactDir: string,
    environment: CutoverEnvironment,
    targetSourceSha: string,
  ) => Promise<PostRestorationApproval>;
  readForwardRepairSkewReceiptFile: (
    artifactDir: string,
    environment: CutoverEnvironment,
    targetSourceSha: string,
  ) => Promise<BidirectionalSkewReceipt>;
  readExecutedSkewReceiptFile: (
    artifactDir: string,
    receiptSha256: string,
  ) => Promise<BidirectionalSkewReceipt>;
  readPostRestorationChainStateFile: (
    evidenceDir: string,
    environment: CutoverEnvironment,
  ) => Promise<PostRestorationChainState>;
  runProductCutover: (
    attempt: CutoverAttempt,
    effects: ProductCutoverEffects,
  ) => Promise<ProductCutoverArtifact>;
}

const productCutoverApi = releaseModule as unknown as Partial<ProductCutoverApi>;

function requireApi<K extends keyof ProductCutoverApi>(name: K): ProductCutoverApi[K] {
  const value = productCutoverApi[name];
  expect(value, `deploy-production-canary must export ${name}`).toBeTypeOf("function");
  return value as ProductCutoverApi[K];
}

function sourceRecord(overrides: Partial<CutoverSourceRecord> = {}): CutoverSourceRecord {
  return {
    sourceSha: COMPATIBILITY_SOURCE_SHA,
    treeSha: TREE_SHA,
    workerBundleSha256: WORKER_BUNDLE_SHA256,
    durableObjectBundleSha256: DO_BUNDLE_SHA256,
    versionId: ACTIVE_VERSION_ID,
    releaseMode: "atomic-bootstrap",
    baseSourceSha: COMPATIBILITY_BASE_SHA,
    ...overrides,
  };
}

function predecessorRecord(
  overrides: Partial<CutoverPredecessorRecord> = {},
): CutoverPredecessorRecord {
  return {
    relationship: "exact",
    canonicalSourceSha: COMPATIBILITY_SOURCE_SHA,
    canonicalTreeSha: TREE_SHA,
    canonicalWorkerBundleSha256: WORKER_BUNDLE_SHA256,
    canonicalDurableObjectBundleSha256: DO_BUNDLE_SHA256,
    lineageParentSourceSha: COMPATIBILITY_SOURCE_SHA,
    runtimeFloorSourceSha: null,
    originalFailedRestorationSourceSha: null,
    ...overrides,
  };
}

function attempt(overrides: Partial<CutoverAttempt> = {}): CutoverAttempt {
  return {
    environment: "production",
    transition: "initial",
    activeBefore: sourceRecord(),
    target: sourceRecord({
      sourceSha: TARGET_SOURCE_SHA,
      treeSha: TARGET_TREE_SHA,
      workerBundleSha256: PRODUCT_WORKER_BUNDLE_SHA256,
      versionId: null,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TARGET_BASE_SHA,
    }),
    predecessor: predecessorRecord(),
    protocolBoundarySha: PROTOCOL_BOUNDARY_SHA,
    compatibilitySourceSha: COMPATIBILITY_SOURCE_SHA,
    compatibilityVersionId: ACTIVE_VERSION_ID,
    migrationName: MIGRATION_NAME,
    migrationSha256: MIGRATION_SHA256,
    migrationSql: REVIEWED_MIGRATION_SQL,
    ...overrides,
  };
}

function initialAttempt(environment: CutoverEnvironment): CutoverAttempt {
  if (environment === "production") return attempt();
  const activeBefore = sourceRecord({
    sourceSha: QA_COMPATIBILITY_SOURCE_SHA,
    treeSha: QA_COMPATIBILITY_TREE_SHA,
    versionId: QA_COMPATIBILITY_VERSION_ID,
    baseSourceSha: QA_COMPATIBILITY_BASE_SHA,
  });
  return attempt({
    environment,
    activeBefore,
    predecessor: predecessorRecord({
      canonicalSourceSha: activeBefore.sourceSha,
      canonicalTreeSha: activeBefore.treeSha,
      lineageParentSourceSha: activeBefore.sourceSha,
    }),
    compatibilitySourceSha: activeBefore.sourceSha,
    compatibilityVersionId: QA_COMPATIBILITY_VERSION_ID,
  });
}

function observedTarget(overrides: Partial<CutoverDeploymentRecord> = {}): CutoverDeploymentRecord {
  return {
    deploymentId: TARGET_DEPLOYMENT_ID,
    versionId: TARGET_VERSION_ID,
    sourceSha: TARGET_SOURCE_SHA,
    trafficPercent: 100,
    ...overrides,
  };
}

function treeForSourceSha(sourceSha: string): string {
  const topologyTreeSha = Object.values(RELEASE_TOPOLOGY).find(
    (record) => record.sourceSha === sourceSha,
  )?.treeSha;
  if (topologyTreeSha) return topologyTreeSha;
  return {
    [COMPATIBILITY_SOURCE_SHA]: TREE_SHA,
    [TARGET_SOURCE_SHA]: TARGET_TREE_SHA,
  }[sourceSha] ?? OTHER_TREE_SHA;
}

function topologyRecordForSourceSha(sourceSha: string): ReleaseTopologyRecord | undefined {
  return Object.values(RELEASE_TOPOLOGY).find((record) => record.sourceSha === sourceSha);
}

function changedPathsForSourceSha(sourceSha: string): string[] {
  const record = topologyRecordForSourceSha(sourceSha);
  return [...(record?.runtimeFloorChangedPaths ?? record?.changedPaths ?? REVIEWED_REPAIR_PATHS)];
}

function exactRuntimeManifest(
  sourceSha: string,
  kind: ExactRuntimeFixtureManifest["kind"],
  bundleSha256: string,
): ExactRuntimeFixtureManifest {
  const matches = ALL_RUNTIME_MANIFESTS.filter((manifest) => (
    manifest.mergeSha === sourceSha &&
    manifest.kind === kind &&
    manifest.bundleSha256 === bundleSha256
  ));
  expect(matches, `one exact manifest for ${sourceSha}:${kind}:${bundleSha256}`).toHaveLength(1);
  return matches[0];
}

interface GitEvidenceOptions {
  deniedAncestry?: readonly { ancestor: string; descendant: string }[];
  diffPaths?: readonly string[];
  firstParents?: Readonly<Record<string, string>>;
  releaseModes?: Readonly<Record<string, ReleaseMode>>;
}

function gitEvidenceRunner(options: GitEvidenceOptions = {}): ReleaseCommandRunner {
  const firstParents: Readonly<Record<string, string>> = {
    [TARGET_SOURCE_SHA]: TARGET_BASE_SHA,
    [RELEASE_TOPOLOGY.productTarget.sourceSha]: RELEASE_TOPOLOGY.compatibility.sourceSha,
    [TOPOLOGY_PROTOCOL_BOUNDARY_SHA]: RELEASE_TOPOLOGY.productTarget.sourceSha,
    [RUNTIME_FLOOR_SHA]: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
    [QA_ALIAS_SHA]: RUNTIME_FLOOR_SHA,
    [QA_POST_ALIAS_SHA]: FAILED_REPAIR_SHA,
    [REPAIR_SOURCE_SHA]: RUNTIME_FLOOR_SHA,
    [RELEASE_TOPOLOGY.ordinaryDoRepair.sourceSha]: RUNTIME_FLOOR_SHA,
    [RELEASE_TOPOLOGY.ordinaryBothRepair.sourceSha]: RUNTIME_FLOOR_SHA,
    [FAILED_RESTORATION_SHA]: RUNTIME_FLOOR_SHA,
    [POST_REPAIR_SOURCE_SHA]: FAILED_RESTORATION_SHA,
    [POST_WORKER_REPAIR_SOURCE_SHA]: FAILED_RESTORATION_SHA,
    [POST_BOTH_REPAIR_SOURCE_SHA]: FAILED_RESTORATION_SHA,
    [FAILED_REPAIR_SHA]: POST_REPAIR_SOURCE_SHA,
    [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA,
    ...options.firstParents,
  };
  const releaseModes: Readonly<Record<string, ReleaseMode>> = {
    [COMPATIBILITY_SOURCE_SHA]: "atomic-bootstrap",
    [TOPOLOGY_PROTOCOL_BOUNDARY_SHA]: "atomic-product-activation",
    [TARGET_SOURCE_SHA]: "atomic-product-activation",
    [RELEASE_TOPOLOGY.productTarget.sourceSha]: "atomic-product-activation",
    [REPAIR_SOURCE_SHA]: "atomic-product-activation",
    [RELEASE_TOPOLOGY.ordinaryDoRepair.sourceSha]: "atomic-product-activation",
    [RELEASE_TOPOLOGY.ordinaryBothRepair.sourceSha]: "atomic-product-activation",
    [POST_REPAIR_SOURCE_SHA]: "atomic-product-activation",
    [POST_WORKER_REPAIR_SOURCE_SHA]: "atomic-product-activation",
    [POST_BOTH_REPAIR_SOURCE_SHA]: "atomic-product-activation",
    [NEXT_REPAIR_SHA]: "atomic-product-activation",
    [FAILED_REPAIR_SHA]: "atomic-product-activation",
    [RUNTIME_FLOOR_SHA]: "atomic-product-activation",
    [FAILED_RESTORATION_SHA]: "protocol-v1-canary",
    [QA_ALIAS_SHA]: "atomic-product-activation",
    [QA_POST_ALIAS_SHA]: "atomic-product-activation",
    ...options.releaseModes,
  };
  const denied = new Set((options.deniedAncestry ?? []).map(
    ({ ancestor, descendant }) => `${ancestor}:${descendant}`,
  ));
  return vi.fn<ReleaseCommandRunner>(async (command, args) => {
    if (command === "node" && args[0] === RUNTIME_BUNDLE_BUILDER_PATH) {
      const buildCommand = [command, ...args].join(" ");
      return {
        stdout: `${JSON.stringify({ bundleSha256: runtimeBuildDigest(buildCommand) })}\n`,
        stderr: "",
      };
    }
    if (command !== "git") throw new Error("Unexpected source verification command.");
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      if (denied.has(`${args[2]}:${args[3]}`)) throw new Error("not an ancestor");
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1]?.endsWith("^")) {
      const sourceSha = args[1].slice(0, -1);
      return { stdout: `${firstParents[sourceSha] ?? COMPATIBILITY_BASE_SHA}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1]?.endsWith("^{tree}")) {
      const sourceSha = args[1].slice(0, -7);
      return {
        stdout: `${treeForSourceSha(sourceSha)}\n`,
        stderr: "",
      };
    }
    if (args[0] === "rev-parse" && args[1]?.includes(":")) {
      const [mergeSha, sourcePath] = args[1].split(/:(.*)/s, 2);
      const matches = ALL_RUNTIME_MANIFESTS.filter((manifest) => (
        manifest.mergeSha === mergeSha && manifest.sourcePath === sourcePath
      ));
      if (matches.length > 0) {
        const blobOids = [...new Set(matches.map((manifest) => manifest.sourceBlobOid))];
        if (blobOids.length !== 1) throw new Error(`Ambiguous Git blob identity: ${args[1]}`);
        return { stdout: `${blobOids[0]}\n`, stderr: "" };
      }
    }
    if (args[0] === "show" && args[1]?.includes(":")) {
      const [mergeSha, sourcePath] = args[1].split(/:(.*)/s, 2);
      const matches = ALL_RUNTIME_MANIFESTS.filter((manifest) => (
        manifest.mergeSha === mergeSha && manifest.sourcePath === sourcePath
      ));
      if (matches.length > 0) {
        const fixturePaths = [...new Set(matches.map((manifest) => manifest.fixturePath))];
        if (fixturePaths.length !== 1) throw new Error(`Ambiguous Git source fixture: ${args[1]}`);
        return { stdout: readFileSync(fixturePaths[0], "utf8"), stderr: "" };
      }
    }
    if (args[0] === "diff" && args[1] === "--name-only" && args.length === 3) {
      const targetSourceSha = args[2].split("...").at(-1)!;
      const diffPaths = options.diffPaths ?? changedPathsForSourceSha(targetSourceSha);
      return { stdout: `${diffPaths.join("\n")}\n`, stderr: "" };
    }
    if (
      args[0] === "show" &&
      args[1]?.endsWith(":.github/workflows/production-deploy.yml")
    ) {
      const sourceSha = args[1].split(":", 1)[0];
      return {
        stdout: `env:\n  SPOONJOY_RELEASE_MODE: ${releaseModes[sourceSha] ?? "atomic-product-activation"}\n`,
        stderr: "",
      };
    }
    throw new Error(`Unexpected Git verification argv: ${args.join(" ")}`);
  });
}

function verificationEffects(
  options: GitEvidenceOptions = {},
  overrides: Partial<CutoverVerificationEffects> = {},
): CutoverVerificationEffects {
  return {
    runCommand: gitEvidenceRunner(options),
    loadPredecessorBinding: vi.fn(async () => predecessorRecord()),
    loadPostRestorationChainState: vi.fn(async () => ({
      runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
      originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
      latestFailedRepairArtifact: null,
    })),
    loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(
      postRestorationAttempt(FAILED_RESTORATION_SHA),
    )),
    loadForwardRepairSkewReceipt: vi.fn(async () => bidirectionalSkewReceipt(
      ordinaryRepairAttempt(),
    )),
    loadExecutedSkewReceipt: vi.fn(async () => executedReceiptForActiveSource(
      ordinaryRepairAttempt(),
    )),
    ...overrides,
  };
}

function verificationForAttempt(
  value: CutoverAttempt,
  options: GitEvidenceOptions = {},
  overrides: Partial<CutoverVerificationEffects> = {},
): CutoverVerificationEffects {
  return verificationEffects(options, {
    loadPredecessorBinding: vi.fn(async () => clone(value.predecessor)),
    loadPostRestorationChainState: vi.fn(async () => ({
      runtimeFloorSourceSha: value.predecessor.runtimeFloorSourceSha ?? RUNTIME_FLOOR_SHA,
      originalFailedRestorationSourceSha:
        value.predecessor.originalFailedRestorationSourceSha ?? FAILED_RESTORATION_SHA,
      latestFailedRepairArtifact: null,
    })),
    loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value)),
    loadForwardRepairSkewReceipt: vi.fn(async () => bidirectionalSkewReceipt(value)),
    loadExecutedSkewReceipt: vi.fn(async () => executedReceiptForActiveSource(value)),
    ...overrides,
  });
}

function effects(
  overrides: Partial<ProductCutoverEffects> = {},
  value: CutoverAttempt = attempt(),
): ProductCutoverEffects {
  const deployment = observedTarget();
  return {
    runCommand: gitEvidenceRunner(),
    loadPredecessorBinding: vi.fn(async () => clone(value.predecessor)),
    loadPostRestorationChainState: vi.fn(async () => ({
      runtimeFloorSourceSha: value.predecessor.runtimeFloorSourceSha ?? RUNTIME_FLOOR_SHA,
      originalFailedRestorationSourceSha:
        value.predecessor.originalFailedRestorationSourceSha ?? FAILED_RESTORATION_SHA,
      latestFailedRepairArtifact: null,
    })),
    loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value)),
    loadForwardRepairSkewReceipt: vi.fn(async () => bidirectionalSkewReceipt(value)),
    loadExecutedSkewReceipt: vi.fn(async () => executedReceiptForActiveSource(value)),
    readPreflight: vi.fn(async () => ({
      duplicateSavedRecipePairs: 0,
      invalidSavedRecipeBackfillRows: 0,
      cookStateTables: [],
    })),
    readPendingMigrationNames: vi.fn()
      .mockResolvedValueOnce([MIGRATION_NAME])
      .mockResolvedValue([]),
    createRecoveryBookmark: vi.fn(async () => RECOVERY_BOOKMARK_ID),
    applyMigration: vi.fn(async () => undefined),
    readTriggerInventory: vi.fn()
      .mockResolvedValueOnce([...BOTH_TRIGGERS])
      .mockResolvedValue([]),
    resolveTargetVersion: vi.fn(async () => TARGET_VERSION_ID),
    observeDeployment: vi.fn(async () => deployment),
    assertDeploymentOwnership: vi.fn(async () => undefined),
    deployTarget: vi.fn(async () => deployment),
    verifyCanonicalHealth: vi.fn(async () => true),
    applyUnlock: vi.fn(async () => undefined),
    readQaActiveSource: vi.fn(async () => sourceRecord({
      sourceSha: QA_ALIAS_SHA,
      treeSha: value.target.treeSha,
      workerBundleSha256: value.target.workerBundleSha256,
      durableObjectBundleSha256: value.target.durableObjectBundleSha256,
      versionId: TARGET_VERSION_ID,
      releaseMode: "atomic-product-activation",
    })),
    recordQaBinding: vi.fn(async () => undefined),
    writeEvidence: vi.fn(async () => undefined),
    ...overrides,
  };
}

function successfulEffectsForAttempt(
  value: CutoverAttempt,
  overrides: Partial<ProductCutoverEffects> = {},
): ProductCutoverEffects {
  const deployment = observedTarget({ sourceSha: value.target.sourceSha });
  const repairOverrides: Partial<ProductCutoverEffects> = value.transition === "initial"
    ? {}
    : {
        readPendingMigrationNames: vi.fn(async () => []),
        readTriggerInventory: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([]),
      };
  const restorationOverrides: Partial<ProductCutoverEffects> =
    value.transition === "post-restoration-product-repair"
      ? {
          runCommand: gitEvidenceRunner({
            firstParents: {
              [value.target.sourceSha]: value.predecessor.lineageParentSourceSha,
            },
          }),
        }
      : {};
  return effects({
    ...repairOverrides,
    ...restorationOverrides,
    resolveTargetVersion: vi.fn(async () => TARGET_VERSION_ID),
    deployTarget: vi.fn(async () => deployment),
    observeDeployment: vi.fn(async () => deployment),
    ...overrides,
  }, value);
}

function expectSuccessfulLifecycleWrites(
  runEffects: ProductCutoverEffects,
  environment: CutoverEnvironment,
  transition: CutoverTransition,
): void {
  const artifacts = writtenLifecycleArtifacts(runEffects);
  expect(artifacts.map(({ phase, status }) => `${phase}:${status}`)).toEqual([
    "precheck:pending",
    "precheck:succeeded",
    "migration:pending",
    "migration:succeeded",
    "deployment:pending",
    "deployment:succeeded",
    "unlock:pending",
    "unlock:succeeded",
    "verified:succeeded",
  ]);
  for (const [index, current] of artifacts.entries()) {
    expect(current).toMatchObject({ environment, transition });
    expect(() => requireApi("assertProductCutoverArtifact")(
      current,
      index === 0 ? undefined : artifacts[index - 1],
    )).not.toThrow();
  }
}

function writtenLifecycleArtifacts(
  runEffects: ProductCutoverEffects,
): ProductCutoverArtifact[] {
  const calls = (runEffects.writeEvidence as unknown as {
    mock: { calls: Array<[ProductCutoverArtifact]> };
  }).mock.calls;
  return calls.map(([value]) => value).filter((value, index, values) => (
    index === 0 || value.phase !== values[index - 1].phase ||
    value.status !== values[index - 1].status
  ));
}

function expectTerminalFailureLifecycle(
  runEffects: ProductCutoverEffects,
  expectedAttempt: CutoverAttempt,
  expectedStates: readonly string[],
  phase: Exclude<CutoverPhase, "verified">,
  classification: NonNullable<ProductCutoverArtifact["failure"]>["classification"],
): void {
  const artifacts = writtenLifecycleArtifacts(runEffects);
  expect(artifacts.map(({ phase: writtenPhase, status }) => (
    `${writtenPhase}:${status}`
  ))).toEqual(expectedStates);
  expect(artifacts.at(-1)).toMatchObject({
    phase,
    status: "failed",
    failure: { phase, classification },
  });
  for (const evidence of artifacts) {
    expect(evidence).toMatchObject({
      environment: expectedAttempt.environment,
      transition: expectedAttempt.transition,
      activeBefore: expectedAttempt.activeBefore,
      target: {
        sourceSha: expectedAttempt.target.sourceSha,
        treeSha: expectedAttempt.target.treeSha,
        workerBundleSha256: expectedAttempt.target.workerBundleSha256,
        durableObjectBundleSha256: expectedAttempt.target.durableObjectBundleSha256,
        releaseMode: expectedAttempt.target.releaseMode,
        baseSourceSha: expectedAttempt.target.baseSourceSha,
      },
      predecessor: expectedAttempt.predecessor,
      protocolBoundarySha: expectedAttempt.protocolBoundarySha,
      compatibilitySourceSha: expectedAttempt.compatibilitySourceSha,
      migration: {
        name: expectedAttempt.migrationName,
        sha256: expectedAttempt.migrationSha256,
      },
    });
  }
  for (const [index, current] of artifacts.entries()) {
    expect(() => requireApi("assertProductCutoverArtifact")(
      current,
      index === 0 ? undefined : artifacts[index - 1],
    )).not.toThrow();
  }
}

function artifact(overrides: Partial<ProductCutoverArtifact> = {}): ProductCutoverArtifact {
  const activeBefore = sourceRecord();
  const target = sourceRecord({
    sourceSha: TARGET_SOURCE_SHA,
    versionId: TARGET_VERSION_ID,
    releaseMode: "atomic-product-activation",
    baseSourceSha: TARGET_BASE_SHA,
  });
  return {
    schemaVersion: 1,
    environment: "production",
    transition: "initial",
    phase: "verified",
    status: "succeeded",
    activeBefore,
    target,
    predecessor: predecessorRecord(),
    protocolBoundarySha: PROTOCOL_BOUNDARY_SHA,
    compatibilitySourceSha: COMPATIBILITY_SOURCE_SHA,
    migration: {
      name: MIGRATION_NAME,
      sha256: MIGRATION_SHA256,
      recoveryBookmarkId: RECOVERY_BOOKMARK_ID,
      applyState: "applied",
      triggerInventory: [...BOTH_TRIGGERS],
    },
    deployment: observedTarget(),
    unlock: {
      inventoryBefore: [...BOTH_TRIGGERS],
      statementsSha256: UNLOCK_STATEMENTS_SHA256,
      applyState: "applied",
      inventoryAfter: [],
    },
    failure: null,
    ...overrides,
  };
}

async function migrationSql(): Promise<string> {
  return REVIEWED_MIGRATION_SQL;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("reviewed product migration SQL gate", () => {
  it("is red against the existing additive-only gate", async () => {
    await expect(migrationSql()).resolves.toSatisfy((sql: string) => {
      expect(() => assertAdditiveMigrationSql(MIGRATION_NAME, sql)).toThrow("not additive");
      return true;
    });
  });

  it("accepts only the immutable reviewed 0025 bytes and their frozen digest", async () => {
    const sql = await migrationSql();
    expect(createHash("sha256").update(sql, "utf8").digest("hex")).toBe(MIGRATION_SHA256);
    expect(() => requireApi("assertReviewedMigrationSql")(MIGRATION_NAME, sql)).not.toThrow();
  });

  it("retains the ordinary additive migration path", () => {
    expect(() => requireApi("assertReviewedMigrationSql")(
      "0026_additive.sql",
      "CREATE TABLE FutureAdditive(id TEXT PRIMARY KEY);",
    )).not.toThrow();
  });

  it.each([
    ["migration clock create", 'CREATE TABLE "_Migration0025Clock"'],
    ["migration clock insert", 'INSERT INTO "_Migration0025Clock"'],
    ["migration clock reference", 'CROSS JOIN "_Migration0025Clock"'],
    ["migration clock drop", 'DROP TABLE "_Migration0025Clock"'],
    ["legacy index drop", 'DROP INDEX "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key"'],
    ["active identity index", 'CREATE UNIQUE INDEX "ShoppingListItem_active_identity_key"'],
    ["insert fence", `CREATE TRIGGER "${INSERT_TRIGGER}"`],
    ["delete fence", `CREATE TRIGGER "${DELETE_TRIGGER}"`],
  ])("accepts the exact reviewed %s statement only as part of 0025", async (_label, needle) => {
    const sql = await migrationSql();
    expect(sql).toContain(needle);
    expect(() => requireApi("assertReviewedMigrationSql")(MIGRATION_NAME, sql)).not.toThrow();
  });

  it.each([
    "DROP TABLE Recipe;",
    "DROP INDEX Recipe_title_idx;",
    `DROP TRIGGER ${INSERT_TRIGGER};`,
    "DROP VIEW RecipeSummary;",
    "INSERT INTO Recipe(id) VALUES ('unreviewed');",
    "INSERT OR REPLACE INTO Recipe(id) VALUES ('unreviewed');",
    "REPLACE INTO Recipe(id) VALUES ('unreviewed');",
    "UPDATE Recipe SET title = 'unreviewed';",
    "DELETE FROM Recipe;",
    "CREATE TRIGGER unreviewed BEFORE INSERT ON Recipe BEGIN SELECT 1; END;",
    "CREATE UNIQUE INDEX unreviewed_existing_key ON Recipe(title);",
    "CREATE INDEX unreviewed_partial_idx ON Recipe(title) WHERE deletedAt IS NULL;",
  ])("rejects an unrelated reviewed-maintenance form: %s", async (statement) => {
    const sql = await migrationSql();
    expect(() => requireApi("assertReviewedMigrationSql")(
      MIGRATION_NAME,
      `${sql}\n${statement}\n`,
    )).toThrow("reviewed");
  });

  it.each([
    ["wrong filename", "0026_clem_feedback_product.sql", (sql: string) => sql],
    ["changed clock table", MIGRATION_NAME, (sql: string) => sql.replace("_Migration0025Clock", "_Migration0025Clock2")],
    ["changed legacy index", MIGRATION_NAME, (sql: string) => sql.replace("ShoppingListItem_shoppingListId_unitId_ingredientRefId_key", "Other_idx")],
    ["changed trigger body", MIGRATION_NAME, (sql: string) => sql.replace("saved_recipe_cutover_pending", "other_cutover")],
    ["missing final newline", MIGRATION_NAME, (sql: string) => sql.replace(/\n$/, "")],
  ])("rejects the reviewed migration with %s", async (_label, filename, mutate) => {
    const sql = await migrationSql();
    expect(() => requireApi("assertReviewedMigrationSql")(
      filename,
      mutate(sql),
    )).toThrow("reviewed");
  });
});

describe("exact product cutover source records", () => {
  it("returns the frozen compatibility runtime without rebuilding historical bytes", async () => {
    const runCommand = vi.fn<ReleaseCommandRunner>();

    await expect(requireApi("readProductCutoverSourceRecord")(
      "production",
      COMPATIBILITY_SOURCE_SHA,
      ACTIVE_VERSION_ID,
      runCommand,
    )).resolves.toEqual(sourceRecord());
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns the separately frozen QA compatibility runtime identity", async () => {
    const runCommand = vi.fn<ReleaseCommandRunner>();

    await expect(requireApi("readProductCutoverSourceRecord")(
      "qa",
      QA_COMPATIBILITY_SOURCE_SHA,
      QA_COMPATIBILITY_VERSION_ID,
      runCommand,
    )).resolves.toEqual(sourceRecord({
      sourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      treeSha: QA_COMPATIBILITY_TREE_SHA,
      versionId: QA_COMPATIBILITY_VERSION_ID,
      baseSourceSha: QA_COMPATIBILITY_BASE_SHA,
    }));
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("rebuilds an arbitrary exact Git source into deterministic Worker and DO identities", async () => {
    const deployedEntry = "export class CookSession {}; export default {};\n";
    const runtimeIdentity = requireApi("productRuntimeBundleDigests")("_worker.js", [{
      name: "_worker.js",
      bytes: Buffer.from(deployedEntry),
    }]);
    const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
      if (command === "git") {
        const key = args.join(" ");
        const responses: Record<string, string> = {
          [`rev-parse ${TARGET_SOURCE_SHA}^{tree}`]: TARGET_TREE_SHA,
          [`rev-parse ${TARGET_SOURCE_SHA}^`]: TARGET_BASE_SHA,
          [`show ${TARGET_SOURCE_SHA}:.github/workflows/production-deploy.yml`]:
            "env:\n  SPOONJOY_RELEASE_MODE: atomic-product-activation\n",
          "rev-parse HEAD": TARGET_SOURCE_SHA,
        };
        if (responses[key] !== undefined) return { stdout: responses[key], stderr: "" };
      }
      if (command === "pnpm" && args.slice(0, 4).join(" ") ===
          "exec wrangler deploy --dry-run") {
        const outdir = args[args.indexOf("--outdir") + 1];
        await mkdir(outdir, { recursive: true });
        await writeFile(path.join(outdir, "_worker.js"), deployedEntry);
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected source-record command: ${command} ${args.join(" ")}`);
    });

    await expect(requireApi("readProductCutoverSourceRecord")(
      "qa",
      TARGET_SOURCE_SHA,
      null,
      runCommand,
      { PATH: "/test/bin" },
    )).resolves.toEqual(sourceRecord({
      sourceSha: TARGET_SOURCE_SHA,
      treeSha: TARGET_TREE_SHA,
      ...runtimeIdentity,
      versionId: null,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TARGET_BASE_SHA,
    }));
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["exec", "wrangler", "deploy", "--dry-run", "--env", "qa"]),
      { env: { PATH: "/test/bin" } },
    );
  });

  it.each([
    ["invalid source", "A".repeat(40), null],
    ["invalid version", TARGET_SOURCE_SHA, "not-a-version"],
  ])("rejects %s before running evidence commands", async (_label, sourceSha, versionId) => {
    const runCommand = vi.fn<ReleaseCommandRunner>();
    await expect(requireApi("readProductCutoverSourceRecord")(
      "production",
      sourceSha,
      versionId,
      runCommand,
    )).rejects.toThrow(/source record/i);
    expect(runCommand).not.toHaveBeenCalled();
  });
});

describe("exact-source runtime bundle fixture", () => {
  it("executes every recorded deterministic build and reproduces source/blob/bundle digests", () => {
    const builtCommands = new Map<string, string>();
    expect(new Set(ALL_RUNTIME_MANIFESTS.map(({ id }) => id)).size)
      .toBe(ALL_RUNTIME_MANIFESTS.length);
    for (const manifest of ALL_RUNTIME_MANIFESTS) {
      const sourceBytes = readFileSync(manifest.fixturePath);
      expect(manifest.mergeSha, manifest.id).toMatch(/^[0-9a-f]{40}$/);
      expect(manifest.treeSha, manifest.id).toMatch(/^[0-9a-f]{40}$/);
      const sourceBlobOid = createHash("sha1")
        .update(`blob ${sourceBytes.byteLength}\0`, "utf8")
        .update(sourceBytes)
        .digest("hex");
      expect(sourceBlobOid, manifest.id).toBe(manifest.sourceBlobOid);
      expect(createHash("sha256").update(sourceBytes).digest("hex"), manifest.id)
        .toBe(manifest.sourceSha256);
      expect(
        createHash("sha256").update(readFileSync(manifest.bundlePath)).digest("hex"),
        manifest.id,
      ).toBe(manifest.bundleSha256);

      let first = builtCommands.get(manifest.buildCommand);
      if (!first) {
        const [command, ...args] = manifest.buildCommand.split(" ");
        const build = () => execFileSync(command, args, { encoding: "utf8" });
        first = build();
        expect(build(), `${manifest.id} deterministic output`).toBe(first);
        builtCommands.set(manifest.buildCommand, first);
      }
      expect(JSON.parse(first), manifest.id).toEqual({ bundleSha256: manifest.bundleSha256 });
    }
  }, 60_000);

  it("reconstructs every positive release identity with exact parent, mode, diff, and source bytes", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-topology-"));
    try {
      const rebuilt = JSON.parse(execFileSync(
        process.execPath,
        [`${RUNTIME_FIXTURE_DIR}/build-release-topology.mjs`, repoDir],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )) as ReleaseTopology;
      expect(rebuilt).toEqual(RELEASE_TOPOLOGY);

      expect(rebuilt.productTarget).toMatchObject({
        firstParentSha: rebuilt.compatibility.sourceSha,
        mode: "atomic-product-activation",
        protocolBoundaryBlobOid: null,
      });
      expect(rebuilt.productTarget.workerBlobOid).toBe(
        exactRuntimeManifest(TARGET_SOURCE_SHA, "worker", PRODUCT_WORKER_BUNDLE_SHA256)
          .sourceBlobOid,
      );
      expect(rebuilt.productTarget.durableObjectBlobOid).toBe(
        exactRuntimeManifest(TARGET_SOURCE_SHA, "durable-object", DO_BUNDLE_SHA256)
          .sourceBlobOid,
      );
      expect(rebuilt.protocolBoundary).toMatchObject({
        changedPaths: [
          "evidence/release-topology",
          "workers/app.ts",
          PROTOCOL_BOUNDARY_MARKER_PATH,
          "workers/cook-session.ts",
        ],
        firstParentSha: rebuilt.productTarget.sourceSha,
        mode: "atomic-product-activation",
      });
      expect(rebuilt.protocolBoundary.protocolBoundaryBlobOid).toMatch(/^[0-9a-f]{40}$/);
      expect(rebuilt.runtimeFloor).toMatchObject({
        changedPaths: ["evidence/release-topology"],
        firstParentSha: rebuilt.protocolBoundary.sourceSha,
        mode: "atomic-product-activation",
        protocolBoundaryBlobOid: rebuilt.protocolBoundary.protocolBoundaryBlobOid,
        runtimeFloorChangedPaths: [],
        workerBlobOid: rebuilt.protocolBoundary.workerBlobOid,
        durableObjectBlobOid: rebuilt.protocolBoundary.durableObjectBlobOid,
      });
      expect(execFileSync(
        "git",
        ["log", "--format=%H", "--diff-filter=A", "--", PROTOCOL_BOUNDARY_MARKER_PATH],
        { cwd: repoDir, encoding: "utf8" },
      ).trim()).toBe(rebuilt.protocolBoundary.sourceSha);
      expect(rebuilt.qaAlias).toMatchObject({
        changedPaths: [],
        firstParentSha: rebuilt.runtimeFloor.sourceSha,
        treeSha: rebuilt.runtimeFloor.treeSha,
        workerBlobOid: rebuilt.runtimeFloor.workerBlobOid,
        durableObjectBlobOid: rebuilt.runtimeFloor.durableObjectBlobOid,
      });
      expect(rebuilt.qaAlias.sourceSha).not.toBe(rebuilt.runtimeFloor.sourceSha);
      for (const [name, changedPaths] of [
        ["ordinaryWorkerRepair", ["workers/app.ts"]],
        ["ordinaryDoRepair", ["workers/cook-session.ts"]],
        ["ordinaryBothRepair", ["workers/app.ts", "workers/cook-session.ts"]],
      ] as const) {
        expect(rebuilt[name]).toMatchObject({
          changedPaths,
          firstParentSha: rebuilt.runtimeFloor.sourceSha,
          mode: "atomic-product-activation",
          runtimeFloorChangedPaths: changedPaths,
        });
      }
      expect(rebuilt.failedRestoration).toMatchObject({
        firstParentSha: rebuilt.runtimeFloor.sourceSha,
        mode: "protocol-v1-canary",
      });
      expect(rebuilt.failedRestoration.changedPaths).toEqual([
        ".github/workflows/production-deploy.yml",
        "evidence/release-topology",
        "workers/app.ts",
        "workers/cook-session.ts",
      ]);
      for (const [name, changedPaths, runtimeFloorChangedPaths] of [
        [
          "postRestorationWorkerRepair",
          [
            ".github/workflows/production-deploy.yml",
            "evidence/release-topology",
            "workers/app.ts",
          ],
          ["evidence/release-topology", "workers/cook-session.ts"],
        ],
        [
          "postRestorationRepair",
          [
            ".github/workflows/production-deploy.yml",
            "evidence/release-topology",
            "workers/cook-session.ts",
          ],
          ["evidence/release-topology", "workers/app.ts"],
        ],
        [
          "postRestorationBothRepair",
          [
            ".github/workflows/production-deploy.yml",
            "evidence/release-topology",
          ],
          ["evidence/release-topology", "workers/app.ts", "workers/cook-session.ts"],
        ],
      ] as const) {
        expect(rebuilt[name]).toMatchObject({
          changedPaths,
          firstParentSha: rebuilt.failedRestoration.sourceSha,
          mode: "atomic-product-activation",
          runtimeFloorChangedPaths,
        });
      }
      expect(rebuilt.postRestorationWorkerRepair).toMatchObject({
        workerBlobOid: rebuilt.runtimeFloor.workerBlobOid,
        durableObjectBlobOid: rebuilt.failedRestoration.durableObjectBlobOid,
      });
      expect(rebuilt.postRestorationRepair).toMatchObject({
        workerBlobOid: rebuilt.failedRestoration.workerBlobOid,
        durableObjectBlobOid: rebuilt.runtimeFloor.durableObjectBlobOid,
      });
      expect(rebuilt.postRestorationBothRepair).toMatchObject({
        workerBlobOid: rebuilt.failedRestoration.workerBlobOid,
        durableObjectBlobOid: rebuilt.failedRestoration.durableObjectBlobOid,
      });
      expect(rebuilt.failedPostRestorationRepair).toMatchObject({
        changedPaths: ["evidence/release-topology"],
        firstParentSha: rebuilt.postRestorationRepair.sourceSha,
        mode: "atomic-product-activation",
      });
      expect(rebuilt.qaPostAlias).toMatchObject({
        changedPaths: [],
        firstParentSha: rebuilt.failedPostRestorationRepair.sourceSha,
        treeSha: rebuilt.failedPostRestorationRepair.treeSha,
        workerBlobOid: rebuilt.failedPostRestorationRepair.workerBlobOid,
        durableObjectBlobOid: rebuilt.failedPostRestorationRepair.durableObjectBlobOid,
      });
      expect(rebuilt.nextPostRestorationRepair).toMatchObject({
        changedPaths: ["evidence/release-topology", "workers/app.ts"],
        firstParentSha: rebuilt.failedPostRestorationRepair.sourceSha,
        mode: "atomic-product-activation",
        runtimeFloorChangedPaths: ["evidence/release-topology"],
        workerBlobOid: rebuilt.runtimeFloor.workerBlobOid,
        durableObjectBlobOid: rebuilt.runtimeFloor.durableObjectBlobOid,
      });

      for (const manifest of TOPOLOGY_RUNTIME_MANIFESTS) {
        expect(execFileSync(
          "git",
          ["show", `${manifest.mergeSha}:${manifest.sourcePath}`],
          { cwd: repoDir },
        ), manifest.id).toEqual(readFileSync(manifest.fixturePath));
      }
      for (const descendant of [
        rebuilt.runtimeFloor.sourceSha,
        rebuilt.ordinaryWorkerRepair.sourceSha,
        rebuilt.ordinaryDoRepair.sourceSha,
        rebuilt.ordinaryBothRepair.sourceSha,
        rebuilt.failedRestoration.sourceSha,
        rebuilt.postRestorationWorkerRepair.sourceSha,
        rebuilt.postRestorationRepair.sourceSha,
        rebuilt.postRestorationBothRepair.sourceSha,
        rebuilt.failedPostRestorationRepair.sourceSha,
        rebuilt.nextPostRestorationRepair.sourceSha,
      ]) {
        for (const ancestor of [
          rebuilt.productTarget.sourceSha,
          rebuilt.protocolBoundary.sourceSha,
          rebuilt.runtimeFloor.sourceSha,
        ]) {
          expect(() => execFileSync(
            "git",
            ["merge-base", "--is-ancestor", ancestor, descendant],
            { cwd: repoDir, stdio: "ignore" },
          )).not.toThrow();
        }
        const descendantRecord = Object.values(rebuilt).find(
          (record) => record.sourceSha === descendant,
        );
        expect(descendantRecord?.protocolBoundaryBlobOid)
          .toBe(rebuilt.protocolBoundary.protocolBoundaryBlobOid);
      }
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("binds mocked Git evidence to the exact merge and historical path pair", async () => {
    const runner = gitEvidenceRunner();
    const manifest = EXACT_RUNTIME_MANIFESTS.find(({ id }) => id === "pr-283-worker")!;
    await expect(runner("git", [
      "show",
      `${manifest.mergeSha}:${manifest.sourcePath}`,
    ])).resolves.toEqual({ stdout: readFileSync(manifest.fixturePath, "utf8"), stderr: "" });
    await expect(runner("git", [
      "show",
      `${COMPATIBILITY_SOURCE_SHA}:workers/not-the-worker.ts`,
    ])).rejects.toThrow("Unexpected Git verification argv");
    await expect(runner("git", [
      "show",
      `${"f".repeat(40)}:${manifest.sourcePath}`,
    ])).rejects.toThrow("Unexpected Git verification argv");
  });

  it("executes both historical Worker/Durable Object skew matrices", async () => {
    const loadBundle = async (bundlePath: string, identity: string) => import(
      `${pathToFileURL(path.resolve(bundlePath)).href}?identity=${identity}`
    ) as Promise<{
      default: { fetch: (request: Request, env: Record<string, unknown>, ctx: ExecutionContext) => Promise<Response> };
      CookSession: new (state: unknown, env: unknown) => { fetch: (request: Request) => Promise<Response> };
    }>;
    const predecessorWorker = await loadBundle(
      exactRuntimeManifest(
        PROTOCOL_BOUNDARY_SHA,
        "worker",
        "0ec10563d90efb4dbf6ce7461d2f1c48b451c7dada1f8cb2c81fe9601859f743",
      ).bundlePath,
      "predecessor-worker",
    );
    const predecessorDo = await loadBundle(
      exactRuntimeManifest(PROTOCOL_BOUNDARY_SHA, "durable-object", DO_BUNDLE_SHA256).bundlePath,
      "predecessor-do",
    );
    const candidateWorker = await loadBundle(
      exactRuntimeManifest(COMPATIBILITY_SOURCE_SHA, "worker", WORKER_BUNDLE_SHA256).bundlePath,
      "candidate-worker",
    );
    const candidateDo = await loadBundle(
      exactRuntimeManifest(COMPATIBILITY_SOURCE_SHA, "durable-object", DO_BUNDLE_SHA256).bundlePath,
      "candidate-do",
    );

    const env = {
      DB: {},
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
      __fixturePrincipal: {
        source: "bearer",
        credentialId: "exact-fixture",
        scopes: ["account:write", "kitchen:read", "kitchen:write"],
        oauthResource: "urn:spoonjoy:account-delete-intent:v1",
      },
    };
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const workerRequest = (method: string, pathname: string) => ({
      body: null,
      headers: new Headers({ Origin: "https://spoonjoy.app" }),
      method,
      url: `https://spoonjoy.app${pathname}`,
    }) as Request;
    const state = {
      storage: {
        deleteAlarm: vi.fn(),
        deleteAll: vi.fn(),
        sql: { exec: vi.fn() },
      },
    };
    const bootstrapState = () => ({
      storage: {
        deleteAlarm: async () => undefined,
        deleteAll: async () => undefined,
        sql: {
          exec: (query: string) => {
            const rows = query.startsWith("SELECT value") ? [{ value: "sqlite" }] : [];
            return Object.assign(rows, {
              one: () => rows[0],
            });
          },
        },
      },
    });
    const bindingFor = (RuntimeDo: typeof predecessorDo.CookSession) => {
      const fetch = vi.fn((request: Request) => (
        new RuntimeDo(bootstrapState(), {}).fetch(request)
      ));
      return {
        fetch,
        namespace: {
          idFromName: (name: string) => name,
          get: () => ({ fetch }),
        },
      };
    };
    const bootstrapRequest = () => new Request(
      "https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.10" } },
    );
    const bootstrapEnv = (namespace: ReturnType<typeof bindingFor>["namespace"]) => ({
      ...env,
      AUTH_IP_RATE_LIMITER: { limit: async () => ({ success: true }) },
      CF_VERSION_METADATA: { id: "exact-cross-version" },
      COOK_SESSIONS: namespace,
      COOK_SESSION_BOOTSTRAP_MODE: "1",
    });
    const internalRequest = (method: string, pathname: string) => new Request(
      `https://cook-session.internal${pathname}`,
      { method, headers: { "X-Spoonjoy-Cook-Protocol": "1" } },
    );

    const candidateWorkerRecipe = await candidateWorker.default.fetch(
      workerRequest("GET", "/api/cook-sessions/exact-recipe"),
      env,
      ctx,
    );
    const candidateWorkerOwner = await candidateWorker.default.fetch(
      workerRequest("DELETE", "/api/cook-sessions"),
      env,
      ctx,
    );
    const candidateWorkerOwnerBody = await candidateWorkerOwner.clone().json();
    const predecessorDoRecipe = await new predecessorDo.CookSession(state, {}).fetch(
      internalRequest("GET", "/api/cook-sessions/exact-recipe"),
    );
    const predecessorDoOwnerSentinel = await new predecessorDo.CookSession(state, {}).fetch(
      internalRequest("DELETE", "/api/cook-sessions/__owner__"),
    );
    const predecessorDoBinding = bindingFor(predecessorDo.CookSession);
    const candidateWorkerWithPredecessorDo = await candidateWorker.default.fetch(
      bootstrapRequest(),
      bootstrapEnv(predecessorDoBinding.namespace),
      ctx,
    );
    expect([
      candidateWorkerRecipe.status,
      candidateWorkerOwner.status,
      predecessorDoRecipe.status,
      predecessorDoOwnerSentinel.status,
      candidateWorkerWithPredecessorDo.status,
      candidateWorkerOwnerBody,
    ]).toEqual([503, 503, 503, 503, 200, {
      error: {
        code: "cook_session_protocol_unavailable",
        message: "Cook session protocol is temporarily unavailable.",
        retryable: true,
      },
    }]);

    const predecessorWorkerRecipe = await predecessorWorker.default.fetch(
      workerRequest("GET", "/api/cook-sessions/exact-recipe"),
      env,
      ctx,
    );
    const predecessorWorkerOwner = await predecessorWorker.default.fetch(
      workerRequest("DELETE", "/api/cook-sessions"),
      env,
      ctx,
    );
    const candidateDoRecipe = await new candidateDo.CookSession(state, {}).fetch(
      internalRequest("GET", "/api/cook-sessions/exact-recipe"),
    );
    const candidateDoOwnerSentinel = await new candidateDo.CookSession(state, {}).fetch(
      internalRequest("DELETE", "/api/cook-sessions/__owner__"),
    );
    const candidateDoBinding = bindingFor(candidateDo.CookSession);
    const predecessorWorkerWithCandidateDo = await predecessorWorker.default.fetch(
      bootstrapRequest(),
      bootstrapEnv(candidateDoBinding.namespace),
      ctx,
    );
    expect([
      predecessorWorkerRecipe.status,
      predecessorWorkerOwner.status,
      candidateDoRecipe.status,
      candidateDoOwnerSentinel.status,
      predecessorWorkerWithCandidateDo.status,
    ]).toEqual([503, 404, 503, 503, 200]);
    await expect(candidateWorkerWithPredecessorDo.json()).resolves.toEqual({
      ok: true,
      residue: 0,
      storage: "sqlite",
      workerVersionId: "exact-cross-version",
    });
    await expect(predecessorWorkerWithCandidateDo.json()).resolves.toEqual({
      ok: true,
      residue: 0,
      storage: "sqlite",
      workerVersionId: "exact-cross-version",
    });
    for (const binding of [predecessorDoBinding, candidateDoBinding]) {
      expect(binding.fetch).toHaveBeenCalledTimes(1);
      const outbound = binding.fetch.mock.calls[0][0];
      expect(new URL(outbound.url).pathname).toBe("/__bootstrap/probe");
      expect(outbound.method).toBe("POST");
      expect(outbound.headers.get("X-Spoonjoy-Internal-Probe")).toBe("1");
    }
    await expect(candidateWorkerOwner.json()).resolves.toEqual({
      error: {
        code: "cook_session_protocol_unavailable",
        message: "Cook session protocol is temporarily unavailable.",
        retryable: true,
      },
    });
  });

  it.each([
    ["Worker-only", REPAIR_SOURCE_SHA, CANDIDATE_WORKER_BUNDLE_SHA256, RUNTIME_FLOOR_DO_BUNDLE_SHA256],
    ["Durable-Object-only", RELEASE_TOPOLOGY.ordinaryDoRepair.sourceSha, RUNTIME_FLOOR_WORKER_BUNDLE_SHA256, CANDIDATE_DO_BUNDLE_SHA256],
    ["Worker-and-Durable-Object", RELEASE_TOPOLOGY.ordinaryBothRepair.sourceSha, CANDIDATE_WORKER_BUNDLE_SHA256, CANDIDATE_DO_BUNDLE_SHA256],
  ])("executes both product-era skew matrices for %s runtime change", async (
    label,
    candidateSourceSha,
    candidateWorkerDigest,
    candidateDoDigest,
  ) => {
    const loadBundle = async (manifest: ExactRuntimeFixtureManifest, identity: string) => import(
      `${pathToFileURL(path.resolve(manifest.bundlePath)).href}?identity=${identity}`
    ) as Promise<{
      default: {
        fetch: (
          request: Request,
          env: Record<string, unknown>,
          ctx: ExecutionContext,
        ) => Promise<Response>;
      };
      CookSession: new (
        state: unknown,
        env: unknown,
      ) => { fetch: (request: Request) => Promise<Response> };
    }>;
    const predecessorWorker = await loadBundle(
      exactRuntimeManifest(
        RUNTIME_FLOOR_SHA,
        "worker",
        RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      ),
      `${label}-predecessor-worker`,
    );
    const predecessorDo = await loadBundle(
      exactRuntimeManifest(
        RUNTIME_FLOOR_SHA,
        "durable-object",
        RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      ),
      `${label}-predecessor-do`,
    );
    const candidateWorker = await loadBundle(
      exactRuntimeManifest(candidateSourceSha, "worker", candidateWorkerDigest),
      `${label}-candidate-worker`,
    );
    const candidateDo = await loadBundle(
      exactRuntimeManifest(candidateSourceSha, "durable-object", candidateDoDigest),
      `${label}-candidate-do`,
    );
    const publicBody = {
      attemptId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 7,
      mutationId: "00000000-0000-4000-8000-000000000001",
      changes: {
        activeStepIndex: 1,
        scaleFactor: 2,
        checkedIngredientIds: ["ingredient-id"],
        checkedStepOutputIds: ["step-output-id"],
      },
    };
    const internalBody = {
      phase: "apply",
      operation: "patch",
      recipeId: "exact-product-recipe",
      mutationId: publicBody.mutationId,
      requestHash: "dfefbbd4a395316afdabfb09cd6d854da60015b2e01c934990276a3d66fb6be0",
      expectedOwnerEpoch: null,
      expectedAttemptId: publicBody.attemptId,
      expectedRevision: publicBody.expectedRevision,
      payload: publicBody.changes,
      snapshot: null,
    };
    const workerRequest = () => new Request(
      "https://spoonjoy.app/api/cook-sessions/exact-product-recipe",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publicBody),
      },
    );
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const bindingFor = (RuntimeDo: typeof predecessorDo.CookSession) => {
      const outbound: Request[] = [];
      const fetch = vi.fn((request: Request) => {
        outbound.push(request.clone());
        return new RuntimeDo({}, {}).fetch(request);
      });
      const idFromName = vi.fn((name: string) => name);
      return {
        fetch,
        idFromName,
        outbound,
        namespace: {
          idFromName,
          get: () => ({ fetch }),
        },
      };
    };

    const predecessorDoBinding = bindingFor(predecessorDo.CookSession);
    const candidateWorkerWithPredecessorDo = await candidateWorker.default.fetch(
      workerRequest(),
      {
        COOK_SESSIONS: predecessorDoBinding.namespace,
        __fixturePrincipal: { userId: "exact-product-user" },
      },
      ctx,
    );
    const candidateDoBinding = bindingFor(candidateDo.CookSession);
    const predecessorWorkerWithCandidateDo = await predecessorWorker.default.fetch(
      workerRequest(),
      {
        COOK_SESSIONS: candidateDoBinding.namespace,
        __fixturePrincipal: { userId: "exact-product-user" },
      },
      ctx,
    );

    expect([candidateWorkerWithPredecessorDo.status, predecessorWorkerWithCandidateDo.status])
      .toEqual([200, 200]);
    const expectedResponse = { ok: true, received: internalBody };
    await expect(candidateWorkerWithPredecessorDo.json()).resolves.toEqual(expectedResponse);
    await expect(predecessorWorkerWithCandidateDo.json()).resolves.toEqual(expectedResponse);
    expect(candidateWorkerWithPredecessorDo.headers.get("X-Spoonjoy-Worker-Runtime"))
      .toBe(candidateWorkerDigest === CANDIDATE_WORKER_BUNDLE_SHA256 ? "2" : "1");
    expect(predecessorWorkerWithCandidateDo.headers.get("X-Spoonjoy-Worker-Runtime"))
      .toBe("1");

    for (const binding of [predecessorDoBinding, candidateDoBinding]) {
      expect(binding.idFromName).toHaveBeenCalledExactlyOnceWith(
        "owner:v1:exact-product-user",
      );
      expect(binding.fetch).toHaveBeenCalledTimes(1);
      expect(binding.outbound).toHaveLength(1);
      const outbound = binding.outbound[0];
      expect(new URL(outbound.url).pathname)
        .toBe("/api/cook-sessions/exact-product-recipe");
      expect(outbound.method).toBe("PATCH");
      expect(outbound.headers.get("X-Spoonjoy-Cook-Protocol")).toBe("1");
      expect(outbound.headers.get("X-Spoonjoy-Cook-Operation")).toBe("recipe");
      expect(
        [...outbound.headers.keys()]
          .map((name) => name.toLowerCase())
          .filter((name) => name.startsWith("x-spoonjoy-"))
          .sort(),
      ).toEqual(["x-spoonjoy-cook-operation", "x-spoonjoy-cook-protocol"]);
      expect(outbound.headers.get("Content-Type")).toBeNull();
      await expect(outbound.json()).resolves.toEqual(internalBody);
    }
  });
});

describe("D1 recovery bookmark adapter", () => {
  it.each([
    ["production", ["exec", "wrangler", "d1", "time-travel", "info", "DB", "--json"]],
    ["qa", ["exec", "wrangler", "d1", "time-travel", "info", "DB", "--env", "qa", "--json"]],
  ] as const)("captures one exact %s bookmark command and parses its JSON", async (environment, args) => {
    const runCommand = vi.fn<ReleaseCommandRunner>(async () => ({
      stdout: JSON.stringify({ bookmark: RECOVERY_BOOKMARK_ID }),
      stderr: "",
    }));
    const commandEnv = { PATH: "/test/bin", CLOUDFLARE_API_TOKEN: "secret" };

    await expect(requireApi("readD1RecoveryBookmark")(
      environment,
      runCommand,
      commandEnv,
    )).resolves.toBe(RECOVERY_BOOKMARK_ID);
    expect(runCommand).toHaveBeenCalledExactlyOnceWith("pnpm", args, { env: commandEnv });
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", "[]"],
    ["a missing bookmark", "{}"],
    ["a non-string bookmark", '{"bookmark":1}'],
    ["an empty bookmark", '{"bookmark":""}'],
    ["an extra key", JSON.stringify({ bookmark: RECOVERY_BOOKMARK_ID, token: "secret" })],
  ])("rejects %s bookmark output", async (_label, stdout) => {
    const runCommand = vi.fn<ReleaseCommandRunner>(async () => ({ stdout, stderr: "" }));
    await expect(requireApi("readD1RecoveryBookmark")(
      "production",
      runCommand,
    )).rejects.toThrow("bookmark");
  });
});

describe("external post-restoration approval adapter", () => {
  it("loads an exact source-controlled post-restoration chain across runners", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-repair-chain-input-"));
    const chainDir = path.join(evidenceDir, "product-repair-chain");
    const latest = failedPostRestorationArtifact(
      POST_REPAIR_SOURCE_SHA,
      FAILED_RESTORATION_SHA,
    );
    const chain: PostRestorationChainState = {
      runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
      originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
      latestFailedRepairArtifact: latest,
    };
    try {
      await mkdir(chainDir, { recursive: true });
      await writeFile(
        path.join(chainDir, "production.json"),
        `${JSON.stringify(chain, null, 2)}\n`,
      );
      await expect(requireApi("readPostRestorationChainStateFile")(
        evidenceDir,
        "production",
      )).resolves.toEqual(chain);
      await expect(requireApi("readPostRestorationChainStateFile")(
        evidenceDir,
        "qa",
      )).rejects.toThrow("chain");
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it.each(["qa", "production"] as const)(
    "reads a candidate-relative %s approval keyed by its known lineage parent",
    async (environment) => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-repair-approval-"));
      const value = postRestorationAttempt(FAILED_RESTORATION_SHA);
      value.environment = environment;
      const approval = postRestorationApproval(value);
      const approvalDir = path.join(artifactDir, "product-repair-approvals");
      const approvalPath = path.join(
        approvalDir,
        `${environment}-from-${value.predecessor.lineageParentSourceSha}.json`,
      );
      try {
        await mkdir(approvalDir, { recursive: true });
        await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
        await expect(requireApi("readPostRestorationApprovalFile")(
          artifactDir,
          environment,
          value.predecessor.lineageParentSourceSha,
        )).resolves.toEqual(approval);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    },
  );

  it("persists valid terminal evidence when unlock readback is unavailable", async () => {
    const runEffects = effects({
      applyUnlock: vi.fn(async () => {
        throw new Error("unlock response lost");
      }),
      readTriggerInventory: vi.fn()
        .mockResolvedValueOnce([...BOTH_TRIGGERS])
        .mockRejectedValueOnce(new Error("trigger inventory unavailable")),
    });

    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("ambiguous");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:succeeded",
        "unlock:pending",
        "unlock:failed",
      ],
      "unlock",
      "unlock_state_ambiguous",
    );
  });

  it("rejects a missing or lineage-mismatched external approval", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-repair-approval-invalid-"));
    const value = postRestorationAttempt(FAILED_RESTORATION_SHA);
    const approvalDir = path.join(artifactDir, "product-repair-approvals");
    const approvalPath = path.join(
      approvalDir,
      `production-from-${value.predecessor.lineageParentSourceSha}.json`,
    );
    try {
      await expect(requireApi("readPostRestorationApprovalFile")(
        artifactDir,
        "production",
        value.predecessor.lineageParentSourceSha,
      )).rejects.toThrow("approval");
      await mkdir(approvalDir, { recursive: true });
      await writeFile(approvalPath, JSON.stringify(postRestorationApproval(value, {
        lineageParentSourceSha: NEXT_REPAIR_SHA,
      })), "utf8");
      await expect(requireApi("readPostRestorationApprovalFile")(
        artifactDir,
        "production",
        value.predecessor.lineageParentSourceSha,
      )).rejects.toThrow("approval");
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});

describe("durable forward-repair skew receipt adapters", () => {
  it.each(["production", "qa"] as const)(
    "reads a candidate-relative %s skew receipt keyed by its known lineage parent",
    async (environment) => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-forward-skew-"));
      const value = ordinaryRepairAttempt();
      value.environment = environment;
      value.target.workerBundleSha256 = CANDIDATE_WORKER_BUNDLE_SHA256;
      const receipt = bidirectionalSkewReceipt(value);
      const receiptDir = path.join(artifactDir, "product-skew-receipts");
      const receiptPath = path.join(
        receiptDir,
        `${environment}-from-${value.predecessor.lineageParentSourceSha}.json`,
      );
      try {
        await mkdir(receiptDir, { recursive: true });
        await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

        await expect(requireApi("readForwardRepairSkewReceiptFile")(
          artifactDir,
          environment,
          value.predecessor.lineageParentSourceSha,
        )).resolves.toEqual(receipt);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    },
  );

  it("authors repair authority without requiring the candidate commit to contain its own SHA", () => {
    const value = ordinaryRepairAttempt("both");
    const receipt = bidirectionalSkewReceipt(value);
    const serialized = JSON.stringify(receipt);

    expect(receipt.candidateSourceSha).toBe(CANDIDATE_SOURCE_REF);
    expect(receipt.candidateWorkerManifest).toMatchObject({
      mergeSha: CANDIDATE_SOURCE_REF,
      treeSha: CANDIDATE_SOURCE_REF,
    });
    expect(receipt.candidateDurableObjectManifest).toMatchObject({
      mergeSha: CANDIDATE_SOURCE_REF,
      treeSha: CANDIDATE_SOURCE_REF,
    });
    expect(serialized).not.toContain(value.target.sourceSha);
    expect(`production-from-${value.predecessor.lineageParentSourceSha}.json`)
      .not.toContain(value.target.sourceSha);
  });

  it("rejects a missing, wrong-environment, or wrong-lineage forward-repair receipt", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-forward-skew-invalid-"));
    const value = ordinaryRepairAttempt();
    value.target.workerBundleSha256 = CANDIDATE_WORKER_BUNDLE_SHA256;
    const receiptDir = path.join(artifactDir, "product-skew-receipts");
    const receiptPath = path.join(
      receiptDir,
      `production-from-${value.predecessor.lineageParentSourceSha}.json`,
    );
    try {
      await expect(requireApi("readForwardRepairSkewReceiptFile")(
        artifactDir,
        "production",
        value.predecessor.lineageParentSourceSha,
      )).rejects.toThrow("skew");
      await mkdir(receiptDir, { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify({
        ...bidirectionalSkewReceipt(value),
        environment: "qa",
      }, null, 2)}\n`, "utf8");
      await expect(requireApi("readForwardRepairSkewReceiptFile")(
        artifactDir,
        "production",
        value.predecessor.lineageParentSourceSha,
      )).rejects.toThrow("skew");
      await writeFile(receiptPath, `${JSON.stringify({
        ...bidirectionalSkewReceipt(value),
        predecessorSourceSha: FAILED_REPAIR_SHA,
      }, null, 2)}\n`, "utf8");
      await expect(requireApi("readForwardRepairSkewReceiptFile")(
        artifactDir,
        "production",
        value.predecessor.lineageParentSourceSha,
      )).rejects.toThrow("skew");
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("loads a prior executed receipt only by its canonical digest", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-executed-skew-"));
    const receipt = executedReceiptForActiveSource(ordinaryRepairAttempt());
    const digest = skewReceiptSha256(receipt);
    const receiptDir = path.join(artifactDir, "product-skew-receipts");
    const receiptPath = path.join(receiptDir, `executed-${digest}.json`);
    try {
      await mkdir(receiptDir, { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      await expect(requireApi("readExecutedSkewReceiptFile")(artifactDir, digest))
        .resolves.toEqual(receipt);

      await writeFile(receiptPath, `${JSON.stringify({
        ...receipt,
        candidateSourceSha: FAILED_REPAIR_SHA,
      }, null, 2)}\n`, "utf8");
      await expect(requireApi("readExecutedSkewReceiptFile")(artifactDir, digest))
        .rejects.toThrow("skew");
      await expect(requireApi("readExecutedSkewReceiptFile")(
        artifactDir,
        OTHER_BUNDLE_SHA256,
      )).rejects.toThrow("skew");
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("rejects an executed receipt that still contains the candidate source token", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-executed-candidate-"));
    const receipt = {
      ...executedReceiptForActiveSource(ordinaryRepairAttempt()),
      candidateSourceSha: CANDIDATE_SOURCE_REF,
      candidateWorkerManifest: {
        ...executedReceiptForActiveSource(ordinaryRepairAttempt()).candidateWorkerManifest,
        mergeSha: CANDIDATE_SOURCE_REF,
        treeSha: CANDIDATE_SOURCE_REF,
      },
      candidateDurableObjectManifest: {
        ...executedReceiptForActiveSource(ordinaryRepairAttempt()).candidateDurableObjectManifest,
        mergeSha: CANDIDATE_SOURCE_REF,
        treeSha: CANDIDATE_SOURCE_REF,
      },
    };
    const digest = skewReceiptSha256(receipt);
    const receiptDir = path.join(artifactDir, "product-skew-receipts");
    try {
      await mkdir(receiptDir, { recursive: true });
      await writeFile(
        path.join(receiptDir, `executed-${digest}.json`),
        `${JSON.stringify(receipt, null, 2)}\n`,
        "utf8",
      );
      await expect(requireApi("readExecutedSkewReceiptFile")(artifactDir, digest))
        .rejects.toThrow("skew");
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["empty", ""],
    ["short", "0".repeat(63)],
    ["nonhex", "g".repeat(64)],
    ["uppercase", "A".repeat(64)],
    ["path traversal", `../${"a".repeat(64)}`],
    ["embedded slash", `${"a".repeat(32)}/${"b".repeat(32)}`],
  ])("rejects a %s executed-receipt digest before filesystem access", async (_label, digest) => {
    const absentArtifactDir = path.join(
      os.tmpdir(),
      `spoonjoy-no-artifact-${crypto.randomUUID()}`,
    );
    await expect(requireApi("readExecutedSkewReceiptFile")(
      absentArtifactDir,
      digest,
    )).rejects.toThrow(/digest/i);
  });
});

describe("product cutover source and lineage preconditions", () => {
  const check = (
    value: CutoverAttempt,
    verification = verificationForAttempt(value),
  ) => requireApi("assertProductCutoverPreconditions")(value, verification);

  it("accepts initial QA activation through indirect compatibility ancestry", async () => {
    const activeBefore = sourceRecord({
      sourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      treeSha: QA_COMPATIBILITY_TREE_SHA,
      versionId: QA_COMPATIBILITY_VERSION_ID,
      baseSourceSha: QA_COMPATIBILITY_BASE_SHA,
    });
    const value = attempt({
      environment: "qa",
      activeBefore,
      predecessor: predecessorRecord({
        canonicalSourceSha: QA_COMPATIBILITY_SOURCE_SHA,
        canonicalTreeSha: QA_COMPATIBILITY_TREE_SHA,
        lineageParentSourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      }),
      compatibilitySourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      compatibilityVersionId: QA_COMPATIBILITY_VERSION_ID,
    });
    const verification = verificationForAttempt(value);
    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(verification.runCommand).toHaveBeenCalledWith(
      "git",
      ["merge-base", "--is-ancestor", QA_COMPATIBILITY_SOURCE_SHA, TARGET_SOURCE_SHA],
      { env: undefined },
    );
    expect(TARGET_BASE_SHA).not.toBe(QA_COMPATIBILITY_SOURCE_SHA);
  });

  it("rejects initial activation when compatibility is not an ancestor", async () => {
    const activeBefore = sourceRecord({
      sourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      treeSha: QA_COMPATIBILITY_TREE_SHA,
      versionId: QA_COMPATIBILITY_VERSION_ID,
      baseSourceSha: QA_COMPATIBILITY_BASE_SHA,
    });
    const value = attempt({
      environment: "qa",
      activeBefore,
      predecessor: predecessorRecord({
        canonicalSourceSha: QA_COMPATIBILITY_SOURCE_SHA,
        canonicalTreeSha: QA_COMPATIBILITY_TREE_SHA,
        lineageParentSourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      }),
      compatibilitySourceSha: QA_COMPATIBILITY_SOURCE_SHA,
      compatibilityVersionId: QA_COMPATIBILITY_VERSION_ID,
    });
    const verification = verificationForAttempt(value, {
      deniedAncestry: [{
        ancestor: QA_COMPATIBILITY_SOURCE_SHA,
        descendant: TARGET_SOURCE_SHA,
      }],
    });
    await expect(check(value, verification)).rejects.toThrow("compatibility");
  });

  it.each([
    ["source", sourceRecord({ sourceSha: QA_ALIAS_SHA })],
    ["version", sourceRecord({ versionId: TARGET_VERSION_ID })],
    ["release mode", sourceRecord({ releaseMode: "atomic-product-activation" })],
  ])("rejects initial activation with the wrong compatibility %s", async (_label, activeBefore) => {
    await expect(check(attempt({ activeBefore }))).rejects.toThrow("compatibility");
  });

  it("rejects a self-consistent caller-supplied replacement compatibility identity", async () => {
    const value = attempt({
      activeBefore: sourceRecord({ sourceSha: QA_ALIAS_SHA, versionId: TARGET_VERSION_ID }),
      compatibilitySourceSha: QA_ALIAS_SHA,
      compatibilityVersionId: TARGET_VERSION_ID,
      predecessor: predecessorRecord({
        canonicalSourceSha: QA_ALIAS_SHA,
        lineageParentSourceSha: QA_ALIAS_SHA,
      }),
    });
    await expect(check(value)).rejects.toThrow("reviewed compatibility");
  });

  it("rejects a source-correct caller-supplied replacement compatibility version", async () => {
    const value = attempt({
      activeBefore: sourceRecord({ versionId: TARGET_VERSION_ID }),
      compatibilityVersionId: TARGET_VERSION_ID,
    });
    await expect(check(value)).rejects.toThrow("reviewed compatibility");
  });

  it("preserves a same-target retry's historical base without a new ancestry edge", async () => {
    const value = sameTargetAttempt();
    const verification = verificationForAttempt(value, {
      firstParents: { [TARGET_SOURCE_SHA]: COMPATIBILITY_BASE_SHA },
    });
    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(verification.runCommand).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["merge-base"]),
      expect.anything(),
    );
  });

  it.each([
    ["same-target reconciliation", () => sameTargetAttempt()],
    ["ordinary repair", () => ordinaryRepairAttempt()],
    ["post-restoration repair", () => postRestorationAttempt(FAILED_RESTORATION_SHA)],
  ] as const)("accepts an exact QA predecessor binding for %s", async (_label, makeAttempt) => {
    const value = makeAttempt();
    value.environment = "qa";
    const verification = verificationForAttempt(value, {
      firstParents: value.transition === "post-restoration-product-repair"
        ? { [value.target.sourceSha]: value.predecessor.lineageParentSourceSha }
        : undefined,
    });
    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(value.predecessor.relationship).toBe("exact");
  });

  it("checks ordinary repair mode, boundary ancestry, direct parent, and lineage with Git", async () => {
    const value = ordinaryRepairAttempt();
    const verification = verificationForAttempt(value);
    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(verification.runCommand).toHaveBeenCalledWith(
      "git",
      ["rev-parse", `${REPAIR_SOURCE_SHA}^`],
      { env: undefined },
    );
    for (const [ancestor, descendant] of [
      [TOPOLOGY_PROTOCOL_BOUNDARY_SHA, RUNTIME_FLOOR_SHA],
      [TOPOLOGY_PROTOCOL_BOUNDARY_SHA, REPAIR_SOURCE_SHA],
      [RUNTIME_FLOOR_SHA, REPAIR_SOURCE_SHA],
    ]) {
      expect(verification.runCommand).toHaveBeenCalledWith(
        "git",
        ["merge-base", "--is-ancestor", ancestor, descendant],
        { env: undefined },
      );
    }
  });

  it("rejects an ordinary repair whose lineage parent is not the canonical active predecessor", async () => {
    const value = ordinaryRepairAttempt();
    const unrelatedParent = FAILED_REPAIR_SHA;
    value.predecessor.lineageParentSourceSha = unrelatedParent;
    value.target.baseSourceSha = unrelatedParent;
    const verification = verificationForAttempt(value, {
      firstParents: { [value.target.sourceSha]: unrelatedParent },
    });

    await expect(check(value, verification)).rejects.toThrow(/lineage|predecessor/i);
  });

  it("parses only the root workflow release mode and ignores matching comments", async () => {
    const value = ordinaryRepairAttempt();
    const base = gitEvidenceRunner();
    const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args, options) => {
      if (command === "git" && args[0] === "show" &&
          args[1]?.endsWith(":.github/workflows/production-deploy.yml")) {
        return {
          stdout: [
            "# SPOONJOY_RELEASE_MODE: atomic-product-activation",
            "env:",
            "  SPOONJOY_RELEASE_MODE: protocol-v1-canary",
            "",
          ].join("\n"),
          stderr: "",
        };
      }
      return base(command, args, options);
    });
    const verification = verificationForAttempt(value, {}, { runCommand });

    await expect(check(value, verification)).rejects.toThrow(/release mode/i);
  });

  it.each([
    ["production", "Worker-only", "worker"],
    ["production", "Durable-Object-only", "durable-object"],
    ["production", "Worker-and-Durable-Object", "both"],
    ["qa", "Worker-only", "worker"],
    ["qa", "Durable-Object-only", "durable-object"],
    ["qa", "Worker-and-Durable-Object", "both"],
  ] as const)("accepts a %s %s runtime-changing ordinary repair with exact manifests and both matrices", async (
    environment,
    _label,
    profile,
  ) => {
    const value = ordinaryRepairAttempt(profile);
    value.environment = environment;
    const receipt = bidirectionalSkewReceipt(value);
    const loadForwardRepairSkewReceipt = vi.fn(async () => receipt);
    const verification = verificationForAttempt(value, {}, { loadForwardRepairSkewReceipt });

    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(loadForwardRepairSkewReceipt)
      .toHaveBeenCalledExactlyOnceWith(environment, value.predecessor.lineageParentSourceSha);
    expect([
      value.target.workerBundleSha256 !== value.activeBefore.workerBundleSha256,
      value.target.durableObjectBundleSha256 !== value.activeBefore.durableObjectBundleSha256,
    ]).toEqual({
      worker: [true, false],
      "durable-object": [false, true],
      both: [true, true],
    }[profile]);
    expect(receipt).toMatchObject({
      evidenceMode: "executed",
      predecessorWorkerManifest: exactSourceBundleManifest(value.activeBefore, "worker"),
      predecessorDurableObjectManifest: exactSourceBundleManifest(
        value.activeBefore,
        "durable-object",
      ),
      candidateWorkerManifest: candidateSourceBundleManifest(value.target, "worker"),
      candidateDurableObjectManifest: candidateSourceBundleManifest(
        value.target,
        "durable-object",
      ),
    });
    expect(receipt.candidateWorkerWithPredecessorDoBundleSha256)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.predecessorWorkerWithCandidateDoBundleSha256)
      .toMatch(/^[0-9a-f]{64}$/);
    for (const manifest of [
      receipt.predecessorWorkerManifest,
      receipt.predecessorDurableObjectManifest,
      receipt.candidateWorkerManifest,
      receipt.candidateDurableObjectManifest,
    ]) {
      const sourceSha = manifest.mergeSha === CANDIDATE_SOURCE_REF
        ? value.target.sourceSha
        : manifest.mergeSha;
      expect(manifest.sourceBlobOid).toMatch(/^[0-9a-f]{40}$/);
      expect(manifest.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(verification.runCommand).toHaveBeenCalledWith(
        "git",
        ["rev-parse", `${sourceSha}^{tree}`],
        { env: undefined },
      );
      expect(verification.runCommand).toHaveBeenCalledWith(
        "git",
        ["rev-parse", `${sourceSha}:${manifest.sourcePath}`],
        { env: undefined },
      );
      expect(verification.runCommand).toHaveBeenCalledWith(
        "git",
        ["show", `${sourceSha}:${manifest.sourcePath}`],
        { env: undefined },
      );
      const [buildCommand, ...buildArgs] = manifest.buildCommand.split(" ");
      expect(verification.runCommand).toHaveBeenCalledWith(
        buildCommand,
        buildArgs,
        { env: undefined },
      );
    }
    for (const crossCommand of [
      crossRuntimeBuildCommand(
        receipt.candidateWorkerManifest,
        receipt.predecessorDurableObjectManifest,
      ),
      crossRuntimeBuildCommand(
        receipt.predecessorWorkerManifest,
        receipt.candidateDurableObjectManifest,
      ),
    ]) {
      const [command, ...args] = crossCommand.split(" ");
      expect(verification.runCommand).toHaveBeenCalledWith(command, args, { env: undefined });
    }
  });

  it.each(["production", "qa"] as const)(
    "accepts a byte-identical %s ordinary repair only with a digest-bound executed receipt",
    async (environment) => {
    const value = ordinaryRepairAttempt("byte-identical");
    value.environment = environment;
    const executedReceipt = executedReceiptForActiveSource(value);
    const receipt = bidirectionalSkewReceipt(value, "reused-byte-identical", executedReceipt);
    const loadForwardRepairSkewReceipt = vi.fn(async () => receipt);
    const loadExecutedSkewReceipt = vi.fn(async () => executedReceipt);

    await expect(check(value, verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt,
      loadExecutedSkewReceipt,
    }))).resolves.toBeUndefined();
    expect(loadForwardRepairSkewReceipt)
      .toHaveBeenCalledExactlyOnceWith(environment, value.predecessor.lineageParentSourceSha);
    expect(loadExecutedSkewReceipt)
      .toHaveBeenCalledExactlyOnceWith(skewReceiptSha256(executedReceipt));
    expect(receipt).toMatchObject({
      reusedExecutedReceiptSha256: skewReceiptSha256(executedReceipt),
      candidateWorkerWithPredecessorDoBundleSha256:
        executedReceipt.candidateWorkerWithPredecessorDoBundleSha256,
      predecessorWorkerWithCandidateDoBundleSha256:
        executedReceipt.predecessorWorkerWithCandidateDoBundleSha256,
    });
    expect(receipt.candidateWorkerBundleSha256)
      .toBe(receipt.predecessorWorkerBundleSha256);
    expect(receipt.candidateDurableObjectBundleSha256)
      .toBe(receipt.predecessorDurableObjectBundleSha256);
    },
  );

  it("rejects an ordinary repair without durable skew evidence", async () => {
    const value = ordinaryRepairAttempt();
    value.target.workerBundleSha256 = CANDIDATE_WORKER_BUNDLE_SHA256;
    const verification = verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => {
        throw new Error("skew receipt missing");
      }),
    });

    await expect(check(value, verification)).rejects.toThrow("skew");
  });

  it.each([
    ["production", "Worker-only", "worker"],
    ["production", "Durable-Object-only", "durable-object"],
    ["production", "both-bundle", "both"],
    ["qa", "Worker-only", "worker"],
    ["qa", "Durable-Object-only", "durable-object"],
    ["qa", "both-bundle", "both"],
  ] as const)("rejects %s %s runtime changes that claim byte-identical receipt reuse", async (
    environment,
    _label,
    profile,
  ) => {
    const value = ordinaryRepairAttempt(profile);
    value.environment = environment;
    const prior = executedReceiptForActiveSource(value);
    const receipt = bidirectionalSkewReceipt(value, "reused-byte-identical", prior);

    await expect(check(value, verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
      loadExecutedSkewReceipt: vi.fn(async () => prior),
    }))).rejects.toThrow("skew");
  });

  it.each([
    ["missing", () => null],
    ["altered", (value: CutoverAttempt) => {
      const prior = executedReceiptForActiveSource(value);
      prior.candidateWorkerManifest.sourceSha256 = "1".repeat(64);
      return prior;
    }],
    ["wrong-source", (value: CutoverAttempt) => {
      return validWrongSourceExecutedReceipt(value);
    }],
    ["non-executed", (value: CutoverAttempt) => {
      return validNonExecutedReceiptForActiveSource(value);
    }],
  ] as const)("rejects byte-identical reuse with %s prior executed evidence", async (
    label,
    makeLoaded,
  ) => {
    const value = ordinaryRepairAttempt();
    const prior = executedReceiptForActiveSource(value);
    const receipt = bidirectionalSkewReceipt(value, "reused-byte-identical", prior);
    const loaded = makeLoaded(value);
    if (loaded && (label === "wrong-source" || label === "non-executed")) {
      receipt.reusedExecutedReceiptSha256 = skewReceiptSha256(loaded);
    }
    const loadExecutedSkewReceipt = vi.fn(async () => {
      if (!loaded) throw new Error("executed skew receipt missing");
      return loaded;
    });

    await expect(check(value, verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
      loadExecutedSkewReceipt,
    }))).rejects.toThrow("skew");
  });

  it.each([
    ["executed/non-null digest", "executed", (receipt: BidirectionalSkewReceipt) => {
      receipt.reusedExecutedReceiptSha256 = "a".repeat(64);
    }],
    ["executed/malformed candidate cross digest", "executed", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerWithPredecessorDoBundleSha256 = "passed";
    }],
    ["executed/uppercase predecessor cross digest", "executed", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorWorkerWithCandidateDoBundleSha256 = "A".repeat(64);
    }],
    ["reuse/null digest", "reused-byte-identical", (receipt: BidirectionalSkewReceipt) => {
      receipt.reusedExecutedReceiptSha256 = null;
    }],
    ["reuse/nonhex digest", "reused-byte-identical", (receipt: BidirectionalSkewReceipt) => {
      receipt.reusedExecutedReceiptSha256 = "g".repeat(64);
    }],
    ["reuse/uppercase digest", "reused-byte-identical", (receipt: BidirectionalSkewReceipt) => {
      receipt.reusedExecutedReceiptSha256 = "A".repeat(64);
    }],
    ["reuse/changed candidate cross digest", "reused-byte-identical", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerWithPredecessorDoBundleSha256 = "a".repeat(64);
    }],
    ["reuse/changed predecessor cross digest", "reused-byte-identical", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorWorkerWithCandidateDoBundleSha256 = "b".repeat(64);
    }],
  ] as const)("rejects invalid skew evidence coupling: %s", async (
    _label,
    evidenceMode,
    mutate,
  ) => {
    const value = ordinaryRepairAttempt();
    const loaded = executedReceiptForActiveSource(value);
    const receipt = bidirectionalSkewReceipt(value, evidenceMode, loaded);
    mutate(receipt);

    await expect(check(value, verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
      loadExecutedSkewReceipt: vi.fn(async () => loaded),
    }))).rejects.toThrow("skew");
  });

  it("rejects a fully coherent nonzero manifest forgery against independent Git and build evidence", async () => {
    const value = ordinaryRepairAttempt();
    const receipt = bidirectionalSkewReceipt(value);
    value.target.workerBundleSha256 = "3".repeat(64);
    receipt.candidateWorkerBundleSha256 = value.target.workerBundleSha256;
    receipt.candidateWorkerManifest = {
      mergeSha: value.target.sourceSha,
      treeSha: value.target.treeSha,
      sourcePath: "workers/app.ts",
      sourceBlobOid: "1".repeat(40),
      sourceSha256: "2".repeat(64),
      bundleSha256: value.target.workerBundleSha256,
      buildCommand: `node ${RUNTIME_BUNDLE_BUILDER_PATH} ${RUNTIME_FIXTURE_DIR}/exact-8ec4cb1d-product-worker.ts --durable-object ${RUNTIME_FIXTURE_DIR}/exact-8ec4cb1d-product-durable-object.ts`,
    };

    await expect(check(value, verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
    }))).rejects.toThrow("skew");
  });

  it.each([
    ["predecessor Worker", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorWorkerManifest.buildCommand = crossRuntimeBuildCommand(
        receipt.predecessorWorkerManifest,
        receipt.candidateDurableObjectManifest,
      );
    }],
    ["candidate Worker", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerManifest.buildCommand = crossRuntimeBuildCommand(
        receipt.candidateWorkerManifest,
        receipt.predecessorDurableObjectManifest,
      );
    }],
  ] as const)("rejects a %s manifest natively paired with the opposite DO", async (
    _label,
    mutate,
  ) => {
    const value = ordinaryRepairAttempt("both");
    const receipt = bidirectionalSkewReceipt(value);
    mutate(receipt);
    const verification = verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
    });

    await expect(check(value, verification)).rejects.toThrow("runtime pairing");
    expect(vi.mocked(verification.runCommand).mock.calls.filter(
      ([command]) => command === "node",
    )).toEqual([]);
  });

  it.each([
    ["has a malformed candidate Worker blob OID", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerManifest.sourceBlobOid = "A".repeat(40);
    }],
    ["has a mismatched candidate Worker source digest", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerManifest.sourceSha256 = "0".repeat(64);
    }],
    ["has a mismatched candidate Worker bundle digest", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerManifest.bundleSha256 = WORKER_BUNDLE_SHA256;
    }],
    ["has an empty candidate DO build command", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateDurableObjectManifest.buildCommand = "";
    }],
    ["failed the candidate-Worker/predecessor-DO matrix", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerWithPredecessorDoBundleSha256 = "failed";
    }],
    ["failed the predecessor-Worker/candidate-DO matrix", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorWorkerWithCandidateDoBundleSha256 = "failed";
    }],
  ] as const)("rejects an ordinary runtime-changing repair whose skew receipt %s", async (
    _label,
    mutate,
  ) => {
    const value = ordinaryRepairAttempt();
    value.target.workerBundleSha256 = CANDIDATE_WORKER_BUNDLE_SHA256;
    const receipt = bidirectionalSkewReceipt(value);
    mutate(receipt);
    const verification = verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
    });

    await expect(check(value, verification)).rejects.toThrow("skew");
  });

  it.each([
    ["target base", (value: CutoverAttempt) => { value.target.baseSourceSha = COMPATIBILITY_SOURCE_SHA; }, {}],
    ["first parent", () => undefined, { firstParents: { [REPAIR_SOURCE_SHA]: COMPATIBILITY_SOURCE_SHA } }],
    ["canonical active mode", () => undefined, { releaseModes: { [RUNTIME_FLOOR_SHA]: "protocol-v1-canary" } }],
    ["target mode", () => undefined, { releaseModes: { [REPAIR_SOURCE_SHA]: "protocol-v1-canary" } }],
    ["active boundary ancestry", () => undefined, { deniedAncestry: [{ ancestor: TOPOLOGY_PROTOCOL_BOUNDARY_SHA, descendant: RUNTIME_FLOOR_SHA }] }],
    ["target boundary ancestry", () => undefined, { deniedAncestry: [{ ancestor: TOPOLOGY_PROTOCOL_BOUNDARY_SHA, descendant: REPAIR_SOURCE_SHA }] }],
    ["forward ancestry", () => undefined, { deniedAncestry: [{ ancestor: RUNTIME_FLOOR_SHA, descendant: REPAIR_SOURCE_SHA }] }],
  ] as const)("rejects an ordinary repair with invalid %s", async (_label, mutate, gitOptions) => {
    const value = ordinaryRepairAttempt();
    mutate(value);
    await expect(check(value, verificationForAttempt(value, gitOptions))).rejects.toThrow();
  });

  it("permits a QA same-build alias only with byte-identical tree and both bundles", async () => {
    await expect(check(qaAliasAttempt())).resolves.toBeUndefined();
  });

  it.each([
    ["runtime floor", RUNTIME_FLOOR_SHA, FAILED_RESTORATION_SHA, POST_REPAIR_SOURCE_SHA, null],
    [
      "latest failed lineage",
      FAILED_REPAIR_SHA,
      FAILED_REPAIR_SHA,
      NEXT_REPAIR_SHA,
      failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA),
    ],
  ] as const)("permits a post-restoration QA alias to the %s", async (
    _label,
    canonicalSourceSha,
    lineageParentSourceSha,
    targetSourceSha,
    previous,
  ) => {
    const value = qaPostRestorationAttempt(
      canonicalSourceSha,
      lineageParentSourceSha,
      targetSourceSha,
    );
    const verification = verificationForAttempt(value, {
      firstParents: { [targetSourceSha]: lineageParentSourceSha },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
    });

    await expect(check(value, verification)).resolves.toBeUndefined();
  });

  it.each([
    ["tree", { treeSha: OTHER_TREE_SHA }],
    ["Worker bundle", { workerBundleSha256: OTHER_BUNDLE_SHA256 }],
    ["Durable Object bundle", { durableObjectBundleSha256: OTHER_BUNDLE_SHA256 }],
  ])("rejects a QA alias with mismatched %s bytes", async (_label, sourceOverride) => {
    const value = qaAliasAttempt();
    value.activeBefore = { ...value.activeBefore, ...sourceOverride };
    await expect(check(value)).rejects.toThrow("predecessor");
  });

  it("rejects a same-build alias in production", async () => {
    const value = qaAliasAttempt();
    value.environment = "production";
    await expect(check(value)).rejects.toThrow("production");
  });

  it("requires QA rebinding after each production merge", async () => {
    const value = qaAliasAttempt();
    value.predecessor.canonicalTreeSha = OTHER_TREE_SHA;
    await expect(check(value)).rejects.toThrow("predecessor");
  });

  it.each([
    ["source and lineage", (value: CutoverAttempt) => {
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
      value.predecessor.canonicalSourceSha = QA_ALIAS_SHA;
      value.predecessor.lineageParentSourceSha = QA_ALIAS_SHA;
      value.target.baseSourceSha = QA_ALIAS_SHA;
    }, { firstParents: { [REPAIR_SOURCE_SHA]: QA_ALIAS_SHA } }],
    ["tree", (value: CutoverAttempt) => {
      value.activeBefore.treeSha = OTHER_TREE_SHA;
      value.predecessor.canonicalTreeSha = OTHER_TREE_SHA;
    }, {}],
    ["Worker bundle", (value: CutoverAttempt) => {
      value.activeBefore.workerBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    }, {}],
    ["Durable Object bundle", (value: CutoverAttempt) => {
      value.activeBefore.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalDurableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }, {}],
  ] as const)("rejects a self-consistent %s replacement of the durable predecessor binding", async (
    _label,
    mutate,
    gitOptions,
  ) => {
    const value = ordinaryRepairAttempt();
    const durableBinding = clone(value.predecessor);
    mutate(value);
    const verification = verificationForAttempt(value, gitOptions, {
      loadPredecessorBinding: vi.fn(async () => durableBinding),
    });

    await expect(check(value, verification)).rejects.toThrow("binding");
    expect(verification.loadPredecessorBinding).toHaveBeenCalledExactlyOnceWith("production");
  });

  it("accepts the first post-restoration repair only from the original failed restoration", async () => {
    const value = postRestorationAttempt(FAILED_RESTORATION_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [POST_REPAIR_SOURCE_SHA]: FAILED_RESTORATION_SHA },
    });

    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(verification.loadPostRestorationChainState)
      .toHaveBeenCalledExactlyOnceWith("production");
    expect(verification.runCommand).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", `${RUNTIME_FLOOR_SHA}...${POST_REPAIR_SOURCE_SHA}`],
      { env: undefined },
    );
    expect(verification.loadPostRestorationApproval)
      .toHaveBeenCalledExactlyOnceWith("production", FAILED_RESTORATION_SHA);
  });

  it.each([
    ["runtime floor", (value: CutoverAttempt) => {
      value.activeBefore.sourceSha = TARGET_SOURCE_SHA;
      value.predecessor.canonicalSourceSha = TARGET_SOURCE_SHA;
      value.predecessor.runtimeFloorSourceSha = TARGET_SOURCE_SHA;
    }],
    ["original failed restoration", (value: CutoverAttempt) => {
      value.predecessor.originalFailedRestorationSourceSha = FAILED_REPAIR_SHA;
      value.predecessor.lineageParentSourceSha = FAILED_REPAIR_SHA;
      value.target.baseSourceSha = FAILED_REPAIR_SHA;
    }],
  ])("rejects a self-consistent caller replacement for the durable %s", async (_label, mutate) => {
    const value = postRestorationAttempt(FAILED_RESTORATION_SHA);
    mutate(value);
    const verification = verificationForAttempt(value, {
      firstParents: { [POST_REPAIR_SOURCE_SHA]: value.predecessor.lineageParentSourceSha },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState()),
    });

    await expect(check(value, verification)).rejects.toThrow("restoration");
  });

  it("binds every later post-restoration repair to the latest durable failed artifact", async () => {
    const links = [
      {
        previous: failedPostRestorationArtifact(POST_REPAIR_SOURCE_SHA, FAILED_RESTORATION_SHA),
        current: postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA),
      },
      {
        previous: failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA),
        current: postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA),
      },
    ];

    for (const { previous, current } of links) {
      const verification = verificationForAttempt(current, {
        firstParents: { [current.target.sourceSha]: previous.target.sourceSha },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      });
      await expect(check(current, verification)).resolves.toBeUndefined();
      expect(verification.loadPostRestorationChainState)
        .toHaveBeenCalledExactlyOnceWith("production");
      expect(current.predecessor.lineageParentSourceSha).toBe(previous.target.sourceSha);
      expect(current.activeBefore.sourceSha).toBe(RUNTIME_FLOOR_SHA);
    }
  });

  it.each([
    ["precheck failure", "precheck", "precondition_mismatch"],
    ["predecessor binding failure", "precheck", "predecessor_binding_mismatch"],
    ["migration rejection", "migration", "migration_rejected"],
    ["trigger-inventory failure", "migration", "trigger_inventory_mismatch"],
    ["deployment failure", "deployment", "deployment_failed"],
    ["pre-activation ambiguous deployment", "deployment", "deployment_state_ambiguous"],
  ] as const)("accepts a latest merged repair after %s as the next lineage seed", async (
    _label,
    phase,
    classification,
  ) => {
    const previous = failedPostRestorationArtifactAt(
      phase,
      classification,
      POST_REPAIR_SOURCE_SHA,
      FAILED_RESTORATION_SHA,
    );
    expect(() => requireApi("assertProductCutoverArtifact")(previous)).not.toThrow();
    const value = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [FAILED_REPAIR_SHA]: POST_REPAIR_SOURCE_SHA },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
    });

    await expect(check(value, verification)).resolves.toBeUndefined();
  });

  it.each(["deployment_failed", "deployment_state_ambiguous"] as const)(
    "rejects a post-restoration seed after %s reached nonzero traffic",
    async (classification) => {
      const previous = failedPostRestorationArtifactAt(
        "deployment",
        classification,
        POST_REPAIR_SOURCE_SHA,
        FAILED_RESTORATION_SHA,
      );
      previous.target.versionId = TARGET_VERSION_ID;
      previous.deployment = observedTarget({
        sourceSha: POST_REPAIR_SOURCE_SHA,
        trafficPercent: 37,
      });
      expect(() => requireApi("assertProductCutoverArtifact")(previous)).not.toThrow();
      const value = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
      const verification = verificationForAttempt(value, {
        firstParents: { [FAILED_REPAIR_SHA]: POST_REPAIR_SOURCE_SHA },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      });

      await expect(check(value, verification)).rejects.toThrow("restoration");
    },
  );

  it.each(["deployment_failed", "deployment_state_ambiguous"] as const)(
    "accepts a post-restoration seed after %s observed the candidate at 0%%",
    async (classification) => {
      const previous = failedPostRestorationArtifactAt(
        "deployment",
        classification,
        POST_REPAIR_SOURCE_SHA,
        FAILED_RESTORATION_SHA,
      );
      previous.target.versionId = TARGET_VERSION_ID;
      previous.deployment = observedTarget({
        sourceSha: POST_REPAIR_SOURCE_SHA,
        trafficPercent: 0,
      });
      expect(() => requireApi("assertProductCutoverArtifact")(previous)).not.toThrow();
      const value = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
      const verification = verificationForAttempt(value, {
        firstParents: { [FAILED_REPAIR_SHA]: POST_REPAIR_SOURCE_SHA },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      });

      await expect(check(value, verification)).resolves.toBeUndefined();
    },
  );

  it.each([
    ["arbitrary first-link lineage", null, FAILED_REPAIR_SHA],
    [
      "caller-claimed latest lineage",
      failedPostRestorationArtifact(POST_REPAIR_SOURCE_SHA, FAILED_RESTORATION_SHA),
      FAILED_REPAIR_SHA,
    ],
  ] as const)("rejects %s without matching durable chain state", async (
    _label,
    previous,
    lineageParent,
  ) => {
    const value = postRestorationAttempt(lineageParent, NEXT_REPAIR_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [NEXT_REPAIR_SHA]: lineageParent },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
    });

    await expect(check(value, verification)).rejects.toThrow("restoration");
  });

  it.each([
    ["environment", (previous: ProductCutoverArtifact) => { previous.environment = "qa"; }],
    ["transition", (previous: ProductCutoverArtifact) => {
      previous.transition = "forward-repair";
      previous.predecessor.runtimeFloorSourceSha = null;
      previous.predecessor.originalFailedRestorationSourceSha = null;
    }],
    ["failed status", (previous: ProductCutoverArtifact) => {
      previous.status = "succeeded";
      previous.failure = null;
    }],
    ["pre-activation failure classification", (previous: ProductCutoverArtifact) => {
      previous.failure = { phase: "deployment", classification: "canonical_health_failed" };
      previous.target.versionId = TARGET_VERSION_ID;
      previous.deployment = observedTarget({ sourceSha: previous.target.sourceSha });
    }],
    ["runtime floor", (previous: ProductCutoverArtifact) => {
      previous.activeBefore.sourceSha = TARGET_SOURCE_SHA;
      previous.predecessor.canonicalSourceSha = TARGET_SOURCE_SHA;
      previous.predecessor.runtimeFloorSourceSha = TARGET_SOURCE_SHA;
    }],
    ["original restoration", (previous: ProductCutoverArtifact) => {
      previous.predecessor.originalFailedRestorationSourceSha = FAILED_REPAIR_SHA;
    }],
  ])("rejects a latest repair artifact with invalid %s evidence", async (_label, mutate) => {
    const previous = failedPostRestorationArtifact(POST_REPAIR_SOURCE_SHA, FAILED_RESTORATION_SHA);
    mutate(previous);
    const value = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [FAILED_REPAIR_SHA]: POST_REPAIR_SOURCE_SHA },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
    });

    await expect(check(value, verification)).rejects.toThrow("restoration");
  });

  it("rejects post-restoration mode once the latest repair reached active target identity", async () => {
    const activeRepair = artifactForTransition("post-restoration-product-repair");
    activeRepair.target.sourceSha = POST_REPAIR_SOURCE_SHA;
    activeRepair.target.baseSourceSha = FAILED_RESTORATION_SHA;
    activeRepair.deployment = observedTarget({ sourceSha: POST_REPAIR_SOURCE_SHA });
    const value = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [FAILED_REPAIR_SHA]: POST_REPAIR_SOURCE_SHA },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(activeRepair)),
    });

    await expect(check(value, verification)).rejects.toThrow("forward repair");
  });

  it("verifies every accepted post-restoration chain link with reviewed diff and skew checks", async () => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
    });

    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(verification.loadPostRestorationApproval)
      .toHaveBeenCalledExactlyOnceWith("production", FAILED_REPAIR_SHA);
    expect(verification.runCommand).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", `${RUNTIME_FLOOR_SHA}...${NEXT_REPAIR_SHA}`],
      { env: undefined },
    );
  });

  it.each([
    ["production", "Worker-only", "worker"],
    ["production", "Durable-Object-only", "durable-object"],
    ["production", "both-bundle", "both"],
    ["qa", "Worker-only", "worker"],
    ["qa", "Durable-Object-only", "durable-object"],
    ["qa", "both-bundle", "both"],
  ] as const)("accepts a %s %s runtime-changing post-restoration repair with executed matrices", async (
    environment,
    _label,
    profile,
  ) => {
    const value = postRestorationRuntimeAttempt(profile);
    value.environment = environment;
    const reviewedPaths = changedPathsForSourceSha(value.target.sourceSha);
    const receipt = bidirectionalSkewReceipt(value);
    const loadPostRestorationApproval = vi.fn(async () => postRestorationApproval(value, {
      changedPathsSha256: changedPathsSha256(reviewedPaths),
      reviewedPaths,
      skewReceipt: receipt,
    }));
    const verification = verificationForAttempt(value, {
      firstParents: { [value.target.sourceSha]: FAILED_RESTORATION_SHA },
      diffPaths: reviewedPaths,
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState()),
      loadPostRestorationApproval,
    });

    await expect(check(value, verification)).resolves.toBeUndefined();
    expect(loadPostRestorationApproval)
      .toHaveBeenCalledExactlyOnceWith(environment, value.predecessor.lineageParentSourceSha);
    expect([
      value.target.workerBundleSha256 !== value.activeBefore.workerBundleSha256,
      value.target.durableObjectBundleSha256 !== value.activeBefore.durableObjectBundleSha256,
    ]).toEqual({
      worker: [true, false],
      "durable-object": [false, true],
      both: [true, true],
    }[profile]);
    expect(receipt).toMatchObject({
      environment,
      evidenceMode: "executed",
    });
    expect(receipt.candidateWorkerWithPredecessorDoBundleSha256)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.predecessorWorkerWithCandidateDoBundleSha256)
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["production", "qa"] as const)(
    "accepts byte-identical %s post-restoration reuse only from a digest-bound executed receipt",
    async (environment) => {
      const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
      value.environment = environment;
      const previous = failedPostRestorationArtifact(
        FAILED_REPAIR_SHA,
        POST_REPAIR_SOURCE_SHA,
      );
      previous.environment = environment;
      const executed = executedReceiptForActiveSource(value);
      const receipt = bidirectionalSkewReceipt(value, "reused-byte-identical", executed);
      const loadExecutedSkewReceipt = vi.fn(async () => executed);
      const verification = verificationForAttempt(value, {
        firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
        loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
          skewReceipt: receipt,
        })),
        loadExecutedSkewReceipt,
      });

      await expect(check(value, verification)).resolves.toBeUndefined();
      expect(loadExecutedSkewReceipt)
        .toHaveBeenCalledExactlyOnceWith(skewReceiptSha256(executed));
    },
  );

  it.each([
    ["production", "Worker-only", "worker"],
    ["production", "Durable-Object-only", "durable-object"],
    ["production", "both-bundle", "both"],
    ["qa", "Worker-only", "worker"],
    ["qa", "Durable-Object-only", "durable-object"],
    ["qa", "both-bundle", "both"],
  ] as const)("rejects %s %s post-restoration runtime changes that claim receipt reuse", async (
    environment,
    _label,
    profile,
  ) => {
    const value = postRestorationRuntimeAttempt(profile);
    value.environment = environment;
    const reviewedPaths = changedPathsForSourceSha(value.target.sourceSha);
    const executed = executedReceiptForActiveSource(value);
    const receipt = bidirectionalSkewReceipt(value, "reused-byte-identical", executed);
    const verification = verificationForAttempt(value, {
      firstParents: { [value.target.sourceSha]: FAILED_RESTORATION_SHA },
      diffPaths: reviewedPaths,
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState()),
      loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
        changedPathsSha256: changedPathsSha256(reviewedPaths),
        reviewedPaths,
        skewReceipt: receipt,
      })),
      loadExecutedSkewReceipt: vi.fn(async () => executed),
    });

    await expect(check(value, verification)).rejects.toThrow("skew");
  });

  it.each([
    ["runtime-floor ancestry", { deniedAncestry: [{ ancestor: RUNTIME_FLOOR_SHA, descendant: NEXT_REPAIR_SHA }] }, {}],
    ["original-restoration ancestry", { deniedAncestry: [{ ancestor: FAILED_RESTORATION_SHA, descendant: NEXT_REPAIR_SHA }] }, {}],
    ["latest-lineage ancestry", { deniedAncestry: [{ ancestor: FAILED_REPAIR_SHA, descendant: NEXT_REPAIR_SHA }] }, {}],
    ["atomic product mode", { releaseModes: { [NEXT_REPAIR_SHA]: "protocol-v1-canary" } }, {}],
    ["failed restoration canary mode", { releaseModes: { [FAILED_RESTORATION_SHA]: "atomic-product-activation" } }, {}],
  ] as const)("rejects post-restoration repair without %s", async (_label, gitOptions, override) => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const verification = verificationForAttempt(
      value,
      { firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA }, ...gitOptions },
      {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
        ...override,
      },
    );
    await expect(check(value, verification)).rejects.toThrow();
  });

  it.each([
    ["an unreviewed changed path", [...NEXT_REPAIR_FLOOR_CHANGED_PATHS, "app/unreviewed.ts"], [...NEXT_REPAIR_FLOOR_CHANGED_PATHS]],
    ["a reviewed path missing from the full diff", NEXT_REPAIR_FLOOR_CHANGED_PATHS.slice(0, -1), [...NEXT_REPAIR_FLOOR_CHANGED_PATHS]],
    ["a duplicate changed path", [...NEXT_REPAIR_FLOOR_CHANGED_PATHS, NEXT_REPAIR_FLOOR_CHANGED_PATHS[0]], [...NEXT_REPAIR_FLOOR_CHANGED_PATHS]],
    ["an empty changed path", [...NEXT_REPAIR_FLOOR_CHANGED_PATHS, ""], [...NEXT_REPAIR_FLOOR_CHANGED_PATHS]],
  ])("rejects post-restoration diff evidence with %s", async (_label, changedPaths, reviewedPaths) => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const verification = verificationForAttempt(value, {
      firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      diffPaths: changedPaths,
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
        changedPathsSha256: changedPathsSha256(reviewedPaths),
        reviewedPaths: [...reviewedPaths],
      })),
    });

    await expect(check(value, verification)).rejects.toThrow("diff");
  });

  it("rejects any post-restoration change to the immutable protocol boundary marker", async () => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const changedPaths = [
      ...NEXT_REPAIR_FLOOR_CHANGED_PATHS,
      PROTOCOL_BOUNDARY_MARKER_PATH,
    ];
    const verification = verificationForAttempt(value, {
      firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      diffPaths: changedPaths,
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
        changedPathsSha256: changedPathsSha256(changedPaths),
        reviewedPaths: [...changedPaths],
      })),
    });

    await expect(check(value, verification)).rejects.toThrow("protocol boundary");
  });

  it.each([
    ["schema", (approval: PostRestorationApproval) => {
      (approval as { schemaVersion: number }).schemaVersion = 2;
    }],
    ["environment", (approval: PostRestorationApproval) => { approval.environment = "qa"; }],
    ["runtime floor", (approval: PostRestorationApproval) => {
      approval.runtimeFloorSourceSha = TARGET_SOURCE_SHA;
    }],
    ["original restoration", (approval: PostRestorationApproval) => {
      approval.originalFailedRestorationSourceSha = FAILED_REPAIR_SHA;
    }],
    ["lineage parent", (approval: PostRestorationApproval) => {
      approval.lineageParentSourceSha = TARGET_SOURCE_SHA;
    }],
    ["target", (approval: PostRestorationApproval) => {
      approval.targetSourceSha = TARGET_SOURCE_SHA;
    }],
    ["changed-path digest syntax", (approval: PostRestorationApproval) => {
      approval.changedPathsSha256 = "A".repeat(64);
    }],
    ["changed-path digest identity", (approval: PostRestorationApproval) => {
      approval.changedPathsSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["reviewed path order", (approval: PostRestorationApproval) => {
      approval.reviewedPaths = [
        ...approval.reviewedPaths,
        ".github/workflows/production-deploy.yml",
      ].sort().reverse();
      approval.changedPathsSha256 = changedPathsSha256(approval.reviewedPaths);
    }],
    ["duplicate reviewed path", (approval: PostRestorationApproval) => {
      approval.reviewedPaths.push(approval.reviewedPaths[0]);
    }],
    ["empty reviewed path", (approval: PostRestorationApproval) => {
      approval.reviewedPaths.push("");
    }],
  ])("rejects invalid durable post-restoration approval: %s", async (_label, mutate) => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const approval = postRestorationApproval(value);
    mutate(approval);
    const verification = verificationForAttempt(value, {
      firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      loadPostRestorationApproval: vi.fn(async () => approval),
    });

    await expect(check(value, verification)).rejects.toThrow("approval");
  });

  it("requires the exact durable post-restoration approval key set", async () => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const valid = postRestorationApproval(value);
    const invalidApprovals: PostRestorationApproval[] = [];
    for (const key of Object.keys(valid)) {
      const missing = clone(valid) as unknown as Record<string, unknown>;
      delete missing[key];
      invalidApprovals.push(missing as unknown as PostRestorationApproval);
    }
    invalidApprovals.push({
      ...valid,
      unexpected: true,
    } as PostRestorationApproval & { unexpected: boolean });

    for (const approval of invalidApprovals) {
      const verification = verificationForAttempt(value, {
        firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
        loadPostRestorationApproval: vi.fn(async () => approval),
      });
      await expect(check(value, verification)).rejects.toThrow("approval");
    }
  });

  it.each([
    ["schema", (receipt: BidirectionalSkewReceipt) => {
      (receipt as { schemaVersion: number }).schemaVersion = 2;
    }],
    ["environment", (receipt: BidirectionalSkewReceipt) => {
      receipt.environment = receipt.environment === "production" ? "qa" : "production";
    }],
    ["evidence mode", (receipt: BidirectionalSkewReceipt) => {
      (receipt as { evidenceMode: string }).evidenceMode = "claimed";
    }],
    ["predecessor source", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorSourceSha = TARGET_SOURCE_SHA;
    }],
    ["candidate source", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateSourceSha = TARGET_SOURCE_SHA;
    }],
    ["predecessor Worker", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["predecessor DO", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorDurableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["candidate Worker", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["candidate DO", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateDurableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["candidate-Worker/predecessor-DO matrix", (receipt: BidirectionalSkewReceipt) => {
      receipt.candidateWorkerWithPredecessorDoBundleSha256 = "failed";
    }],
    ["predecessor-Worker/candidate-DO matrix", (receipt: BidirectionalSkewReceipt) => {
      receipt.predecessorWorkerWithCandidateDoBundleSha256 = "failed";
    }],
  ])("rejects invalid bidirectional skew receipt: %s", async (_label, mutate) => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const receipt = bidirectionalSkewReceipt(value);
    mutate(receipt);
    const verification = verificationForAttempt(value, {
      firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
    }, {
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
        skewReceipt: receipt,
      })),
    });

    await expect(check(value, verification)).rejects.toThrow("skew");
  });

  it("requires the exact bidirectional skew receipt key set", async () => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const valid = bidirectionalSkewReceipt(value);
    const invalidReceipts: BidirectionalSkewReceipt[] = [];
    for (const key of Object.keys(valid)) {
      const missing = clone(valid) as unknown as Record<string, unknown>;
      delete missing[key];
      invalidReceipts.push(missing as unknown as BidirectionalSkewReceipt);
    }
    invalidReceipts.push({
      ...valid,
      unexpected: true,
    } as BidirectionalSkewReceipt & { unexpected: boolean });

    for (const receipt of invalidReceipts) {
      const verification = verificationForAttempt(value, {
        firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
        loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
          skewReceipt: receipt,
        })),
      });
      await expect(check(value, verification)).rejects.toThrow("skew");
    }
  });

  it.each([
    "predecessorWorkerManifest",
    "predecessorDurableObjectManifest",
    "candidateWorkerManifest",
    "candidateDurableObjectManifest",
  ] as const)("requires the exact %s key set", async (manifestName) => {
    const value = postRestorationAttempt(FAILED_REPAIR_SHA, NEXT_REPAIR_SHA);
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const valid = bidirectionalSkewReceipt(value);
    const invalidReceipts: BidirectionalSkewReceipt[] = [];
    for (const key of Object.keys(valid[manifestName])) {
      const missing = clone(valid);
      delete (missing[manifestName] as unknown as Record<string, unknown>)[key];
      invalidReceipts.push(missing);
    }
    const extra = clone(valid);
    (extra[manifestName] as unknown as Record<string, unknown>).unexpected = true;
    invalidReceipts.push(extra);

    for (const receipt of invalidReceipts) {
      const verification = verificationForAttempt(value, {
        firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      }, {
        loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
        loadPostRestorationApproval: vi.fn(async () => postRestorationApproval(value, {
          skewReceipt: receipt,
        })),
      });
      await expect(check(value, verification)).rejects.toThrow("skew");
    }
  });

  it.each([
    "predecessorWorkerManifest",
    "predecessorDurableObjectManifest",
    "candidateWorkerManifest",
    "candidateDurableObjectManifest",
  ] as const)("rejects every mutated exact-source field in %s", async (manifestName) => {
    const value = ordinaryRepairAttempt();
    value.target.workerBundleSha256 = CANDIDATE_WORKER_BUNDLE_SHA256;
    const valid = bidirectionalSkewReceipt(value);
    const mutations: ReadonlyArray<readonly [keyof ExactSourceBundleManifest, string]> = [
      ["mergeSha", COMPATIBILITY_BASE_SHA],
      ["treeSha", OTHER_TREE_SHA],
      ["sourcePath", "workers/unreviewed.ts"],
      ["sourceBlobOid", "0".repeat(40)],
      ["sourceSha256", "0".repeat(64)],
      ["bundleSha256", "0".repeat(64)],
      ["buildCommand", `${valid[manifestName].buildCommand} `],
    ];

    for (const [field, replacement] of mutations) {
      const receipt = clone(valid);
      receipt[manifestName][field] = replacement;
      const verification = verificationForAttempt(value, {}, {
        loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
      });
      await expect(
        check(value, verification),
        `${manifestName}.${field}`,
      ).rejects.toThrow("skew");
    }
  });

  it.each([
    "predecessorWorkerManifest",
    "predecessorDurableObjectManifest",
    "candidateWorkerManifest",
    "candidateDurableObjectManifest",
  ] as const)("rejects unsafe %s build argv before any builder invocation", async (
    manifestName,
  ) => {
    const value = ordinaryRepairAttempt("both");
    const valid = bidirectionalSkewReceipt(value);
    const [command, builderPath, sourcePath, ...rest] = valid[manifestName].buildCommand.split(" ");
    const durableObjectIndex = rest.indexOf("--durable-object");
    const durableObjectPath = durableObjectIndex === -1
      ? `${RUNTIME_FIXTURE_DIR}/exact-8ec4cb1d-product-durable-object.ts`
      : rest[durableObjectIndex + 1];
    const invalidCommands = [
      `sh -c ${builderPath}`,
      `pnpm ${builderPath} ${sourcePath}`,
      `${command} scripts/not-the-runtime-builder.mjs ${sourcePath}`,
      `${command} ${builderPath} /tmp/runtime.ts`,
      `${command} ${builderPath} ../runtime.ts`,
      `${command} ${builderPath} ${RUNTIME_FIXTURE_DIR}/not-recorded.ts`,
      `${command} ${builderPath} ${sourcePath} --durable-object /tmp/cook-session.ts`,
      `${command} ${builderPath} ${sourcePath} --durable-object ../cook-session.ts`,
      `${command} ${builderPath} ${sourcePath} --output /tmp/runtime.mjs`,
      `${command} ${builderPath} ${sourcePath} --minify --durable-object ${durableObjectPath}`,
      `${command} ${builderPath} ${sourcePath} --durable-object ${durableObjectPath} --durable-object ${durableObjectPath}`,
      `${valid[manifestName].buildCommand} ; touch /tmp/spoonjoy-unsafe`,
    ];

    for (const buildCommand of invalidCommands) {
      const receipt = clone(valid);
      receipt[manifestName].buildCommand = buildCommand;
      const verification = verificationForAttempt(value, {}, {
        loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
      });

      await expect(check(value, verification), buildCommand).rejects.toThrow("skew");
      const runnerCalls = vi.mocked(verification.runCommand).mock.calls;
      expect(runnerCalls.filter(([calledCommand]) => calledCommand !== "git"), buildCommand)
        .toEqual([]);
    }
  });

  it.each([
    "predecessorWorkerManifest",
    "predecessorDurableObjectManifest",
    "candidateWorkerManifest",
    "candidateDurableObjectManifest",
  ] as const)("rejects a safe but identity-mismatched %s build command before invocation", async (
    manifestName,
  ) => {
    const value = ordinaryRepairAttempt("both");
    const receipt = bidirectionalSkewReceipt(value);
    const expected = receipt[manifestName];
    const replacement = ALL_RUNTIME_MANIFESTS.find((manifest) => (
      manifest.kind === (manifestName.includes("Worker") ? "worker" : "durable-object") &&
      manifest.buildCommand !== expected.buildCommand
    ));
    expect(replacement).toBeDefined();
    receipt[manifestName].buildCommand = replacement!.buildCommand;
    const verification = verificationForAttempt(value, {}, {
      loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
    });

    await expect(check(value, verification)).rejects.toThrow("skew");
    const runnerCalls = vi.mocked(verification.runCommand).mock.calls;
    expect(runnerCalls.filter(([calledCommand]) => calledCommand !== "git")).toEqual([]);
  });

  it.each([
    ["failed post-restoration activation", POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA],
    ["post-unlock feature smoke failure", RUNTIME_FLOOR_SHA, REPAIR_SOURCE_SHA],
  ])("switches %s to ordinary exact-active forward repair", async (
    _label,
    activeSourceSha,
    nextSourceSha,
  ) => {
    const value = activeSourceSha === POST_REPAIR_SOURCE_SHA
      ? (() => {
          const active = postRestorationAttempt(FAILED_RESTORATION_SHA).target;
          const target = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA).target;
          return attempt({
            transition: "forward-repair",
            activeBefore: { ...active, versionId: ACTIVE_VERSION_ID },
            target,
            predecessor: predecessorRecord({
              canonicalSourceSha: active.sourceSha,
              canonicalTreeSha: active.treeSha,
              canonicalWorkerBundleSha256: active.workerBundleSha256,
              canonicalDurableObjectBundleSha256: active.durableObjectBundleSha256,
              lineageParentSourceSha: active.sourceSha,
            }),
            protocolBoundarySha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
          });
        })()
      : ordinaryRepairAttempt();
    expect(value.activeBefore.sourceSha).toBe(activeSourceSha);
    expect(value.target.sourceSha).toBe(nextSourceSha);
    await expect(check(value, verificationForAttempt(value, {
      firstParents: { [nextSourceSha]: activeSourceSha },
    }))).resolves.toBeUndefined();
  });

  it.each([
    ["arbitrary descendant", REPAIR_SOURCE_SHA, TARGET_SOURCE_SHA],
    ["backward target", COMPATIBILITY_SOURCE_SHA, TARGET_SOURCE_SHA],
  ])("rejects an %s that lacks exact forward ancestry", async (
    _label,
    targetSourceSha,
    activeSourceSha,
  ) => {
    const value = ordinaryRepairAttempt();
    value.target.sourceSha = targetSourceSha;
    value.target.baseSourceSha = activeSourceSha;
    await expect(check(value, verificationForAttempt(value, {
      deniedAncestry: [{ ancestor: activeSourceSha, descendant: targetSourceSha }],
      firstParents: { [targetSourceSha]: activeSourceSha },
    }))).rejects.toThrow();
  });
});

function qaAliasAttempt(): CutoverAttempt {
  return attempt({
    environment: "qa",
    transition: "forward-repair",
    activeBefore: sourceRecord({
      sourceSha: QA_ALIAS_SHA,
      treeSha: RUNTIME_FLOOR_TREE_SHA,
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
    }),
    target: sourceRecord({
      sourceSha: REPAIR_SOURCE_SHA,
      treeSha: REPAIR_TREE_SHA,
      workerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      releaseMode: "atomic-product-activation",
      baseSourceSha: RUNTIME_FLOOR_SHA,
    }),
    predecessor: predecessorRecord({
      relationship: "same-build-alias",
      canonicalSourceSha: RUNTIME_FLOOR_SHA,
      canonicalTreeSha: RUNTIME_FLOOR_TREE_SHA,
      canonicalWorkerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      canonicalDurableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      lineageParentSourceSha: RUNTIME_FLOOR_SHA,
    }),
    protocolBoundarySha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
  });
}

function postRestorationAttempt(
  lineageParentSourceSha: string,
  targetSourceSha = POST_REPAIR_SOURCE_SHA,
  releaseMode: ReleaseMode = "atomic-product-activation",
): CutoverAttempt {
  const targetRuntime = {
    [POST_WORKER_REPAIR_SOURCE_SHA]: {
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: CANDIDATE_DO_BUNDLE_SHA256,
    },
    [POST_BOTH_REPAIR_SOURCE_SHA]: {
      workerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: CANDIDATE_DO_BUNDLE_SHA256,
    },
    [NEXT_REPAIR_SHA]: {
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
    },
  }[targetSourceSha] ?? {
    workerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
    durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
  };
  return attempt({
    transition: "post-restoration-product-repair",
    activeBefore: sourceRecord({
      sourceSha: RUNTIME_FLOOR_SHA,
      treeSha: RUNTIME_FLOOR_TREE_SHA,
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      versionId: ACTIVE_VERSION_ID,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
    }),
    target: sourceRecord({
      sourceSha: targetSourceSha,
      treeSha: treeForSourceSha(targetSourceSha),
      ...targetRuntime,
      versionId: null,
      releaseMode,
      baseSourceSha: lineageParentSourceSha,
    }),
    predecessor: predecessorRecord({
      canonicalSourceSha: RUNTIME_FLOOR_SHA,
      canonicalTreeSha: RUNTIME_FLOOR_TREE_SHA,
      canonicalWorkerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      canonicalDurableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      lineageParentSourceSha,
      runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
      originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
    }),
    protocolBoundarySha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
  });
}

type PostRuntimeProfile = "worker" | "durable-object" | "both";

function postRestorationRuntimeAttempt(profile: PostRuntimeProfile): CutoverAttempt {
  const targetSourceSha = {
    worker: POST_REPAIR_SOURCE_SHA,
    "durable-object": POST_WORKER_REPAIR_SOURCE_SHA,
    both: POST_BOTH_REPAIR_SOURCE_SHA,
  }[profile];
  return postRestorationAttempt(FAILED_RESTORATION_SHA, targetSourceSha);
}

function qaPostRestorationAttempt(
  canonicalSourceSha: string,
  lineageParentSourceSha: string,
  targetSourceSha = POST_REPAIR_SOURCE_SHA,
): CutoverAttempt {
  const value = postRestorationAttempt(lineageParentSourceSha, targetSourceSha);
  value.environment = "qa";
  value.activeBefore = sourceRecord({
    sourceSha: canonicalSourceSha === FAILED_REPAIR_SHA ? QA_POST_ALIAS_SHA : QA_ALIAS_SHA,
    treeSha: treeForSourceSha(canonicalSourceSha),
    workerBundleSha256: canonicalSourceSha === RUNTIME_FLOOR_SHA
      ? RUNTIME_FLOOR_WORKER_BUNDLE_SHA256
      : CANDIDATE_WORKER_BUNDLE_SHA256,
    durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
    releaseMode: "atomic-product-activation",
    baseSourceSha: lineageParentSourceSha,
  });
  value.predecessor = predecessorRecord({
    relationship: "same-build-alias",
    canonicalSourceSha,
    canonicalTreeSha: treeForSourceSha(canonicalSourceSha),
    canonicalWorkerBundleSha256: canonicalSourceSha === RUNTIME_FLOOR_SHA
      ? RUNTIME_FLOOR_WORKER_BUNDLE_SHA256
      : CANDIDATE_WORKER_BUNDLE_SHA256,
    canonicalDurableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
    lineageParentSourceSha,
    runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
    originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
  });
  return value;
}

function failedPostRestorationArtifact(
  targetSourceSha: string,
  lineageParentSourceSha: string,
): ProductCutoverArtifact {
  return failedPostRestorationArtifactAt(
    "deployment",
    "deployment_failed",
    targetSourceSha,
    lineageParentSourceSha,
  );
}

function failedPostRestorationArtifactAt(
  phase: "precheck" | "migration" | "deployment",
  classification:
    | "precondition_mismatch"
    | "predecessor_binding_mismatch"
    | "migration_rejected"
    | "trigger_inventory_mismatch"
    | "deployment_failed"
    | "deployment_state_ambiguous",
  targetSourceSha: string,
  lineageParentSourceSha: string,
): ProductCutoverArtifact {
  const sourceAttempt = postRestorationAttempt(lineageParentSourceSha, targetSourceSha);
  const value = artifactForTransition("post-restoration-product-repair");
  value.phase = phase;
  value.status = "failed";
  value.activeBefore = clone(sourceAttempt.activeBefore);
  value.target = clone(sourceAttempt.target);
  value.predecessor = clone(sourceAttempt.predecessor);
  value.protocolBoundarySha = sourceAttempt.protocolBoundarySha;
  value.compatibilitySourceSha = sourceAttempt.compatibilitySourceSha;
  value.deployment = {
    deploymentId: null,
    versionId: null,
    sourceSha: targetSourceSha,
    trafficPercent: null,
  };
  value.unlock = {
    ...value.unlock,
    inventoryBefore: null,
    applyState: "not_started",
    inventoryAfter: null,
  };
  if (phase === "precheck") {
    value.migration = {
      ...value.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
  } else if (phase === "migration") {
    value.migration = classification === "trigger_inventory_mismatch"
      ? {
          ...value.migration,
          recoveryBookmarkId: null,
          applyState: "already_applied",
          triggerInventory: [INSERT_TRIGGER],
        }
      : {
          ...value.migration,
          recoveryBookmarkId: null,
          applyState: "not_started",
          triggerInventory: null,
        };
  }
  value.failure = { phase, classification };
  return value;
}

function restorationChainState(
  latestFailedRepairArtifact: ProductCutoverArtifact | null = null,
  overrides: Partial<PostRestorationChainState> = {},
): PostRestorationChainState {
  return {
    runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
    originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
    latestFailedRepairArtifact,
    ...overrides,
  };
}

function exactSourceBundleManifest(
  source: CutoverSourceRecord,
  kind: "worker" | "durable-object",
): ExactSourceBundleManifest {
  const bundleSha256 = kind === "worker"
    ? source.workerBundleSha256
    : source.durableObjectBundleSha256;
  const fixture = exactRuntimeManifest(source.sourceSha, kind, bundleSha256);
  return {
    mergeSha: fixture.mergeSha,
    treeSha: fixture.treeSha,
    sourcePath: fixture.sourcePath,
    sourceBlobOid: fixture.sourceBlobOid,
    sourceSha256: fixture.sourceSha256,
    bundleSha256: fixture.bundleSha256,
    buildCommand: fixture.buildCommand,
  };
}

function candidateSourceBundleManifest(
  source: CutoverSourceRecord,
  kind: "worker" | "durable-object",
): ExactSourceBundleManifest {
  return {
    ...exactSourceBundleManifest(source, kind),
    mergeSha: CANDIDATE_SOURCE_REF,
    treeSha: CANDIDATE_SOURCE_REF,
  };
}

function sourceFixturePath(manifest: ExactSourceBundleManifest): string {
  return manifest.buildCommand.split(" ")[2];
}

function crossRuntimeBuildCommand(
  worker: ExactSourceBundleManifest,
  durableObject: ExactSourceBundleManifest,
): string {
  return `node ${RUNTIME_BUNDLE_BUILDER_PATH} ${sourceFixturePath(worker)} ` +
    `--durable-object ${sourceFixturePath(durableObject)}`;
}

function runtimeBuildDigest(buildCommand: string): string {
  const cached = RUNTIME_BUILD_DIGEST_CACHE.get(buildCommand);
  if (cached) return cached;
  const manifestDigests = [...new Set(ALL_RUNTIME_MANIFESTS
    .filter((manifest) => manifest.buildCommand === buildCommand)
    .map((manifest) => manifest.bundleSha256))];
  const digest = manifestDigests.length === 1
    ? manifestDigests[0]
    : (JSON.parse(execFileSync(
        buildCommand.split(" ")[0],
        buildCommand.split(" ").slice(1),
        { encoding: "utf8" },
      )) as { bundleSha256: string }).bundleSha256;
  RUNTIME_BUILD_DIGEST_CACHE.set(buildCommand, digest);
  return digest;
}

function canonicalEvidenceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalEvidenceJson(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function skewReceiptSha256(receipt: BidirectionalSkewReceipt): string {
  return createHash("sha256").update(canonicalEvidenceJson(receipt), "utf8").digest("hex");
}

function bidirectionalSkewReceipt(
  value: CutoverAttempt,
  evidenceMode: BidirectionalSkewReceipt["evidenceMode"] = "executed",
  reusedReceipt: BidirectionalSkewReceipt | null = null,
): BidirectionalSkewReceipt {
  const predecessorSource = sourceRecord({
    sourceSha: value.predecessor.canonicalSourceSha,
    treeSha: value.predecessor.canonicalTreeSha,
    workerBundleSha256: value.predecessor.canonicalWorkerBundleSha256,
    durableObjectBundleSha256: value.predecessor.canonicalDurableObjectBundleSha256,
  });
  const predecessorWorkerManifest = exactSourceBundleManifest(predecessorSource, "worker");
  const predecessorDurableObjectManifest = exactSourceBundleManifest(
    predecessorSource,
    "durable-object",
  );
  const candidateWorkerManifest = exactSourceBundleManifest(value.target, "worker");
  const candidateDurableObjectManifest = exactSourceBundleManifest(
    value.target,
    "durable-object",
  );
  candidateWorkerManifest.mergeSha = CANDIDATE_SOURCE_REF;
  candidateWorkerManifest.treeSha = CANDIDATE_SOURCE_REF;
  candidateDurableObjectManifest.mergeSha = CANDIDATE_SOURCE_REF;
  candidateDurableObjectManifest.treeSha = CANDIDATE_SOURCE_REF;
  const executedReceipt = evidenceMode === "reused-byte-identical"
    ? reusedReceipt ?? executedReceiptForActiveSource(value)
    : null;
  return {
    schemaVersion: 1,
    environment: value.environment,
    evidenceMode,
    reusedExecutedReceiptSha256: evidenceMode === "reused-byte-identical"
      ? skewReceiptSha256(executedReceipt!)
      : null,
    predecessorSourceSha: value.predecessor.canonicalSourceSha,
    candidateSourceSha: CANDIDATE_SOURCE_REF,
    predecessorWorkerBundleSha256: value.predecessor.canonicalWorkerBundleSha256,
    predecessorDurableObjectBundleSha256:
      value.predecessor.canonicalDurableObjectBundleSha256,
    candidateWorkerBundleSha256: value.target.workerBundleSha256,
    candidateDurableObjectBundleSha256: value.target.durableObjectBundleSha256,
    predecessorWorkerManifest,
    predecessorDurableObjectManifest,
    candidateWorkerManifest,
    candidateDurableObjectManifest,
    candidateWorkerWithPredecessorDoBundleSha256: executedReceipt
      ?.candidateWorkerWithPredecessorDoBundleSha256 ?? runtimeBuildDigest(
        crossRuntimeBuildCommand(candidateWorkerManifest, predecessorDurableObjectManifest),
      ),
    predecessorWorkerWithCandidateDoBundleSha256: executedReceipt
      ?.predecessorWorkerWithCandidateDoBundleSha256 ?? runtimeBuildDigest(
        crossRuntimeBuildCommand(predecessorWorkerManifest, candidateDurableObjectManifest),
      ),
  };
}

function executedReceiptForActiveSource(value: CutoverAttempt): BidirectionalSkewReceipt {
  const prior = attempt({
    environment: value.environment,
    transition: "forward-repair",
    activeBefore: sourceRecord(),
    target: sourceRecord({
      sourceSha: value.predecessor.canonicalSourceSha,
      treeSha: value.predecessor.canonicalTreeSha,
      workerBundleSha256: value.predecessor.canonicalWorkerBundleSha256,
      durableObjectBundleSha256: value.predecessor.canonicalDurableObjectBundleSha256,
      versionId: ACTIVE_VERSION_ID,
      releaseMode: "atomic-product-activation",
      baseSourceSha: COMPATIBILITY_SOURCE_SHA,
    }),
    predecessor: predecessorRecord(),
  });
  const receipt = bidirectionalSkewReceipt(prior);
  receipt.candidateSourceSha = prior.target.sourceSha;
  for (const manifest of [
    receipt.candidateWorkerManifest,
    receipt.candidateDurableObjectManifest,
  ]) {
    manifest.mergeSha = prior.target.sourceSha;
    manifest.treeSha = prior.target.treeSha;
  }
  return receipt;
}

function validWrongSourceExecutedReceipt(value: CutoverAttempt): BidirectionalSkewReceipt {
  const prior = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
  prior.environment = value.environment;
  return bidirectionalSkewReceipt(prior);
}

function validNonExecutedReceiptForActiveSource(value: CutoverAttempt): BidirectionalSkewReceipt {
  const prior = attempt({
    environment: value.environment,
    transition: "forward-repair",
    activeBefore: sourceRecord({
      sourceSha: FAILED_RESTORATION_SHA,
      treeSha: FAILED_RESTORATION_TREE_SHA,
      workerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: CANDIDATE_DO_BUNDLE_SHA256,
      releaseMode: "atomic-product-activation",
    }),
    target: sourceRecord({
      sourceSha: value.predecessor.canonicalSourceSha,
      treeSha: value.predecessor.canonicalTreeSha,
      workerBundleSha256: value.predecessor.canonicalWorkerBundleSha256,
      durableObjectBundleSha256: value.predecessor.canonicalDurableObjectBundleSha256,
      releaseMode: "atomic-product-activation",
    }),
    predecessor: predecessorRecord({
      canonicalSourceSha: FAILED_RESTORATION_SHA,
      canonicalTreeSha: FAILED_RESTORATION_TREE_SHA,
      canonicalWorkerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
      canonicalDurableObjectBundleSha256: CANDIDATE_DO_BUNDLE_SHA256,
      lineageParentSourceSha: FAILED_RESTORATION_SHA,
    }),
  });
  const executed = bidirectionalSkewReceipt(prior);
  return bidirectionalSkewReceipt(prior, "reused-byte-identical", executed);
}

function changedPathsSha256(paths: readonly string[]): string {
  return createHash("sha256").update(paths.join("\n"), "utf8").digest("hex");
}

function postRestorationApproval(
  value: CutoverAttempt,
  overrides: Partial<PostRestorationApproval> = {},
): PostRestorationApproval {
  const reviewedPaths = changedPathsForSourceSha(value.target.sourceSha);
  return {
    schemaVersion: 1,
    environment: value.environment,
    runtimeFloorSourceSha: value.predecessor.runtimeFloorSourceSha ?? RUNTIME_FLOOR_SHA,
    originalFailedRestorationSourceSha:
      value.predecessor.originalFailedRestorationSourceSha ?? FAILED_RESTORATION_SHA,
    lineageParentSourceSha: value.predecessor.lineageParentSourceSha,
    targetSourceSha: CANDIDATE_SOURCE_REF,
    changedPathsSha256: changedPathsSha256(reviewedPaths),
    reviewedPaths,
    skewReceipt: bidirectionalSkewReceipt(value),
    ...overrides,
  };
}

describe("shared QA and production product-cutover runner", () => {
  it.each([
    ["production initial", () => attempt()],
    ["QA initial", () => initialAttempt("qa")],
    ["same-target reconciliation", () => sameTargetAttempt()],
    ["ordinary repair", () => ordinaryRepairAttempt()],
    ["post-restoration repair", () => postRestorationAttempt(FAILED_RESTORATION_SHA)],
  ] as const)("awaits all durable lifecycle writes for %s", async (_label, makeAttempt) => {
    const writeCount = makeAttempt().transition === "initial" ? 10 : 9;
    for (const failingWrite of Array.from({ length: writeCount }, (_, index) => index + 1)) {
    let observedWriteCount = 0;
    const runAttempt = makeAttempt();
    const runEffects = successfulEffectsForAttempt(runAttempt, {
      writeEvidence: vi.fn(async () => {
        observedWriteCount += 1;
        if (observedWriteCount === failingWrite) {
          throw new Error(`evidence write ${failingWrite} failed`);
        }
      }),
    });

    await expect(requireApi("runProductCutover")(runAttempt, runEffects))
      .rejects.toThrow(`evidence write ${failingWrite} failed`);
    expect(vi.mocked(runEffects.writeEvidence).mock.calls.length)
      .toBeGreaterThanOrEqual(failingWrite);
    if (failingWrite === 1) {
      expect(runEffects.readPreflight).not.toHaveBeenCalled();
    }
    if (failingWrite <= 3) {
      expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    }
    if (failingWrite <= 4) {
      expect(runEffects.applyMigration).not.toHaveBeenCalled();
    }
    if (failingWrite <= 5) {
      expect(runEffects.deployTarget).not.toHaveBeenCalled();
    }
    const unlockPendingWrite = runAttempt.transition === "initial" ? 8 : 7;
    if (failingWrite <= unlockPendingWrite) {
      expect(runEffects.applyUnlock).not.toHaveBeenCalled();
    }
    if (failingWrite <= unlockPendingWrite + 1) {
      expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
    }
    }
  });

  it("persists a classified precheck failure when runner source ancestry fails", async () => {
    const runAttempt = ordinaryRepairAttempt();
    const runEffects = successfulEffectsForAttempt(runAttempt, {
      runCommand: gitEvidenceRunner({
        deniedAncestry: [{
          ancestor: runAttempt.protocolBoundarySha,
          descendant: runAttempt.target.sourceSha,
        }],
      }),
    });

    await expect(requireApi("runProductCutover")(runAttempt, runEffects)).rejects.toThrow();
    expectTerminalFailureLifecycle(
      runEffects,
      runAttempt,
      ["precheck:pending", "precheck:failed"],
      "precheck",
      "precondition_mismatch",
    );
    expect(runEffects.writeEvidence.mock.invocationCallOrder[0])
      .toBeLessThan(runEffects.runCommand.mock.invocationCallOrder[0]);
    expect(runEffects.readPreflight).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
  });

  it("persists a classified precheck failure when the durable predecessor differs", async () => {
    const runAttempt = ordinaryRepairAttempt();
    const durableBinding = clone(runAttempt.predecessor);
    durableBinding.canonicalWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    const runEffects = successfulEffectsForAttempt(runAttempt, {
      loadPredecessorBinding: vi.fn(async () => durableBinding),
    });

    await expect(requireApi("runProductCutover")(runAttempt, runEffects))
      .rejects.toThrow("binding");
    expectTerminalFailureLifecycle(
      runEffects,
      runAttempt,
      ["precheck:pending", "precheck:failed"],
      "precheck",
      "predecessor_binding_mismatch",
    );
    expect(runEffects.writeEvidence.mock.invocationCallOrder[0])
      .toBeLessThan(runEffects.loadPredecessorBinding.mock.invocationCallOrder[0]);
    expect(runEffects.readPreflight).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
  });

  it.each(["qa", "production"] as const)(
    "runs %s preflight, bookmark, migration, exact deployment, health, and unlock in order",
    async (environment) => {
      const sql = await migrationSql();
      const runAttempt = initialAttempt(environment);
      runAttempt.migrationSql = sql;
      const runEffects = effects({}, runAttempt);

      const result = await requireApi("runProductCutover")(runAttempt, runEffects);

      expect(result).toMatchObject({ phase: "verified", status: "succeeded", environment });
      expectSuccessfulLifecycleWrites(runEffects, environment, "initial");
      expect(runEffects.readPreflight).toHaveBeenCalledExactlyOnceWith(environment);
      expect(runEffects.createRecoveryBookmark).toHaveBeenCalledExactlyOnceWith(environment);
      expect(runEffects.applyMigration).toHaveBeenCalledExactlyOnceWith(environment, {
        name: MIGRATION_NAME,
        sha256: MIGRATION_SHA256,
        sql,
      });
      expect(runEffects.deployTarget).toHaveBeenCalledExactlyOnceWith(environment, runAttempt.target);
      expect(runEffects.resolveTargetVersion).toHaveBeenCalledExactlyOnceWith(
        environment,
        runAttempt.target.sourceSha,
      );
      expect(runEffects.verifyCanonicalHealth).toHaveBeenCalledExactlyOnceWith(
        environment,
        observedTarget(),
      );
      expect(runEffects.assertDeploymentOwnership).toHaveBeenNthCalledWith(
        1,
        environment,
        runAttempt.activeBefore,
      );
      expect(runEffects.assertDeploymentOwnership).toHaveBeenNthCalledWith(
        2,
        environment,
        runAttempt.activeBefore,
      );
      expect(runEffects.assertDeploymentOwnership).toHaveBeenNthCalledWith(
        3,
        environment,
        { ...runAttempt.target, versionId: TARGET_VERSION_ID },
      );
      expect(runEffects.applyUnlock).toHaveBeenCalledExactlyOnceWith(
        environment,
        UNLOCK_STATEMENTS,
      );
      expect(runEffects.readPreflight.mock.invocationCallOrder[0])
        .toBeLessThan(runEffects.createRecoveryBookmark.mock.invocationCallOrder[0]);
      expect(runEffects.createRecoveryBookmark.mock.invocationCallOrder[0])
        .toBeLessThan(runEffects.applyMigration.mock.invocationCallOrder[0]);
      expect(runEffects.applyMigration.mock.invocationCallOrder[0])
        .toBeLessThan(runEffects.deployTarget.mock.invocationCallOrder[0]);
      expect(runEffects.deployTarget.mock.invocationCallOrder[0])
        .toBeLessThan(runEffects.applyUnlock.mock.invocationCallOrder[0]);
      if (environment === "production") {
        const activeQaSource = await runEffects.readQaActiveSource.mock.results[1]?.value;
        expect(runEffects.readQaActiveSource).toHaveBeenCalledTimes(2);
        expect(runEffects.recordQaBinding).toHaveBeenCalledExactlyOnceWith(
          activeQaSource,
          predecessorRecord({
            relationship: "same-build-alias",
            canonicalSourceSha: runAttempt.target.sourceSha,
            canonicalTreeSha: runAttempt.target.treeSha,
            canonicalWorkerBundleSha256: runAttempt.target.workerBundleSha256,
            canonicalDurableObjectBundleSha256:
              runAttempt.target.durableObjectBundleSha256,
            lineageParentSourceSha: runAttempt.target.sourceSha,
          }),
        );
        expect(runEffects.applyUnlock.mock.invocationCallOrder[0])
          .toBeLessThan(runEffects.recordQaBinding.mock.invocationCallOrder[0]);
        expect(runEffects.readTriggerInventory).toHaveBeenCalledTimes(2);
        expect(runEffects.readQaActiveSource.mock.invocationCallOrder[0])
          .toBeLessThan(runEffects.applyMigration.mock.invocationCallOrder[0]);
        expect(runEffects.readQaActiveSource.mock.invocationCallOrder[1])
          .toBeLessThan(runEffects.recordQaBinding.mock.invocationCallOrder[0]);
        expect(runEffects.readTriggerInventory.mock.invocationCallOrder[1])
          .toBeLessThan(runEffects.recordQaBinding.mock.invocationCallOrder[0]);
        expect(runEffects.recordQaBinding.mock.invocationCallOrder[0])
          .toBeLessThan(runEffects.writeEvidence.mock.invocationCallOrder[9]);
      } else {
        expect(runEffects.readQaActiveSource).not.toHaveBeenCalled();
        expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["qa", "production"] as const)(
    "resumes %s initial activation after an already-applied migration with exact closed fences",
    async (environment) => {
      const runAttempt = initialAttempt(environment);
      const runEffects = effects({
        readPendingMigrationNames: vi.fn(async () => []),
      }, runAttempt);

      await expect(requireApi("runProductCutover")(runAttempt, runEffects)).resolves.toMatchObject({
        environment,
        transition: "initial",
        phase: "verified",
        status: "succeeded",
        migration: {
          recoveryBookmarkId: null,
          applyState: "already_applied",
          triggerInventory: [...BOTH_TRIGGERS],
        },
      });
      expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
      expect(runEffects.applyMigration).not.toHaveBeenCalled();
      expect(runEffects.deployTarget).toHaveBeenCalledExactlyOnceWith(environment, runAttempt.target);
      expect(runEffects.applyUnlock).toHaveBeenCalledExactlyOnceWith(
        environment,
        UNLOCK_STATEMENTS,
      );
    },
  );

  it("verifies QA before mutation and persists a terminal failure if rebinding cannot finalize", async () => {
    const runEffects = effects({
      recordQaBinding: vi.fn(async () => {
        throw new Error("QA rebinding failed");
      }),
    });

    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("QA rebinding failed");
    expect(runEffects.readTriggerInventory).toHaveBeenCalledTimes(2);
    expect(runEffects.readQaActiveSource.mock.invocationCallOrder[0])
      .toBeLessThan(runEffects.applyMigration.mock.invocationCallOrder[0]);
    expect(runEffects.readTriggerInventory.mock.invocationCallOrder[1])
      .toBeLessThan(runEffects.recordQaBinding.mock.invocationCallOrder[0]);
    expect(runEffects.writeEvidence).toHaveBeenCalledTimes(10);
    expect(writtenLifecycleArtifacts(runEffects).at(-1)).toMatchObject({
      phase: "unlock",
      status: "failed",
      failure: { classification: "artifact_invalid" },
    });
  });

  it("persists the recovery bookmark before the reviewed migration can mutate D1", async () => {
    const runEffects = effects();
    await expect(requireApi("runProductCutover")(attempt(), runEffects)).resolves.toBeDefined();
    const rawArtifacts = vi.mocked(runEffects.writeEvidence).mock.calls.map(([value]) => value);
    const migrationPending = rawArtifacts.filter(
      ({ phase, status }) => phase === "migration" && status === "pending",
    );
    expect(migrationPending).toHaveLength(2);
    expect(migrationPending[0].migration.recoveryBookmarkId).toBeNull();
    expect(migrationPending[1].migration).toMatchObject({
      recoveryBookmarkId: RECOVERY_BOOKMARK_ID,
      applyState: "not_started",
      triggerInventory: null,
    });
    expect(runEffects.writeEvidence.mock.invocationCallOrder[3])
      .toBeLessThan(runEffects.applyMigration.mock.invocationCallOrder[0]);
  });

  it("retains a durable pre-mutation bookmark when retry proves migration already applied", async () => {
    const runAttempt = attempt();
    const previous = artifactForPhase("migration", "pending");
    previous.activeBefore = clone(runAttempt.activeBefore);
    previous.target = clone(runAttempt.target);
    previous.predecessor = clone(runAttempt.predecessor);
    previous.protocolBoundarySha = runAttempt.protocolBoundarySha;
    previous.compatibilitySourceSha = runAttempt.compatibilitySourceSha;
    previous.migration.name = runAttempt.migrationName;
    previous.migration.sha256 = runAttempt.migrationSha256;
    previous.deployment.sourceSha = runAttempt.target.sourceSha;
    previous.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
    const readEvidence = vi.fn(async () => previous);
    const runEffects = effects({
      readEvidence,
      readPendingMigrationNames: vi.fn(async () => []),
    }, runAttempt);

    const result = await requireApi("runProductCutover")(runAttempt, runEffects);

    expect(readEvidence).toHaveBeenCalledExactlyOnceWith();
    expect(result.migration).toMatchObject({
      recoveryBookmarkId: RECOVERY_BOOKMARK_ID,
      applyState: "already_applied",
      triggerInventory: [...BOTH_TRIGGERS],
    });
    expect(vi.mocked(runEffects.writeEvidence).mock.calls.every(
      ([value]) => value.migration.recoveryBookmarkId === RECOVERY_BOOKMARK_ID,
    )).toBe(true);
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
  });

  it("does not carry recovery evidence from a different immutable attempt", async () => {
    const previous = artifactForPhase("migration", "pending");
    previous.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
    const freshBookmark = "fresh-recovery-bookmark";
    const runEffects = effects({
      readEvidence: vi.fn(async () => previous),
      createRecoveryBookmark: vi.fn(async () => freshBookmark),
    });

    const result = await requireApi("runProductCutover")(attempt(), runEffects);

    expect(result.migration.recoveryBookmarkId).toBe(freshBookmark);
    expect(runEffects.createRecoveryBookmark).toHaveBeenCalledExactlyOnceWith("production");
    expect(vi.mocked(runEffects.writeEvidence).mock.calls.some(
      ([value]) => value.migration.recoveryBookmarkId === RECOVERY_BOOKMARK_ID,
    )).toBe(false);
  });

  it("fails QA verification in precheck before any D1 or deployment mutation", async () => {
    const runEffects = effects({
      readQaActiveSource: vi.fn(async () => Promise.reject(new Error("QA unavailable"))),
    });
    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("QA unavailable");
    expect(writtenLifecycleArtifacts(runEffects).at(-1)).toMatchObject({
      phase: "precheck",
      status: "failed",
      failure: { classification: "precondition_mismatch" },
    });
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it("falls back to terminal post-unlock evidence when the verified-state write fails", async () => {
    let writes = 0;
    const writeEvidence = vi.fn(async () => {
      writes += 1;
      if (writes === 10) throw new Error("verified state write failed");
    });
    const runEffects = effects({ writeEvidence });
    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("verified state write failed");
    expect(writeEvidence).toHaveBeenCalledTimes(11);
    expect(writtenLifecycleArtifacts(runEffects).at(-1)).toMatchObject({
      phase: "unlock",
      status: "failed",
      unlock: { applyState: "applied", inventoryAfter: [] },
      failure: { classification: "artifact_invalid" },
    });
  });

  it("runs a QA same-build alias repair through every phase", async () => {
    const runAttempt = qaAliasAttempt();
    const deployment = observedTarget({ sourceSha: REPAIR_SOURCE_SHA });
    const runEffects = effects({
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn(async () => []),
      resolveTargetVersion: vi.fn(async () => TARGET_VERSION_ID),
      deployTarget: vi.fn(async () => deployment),
      observeDeployment: vi.fn(async () => deployment),
    }, runAttempt);

    await expect(requireApi("runProductCutover")(runAttempt, runEffects)).resolves.toMatchObject({
      environment: "qa",
      transition: "forward-repair",
      phase: "verified",
      status: "succeeded",
      predecessor: { relationship: "same-build-alias" },
      migration: { applyState: "already_applied" },
      deployment,
    });
    expect(runEffects.readPreflight).toHaveBeenCalledExactlyOnceWith("qa");
    expectSuccessfulLifecycleWrites(runEffects, "qa", "forward-repair");
    expect(runEffects.deployTarget).toHaveBeenCalledExactlyOnceWith("qa", runAttempt.target);
    expect(runEffects.applyUnlock).toHaveBeenCalledExactlyOnceWith("qa", UNLOCK_STATEMENTS);
    expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
  });

  it("runs a post-restoration product repair through every phase while production stays on its floor", async () => {
    const runAttempt = postRestorationAttempt(FAILED_RESTORATION_SHA);
    const deployment = observedTarget({ sourceSha: POST_REPAIR_SOURCE_SHA });
    const runEffects = effects({
      runCommand: gitEvidenceRunner({
        firstParents: { [POST_REPAIR_SOURCE_SHA]: FAILED_RESTORATION_SHA },
      }),
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn(async () => []),
      resolveTargetVersion: vi.fn(async () => TARGET_VERSION_ID),
      deployTarget: vi.fn(async () => deployment),
      observeDeployment: vi.fn(async () => deployment),
    }, runAttempt);

    await expect(requireApi("runProductCutover")(runAttempt, runEffects)).resolves.toMatchObject({
      environment: "production",
      transition: "post-restoration-product-repair",
      phase: "verified",
      status: "succeeded",
      activeBefore: { sourceSha: RUNTIME_FLOOR_SHA },
      target: { sourceSha: POST_REPAIR_SOURCE_SHA, versionId: TARGET_VERSION_ID },
      migration: { applyState: "already_applied" },
      deployment,
    });
    expect(runEffects.loadPostRestorationApproval)
      .toHaveBeenCalledExactlyOnceWith("production", FAILED_RESTORATION_SHA);
    expectSuccessfulLifecycleWrites(
      runEffects,
      "production",
      "post-restoration-product-repair",
    );
    expect(runEffects.runCommand).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", `${RUNTIME_FLOOR_SHA}...${POST_REPAIR_SOURCE_SHA}`],
      { env: undefined },
    );
    expect(runEffects.applyUnlock).toHaveBeenCalledExactlyOnceWith(
      "production",
      UNLOCK_STATEMENTS,
    );
    expect(runEffects.recordQaBinding).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sourceSha: QA_ALIAS_SHA }),
      predecessorRecord({
        relationship: "same-build-alias",
        canonicalSourceSha: POST_REPAIR_SOURCE_SHA,
        canonicalTreeSha: runAttempt.target.treeSha,
        canonicalWorkerBundleSha256: runAttempt.target.workerBundleSha256,
        canonicalDurableObjectBundleSha256: runAttempt.target.durableObjectBundleSha256,
        lineageParentSourceSha: POST_REPAIR_SOURCE_SHA,
        runtimeFloorSourceSha: runAttempt.predecessor.runtimeFloorSourceSha,
        originalFailedRestorationSourceSha:
          runAttempt.predecessor.originalFailedRestorationSourceSha,
      }),
    );
  });

  it("runs a post-restoration QA alias bound to the latest failed lineage through every phase", async () => {
    const previous = failedPostRestorationArtifact(FAILED_REPAIR_SHA, POST_REPAIR_SOURCE_SHA);
    const runAttempt = qaPostRestorationAttempt(
      FAILED_REPAIR_SHA,
      FAILED_REPAIR_SHA,
      NEXT_REPAIR_SHA,
    );
    const deployment = observedTarget({ sourceSha: NEXT_REPAIR_SHA });
    const runEffects = effects({
      runCommand: gitEvidenceRunner({
        firstParents: { [NEXT_REPAIR_SHA]: FAILED_REPAIR_SHA },
      }),
      loadPostRestorationChainState: vi.fn(async () => restorationChainState(previous)),
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn(async () => []),
      resolveTargetVersion: vi.fn(async () => TARGET_VERSION_ID),
      deployTarget: vi.fn(async () => deployment),
      observeDeployment: vi.fn(async () => deployment),
    }, runAttempt);

    await expect(requireApi("runProductCutover")(runAttempt, runEffects)).resolves.toMatchObject({
      environment: "qa",
      transition: "post-restoration-product-repair",
      phase: "verified",
      status: "succeeded",
      predecessor: {
        relationship: "same-build-alias",
        canonicalSourceSha: FAILED_REPAIR_SHA,
      },
      migration: { applyState: "already_applied" },
      deployment,
    });
    expectSuccessfulLifecycleWrites(runEffects, "qa", "post-restoration-product-repair");
    expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
  });

  it.each([
    ["tree", { treeSha: OTHER_TREE_SHA }],
    ["Worker bundle", { workerBundleSha256: OTHER_BUNDLE_SHA256 }],
    ["Durable Object bundle", { durableObjectBundleSha256: OTHER_BUNDLE_SHA256 }],
    ["missing live version", { versionId: null }],
    ["non-product release mode", { releaseMode: "atomic-bootstrap" as const }],
  ])("does not record an invalid QA alias after production when %s differs", async (
    _label,
    mismatch,
  ) => {
    const runEffects = effects({
      readQaActiveSource: vi.fn(async () => sourceRecord({
        sourceSha: QA_ALIAS_SHA,
        versionId: TARGET_VERSION_ID,
        releaseMode: "atomic-product-activation",
        ...mismatch,
      })),
    });

    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("QA");
    expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
  });

  it("records an exact QA binding when QA already runs the production merge source", async () => {
    const runAttempt = attempt();
    const activeQaSource = sourceRecord({
      sourceSha: TARGET_SOURCE_SHA,
      treeSha: runAttempt.target.treeSha,
      workerBundleSha256: runAttempt.target.workerBundleSha256,
      durableObjectBundleSha256: runAttempt.target.durableObjectBundleSha256,
      versionId: TARGET_VERSION_ID,
      releaseMode: "atomic-product-activation",
    });
    const runEffects = effects({
      readQaActiveSource: vi.fn(async () => activeQaSource),
    });

    await expect(requireApi("runProductCutover")(runAttempt, runEffects)).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(runEffects.recordQaBinding).toHaveBeenCalledExactlyOnceWith(
      activeQaSource,
      predecessorRecord({
        canonicalSourceSha: TARGET_SOURCE_SHA,
        canonicalTreeSha: runAttempt.target.treeSha,
        canonicalWorkerBundleSha256: runAttempt.target.workerBundleSha256,
        canonicalDurableObjectBundleSha256: runAttempt.target.durableObjectBundleSha256,
        lineageParentSourceSha: TARGET_SOURCE_SHA,
      }),
    );
  });

  it("records the freshly re-read QA source after a concurrent valid QA deployment", async () => {
    const runAttempt = attempt();
    const precheckAlias = sourceRecord({
      sourceSha: QA_ALIAS_SHA,
      treeSha: runAttempt.target.treeSha,
      workerBundleSha256: runAttempt.target.workerBundleSha256,
      durableObjectBundleSha256: runAttempt.target.durableObjectBundleSha256,
      versionId: ACTIVE_VERSION_ID,
      releaseMode: "atomic-product-activation",
    });
    const currentExactSource = {
      ...runAttempt.target,
      versionId: TARGET_VERSION_ID,
    };
    const readQaActiveSource = vi.fn()
      .mockResolvedValueOnce(precheckAlias)
      .mockResolvedValueOnce(currentExactSource);
    const runEffects = effects({ readQaActiveSource });

    await expect(requireApi("runProductCutover")(runAttempt, runEffects))
      .resolves.toMatchObject({ status: "succeeded" });

    expect(readQaActiveSource).toHaveBeenCalledTimes(2);
    expect(runEffects.recordQaBinding).toHaveBeenCalledExactlyOnceWith(
      currentExactSource,
      predecessorRecord({
        canonicalSourceSha: TARGET_SOURCE_SHA,
        canonicalTreeSha: runAttempt.target.treeSha,
        canonicalWorkerBundleSha256: runAttempt.target.workerBundleSha256,
        canonicalDurableObjectBundleSha256: runAttempt.target.durableObjectBundleSha256,
        lineageParentSourceSha: TARGET_SOURCE_SHA,
      }),
    );
  });

  it.each([
    ["duplicate SavedRecipe backfill", { duplicateSavedRecipePairs: 1 }],
    ["invalid SavedRecipe backfill", { invalidSavedRecipeBackfillRows: 1 }],
    ["a D1 cook-state table", { cookStateTables: ["CookSession"] }],
  ])("fails closed before bookmark or mutation for %s", async (_label, preflightOverride) => {
    const runEffects = effects({
      readPreflight: vi.fn(async () => ({
        duplicateSavedRecipePairs: 0,
        invalidSavedRecipeBackfillRows: 0,
        cookStateTables: [],
        ...preflightOverride,
      })),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("preflight");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      ["precheck:pending", "precheck:failed"],
      "precheck",
      "precondition_mismatch",
    );
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it("fails closed when a recovery bookmark cannot be captured", async () => {
    const runEffects = effects({
      createRecoveryBookmark: vi.fn(async () => {
        throw new Error("bookmark transport secret");
      }),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("bookmark");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "recovery_bookmark_failed",
    );
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
    expect(JSON.stringify(runEffects.writeEvidence.mock.calls)).not.toContain("secret");
  });

  it("rejects an unrelated pending migration before bookmark or mutation", async () => {
    const runEffects = effects({
      readPendingMigrationNames: vi.fn(async () => [MIGRATION_NAME, "0026_unreviewed.sql"]),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("migration");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "migration_rejected",
    );
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
  });

  it("requires exactly both closed-fence triggers after initial migration", async () => {
    for (const triggerInventory of [[], [INSERT_TRIGGER], [DELETE_TRIGGER], [...BOTH_TRIGGERS, "Unexpected"]]) {
      const runEffects = effects({
        readTriggerInventory: vi.fn(async () => triggerInventory),
      });
      await expect(requireApi("runProductCutover")(
        attempt(),
        runEffects,
      )).rejects.toThrow("trigger");
      expectTerminalFailureLifecycle(
        runEffects,
        attempt(),
        [
          "precheck:pending",
          "precheck:succeeded",
          "migration:pending",
          "migration:failed",
        ],
        "migration",
        "trigger_inventory_mismatch",
      );
      expect(runEffects.deployTarget).not.toHaveBeenCalled();
      expect(runEffects.applyUnlock).not.toHaveBeenCalled();
    }
  });

  it("classifies malformed trigger inventory evidence as an ambiguous migration state", async () => {
    const runEffects = effects({
      readTriggerInventory: vi.fn(async () => [42] as unknown as string[]),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("inventory evidence is invalid");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "migration_state_ambiguous",
    );
    expect(writtenLifecycleArtifacts(runEffects).at(-1)?.migration.triggerInventory).toBeNull();
  });

  it.each([
    [[]],
    [[INSERT_TRIGGER]],
    [[DELETE_TRIGGER]],
    [[...BOTH_TRIGGERS]],
  ] as const)("accepts ordinary repair trigger inventory %j", async (inventory) => {
    const repairAttempt = ordinaryRepairAttempt();
    const deployment = observedTarget({ sourceSha: REPAIR_SOURCE_SHA });
    const runEffects = effects({
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn()
        .mockResolvedValueOnce(inventory)
        .mockResolvedValue([]),
      deployTarget: vi.fn(async () => deployment),
      observeDeployment: vi.fn(async () => deployment),
    }, repairAttempt);
    await expect(requireApi("runProductCutover")(
      repairAttempt,
      runEffects,
    )).resolves.toMatchObject({
      phase: "verified",
      status: "succeeded",
      migration: { applyState: "already_applied" },
    });
    expectSuccessfulLifecycleWrites(runEffects, "production", "forward-repair");
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.recordQaBinding).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sourceSha: QA_ALIAS_SHA }),
      predecessorRecord({
        relationship: "same-build-alias",
        canonicalSourceSha: REPAIR_SOURCE_SHA,
        canonicalTreeSha: repairAttempt.target.treeSha,
        canonicalWorkerBundleSha256: repairAttempt.target.workerBundleSha256,
        canonicalDurableObjectBundleSha256: repairAttempt.target.durableObjectBundleSha256,
        lineageParentSourceSha: REPAIR_SOURCE_SHA,
      }),
    );
  });

  it("rejects an unexpected trigger on every repair path", async () => {
    const repairAttempt = ordinaryRepairAttempt();
    const runEffects = effects({
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn(async () => ["Unexpected"]),
    }, repairAttempt);
    await expect(requireApi("runProductCutover")(
      repairAttempt,
      runEffects,
    )).rejects.toThrow("trigger");
    expectTerminalFailureLifecycle(
      runEffects,
      repairAttempt,
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "trigger_inventory_mismatch",
    );
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it.each([
    [[INSERT_TRIGGER]],
    [[DELETE_TRIGGER]],
    [[...BOTH_TRIGGERS]],
    [["Unexpected"]],
  ] as const)("requires zero triggers for post-restoration repair, rejecting %j", async (inventory) => {
    const repairAttempt = postRestorationAttempt(FAILED_RESTORATION_SHA);
    const runEffects = effects({
      runCommand: gitEvidenceRunner({
        firstParents: { [POST_REPAIR_SOURCE_SHA]: FAILED_RESTORATION_SHA },
      }),
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn(async () => inventory),
    }, repairAttempt);
    await expect(requireApi("runProductCutover")(
      repairAttempt,
      runEffects,
    )).rejects.toThrow("trigger");
    expectTerminalFailureLifecycle(
      runEffects,
      repairAttempt,
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "trigger_inventory_mismatch",
    );
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
  });

  it.each(["qa", "production"] as const)(
    "reconciles a lost %s migration response only from exact applied state and closed triggers",
    async (environment) => {
    const runAttempt = initialAttempt(environment);
    const runEffects = effects({
      applyMigration: vi.fn(async () => {
        throw new Error("lost response");
      }),
      readPendingMigrationNames: vi.fn()
        .mockResolvedValueOnce([MIGRATION_NAME])
        .mockResolvedValue([]),
    }, runAttempt);
    await expect(requireApi("runProductCutover")(
      runAttempt,
      runEffects,
    )).resolves.toMatchObject({
      migration: { applyState: "ambiguous_reconciled" },
    });
    expect(writtenLifecycleArtifacts(runEffects).map(
      ({ phase, status }) => `${phase}:${status}`,
    )).toEqual([
      "precheck:pending",
      "precheck:succeeded",
      "migration:pending",
      "migration:ambiguous_reconciled",
      "deployment:pending",
      "deployment:succeeded",
      "unlock:pending",
      "unlock:succeeded",
      "verified:succeeded",
    ]);
    expect(runEffects.deployTarget).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["still-pending migration", [MIGRATION_NAME], [...BOTH_TRIGGERS]],
    ["missing closed trigger", [], [INSERT_TRIGGER]],
  ])("does not reconcile a lost migration response with %s", async (_label, pending, triggers) => {
    const runEffects = effects({
      applyMigration: vi.fn(async () => {
        throw new Error("lost response");
      }),
      readPendingMigrationNames: vi.fn()
        .mockResolvedValueOnce([MIGRATION_NAME])
        .mockResolvedValue(pending),
      readTriggerInventory: vi.fn(async () => triggers),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("ambiguous");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "migration_state_ambiguous",
    );
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
  });

  it("persists valid terminal evidence when migration reconciliation itself cannot read D1", async () => {
    const runEffects = effects({
      applyMigration: vi.fn(async () => {
        throw new Error("migration response lost");
      }),
      readPendingMigrationNames: vi.fn()
        .mockResolvedValueOnce([MIGRATION_NAME])
        .mockRejectedValueOnce(new Error("pending inventory unavailable")),
    });

    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("ambiguous");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "migration_state_ambiguous",
    );
  });

  it.each(["qa", "production"] as const)(
    "reconciles a lost %s deploy response only from exact target identity at 100%",
    async (environment) => {
    const runAttempt = initialAttempt(environment);
    const runEffects = effects({
      deployTarget: vi.fn(async () => {
        throw new Error("lost deploy response");
      }),
    }, runAttempt);
    await expect(requireApi("runProductCutover")(
      runAttempt,
      runEffects,
    )).resolves.toMatchObject({ status: "succeeded", deployment: observedTarget() });
    expect(writtenLifecycleArtifacts(runEffects).map(
      ({ phase, status }) => `${phase}:${status}`,
    )).toEqual([
      "precheck:pending",
      "precheck:succeeded",
      "migration:pending",
      "migration:succeeded",
      "deployment:pending",
      "deployment:ambiguous_reconciled",
      "unlock:pending",
      "unlock:succeeded",
      "verified:succeeded",
    ]);
    expect(runEffects.applyUnlock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["wrong source", observedTarget({ sourceSha: REPAIR_SOURCE_SHA })],
    ["wrong version", observedTarget({ versionId: ACTIVE_VERSION_ID })],
    ["arbitrary version", observedTarget({
      versionId: "55555555-5555-4555-8555-555555555555",
    })],
    ["split traffic", observedTarget({ trafficPercent: 99 })],
    ["missing deployment", observedTarget({ deploymentId: null })],
  ])("refuses unlock after %s", async (_label, deployment) => {
    const runEffects = effects({ observeDeployment: vi.fn(async () => deployment) });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("target");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:failed",
      ],
      "deployment",
      "target_identity_mismatch",
    );
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it("persists valid terminal evidence when target topology cannot be observed after upload", async () => {
    const runEffects = effects({
      observeDeployment: vi.fn()
        .mockRejectedValueOnce(new Error("deployment inventory unavailable")),
    });

    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("ambiguous");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:failed",
      ],
      "deployment",
      "deployment_state_ambiguous",
    );
  });

  it("classifies a failed activation as ambiguous while the old source remains active", async () => {
    const runEffects = effects({
      deployTarget: vi.fn(async () => {
        throw new Error("deploy response lost");
      }),
      observeDeployment: vi.fn(async () => ({
        deploymentId: "44444444-4444-4444-8444-444444444444",
        versionId: ACTIVE_VERSION_ID,
        sourceSha: COMPATIBILITY_SOURCE_SHA,
        trafficPercent: 100,
      })),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("ambiguous");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:failed",
      ],
      "deployment",
      "deployment_state_ambiguous",
    );
    const finalEvidence = runEffects.writeEvidence.mock.calls.at(-1)?.[0];
    expect(finalEvidence).toMatchObject({
      phase: "deployment",
      status: "failed",
      failure: { phase: "deployment", classification: "deployment_state_ambiguous" },
    });
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it("records an exact active target when canonical health fails so the next attempt can repair forward", async () => {
    const runEffects = effects({ verifyCanonicalHealth: vi.fn(async () => false) });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("health");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:failed",
      ],
      "deployment",
      "canonical_health_failed",
    );
    const finalEvidence = runEffects.writeEvidence.mock.calls.at(-1)?.[0];
    expect(finalEvidence).toMatchObject({
      phase: "deployment",
      status: "failed",
      target: { versionId: TARGET_VERSION_ID },
      deployment: observedTarget(),
      failure: { phase: "deployment", classification: "canonical_health_failed" },
    });
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it.each([
    [[]],
    [[INSERT_TRIGGER]],
    [[DELETE_TRIGGER]],
    [[...BOTH_TRIGGERS]],
  ] as const)("reconciles exact same-target trigger inventory %j", async (inventory) => {
    const retry = sameTargetAttempt();
    const runEffects = effects({
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn()
        .mockResolvedValueOnce(inventory)
        .mockResolvedValue([]),
      observeDeployment: vi.fn(async () => observedTarget()),
    }, retry);
    await expect(requireApi("runProductCutover")(
      retry,
      runEffects,
    )).resolves.toMatchObject({
      transition: "same-target-reconcile",
      migration: { applyState: "already_applied", triggerInventory: inventory },
      unlock: {
        inventoryBefore: inventory,
        applyState: inventory.length === 0 ? "already_absent" : "applied",
        inventoryAfter: [],
      },
    });
    expectSuccessfulLifecycleWrites(runEffects, "production", "same-target-reconcile");
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
    expect(runEffects.resolveTargetVersion).toHaveBeenCalledExactlyOnceWith(
      retry.environment,
      retry.target.sourceSha,
    );
    expect(runEffects.applyUnlock).toHaveBeenCalledExactlyOnceWith(
      retry.environment,
      UNLOCK_STATEMENTS,
    );
    expect(runEffects.recordQaBinding).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sourceSha: QA_ALIAS_SHA }),
      predecessorRecord({
        relationship: "same-build-alias",
        canonicalSourceSha: TARGET_SOURCE_SHA,
        canonicalTreeSha: retry.target.treeSha,
        canonicalWorkerBundleSha256: retry.target.workerBundleSha256,
        canonicalDurableObjectBundleSha256: retry.target.durableObjectBundleSha256,
        lineageParentSourceSha: TARGET_SOURCE_SHA,
      }),
    );
  });

  it("rejects unexpected same-target inventory before unlock", async () => {
    const retry = sameTargetAttempt();
    const runEffects = effects({
      readPendingMigrationNames: vi.fn(async () => []),
      readTriggerInventory: vi.fn(async () => ["Unexpected"]),
    }, retry);
    await expect(requireApi("runProductCutover")(
      retry,
      runEffects,
    )).rejects.toThrow("trigger");
    expectTerminalFailureLifecycle(
      runEffects,
      retry,
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:failed",
      ],
      "migration",
      "trigger_inventory_mismatch",
    );
    expect(runEffects.createRecoveryBookmark).not.toHaveBeenCalled();
    expect(runEffects.applyMigration).not.toHaveBeenCalled();
    expect(runEffects.deployTarget).not.toHaveBeenCalled();
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it.each(["qa", "production"] as const)(
    "reconciles a lost %s unlock response only after zero-trigger readback",
    async (environment) => {
    const runAttempt = initialAttempt(environment);
    const runEffects = effects({
      applyUnlock: vi.fn(async () => {
        throw new Error("lost unlock response");
      }),
    }, runAttempt);
    await expect(requireApi("runProductCutover")(
      runAttempt,
      runEffects,
    )).resolves.toMatchObject({
      unlock: { applyState: "ambiguous_reconciled", inventoryAfter: [] },
    });
    expect(writtenLifecycleArtifacts(runEffects).map(
      ({ phase, status }) => `${phase}:${status}`,
    )).toEqual([
      "precheck:pending",
      "precheck:succeeded",
      "migration:pending",
      "migration:succeeded",
      "deployment:pending",
      "deployment:succeeded",
      "unlock:pending",
      "unlock:ambiguous_reconciled",
      "verified:succeeded",
    ]);
    },
  );

  it("fails closed when trigger residue remains after unlock", async () => {
    const runEffects = effects({
      readTriggerInventory: vi.fn(async () => [...BOTH_TRIGGERS]),
    });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("unlock");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:succeeded",
        "unlock:pending",
        "unlock:failed",
      ],
      "unlock",
      "unlock_state_ambiguous",
    );
    expect(runEffects.readQaActiveSource).toHaveBeenCalledExactlyOnceWith();
    expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
  });

  it("never unlocks a different active target after deployment", async () => {
    const assertDeploymentOwnership = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("deployment ownership changed before unlock"));
    const runEffects = effects({ assertDeploymentOwnership });
    await expect(requireApi("runProductCutover")(
      attempt(),
      runEffects,
    )).rejects.toThrow("ownership changed");
    expectTerminalFailureLifecycle(
      runEffects,
      attempt(),
      [
        "precheck:pending",
        "precheck:succeeded",
        "migration:pending",
        "migration:succeeded",
        "deployment:pending",
        "deployment:succeeded",
        "unlock:pending",
        "unlock:failed",
      ],
      "unlock",
      "unlock_state_ambiguous",
    );
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });

  it("rechecks target ownership after trigger inventory capture and before unlock", async () => {
    const assertDeploymentOwnership = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("deployment replaced after inventory capture"));
    const runEffects = effects({ assertDeploymentOwnership });
    await expect(requireApi("runProductCutover")(attempt(), runEffects))
      .rejects.toThrow("replaced after inventory capture");
    expect(writtenLifecycleArtifacts(runEffects).at(-1)).toMatchObject({
      phase: "unlock",
      status: "failed",
      unlock: {
        inventoryBefore: [...BOTH_TRIGGERS],
        applyState: "failed",
        inventoryAfter: null,
      },
      failure: { classification: "unlock_state_ambiguous" },
    });
    expect(runEffects.applyUnlock).not.toHaveBeenCalled();
  });
});

type OrdinaryRuntimeProfile = "byte-identical" | "worker" | "durable-object" | "both";

function ordinaryRepairAttempt(profile: OrdinaryRuntimeProfile = "worker"): CutoverAttempt {
  const targetProfile = {
    "byte-identical": {
      sourceSha: QA_ALIAS_SHA,
      treeSha: RUNTIME_FLOOR_TREE_SHA,
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
    },
    worker: {
      sourceSha: REPAIR_SOURCE_SHA,
      treeSha: REPAIR_TREE_SHA,
      workerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
    },
    "durable-object": {
      sourceSha: RELEASE_TOPOLOGY.ordinaryDoRepair.sourceSha,
      treeSha: RELEASE_TOPOLOGY.ordinaryDoRepair.treeSha,
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: CANDIDATE_DO_BUNDLE_SHA256,
    },
    both: {
      sourceSha: RELEASE_TOPOLOGY.ordinaryBothRepair.sourceSha,
      treeSha: RELEASE_TOPOLOGY.ordinaryBothRepair.treeSha,
      workerBundleSha256: CANDIDATE_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: CANDIDATE_DO_BUNDLE_SHA256,
    },
  }[profile];
  return attempt({
    transition: "forward-repair",
    activeBefore: sourceRecord({
      sourceSha: RUNTIME_FLOOR_SHA,
      treeSha: RUNTIME_FLOOR_TREE_SHA,
      workerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      durableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      versionId: ACTIVE_VERSION_ID,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
    }),
    target: sourceRecord({
      ...targetProfile,
      versionId: null,
      releaseMode: "atomic-product-activation",
      baseSourceSha: RUNTIME_FLOOR_SHA,
    }),
    predecessor: predecessorRecord({
      canonicalSourceSha: RUNTIME_FLOOR_SHA,
      canonicalTreeSha: RUNTIME_FLOOR_TREE_SHA,
      canonicalWorkerBundleSha256: RUNTIME_FLOOR_WORKER_BUNDLE_SHA256,
      canonicalDurableObjectBundleSha256: RUNTIME_FLOOR_DO_BUNDLE_SHA256,
      lineageParentSourceSha: RUNTIME_FLOOR_SHA,
    }),
    protocolBoundarySha: TOPOLOGY_PROTOCOL_BOUNDARY_SHA,
  });
}

function sameTargetAttempt(): CutoverAttempt {
  const target = sourceRecord({
    sourceSha: TARGET_SOURCE_SHA,
    treeSha: TARGET_TREE_SHA,
    workerBundleSha256: PRODUCT_WORKER_BUNDLE_SHA256,
    versionId: TARGET_VERSION_ID,
    releaseMode: "atomic-product-activation",
    baseSourceSha: TARGET_BASE_SHA,
  });
  return attempt({
    transition: "same-target-reconcile",
    activeBefore: target,
    target,
    predecessor: predecessorRecord({
      canonicalSourceSha: TARGET_SOURCE_SHA,
      canonicalTreeSha: TARGET_TREE_SHA,
      canonicalWorkerBundleSha256: PRODUCT_WORKER_BUNDLE_SHA256,
      canonicalDurableObjectBundleSha256: DO_BUNDLE_SHA256,
      lineageParentSourceSha: TARGET_BASE_SHA,
    }),
  });
}

describe("schema-v1 product-cutover evidence", () => {
  it("accepts the exact complete verified artifact", () => {
    expect(() => requireApi("assertProductCutoverArtifact")(artifact())).not.toThrow();
  });

  it("requires the exact top-level and nested key sets", () => {
    const valid = artifact();
    const mutations: ProductCutoverArtifact[] = [];
    for (const key of Object.keys(valid)) {
      const value = clone(valid) as unknown as Record<string, unknown>;
      delete value[key];
      mutations.push(value as unknown as ProductCutoverArtifact);
    }
    for (const section of [
      "activeBefore",
      "target",
      "predecessor",
      "migration",
      "deployment",
      "unlock",
    ] as const) {
      for (const key of Object.keys(valid[section])) {
        const value = clone(valid) as unknown as Record<string, Record<string, unknown>>;
        delete value[section][key];
        mutations.push(value as unknown as ProductCutoverArtifact);
      }
      const value = clone(valid) as unknown as Record<string, Record<string, unknown>>;
      value[section].unexpected = true;
      mutations.push(value as unknown as ProductCutoverArtifact);
    }
    const failed = artifactForPhase("deployment", "failed");
    if (!failed.failure) throw new Error("failure fixture must be present");
    for (const key of Object.keys(failed.failure)) {
      const value = clone(failed) as unknown as ProductCutoverArtifact & {
        failure: Record<string, unknown>;
      };
      delete value.failure[key];
      mutations.push(value as unknown as ProductCutoverArtifact);
    }
    mutations.push({
      ...failed,
      failure: { ...failed.failure, unexpected: true },
    } as unknown as ProductCutoverArtifact);
    mutations.push({ ...valid, unexpected: true } as unknown as ProductCutoverArtifact);

    for (const invalid of mutations) {
      expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
    }
  });

  it.each([
    ["schemaVersion", (value: ProductCutoverArtifact) => {
      (value as unknown as { schemaVersion: number }).schemaVersion = 2;
    }],
    ["environment", "staging"],
    ["transition", "rollback"],
    ["phase", "complete"],
    ["status", "promoted"],
    ["source releaseMode", (value: ProductCutoverArtifact) => {
      (value.target as unknown as { releaseMode: string }).releaseMode = "gradual";
    }],
    ["predecessor relationship", (value: ProductCutoverArtifact) => {
      (value.predecessor as unknown as { relationship: string }).relationship = "similar";
    }],
    ["migration applyState", (value: ProductCutoverArtifact) => {
      (value.migration as unknown as { applyState: string }).applyState = "succeeded";
    }],
    ["unlock applyState", (value: ProductCutoverArtifact) => {
      (value.unlock as unknown as { applyState: string }).applyState = "succeeded";
    }],
    ["failure classification", (value: ProductCutoverArtifact) => {
      value.phase = "deployment";
      value.status = "failed";
      value.failure = {
        phase: "deployment",
        classification: "unknown" as ProductCutoverArtifact["failure"] extends { classification: infer T }
          ? T
          : never,
      };
    }],
  ])("rejects an unknown %s enum", (key, mutation) => {
    const invalid = artifact();
    if (typeof mutation === "function") mutation(invalid);
    else (invalid as unknown as Record<string, unknown>)[key] = mutation;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    "initial",
    "same-target-reconcile",
    "forward-repair",
    "post-restoration-product-repair",
  ] as const)("accepts the complete %s transition record", (transition) => {
    expect(() => requireApi("assertProductCutoverArtifact")(
      artifactForTransition(transition),
    )).not.toThrow();
  });

  it.each([
    ["precheck", "pending"],
    ["precheck", "succeeded"],
    ["precheck", "failed"],
    ["migration", "pending"],
    ["migration", "succeeded"],
    ["migration", "failed"],
    ["migration", "ambiguous_reconciled"],
    ["deployment", "pending"],
    ["deployment", "succeeded"],
    ["deployment", "failed"],
    ["deployment", "ambiguous_reconciled"],
    ["unlock", "pending"],
    ["unlock", "succeeded"],
    ["unlock", "failed"],
    ["unlock", "ambiguous_reconciled"],
    ["verified", "succeeded"],
  ] as const)("accepts legal %s:%s phase/status evidence", (phase, status) => {
    expect(() => requireApi("assertProductCutoverArtifact")(
      artifactForPhase(phase, status),
    )).not.toThrow();
  });

  it.each([
    ["precheck", "ambiguous_reconciled"],
    ["verified", "pending"],
    ["verified", "failed"],
    ["verified", "ambiguous_reconciled"],
  ] as const)("rejects illegal %s:%s phase/status evidence", (phase, status) => {
    expect(() => requireApi("assertProductCutoverArtifact")({
      ...artifact(),
      phase,
      status,
    } as ProductCutoverArtifact)).toThrow("artifact");
  });

  it.each([
    ["precheck pending to succeeded", artifactForPhase("precheck", "pending"), artifactForPhase("precheck", "succeeded")],
    ["precheck succeeded to migration pending", artifactForPhase("precheck", "succeeded"), artifactForPhase("migration", "pending")],
    ["migration pending to reconciled", artifactForPhase("migration", "pending"), artifactForPhase("migration", "ambiguous_reconciled")],
    ["migration succeeded to deployment pending", artifactForPhase("migration", "succeeded"), artifactForPhase("deployment", "pending")],
    ["deployment reconciled to unlock pending", artifactForPhase("deployment", "ambiguous_reconciled"), artifactForPhase("unlock", "pending")],
    ["unlock succeeded to verified", artifactForPhase("unlock", "succeeded"), artifactForPhase("verified", "succeeded")],
  ])("accepts legal transition %s", (_label, previous, current) => {
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous)).not.toThrow();
  });

  it.each([
    ["skipped phase", artifactForPhase("precheck", "succeeded"), artifactForPhase("deployment", "pending")],
    ["reversed phase", artifactForPhase("deployment", "succeeded"), artifactForPhase("migration", "pending")],
    ["continued after failure", artifactForPhase("migration", "failed"), artifactForPhase("deployment", "pending")],
    ["pending to pending", artifactForPhase("unlock", "pending"), artifactForPhase("unlock", "pending")],
    ["success to failure", artifactForPhase("deployment", "succeeded"), artifactForPhase("deployment", "failed")],
  ])("rejects illegal transition %s", (_label, previous, current) => {
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous)).toThrow("artifact");
  });

  it("classifies every phase/status pair and every possible lifecycle edge", () => {
    const validate = requireApi("assertProductCutoverArtifact");
    const phases: CutoverPhase[] = ["precheck", "migration", "deployment", "unlock", "verified"];
    const statuses: CutoverStatus[] = ["pending", "succeeded", "failed", "ambiguous_reconciled"];
    const legalPairs = new Set([
      "precheck:pending", "precheck:succeeded", "precheck:failed",
      "migration:pending", "migration:succeeded", "migration:failed", "migration:ambiguous_reconciled",
      "deployment:pending", "deployment:succeeded", "deployment:failed", "deployment:ambiguous_reconciled",
      "unlock:pending", "unlock:succeeded", "unlock:failed", "unlock:ambiguous_reconciled",
      "verified:succeeded",
    ]);
    const states = phases.flatMap((phase) => statuses.map((status) => ({
      key: `${phase}:${status}`,
      phase,
      status,
      artifact: artifactForPhase(phase, status),
    })));

    for (const state of states) {
      const assertion = expect(() => validate(state.artifact), state.key);
      if (legalPairs.has(state.key)) assertion.not.toThrow();
      else assertion.toThrow("artifact");
    }

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
    const validStates = states.filter((state) => legalPairs.has(state.key));
    for (const previous of validStates) {
      for (const current of validStates) {
        const edge = `${previous.key}>${current.key}`;
        const currentArtifact = clone(current.artifact);
        if (legalEdges.has(edge)) {
          const previousPhaseIndex = phases.indexOf(previous.phase);
          const currentPhaseIndex = phases.indexOf(current.phase);
          if (previousPhaseIndex >= phases.indexOf("migration") &&
              currentPhaseIndex > previousPhaseIndex) {
            currentArtifact.migration = clone(previous.artifact.migration);
          }
          if (previousPhaseIndex >= phases.indexOf("deployment") &&
              currentPhaseIndex > previousPhaseIndex) {
            currentArtifact.target.versionId = previous.artifact.target.versionId;
            currentArtifact.deployment = clone(previous.artifact.deployment);
          }
          if (previousPhaseIndex >= phases.indexOf("unlock") &&
              currentPhaseIndex > previousPhaseIndex) {
            currentArtifact.unlock = clone(previous.artifact.unlock);
          }
          if (edge === "unlock:succeeded>unlock:failed" ||
              edge === "unlock:ambiguous_reconciled>unlock:failed") {
            currentArtifact.unlock = clone(previous.artifact.unlock);
          }
        }
        const assertion = expect(
          () => validate(currentArtifact, previous.artifact),
          edge,
        );
        if (legalEdges.has(edge)) assertion.not.toThrow();
        else assertion.toThrow("artifact");
      }
    }
  });

  it.each([
    ["environment", (value: ProductCutoverArtifact) => { value.environment = "qa"; }],
    ["transition", (value: ProductCutoverArtifact) => {
      Object.assign(value, artifactForTransitionAtPhase(
        "post-restoration-product-repair",
        "deployment",
        "pending",
      ));
    }],
    ["active source", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
      value.predecessor.canonicalSourceSha = QA_ALIAS_SHA;
      value.predecessor.lineageParentSourceSha = QA_ALIAS_SHA;
      value.target.baseSourceSha = QA_ALIAS_SHA;
    }],
    ["active tree", (value: ProductCutoverArtifact) => {
      value.activeBefore.treeSha = OTHER_TREE_SHA;
      value.predecessor.canonicalTreeSha = OTHER_TREE_SHA;
    }],
    ["active Worker bundle", (value: ProductCutoverArtifact) => {
      value.activeBefore.workerBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["active DO bundle", (value: ProductCutoverArtifact) => {
      value.activeBefore.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalDurableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["active base", (value: ProductCutoverArtifact) => {
      value.activeBefore.baseSourceSha = COMPATIBILITY_BASE_SHA;
    }],
    ["active version", (value: ProductCutoverArtifact) => {
      value.activeBefore.versionId = TARGET_VERSION_ID;
    }],
    ["target source", (value: ProductCutoverArtifact) => {
      value.target.sourceSha = NEXT_REPAIR_SHA;
      value.deployment.sourceSha = NEXT_REPAIR_SHA;
    }],
    ["target tree", (value: ProductCutoverArtifact) => { value.target.treeSha = OTHER_TREE_SHA; }],
    ["target Worker bundle", (value: ProductCutoverArtifact) => {
      value.target.workerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["target DO bundle", (value: ProductCutoverArtifact) => {
      value.target.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["target base", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
      value.predecessor.canonicalSourceSha = QA_ALIAS_SHA;
      value.predecessor.lineageParentSourceSha = QA_ALIAS_SHA;
      value.target.baseSourceSha = QA_ALIAS_SHA;
    }],
    ["predecessor relationship", (value: ProductCutoverArtifact) => {
      value.environment = "qa";
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
      value.predecessor.relationship = "same-build-alias";
    }],
    ["predecessor canonical source", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
      value.predecessor.canonicalSourceSha = QA_ALIAS_SHA;
      value.predecessor.lineageParentSourceSha = QA_ALIAS_SHA;
      value.target.baseSourceSha = QA_ALIAS_SHA;
    }],
    ["predecessor canonical tree", (value: ProductCutoverArtifact) => {
      value.activeBefore.treeSha = OTHER_TREE_SHA;
      value.predecessor.canonicalTreeSha = OTHER_TREE_SHA;
    }],
    ["predecessor canonical Worker bundle", (value: ProductCutoverArtifact) => {
      value.activeBefore.workerBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["predecessor canonical DO bundle", (value: ProductCutoverArtifact) => {
      value.activeBefore.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalDurableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["predecessor lineage", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
      value.predecessor.canonicalSourceSha = QA_ALIAS_SHA;
      value.predecessor.lineageParentSourceSha = QA_ALIAS_SHA;
      value.target.baseSourceSha = QA_ALIAS_SHA;
    }],
    ["protocol boundary", (value: ProductCutoverArtifact) => { value.protocolBoundarySha = REPAIR_SOURCE_SHA; }],
  ])("rejects cross-phase mutation of immutable %s", (_label, mutate) => {
    const previous = artifactForTransitionAtPhase("forward-repair", "migration", "succeeded");
    const current = artifactForTransitionAtPhase("forward-repair", "deployment", "pending");
    mutate(current);
    expect(() => requireApi("assertProductCutoverArtifact")(current)).not.toThrow();
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
      .toThrow("artifact");
  });

  it.each([
    ["migration bookmark", "initial", (value: ProductCutoverArtifact) => {
      value.migration.recoveryBookmarkId = "another-bookmark";
    }],
    ["migration trigger inventory", "forward-repair", (value: ProductCutoverArtifact) => {
      value.migration.triggerInventory = [DELETE_TRIGGER];
    }],
    ["migration reached state", "initial", (value: ProductCutoverArtifact) => {
      value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
      value.migration.applyState = "ambiguous_reconciled";
      value.migration.triggerInventory = [...BOTH_TRIGGERS];
    }],
  ] as const)("rejects cross-phase rewrite of reached %s evidence", (
    _label,
    transition,
    mutate,
  ) => {
    const previous = artifactForTransitionAtPhase(transition, "migration", "succeeded");
    const current = artifactForTransitionAtPhase(transition, "deployment", "pending");
    mutate(current);
    expect(() => requireApi("assertProductCutoverArtifact")(current)).not.toThrow();
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
      .toThrow("artifact");
  });

  it.each([
    ["unlock inventory and applied state", (value: ProductCutoverArtifact) => {
      value.unlock.inventoryBefore = [DELETE_TRIGGER];
      value.unlock.applyState = "applied";
    }],
    ["unlock ambiguous state", (value: ProductCutoverArtifact) => {
      value.unlock.applyState = "ambiguous_reconciled";
    }],
  ])("rejects cross-phase rewrite of reached %s evidence", (_label, mutate) => {
    const previous = artifactForTransition("forward-repair");
    previous.phase = "unlock";
    previous.status = "succeeded";
    const current = artifactForTransition("forward-repair");
    mutate(current);
    expect(() => requireApi("assertProductCutoverArtifact")(current)).not.toThrow();
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
      .toThrow("artifact");
  });

  it.each([
    ["target/deployment version", (value: ProductCutoverArtifact) => {
      value.target.versionId = ACTIVE_VERSION_ID;
      value.deployment.versionId = ACTIVE_VERSION_ID;
    }],
    ["deployment id", (value: ProductCutoverArtifact) => {
      value.deployment.deploymentId = "44444444-4444-4444-8444-444444444444";
    }],
  ])("rejects standalone-valid post-deployment mutation of %s", (_label, mutate) => {
    const previous = artifactForTransitionAtPhase("forward-repair", "deployment", "succeeded");
    const current = artifactForTransitionAtPhase("forward-repair", "unlock", "pending");
    mutate(current);
    expect(() => requireApi("assertProductCutoverArtifact")(current)).not.toThrow();
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
      .toThrow("artifact");
  });

  it.each([
    ["runtime floor", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = TARGET_SOURCE_SHA;
      value.predecessor.canonicalSourceSha = TARGET_SOURCE_SHA;
      value.predecessor.runtimeFloorSourceSha = TARGET_SOURCE_SHA;
    }],
    ["original failed restoration", (value: ProductCutoverArtifact) => {
      value.predecessor.originalFailedRestorationSourceSha = FAILED_REPAIR_SHA;
    }],
    ["lineage parent", (value: ProductCutoverArtifact) => {
      value.predecessor.lineageParentSourceSha = FAILED_REPAIR_SHA;
      value.target.baseSourceSha = FAILED_REPAIR_SHA;
    }],
  ])("rejects self-consistent cross-phase restoration identity mutation: %s", (_label, mutate) => {
    const previous = artifactForTransitionAtPhase(
      "post-restoration-product-repair",
      "migration",
      "succeeded",
    );
    const current = artifactForTransitionAtPhase(
      "post-restoration-product-repair",
      "deployment",
      "pending",
    );
    mutate(current);
    expect(() => requireApi("assertProductCutoverArtifact")(current)).not.toThrow();
    expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
      .toThrow("artifact");
  });

  it.each([
    ["target source SHA", (value: ProductCutoverArtifact) => {
      value.target.sourceSha = "MAIN";
      value.deployment.sourceSha = "MAIN";
    }],
    ["target tree SHA", (value: ProductCutoverArtifact) => { value.target.treeSha = "f".repeat(39); }],
    ["target Worker digest", (value: ProductCutoverArtifact) => {
      value.target.workerBundleSha256 = "A".repeat(64);
    }],
    ["target DO digest", (value: ProductCutoverArtifact) => {
      value.target.durableObjectBundleSha256 = "f".repeat(63);
    }],
    ["target base SHA", (value: ProductCutoverArtifact) => { value.target.baseSourceSha = "main"; }],
    ["active/predecessor source SHA", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = "MAIN";
      value.predecessor.canonicalSourceSha = "MAIN";
      value.predecessor.lineageParentSourceSha = "MAIN";
      value.compatibilitySourceSha = "MAIN";
    }],
    ["active/predecessor tree SHA", (value: ProductCutoverArtifact) => {
      value.activeBefore.treeSha = "f".repeat(39);
      value.predecessor.canonicalTreeSha = "f".repeat(39);
    }],
    ["active/predecessor Worker digest", (value: ProductCutoverArtifact) => {
      value.activeBefore.workerBundleSha256 = "A".repeat(64);
      value.predecessor.canonicalWorkerBundleSha256 = "A".repeat(64);
    }],
    ["active/predecessor DO digest", (value: ProductCutoverArtifact) => {
      value.activeBefore.durableObjectBundleSha256 = "f".repeat(63);
      value.predecessor.canonicalDurableObjectBundleSha256 = "f".repeat(63);
    }],
    ["active base SHA", (value: ProductCutoverArtifact) => {
      value.activeBefore.baseSourceSha = "main";
    }],
    ["active version", (value: ProductCutoverArtifact) => { value.activeBefore.versionId = null; }],
    ["protocol boundary SHA", (value: ProductCutoverArtifact) => {
      value.protocolBoundarySha = "f".repeat(39);
    }],
    ["compatibility source SHA", (value: ProductCutoverArtifact) => {
      value.compatibilitySourceSha = "f".repeat(39);
    }],
    ["migration name", (value: ProductCutoverArtifact) => {
      value.migration.name = "0025-other.sql";
    }],
    ["migration digest syntax", (value: ProductCutoverArtifact) => {
      value.migration.sha256 = "A".repeat(64);
    }],
    ["migration digest identity", (value: ProductCutoverArtifact) => {
      value.migration.sha256 = OTHER_BUNDLE_SHA256;
    }],
    ["unlock digest syntax", (value: ProductCutoverArtifact) => {
      value.unlock.statementsSha256 = "f".repeat(63);
    }],
    ["unlock digest identity", (value: ProductCutoverArtifact) => {
      value.unlock.statementsSha256 = OTHER_BUNDLE_SHA256;
    }],
  ])("rejects an invalid %s", (_label, mutate) => {
    const invalid = artifact();
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["active source version", (value: ProductCutoverArtifact, invalid: unknown) => {
      (value.activeBefore as unknown as { versionId: unknown }).versionId = invalid;
    }],
    ["target source version", (value: ProductCutoverArtifact, invalid: unknown) => {
      (value.target as unknown as { versionId: unknown }).versionId = invalid;
    }],
    ["deployment version", (value: ProductCutoverArtifact, invalid: unknown) => {
      (value.deployment as unknown as { versionId: unknown }).versionId = invalid;
    }],
    ["deployment id", (value: ProductCutoverArtifact, invalid: unknown) => {
      (value.deployment as unknown as { deploymentId: unknown }).deploymentId = invalid;
    }],
    ["recovery bookmark id", (value: ProductCutoverArtifact, invalid: unknown) => {
      (value.migration as unknown as { recoveryBookmarkId: unknown }).recoveryBookmarkId = invalid;
    }],
  ] as const)("rejects non-string runtime values for %s", (_label, mutate) => {
    for (const invalid of [42, {}, ""] as const) {
      const value = artifact();
      mutate(value, invalid);
      expect(
        () => requireApi("assertProductCutoverArtifact")(value),
        `${_label}:${JSON.stringify(invalid)}`,
      ).toThrow("artifact");
    }
  });

  it.each([
    ["runtime floor SHA", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = "MAIN";
      value.predecessor.canonicalSourceSha = "MAIN";
      value.predecessor.runtimeFloorSourceSha = "MAIN";
    }],
    ["original failed restoration SHA", (value: ProductCutoverArtifact) => {
      value.predecessor.originalFailedRestorationSourceSha = "MAIN";
    }],
    ["lineage parent SHA", (value: ProductCutoverArtifact) => {
      value.predecessor.lineageParentSourceSha = "MAIN";
      value.target.baseSourceSha = "MAIN";
    }],
  ])("rejects a malformed post-restoration %s", (_label, mutate) => {
    const invalid = artifactForTransition("post-restoration-product-repair");
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["production alias", (value: ProductCutoverArtifact) => {
      value.predecessor.relationship = "same-build-alias";
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
    }],
    ["exact source mismatch", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = QA_ALIAS_SHA;
    }],
    ["exact tree mismatch", (value: ProductCutoverArtifact) => {
      value.activeBefore.treeSha = OTHER_TREE_SHA;
    }],
    ["exact Worker bundle mismatch", (value: ProductCutoverArtifact) => {
      value.activeBefore.workerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["exact Durable Object bundle mismatch", (value: ProductCutoverArtifact) => {
      value.activeBefore.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["restoration field outside restoration", (value: ProductCutoverArtifact) => {
      value.predecessor.runtimeFloorSourceSha = RUNTIME_FLOOR_SHA;
    }],
  ])("rejects invalid predecessor binding: %s", (_label, mutate) => {
    const invalid = artifact();
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it("accepts a strict QA same-build alias", () => {
    const valid = artifactForTransition("forward-repair");
    valid.environment = "qa";
    valid.activeBefore = sourceRecord({
      sourceSha: QA_ALIAS_SHA,
      releaseMode: "atomic-product-activation",
    });
    valid.predecessor = predecessorRecord({
      relationship: "same-build-alias",
      canonicalSourceSha: TARGET_SOURCE_SHA,
      lineageParentSourceSha: TARGET_SOURCE_SHA,
    });
    valid.target.baseSourceSha = TARGET_SOURCE_SHA;
    expect(() => requireApi("assertProductCutoverArtifact")(valid)).not.toThrow();
  });

  it.each([
    ["runtime floor", RUNTIME_FLOOR_SHA, FAILED_RESTORATION_SHA, REPAIR_SOURCE_SHA],
    ["latest failed lineage", FAILED_REPAIR_SHA, FAILED_REPAIR_SHA, NEXT_REPAIR_SHA],
  ])("accepts a post-restoration QA alias to the %s", (
    _label,
    canonicalSourceSha,
    lineageParentSourceSha,
    targetSourceSha,
  ) => {
    const valid = artifactForTransition("post-restoration-product-repair");
    valid.environment = "qa";
    valid.activeBefore = sourceRecord({
      sourceSha: QA_ALIAS_SHA,
      releaseMode: "atomic-product-activation",
      baseSourceSha: lineageParentSourceSha,
    });
    valid.predecessor = predecessorRecord({
      relationship: "same-build-alias",
      canonicalSourceSha,
      lineageParentSourceSha,
      runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
      originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
    });
    valid.target.sourceSha = targetSourceSha;
    valid.target.baseSourceSha = lineageParentSourceSha;
    valid.deployment = observedTarget({ sourceSha: targetSourceSha });

    expect(() => requireApi("assertProductCutoverArtifact")(valid)).not.toThrow();
  });

  it.each([
    ["tree", (value: ProductCutoverArtifact) => { value.activeBefore.treeSha = OTHER_TREE_SHA; }],
    ["Worker bundle", (value: ProductCutoverArtifact) => {
      value.activeBefore.workerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["Durable Object bundle", (value: ProductCutoverArtifact) => {
      value.activeBefore.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
  ])("rejects a QA same-build alias with mismatched %s bytes", (_label, mutate) => {
    const invalid = artifact({ environment: "qa", transition: "forward-repair" });
    invalid.activeBefore = sourceRecord({
      sourceSha: QA_ALIAS_SHA,
      releaseMode: "atomic-product-activation",
    });
    invalid.predecessor = predecessorRecord({
      relationship: "same-build-alias",
      canonicalSourceSha: TARGET_SOURCE_SHA,
      lineageParentSourceSha: TARGET_SOURCE_SHA,
    });
    invalid.target.baseSourceSha = TARGET_SOURCE_SHA;
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it("rejects a self-consistent replacement for the reviewed initial compatibility identity", () => {
    const invalid = artifact();
    invalid.activeBefore.sourceSha = QA_ALIAS_SHA;
    invalid.compatibilitySourceSha = QA_ALIAS_SHA;
    invalid.predecessor.canonicalSourceSha = QA_ALIAS_SHA;
    invalid.predecessor.lineageParentSourceSha = QA_ALIAS_SHA;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it("rejects a source-correct replacement for the reviewed initial compatibility version", () => {
    const invalid = artifact();
    invalid.activeBefore.versionId = TARGET_VERSION_ID;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["initial lineage", (value: ProductCutoverArtifact) => {
      value.predecessor.lineageParentSourceSha = TARGET_BASE_SHA;
    }],
    ["same-target active identity", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = REPAIR_SOURCE_SHA;
      value.predecessor.canonicalSourceSha = REPAIR_SOURCE_SHA;
    }],
    ["same-target version identity", (value: ProductCutoverArtifact) => {
      value.activeBefore.versionId = ACTIVE_VERSION_ID;
    }],
    ["same-target tree identity", (value: ProductCutoverArtifact) => {
      value.activeBefore.treeSha = OTHER_TREE_SHA;
      value.predecessor.canonicalTreeSha = OTHER_TREE_SHA;
    }],
    ["same-target Worker identity", (value: ProductCutoverArtifact) => {
      value.activeBefore.workerBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalWorkerBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["same-target Durable Object identity", (value: ProductCutoverArtifact) => {
      value.activeBefore.durableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
      value.predecessor.canonicalDurableObjectBundleSha256 = OTHER_BUNDLE_SHA256;
    }],
    ["same-target historical base", (value: ProductCutoverArtifact) => {
      value.predecessor.lineageParentSourceSha = COMPATIBILITY_SOURCE_SHA;
    }],
    ["forward-repair direct base", (value: ProductCutoverArtifact) => {
      value.target.baseSourceSha = COMPATIBILITY_SOURCE_SHA;
    }],
    ["post-restoration direct base", (value: ProductCutoverArtifact) => {
      value.target.baseSourceSha = RUNTIME_FLOOR_SHA;
    }],
    ["post-restoration runtime floor", (value: ProductCutoverArtifact) => {
      value.activeBefore.sourceSha = TARGET_SOURCE_SHA;
      value.predecessor.canonicalSourceSha = TARGET_SOURCE_SHA;
    }],
  ])("rejects a transition-specific identity mismatch: %s", (label, mutate) => {
    const transition = label.startsWith("initial")
      ? "initial"
      : label.startsWith("same-target")
        ? "same-target-reconcile"
        : label.startsWith("forward")
          ? "forward-repair"
          : "post-restoration-product-repair";
    const invalid = artifactForTransition(transition);
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["initial active mode", "initial", (value: ProductCutoverArtifact) => {
      value.activeBefore.releaseMode = "atomic-product-activation";
    }],
    ["initial target mode", "initial", (value: ProductCutoverArtifact) => {
      value.target.releaseMode = "protocol-v1-canary";
    }],
    ["same-target mode", "same-target-reconcile", (value: ProductCutoverArtifact) => {
      value.activeBefore.releaseMode = "protocol-v1-canary";
      value.target.releaseMode = "protocol-v1-canary";
    }],
    ["ordinary active mode", "forward-repair", (value: ProductCutoverArtifact) => {
      value.activeBefore.releaseMode = "protocol-v1-canary";
    }],
    ["ordinary target mode", "forward-repair", (value: ProductCutoverArtifact) => {
      value.target.releaseMode = "protocol-v1-canary";
    }],
    [
      "post-restoration target mode",
      "post-restoration-product-repair",
      (value: ProductCutoverArtifact) => {
        value.target.releaseMode = "protocol-v1-canary";
      },
    ],
  ] as const)("rejects a wrong-but-valid release mode for %s", (_label, transition, mutate) => {
    const invalid = artifactForTransition(transition);
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["unsorted inventory", [INSERT_TRIGGER, DELETE_TRIGGER]],
    ["duplicate inventory", [DELETE_TRIGGER, DELETE_TRIGGER]],
    ["unknown trigger", ["Unknown"]],
  ])("rejects %s", (_label, inventory) => {
    const invalid = artifact();
    invalid.migration.triggerInventory = inventory;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["unsorted", [INSERT_TRIGGER, DELETE_TRIGGER]],
    ["duplicate", [DELETE_TRIGGER, DELETE_TRIGGER]],
    ["empty-name", [""]],
    ["unknown", ["Unknown"]],
  ])("rejects %s unlock inventoryBefore", (_label, inventoryBefore) => {
    const invalid = artifact();
    invalid.unlock.inventoryBefore = inventoryBefore;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it("accepts a failed unlock with a complete recognized residue readback", () => {
    const valid = artifactForFailure("unlock", "unlock_apply_failed");
    valid.unlock.inventoryAfter = [DELETE_TRIGGER];
    expect(() => requireApi("assertProductCutoverArtifact")(valid)).not.toThrow();
  });

  it.each([
    ["unsorted", [INSERT_TRIGGER, DELETE_TRIGGER]],
    ["duplicate", [DELETE_TRIGGER, DELETE_TRIGGER]],
    ["empty-name", [""]],
  ])("rejects %s failed unlock inventoryAfter", (_label, inventoryAfter) => {
    const invalid = artifactForFailure("unlock", "unlock_apply_failed");
    invalid.unlock.inventoryAfter = inventoryAfter;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it("preserves unknown failed unlock residue as observed evidence", () => {
    const observed = artifactForFailure("unlock", "unlock_apply_failed");
    observed.unlock.inventoryAfter = ["Unexpected"];
    expect(() => requireApi("assertProductCutoverArtifact")(observed)).not.toThrow();
  });

  it.each([
    ["not-started migration with bookmark", (value: ProductCutoverArtifact) => {
      value.migration.applyState = "not_started";
      value.migration.triggerInventory = null;
    }],
    ["applied migration without bookmark", (value: ProductCutoverArtifact) => {
      value.migration.recoveryBookmarkId = null;
    }],
    ["observed deployment with incomplete tuple", (value: ProductCutoverArtifact) => {
      value.deployment.deploymentId = null;
    }],
    ["successful deployment below 100", (value: ProductCutoverArtifact) => {
      value.deployment.trafficPercent = 99;
    }],
    ["unlock success with residue", (value: ProductCutoverArtifact) => {
      value.unlock.inventoryAfter = [DELETE_TRIGGER];
    }],
    ["unlock not-started with inventory", (value: ProductCutoverArtifact) => {
      value.unlock.applyState = "not_started";
    }],
  ])("rejects contradictory nested state: %s", (_label, mutate) => {
    const invalid = artifact();
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["applied", () => artifact()],
    ["ambiguous_reconciled", () => {
      const value = artifact();
      value.migration.applyState = "ambiguous_reconciled";
      return value;
    }],
    ["already_applied without a bookmark", () => artifactForTransition("same-target-reconcile")],
    ["already_applied with a bookmark", () => {
      const value = artifactForTransition("same-target-reconcile");
      value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
      value.migration.triggerInventory = [...BOTH_TRIGGERS];
      return value;
    }],
  ] as const)("rejects %s migration state with null trigger inventory", (_label, makeArtifact) => {
    const valid = makeArtifact();
    expect(() => requireApi("assertProductCutoverArtifact")(valid)).not.toThrow();
    valid.migration.triggerInventory = null;
    expect(() => requireApi("assertProductCutoverArtifact")(valid)).toThrow("artifact");
  });

  it.each([
    ["applied", () => artifact()],
    ["ambiguous_reconciled", () => {
      const value = artifact();
      value.unlock.applyState = "ambiguous_reconciled";
      return value;
    }],
    ["already_absent", () => artifactForTransition("same-target-reconcile")],
  ] as const)("rejects %s unlock state with null successful inventories", (_label, makeArtifact) => {
    for (const field of ["inventoryBefore", "inventoryAfter"] as const) {
      const valid = makeArtifact();
      expect(() => requireApi("assertProductCutoverArtifact")(valid)).not.toThrow();
      valid.unlock[field] = null;
      expect(() => requireApi("assertProductCutoverArtifact")(valid)).toThrow("artifact");
    }
  });

  it.each([
    [null, []],
    [RECOVERY_BOOKMARK_ID, [...BOTH_TRIGGERS]],
  ] as const)(
    "accepts already-applied migration with %s prior bookmark evidence and exact inventory",
    (recoveryBookmarkId, triggerInventory) => {
      const valid = artifactForTransition("same-target-reconcile");
      valid.migration.recoveryBookmarkId = recoveryBookmarkId;
      valid.migration.triggerInventory = [...triggerInventory];
      expect(() => requireApi("assertProductCutoverArtifact")(valid)).not.toThrow();
    },
  );

  it.each([
    ["deploymentId", (value: ProductCutoverArtifact) => { value.deployment.deploymentId = null; }],
    ["versionId", (value: ProductCutoverArtifact) => { value.deployment.versionId = null; }],
    ["target versionId", (value: ProductCutoverArtifact) => { value.target.versionId = null; }],
    ["trafficPercent", (value: ProductCutoverArtifact) => { value.deployment.trafficPercent = null; }],
    ["version agreement", (value: ProductCutoverArtifact) => { value.deployment.versionId = ACTIVE_VERSION_ID; }],
  ])("rejects incomplete observed deployment tuple: %s", (_label, mutate) => {
    const invalid = artifact();
    mutate(invalid);
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([-1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid observed traffic percent %s",
    (trafficPercent) => {
      const invalid = artifact();
      invalid.deployment.trafficPercent = trafficPercent;
      expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
    },
  );

  it("requires both restoration sources together and only on post-restoration repair", () => {
    for (const field of ["runtimeFloorSourceSha", "originalFailedRestorationSourceSha"] as const) {
      const missing = artifactForTransition("post-restoration-product-repair");
      missing.predecessor[field] = null;
      expect(() => requireApi("assertProductCutoverArtifact")(missing)).toThrow("artifact");
    }
    for (const transition of ["initial", "same-target-reconcile", "forward-repair"] as const) {
      const unexpected = artifactForTransition(transition);
      unexpected.predecessor.runtimeFloorSourceSha = RUNTIME_FLOOR_SHA;
      unexpected.predecessor.originalFailedRestorationSourceSha = FAILED_RESTORATION_SHA;
      expect(() => requireApi("assertProductCutoverArtifact")(unexpected)).toThrow("artifact");
    }
  });

  it("requires a QA same-build alias to use distinct source SHAs", () => {
    const invalid = artifactForTransition("forward-repair");
    invalid.environment = "qa";
    invalid.predecessor.relationship = "same-build-alias";
    invalid.activeBefore.sourceSha = invalid.predecessor.canonicalSourceSha;
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each([
    ["precheck", "precondition_mismatch"],
    ["precheck", "predecessor_binding_mismatch"],
    ["migration", "recovery_bookmark_failed"],
    ["migration", "migration_rejected"],
    ["migration", "migration_apply_failed"],
    ["migration", "migration_state_ambiguous"],
    ["deployment", "deployment_failed"],
    ["deployment", "deployment_state_ambiguous"],
    ["deployment", "target_identity_mismatch"],
    ["deployment", "canonical_health_failed"],
    ["migration", "trigger_inventory_mismatch"],
    ["unlock", "unlock_apply_failed"],
    ["unlock", "unlock_state_ambiguous"],
    ["unlock", "artifact_invalid"],
  ] as const)("accepts sanitized %s failure classification %s", (phase, classification) => {
    const failed = artifactForFailure(phase, classification);
    expect(() => requireApi("assertProductCutoverArtifact")(failed)).not.toThrow();
  });

  it("rejects every migration failure classification with another group's reached state", () => {
    const shapes = {
      notStarted: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = null;
        value.migration.applyState = "not_started";
        value.migration.triggerInventory = null;
      },
      applyFailed: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "failed";
        value.migration.triggerInventory = null;
      },
      appliedTriggerMismatch: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "applied";
        value.migration.triggerInventory = [INSERT_TRIGGER];
      },
      alreadyApplied: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = null;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [];
      },
      alreadyAppliedWithBookmark: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [...BOTH_TRIGGERS];
      },
      alreadyAppliedInsertMismatch: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = null;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [INSERT_TRIGGER];
      },
      alreadyAppliedDeleteMismatch: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = null;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [DELETE_TRIGGER];
      },
      alreadyAppliedInsertMismatchWithBookmark: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [INSERT_TRIGGER];
      },
      alreadyAppliedDeleteMismatchWithBookmark: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [DELETE_TRIGGER];
      },
      alreadyAppliedBothMismatch: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = null;
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [...BOTH_TRIGGERS];
      },
      ambiguousReconciled: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "ambiguous_reconciled";
        value.migration.triggerInventory = [...BOTH_TRIGGERS];
      },
      applied: (value: ProductCutoverArtifact) => {
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        value.migration.applyState = "applied";
        value.migration.triggerInventory = [...BOTH_TRIGGERS];
      },
    };
    const namedShapes = Object.entries(shapes) as Array<
      [keyof typeof shapes, (value: ProductCutoverArtifact) => void]
    >;
    const cases = [
      ["recovery_bookmark_failed", ["notStarted"]],
      ["migration_rejected", ["notStarted"]],
      ["migration_apply_failed", ["applyFailed"]],
      ["migration_state_ambiguous", ["applyFailed"]],
      ["trigger_inventory_mismatch", [
        "alreadyAppliedInsertMismatch",
        "alreadyAppliedDeleteMismatch",
        "alreadyAppliedBothMismatch",
        "alreadyAppliedInsertMismatchWithBookmark",
        "alreadyAppliedDeleteMismatchWithBookmark",
        "alreadyAppliedWithBookmark",
      ]],
    ] as const;

    for (const [classification, allowedShapes] of cases) {
      for (const allowedShape of allowedShapes) {
        const valid = repairMigrationFailure(classification);
        shapes[allowedShape](valid);
        expect(
          () => requireApi("assertProductCutoverArtifact")(valid),
          `${classification}:${allowedShape}:valid`,
        ).not.toThrow();
      }
      for (const [shapeName, applyShape] of namedShapes) {
        if ((allowedShapes as readonly string[]).includes(shapeName)) continue;
        const invalid = repairMigrationFailure(classification);
        applyShape(invalid);
        expect(
          () => requireApi("assertProductCutoverArtifact")(invalid),
          `${classification}:${shapeName}`,
        ).toThrow("artifact");
      }
    }
  });

  it.each([
    ["deployment_failed", 100],
    ["deployment_state_ambiguous", 100],
    ["target_identity_mismatch", 100],
    ["canonical_health_failed", 37],
  ] as const)("rejects %s with classification-incompatible observation %s", (
    classification,
    trafficPercent,
  ) => {
    const invalid = artifactForFailure("deployment", classification);
    if (trafficPercent !== null) {
      invalid.target.versionId = TARGET_VERSION_ID;
      invalid.deployment = observedTarget({ trafficPercent });
    }
    expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
  });

  it.each(["deployment_failed", "deployment_state_ambiguous"] as const)(
    "accepts %s with a complete observed target tuple below 100%%",
    (classification) => {
      const failed = artifactForFailure("deployment", classification);
      failed.target.versionId = TARGET_VERSION_ID;
      failed.deployment = observedTarget({ trafficPercent: 37 });
      expect(() => requireApi("assertProductCutoverArtifact")(failed)).not.toThrow();
    },
  );

  it.each([
    ["deploymentId", (value: ProductCutoverArtifact) => { value.deployment.deploymentId = null; }],
    ["deployment versionId", (value: ProductCutoverArtifact) => {
      value.deployment.versionId = null;
    }],
    ["target versionId", (value: ProductCutoverArtifact) => { value.target.versionId = null; }],
    ["trafficPercent", (value: ProductCutoverArtifact) => {
      value.deployment.trafficPercent = null;
    }],
    ["version agreement", (value: ProductCutoverArtifact) => {
      value.deployment.versionId = ACTIVE_VERSION_ID;
    }],
  ])("rejects a partial failed deployment observation missing %s", (_label, mutate) => {
    for (const classification of ["deployment_failed", "deployment_state_ambiguous"] as const) {
      const failed = artifactForFailure("deployment", classification);
      failed.target.versionId = TARGET_VERSION_ID;
      failed.deployment = observedTarget({ trafficPercent: 37 });
      mutate(failed);
      expect(() => requireApi("assertProductCutoverArtifact")(failed)).toThrow("artifact");
    }
  });

  it.each([
    ["failed status without failure", () => {
      const value = artifactForFailure("deployment", "deployment_failed");
      value.failure = null;
      return value;
    }],
    ["successful status with failure", () => artifact({
      failure: { phase: "deployment", classification: "deployment_failed" },
    })],
    ["mismatched failure phase", () => {
      const value = artifactForFailure("deployment", "deployment_failed");
      value.failure = { phase: "migration", classification: "deployment_failed" };
      return value;
    }],
    ["classification from another phase", () => {
      const value = artifactForFailure("migration", "migration_apply_failed");
      value.failure = { phase: "migration", classification: "deployment_failed" };
      return value;
    }],
  ])("rejects %s", (_label, makeInvalid) => {
    expect(() => requireApi("assertProductCutoverArtifact")(makeInvalid())).toThrow("artifact");
  });

  it.each([
    ["active version", (value: ProductCutoverArtifact, leak: string) => {
      value.activeBefore.versionId = leak;
    }],
    ["target/deployment version", (value: ProductCutoverArtifact, leak: string) => {
      value.target.versionId = leak;
      value.deployment.versionId = leak;
    }],
    ["deployment id", (value: ProductCutoverArtifact, leak: string) => {
      value.deployment.deploymentId = leak;
    }],
    ["recovery bookmark id", (value: ProductCutoverArtifact, leak: string) => {
      value.migration.recoveryBookmarkId = leak;
    }],
  ] as const)("rejects unsanitized evidence text in %s", (_label, mutate) => {
    for (const leak of [
      "CLOUDFLARE_API_TOKEN=secret",
      "pnpm exec wrangler d1 execute DB",
      "Error: failed\n    at run (/repo/script.ts:1:1)",
    ]) {
      const invalid = artifact();
      mutate(invalid, leak);
      expect(() => requireApi("assertProductCutoverArtifact")(invalid)).toThrow("artifact");
    }
  });
});

function validProductionReleaseEnvelope() {
  return {
    status: "promoted",
    sourceSha: TARGET_SOURCE_SHA,
    releaseMode: "atomic-product-activation",
    deploymentStrategy: "atomic",
    phase: "complete",
    treeHash: TREE_SHA,
    reviewedMigrations: [MIGRATION_NAME],
    migrationApply: "succeeded",
    databaseRollbackSupported: false,
    previousVersionId: ACTIVE_VERSION_ID,
    candidateVersionId: TARGET_VERSION_ID,
  };
}

describe("product-cutover evidence files", () => {
  it.each(["production", "qa"] as const)(
    "persists and validates every %s lifecycle edge from disk",
    async (environment) => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), `spoonjoy-product-cutover-${environment}-`));
    const releaseArtifact = validProductionReleaseEnvelope();
    const lifecycle = [
      artifactForPhase("precheck", "pending"),
      artifactForPhase("precheck", "succeeded"),
      artifactForPhase("migration", "pending"),
      artifactForPhase("migration", "succeeded"),
      artifactForPhase("deployment", "pending"),
      artifactForPhase("deployment", "succeeded"),
      artifactForPhase("unlock", "pending"),
      artifactForPhase("unlock", "succeeded"),
      artifactForPhase("verified", "succeeded"),
    ];
    for (const evidence of lifecycle) evidence.environment = environment;
    const filename = environment === "production"
      ? "production-product-cutover-state.json"
      : "qa-product-release.json";
    try {
      if (environment === "production") {
        await writeFile(
          path.join(artifactDir, "production-release.json"),
          `${JSON.stringify(releaseArtifact, null, 2)}\n`,
          "utf8",
        );
      }
      for (const evidence of lifecycle) {
        await requireApi("writeProductCutoverArtifactFile")(artifactDir, evidence);
        const persisted = JSON.parse(
          await readFile(path.join(artifactDir, filename), "utf8"),
        ) as Record<string, unknown>;
        expect(persisted.cutover).toEqual(evidence);
        expect(persisted).toEqual({ cutover: evidence });
        if (environment === "production") {
          await expect(readFile(path.join(artifactDir, "production-release.json"), "utf8"))
            .resolves.toBe(`${JSON.stringify(releaseArtifact, null, 2)}\n`);
        }
      }
      await expect(requireApi("validateProductCutoverStateFile")(
        path.join(artifactDir, filename),
        environment,
      )).resolves.toEqual(lifecycle.at(-1));
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
    },
  );

  it.each([
    ["production", "precheck", "succeeded"],
    ["production", "migration", "succeeded"],
    ["production", "migration", "ambiguous_reconciled"],
    ["qa", "precheck", "succeeded"],
    ["qa", "migration", "succeeded"],
    ["qa", "migration", "ambiguous_reconciled"],
  ] as const)(
    "restarts the exact %s attempt after persisted %s:%s",
    async (environment, phase, status) => {
      const artifactDir = await mkdtemp(path.join(
        os.tmpdir(),
        `spoonjoy-nonterminal-restart-${environment}-`,
      ));
      const previous = artifactForPhase(phase, status);
      const current = artifactForPhase("precheck", "pending");
      if (phase === "migration") {
        current.migration.recoveryBookmarkId = previous.migration.recoveryBookmarkId;
      }
      previous.environment = environment;
      current.environment = environment;
      const filename = path.join(
        artifactDir,
        environment === "production"
          ? "production-product-cutover-state.json"
          : "qa-product-release.json",
      );
      try {
        await writeFile(filename, JSON.stringify({ cutover: previous }), "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .resolves.toBeUndefined();
        await expect(readFile(filename, "utf8"))
          .resolves.toBe(`${JSON.stringify({ cutover: current }, null, 2)}\n`);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    },
  );

  it.each(["unlock", "verified"] as const)(
  "starts a same-target retry from persisted %s success", async (phase) => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-same-target-restart-"));
    const previous = artifactForPhase(phase, "succeeded");
    const current = artifactForTransition("same-target-reconcile");
    current.phase = "precheck";
    current.status = "pending";
    current.migration = {
      ...current.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
    current.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: current.target.sourceSha,
      trafficPercent: null,
    };
    current.unlock = {
      ...current.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    current.failure = null;
    const filename = path.join(artifactDir, "production-product-cutover-state.json");
    const persisted = { cutover: previous };
    try {
      await writeFile(filename, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
      await requireApi("writeProductCutoverArtifactFile")(artifactDir, current);
      await expect(readFile(filename, "utf8"))
        .resolves.toBe(`${JSON.stringify({ ...persisted, cutover: current }, null, 2)}\n`);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it.each(["deployment", "unlock"] as const)(
    "starts same-target reconciliation after the live topology advanced past %s:pending",
    async (phase) => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), `spoonjoy-advanced-${phase}-`));
      const previous = artifactForPhase(phase, "pending");
      const current = artifactForTransition("same-target-reconcile");
      current.phase = "precheck";
      current.status = "pending";
      current.migration = {
        ...current.migration,
        recoveryBookmarkId: null,
        applyState: "not_started",
        triggerInventory: null,
      };
      current.deployment = {
        deploymentId: null,
        versionId: null,
        sourceSha: current.target.sourceSha,
        trafficPercent: null,
      };
      current.unlock = {
        ...current.unlock,
        inventoryBefore: null,
        applyState: "not_started",
        inventoryAfter: null,
      };
      current.failure = null;
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      try {
        await writeFile(filename, JSON.stringify({ cutover: previous }), "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .resolves.toBeUndefined();
        await expect(requireApi("validateProductCutoverStateFile")(
          filename,
          "production",
        )).resolves.toEqual(current);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    },
  );

  it.each(["migration", "deployment", "unlock"] as const)(
    "starts a fresh reconciliation attempt after a process stopped at %s:pending",
    async (phase) => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), `spoonjoy-pending-${phase}-`));
      const previous = artifactForPhase(phase, "pending");
      const current = artifactForPhase("precheck", "pending");
      current.migration.recoveryBookmarkId = previous.migration.recoveryBookmarkId;
      const filename = path.join(artifactDir, "qa-product-release.json");
      previous.environment = "qa";
      current.environment = "qa";
      try {
        await writeFile(filename, `${JSON.stringify({ cutover: previous }, null, 2)}\n`, "utf8");
        await requireApi("writeProductCutoverArtifactFile")(artifactDir, current);
        const persisted = JSON.parse(await readFile(filename, "utf8")) as {
          cutover: ProductCutoverArtifact;
        };
        expect(persisted.cutover).toEqual(current);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["verified", "succeeded"],
    ["unlock", "ambiguous_reconciled"],
  ] as const)(
  "starts an ordinary forward repair after persisted %s:%s product activation",
  async (phase, status) => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-forward-after-success-"));
    const previous = artifactForPhase(phase, status);
    previous.environment = "qa";
    const current = artifactForTransition("forward-repair");
    current.environment = "qa";
    current.activeBefore = clone(previous.target);
    current.predecessor = {
      relationship: "exact",
      canonicalSourceSha: previous.target.sourceSha,
      canonicalTreeSha: previous.target.treeSha,
      canonicalWorkerBundleSha256: previous.target.workerBundleSha256,
      canonicalDurableObjectBundleSha256: previous.target.durableObjectBundleSha256,
      lineageParentSourceSha: previous.target.sourceSha,
      runtimeFloorSourceSha: null,
      originalFailedRestorationSourceSha: null,
    };
    current.target.baseSourceSha = previous.target.sourceSha;
    current.phase = "precheck";
    current.status = "pending";
    current.target.versionId = null;
    current.migration = {
      ...current.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
    current.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: current.target.sourceSha,
      trafficPercent: null,
    };
    current.unlock = {
      ...current.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    current.failure = null;
    const filename = path.join(artifactDir, "qa-product-release.json");
    try {
      await writeFile(filename, `${JSON.stringify({ cutover: previous }, null, 2)}\n`, "utf8");
      await requireApi("writeProductCutoverArtifactFile")(artifactDir, current);
      const persisted = JSON.parse(await readFile(filename, "utf8")) as {
        cutover: ProductCutoverArtifact;
      };
      expect(persisted.cutover).toEqual(current);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("starts the next repair from a persisted failed post-restoration artifact", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-repair-chain-restart-"));
    const previous = failedPostRestorationArtifact(
      POST_REPAIR_SOURCE_SHA,
      FAILED_RESTORATION_SHA,
    );
    previous.environment = "qa";
    const nextAttempt = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
    nextAttempt.environment = "qa";
    const current = artifactForTransition("post-restoration-product-repair");
    current.environment = "qa";
    current.activeBefore = clone(nextAttempt.activeBefore);
    current.target = clone(nextAttempt.target);
    current.predecessor = clone(nextAttempt.predecessor);
    current.protocolBoundarySha = nextAttempt.protocolBoundarySha;
    current.compatibilitySourceSha = nextAttempt.compatibilitySourceSha;
    current.phase = "precheck";
    current.status = "pending";
    current.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: FAILED_REPAIR_SHA,
      trafficPercent: null,
    };
    current.migration = {
      ...current.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
    current.unlock = {
      ...current.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    current.failure = null;
    const filename = path.join(artifactDir, "qa-product-release.json");
    try {
      await writeFile(
        filename,
        `${JSON.stringify({ cutover: previous }, null, 2)}\n`,
        "utf8",
      );
      await requireApi("writeProductCutoverArtifactFile")(artifactDir, current);
      await expect(readFile(filename, "utf8"))
        .resolves.toBe(`${JSON.stringify({ cutover: current }, null, 2)}\n`);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("starts the next production repair from a persisted failed post-restoration artifact", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-production-repair-chain-"));
    const previous = failedPostRestorationArtifact(
      POST_REPAIR_SOURCE_SHA,
      FAILED_RESTORATION_SHA,
    );
    const nextAttempt = postRestorationAttempt(POST_REPAIR_SOURCE_SHA, FAILED_REPAIR_SHA);
    const current = artifactForTransition("post-restoration-product-repair");
    current.activeBefore = clone(nextAttempt.activeBefore);
    current.target = clone(nextAttempt.target);
    current.predecessor = clone(nextAttempt.predecessor);
    current.protocolBoundarySha = nextAttempt.protocolBoundarySha;
    current.compatibilitySourceSha = nextAttempt.compatibilitySourceSha;
    current.phase = "precheck";
    current.status = "pending";
    current.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: FAILED_REPAIR_SHA,
      trafficPercent: null,
    };
    current.migration = {
      ...current.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
    current.unlock = {
      ...current.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    current.failure = null;
    const filename = path.join(artifactDir, "production-product-cutover-state.json");
    const outer = { cutover: previous };
    try {
      await writeFile(filename, `${JSON.stringify(outer, null, 2)}\n`, "utf8");
      await requireApi("writeProductCutoverArtifactFile")(artifactDir, current);
      await expect(readFile(filename, "utf8"))
        .resolves.toBe(`${JSON.stringify({ ...outer, cutover: current }, null, 2)}\n`);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("switches an active failed post-restoration target to persisted ordinary repair", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-active-repair-switch-"));
    const postAttempt = postRestorationAttempt(FAILED_RESTORATION_SHA);
    const previous = artifactForTransition("post-restoration-product-repair");
    previous.activeBefore = clone(postAttempt.activeBefore);
    previous.target = { ...clone(postAttempt.target), versionId: TARGET_VERSION_ID };
    previous.predecessor = clone(postAttempt.predecessor);
    previous.protocolBoundarySha = postAttempt.protocolBoundarySha;
    previous.compatibilitySourceSha = postAttempt.compatibilitySourceSha;
    previous.phase = "deployment";
    previous.status = "failed";
    previous.deployment = observedTarget({ sourceSha: POST_REPAIR_SOURCE_SHA });
    previous.unlock = {
      ...previous.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    previous.failure = {
      phase: "deployment",
      classification: "canonical_health_failed",
    };
    const forwardActive = previous.target;
    const forwardTarget = postRestorationAttempt(
      POST_REPAIR_SOURCE_SHA,
      FAILED_REPAIR_SHA,
    ).target;
    const current = artifactForTransition("forward-repair");
    current.phase = "precheck";
    current.status = "pending";
    current.activeBefore = clone(forwardActive);
    current.target = clone(forwardTarget);
    current.predecessor = predecessorRecord({
      canonicalSourceSha: forwardActive.sourceSha,
      canonicalTreeSha: forwardActive.treeSha,
      canonicalWorkerBundleSha256: forwardActive.workerBundleSha256,
      canonicalDurableObjectBundleSha256: forwardActive.durableObjectBundleSha256,
      lineageParentSourceSha: forwardActive.sourceSha,
    });
    current.protocolBoundarySha = TOPOLOGY_PROTOCOL_BOUNDARY_SHA;
    current.migration = {
      ...current.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
    current.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: FAILED_REPAIR_SHA,
      trafficPercent: null,
    };
    current.unlock = {
      ...current.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    current.failure = null;
    const filename = path.join(artifactDir, "production-product-cutover-state.json");
    const outer = { cutover: previous };
    try {
      await writeFile(filename, `${JSON.stringify(outer, null, 2)}\n`, "utf8");
      await requireApi("writeProductCutoverArtifactFile")(artifactDir, current);
      await expect(readFile(filename, "utf8"))
        .resolves.toBe(`${JSON.stringify({ ...outer, cutover: current }, null, 2)}\n`);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it.each(["production", "qa"] as const)(
    "refuses to overwrite malformed persisted %s evidence",
    async (environment) => {
    for (const mutation of [
      "missing-top-level-key",
      "extra-top-level-key",
      "missing-nested-key",
      "extra-nested-key",
      "invalid-nested-identity",
      "invalid-nested-state",
    ] as const) {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), `spoonjoy-malformed-${environment}-`));
      const previous = artifactForPhase("unlock", "succeeded");
      previous.environment = environment;
      const malformed = clone(previous) as unknown as Record<string, unknown>;
      if (mutation === "missing-top-level-key") {
        delete malformed.protocolBoundarySha;
      } else if (mutation === "extra-top-level-key") {
        malformed.unexpected = "value";
      } else if (mutation === "missing-nested-key") {
        delete (malformed.activeBefore as Record<string, unknown>).treeSha;
      } else if (mutation === "extra-nested-key") {
        (malformed.unlock as Record<string, unknown>).unexpected = "value";
      } else if (mutation === "invalid-nested-identity") {
        (malformed.target as Record<string, unknown>).sourceSha = "A".repeat(40);
      } else {
        (malformed.migration as Record<string, unknown>).applyState = "unknown";
      }
      const current = artifactForTransition("same-target-reconcile");
      current.environment = environment;
      current.phase = "precheck";
      current.status = "pending";
      current.migration = {
        ...current.migration,
        recoveryBookmarkId: null,
        applyState: "not_started",
        triggerInventory: null,
      };
      current.unlock = {
        ...current.unlock,
        inventoryBefore: null,
        applyState: "not_started",
        inventoryAfter: null,
      };
      current.failure = null;
      const filename = path.join(
        artifactDir,
        environment === "production"
          ? "production-product-cutover-state.json"
          : "qa-product-release.json",
      );
      const persisted = { cutover: malformed };
      try {
        await writeFile(filename, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .rejects.toThrow("artifact");
        await expect(readFile(filename, "utf8"))
          .resolves.toBe(`${JSON.stringify(persisted, null, 2)}\n`);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    }
    },
  );

  it.each(["production", "qa"] as const)(
    "rejects a skipped first durable %s lifecycle state",
    async (environment) => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), `spoonjoy-product-cutover-skipped-${environment}-`));
    const skipped = artifactForPhase("migration", "pending");
    skipped.environment = environment;
    const filename = environment === "production"
      ? "production-product-cutover-state.json"
      : "qa-product-release.json";
    try {
      await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, skipped))
        .rejects.toThrow("artifact");
      await expect(readFile(path.join(artifactDir, filename), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
    },
  );

  it.each(["production", "qa"] as const)(
    "validates the prior phase before replacing the %s artifact",
    async (environment) => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), `spoonjoy-product-cutover-invalid-${environment}-`));
    const previous = artifactForPhase("migration", "failed");
    const current = artifactForPhase("deployment", "pending");
    previous.environment = environment;
    current.environment = environment;
    try {
      const filename = path.join(
        artifactDir,
        environment === "production"
          ? "production-product-cutover-state.json"
          : "qa-product-release.json",
      );
      const persisted = { cutover: previous };
      await writeFile(filename, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
      await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
        .rejects.toThrow("artifact");
      await expect(readFile(filename, "utf8"))
        .resolves.toBe(`${JSON.stringify(persisted, null, 2)}\n`);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
    },
  );
});

function artifactForTransition(transition: CutoverTransition): ProductCutoverArtifact {
  if (transition === "initial") return artifact();
  if (transition === "same-target-reconcile") {
    const value = artifact({ transition });
    value.activeBefore = clone(value.target);
    value.predecessor = predecessorRecord({
      canonicalSourceSha: TARGET_SOURCE_SHA,
      lineageParentSourceSha: TARGET_BASE_SHA,
    });
    value.migration.applyState = "already_applied";
    value.unlock.inventoryBefore = [];
    value.unlock.applyState = "already_absent";
    return value;
  }
  if (transition === "forward-repair") {
    const value = artifact({ transition });
    value.activeBefore = sourceRecord({
      sourceSha: TARGET_SOURCE_SHA,
      versionId: ACTIVE_VERSION_ID,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TARGET_BASE_SHA,
    });
    value.target = sourceRecord({
      sourceSha: REPAIR_SOURCE_SHA,
      versionId: TARGET_VERSION_ID,
      releaseMode: "atomic-product-activation",
      baseSourceSha: TARGET_SOURCE_SHA,
    });
    value.predecessor = predecessorRecord({
      canonicalSourceSha: TARGET_SOURCE_SHA,
      lineageParentSourceSha: TARGET_SOURCE_SHA,
    });
    value.migration.recoveryBookmarkId = null;
    value.migration.applyState = "already_applied";
    value.migration.triggerInventory = [];
    value.deployment = observedTarget({ sourceSha: REPAIR_SOURCE_SHA });
    value.unlock.inventoryBefore = [];
    value.unlock.applyState = "already_absent";
    return value;
  }
  const value = artifactForTransition("forward-repair");
  value.transition = transition;
  value.activeBefore.sourceSha = RUNTIME_FLOOR_SHA;
  value.predecessor.canonicalSourceSha = RUNTIME_FLOOR_SHA;
  value.predecessor.lineageParentSourceSha = FAILED_RESTORATION_SHA;
  value.predecessor.runtimeFloorSourceSha = RUNTIME_FLOOR_SHA;
  value.predecessor.originalFailedRestorationSourceSha = FAILED_RESTORATION_SHA;
  value.target.baseSourceSha = FAILED_RESTORATION_SHA;
  return value;
}

function artifactForTransitionAtPhase(
  transition: CutoverTransition,
  phase: "migration" | "deployment" | "unlock",
  status: "pending" | "succeeded",
): ProductCutoverArtifact {
  const value = artifactForTransition(transition);
  value.phase = phase;
  value.status = status;
  if (phase === "migration" || (phase === "deployment" && status === "pending")) {
    value.target.versionId = null;
    value.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: value.target.sourceSha,
      trafficPercent: null,
    };
  }
  value.unlock = {
    ...value.unlock,
    inventoryBefore: null,
    applyState: "not_started",
    inventoryAfter: null,
  };
  value.failure = null;
  return value;
}

function artifactForFailure(
  phase: Exclude<CutoverPhase, "verified">,
  classification: NonNullable<ProductCutoverArtifact["failure"]>["classification"],
): ProductCutoverArtifact {
  const value = artifactForPhase(phase, "failed");
  value.failure = { phase, classification };
  if (phase === "migration") {
    if (classification === "recovery_bookmark_failed" || classification === "migration_rejected") {
      value.migration.recoveryBookmarkId = null;
      value.migration.applyState = "not_started";
      value.migration.triggerInventory = null;
    }
    if (classification === "migration_apply_failed" || classification === "migration_state_ambiguous") {
      value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
      value.migration.applyState = "failed";
      value.migration.triggerInventory = null;
    }
    if (classification === "trigger_inventory_mismatch") {
      value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
      value.migration.applyState = "applied";
      value.migration.triggerInventory = [INSERT_TRIGGER];
    }
  }
  if (classification === "canonical_health_failed") {
    value.target.versionId = TARGET_VERSION_ID;
    value.deployment = observedTarget();
  }
  return value;
}

function repairMigrationFailure(
  classification:
    | "recovery_bookmark_failed"
    | "migration_rejected"
    | "migration_apply_failed"
    | "migration_state_ambiguous"
    | "trigger_inventory_mismatch",
): ProductCutoverArtifact {
  if (classification === "trigger_inventory_mismatch") {
    const value = artifactForTransitionAtPhase(
      "post-restoration-product-repair",
      "migration",
      "failed",
    );
    value.migration.recoveryBookmarkId = null;
    value.migration.applyState = "already_applied";
    value.migration.triggerInventory = [INSERT_TRIGGER];
    value.failure = { phase: "migration", classification };
    return value;
  }
  const classificationEvidence = artifactForFailure("migration", classification);
  const value = artifactForTransitionAtPhase("forward-repair", "migration", "failed");
  value.migration = clone(classificationEvidence.migration);
  value.failure = { phase: "migration", classification };
  return value;
}

function artifactForPhase(
  phase: CutoverPhase,
  status: CutoverStatus,
): ProductCutoverArtifact {
  const value = artifact({ phase, status });
  value.failure = status === "failed"
    ? {
        phase,
        classification: phase === "precheck"
          ? "precondition_mismatch"
          : phase === "migration"
            ? "migration_apply_failed"
            : phase === "deployment"
              ? "deployment_failed"
              : "unlock_apply_failed",
      }
    : null;

  if (phase === "precheck") {
    value.target.versionId = null;
    value.migration = {
      ...value.migration,
      recoveryBookmarkId: null,
      applyState: "not_started",
      triggerInventory: null,
    };
    value.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: TARGET_SOURCE_SHA,
      trafficPercent: null,
    };
    value.unlock = {
      ...value.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    return value;
  }

  if (phase === "migration") {
    value.target.versionId = null;
    value.migration = status === "pending" || status === "failed"
      ? {
          ...value.migration,
          recoveryBookmarkId: status === "failed" ? RECOVERY_BOOKMARK_ID : null,
          applyState: status === "failed" ? "failed" : "not_started",
          triggerInventory: null,
        }
      : {
          ...value.migration,
          applyState: status === "ambiguous_reconciled"
            ? "ambiguous_reconciled"
            : "applied",
        };
    value.deployment = {
      deploymentId: null,
      versionId: null,
      sourceSha: TARGET_SOURCE_SHA,
      trafficPercent: null,
    };
    value.unlock = {
      ...value.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    return value;
  }

  if (phase === "deployment") {
    if (status === "pending" || status === "failed") {
      value.target.versionId = null;
      value.deployment = {
        deploymentId: null,
        versionId: null,
        sourceSha: TARGET_SOURCE_SHA,
        trafficPercent: null,
      };
    }
    value.unlock = {
      ...value.unlock,
      inventoryBefore: null,
      applyState: "not_started",
      inventoryAfter: null,
    };
    return value;
  }

  if (phase === "unlock") {
    value.unlock = status === "pending"
      ? {
          ...value.unlock,
          inventoryBefore: null,
          applyState: "not_started",
          inventoryAfter: null,
        }
      : {
          ...value.unlock,
          applyState: status === "ambiguous_reconciled"
            ? "ambiguous_reconciled"
            : status === "failed"
              ? "failed"
              : "applied",
          inventoryAfter: status === "failed" ? null : [],
        };
  }
  return value;
}

describe("product-cutover focused coverage completion", () => {
  describe("deployed runtime provenance", () => {
    it.each([
      ["empty entrypoint", "", [{ name: "_worker.js", bytes: Buffer.from("worker") }]],
      ["empty module set", "_worker.js", []],
      ["empty module name", "_worker.js", [{ name: "", bytes: Buffer.from("worker") }]],
      ["empty module bytes", "_worker.js", [{ name: "_worker.js", bytes: Buffer.alloc(0) }]],
      ["duplicate module names", "_worker.js", [
        { name: "_worker.js", bytes: Buffer.from("one") },
        { name: "_worker.js", bytes: Buffer.from("two") },
      ]],
      ["missing entrypoint module", "_worker.js", [
        { name: "chunk.js", bytes: Buffer.from("chunk") },
      ]],
    ] as const)("rejects an invalid %s", (_label, entrypoint, modules) => {
      expect(() => requireApi("productRuntimeBundleDigests")(entrypoint, modules))
        .toThrow("runtime modules");
    });

    it("sorts a multi-module runtime by bytewise module name", () => {
      const modules = [
        { name: "chunks/z.js", bytes: Buffer.from("z") },
        { name: "_worker.js", bytes: Buffer.from("entry") },
        { name: "chunks/a.js", bytes: Buffer.from("a") },
      ];

      expect(requireApi("productRuntimeBundleDigests")("_worker.js", modules))
        .toEqual(requireApi("productRuntimeBundleDigests")(
          "_worker.js",
          [...modules].reverse(),
        ));
    });

    it("rejects a frozen compatibility source paired with another version", async () => {
      const runCommand = vi.fn<ReleaseCommandRunner>();
      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        COMPATIBILITY_SOURCE_SHA,
        TARGET_VERSION_ID,
        runCommand,
      )).rejects.toThrow("compatibility version");
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("binds a live deployed runtime identity to independently read Git evidence", async () => {
      const runtimeIdentity = {
        workerBundleSha256: PRODUCT_WORKER_BUNDLE_SHA256,
        durableObjectBundleSha256: DO_BUNDLE_SHA256,
      };
      const runCommand = vi.fn<ReleaseCommandRunner>(async (_command, args) => {
        const key = args.join(" ");
        const outputs: Record<string, string> = {
          [`rev-parse ${TARGET_SOURCE_SHA}^{tree}`]: TARGET_TREE_SHA,
          [`rev-parse ${TARGET_SOURCE_SHA}^`]: TARGET_BASE_SHA,
          [`show ${TARGET_SOURCE_SHA}:.github/workflows/production-deploy.yml`]:
            "env:\n  SPOONJOY_RELEASE_MODE: atomic-product-activation\n",
        };
        return { stdout: outputs[key] ?? "", stderr: "" };
      });

      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        TARGET_SOURCE_SHA,
        TARGET_VERSION_ID,
        runCommand,
        { PATH: "/test/bin" },
        runtimeIdentity,
      )).resolves.toEqual(sourceRecord({
        sourceSha: TARGET_SOURCE_SHA,
        treeSha: TARGET_TREE_SHA,
        ...runtimeIdentity,
        versionId: TARGET_VERSION_ID,
        releaseMode: "atomic-product-activation",
        baseSourceSha: TARGET_BASE_SHA,
      }));
      expect(runCommand).toHaveBeenCalledTimes(3);
    });

    it.each([
      ["Worker", { workerBundleSha256: "bad", durableObjectBundleSha256: DO_BUNDLE_SHA256 }],
      ["Durable Object", {
        workerBundleSha256: PRODUCT_WORKER_BUNDLE_SHA256,
        durableObjectBundleSha256: "bad",
      }],
    ])("rejects an invalid deployed %s digest before reading Git", async (_label, identity) => {
      const runCommand = vi.fn<ReleaseCommandRunner>();
      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        TARGET_SOURCE_SHA,
        TARGET_VERSION_ID,
        runCommand,
        undefined,
        identity,
      )).rejects.toThrow("runtime");
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("rejects malformed tree or parent Git evidence", async () => {
      const runCommand = vi.fn<ReleaseCommandRunner>(async (_command, args) => ({
        stdout: args[1]?.endsWith("^{tree}")
          ? "not-a-tree\n"
          : args[1]?.endsWith("^")
            ? `${TARGET_BASE_SHA}\n`
            : "env:\n  SPOONJOY_RELEASE_MODE: atomic-product-activation\n",
        stderr: "",
      }));
      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        TARGET_SOURCE_SHA,
        null,
        runCommand,
      )).rejects.toThrow("Git evidence");
    });

    it.each([
      ["different checkout", `${OTHER_TREE_SHA}\n`, null],
      ["historical deployed version", `${TARGET_SOURCE_SHA}\n`, TARGET_VERSION_ID],
    ] as const)("refuses a local dry-run for a %s", async (_label, head, versionId) => {
      const runCommand = vi.fn<ReleaseCommandRunner>(async (_command, args) => {
        const key = args.join(" ");
        const outputs: Record<string, string> = {
          [`rev-parse ${TARGET_SOURCE_SHA}^{tree}`]: TARGET_TREE_SHA,
          [`rev-parse ${TARGET_SOURCE_SHA}^`]: TARGET_BASE_SHA,
          [`show ${TARGET_SOURCE_SHA}:.github/workflows/production-deploy.yml`]:
            "env:\n  SPOONJOY_RELEASE_MODE: atomic-product-activation\n",
          "rev-parse HEAD": head,
        };
        return { stdout: outputs[key] ?? "", stderr: "" };
      });
      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        TARGET_SOURCE_SHA,
        versionId,
        runCommand,
      )).rejects.toThrow("checked-out target");
      expect(runCommand).toHaveBeenCalledTimes(4);
    });

    it("recursively hashes production dry-run modules and excludes Wrangler metadata", async () => {
      const entry = Buffer.from("export default {};\n");
      const chunk = Buffer.from("export const value = 1;\n");
      const expected = requireApi("productRuntimeBundleDigests")("_worker.js", [
        { name: "_worker.js", bytes: entry },
        { name: "chunks/value.js", bytes: chunk },
      ]);
      const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
        if (command === "git") {
          const key = args.join(" ");
          const outputs: Record<string, string> = {
            [`rev-parse ${TARGET_SOURCE_SHA}^{tree}`]: TARGET_TREE_SHA,
            [`rev-parse ${TARGET_SOURCE_SHA}^`]: TARGET_BASE_SHA,
            [`show ${TARGET_SOURCE_SHA}:.github/workflows/production-deploy.yml`]:
              "env:\n  SPOONJOY_RELEASE_MODE: atomic-product-activation\n",
            "rev-parse HEAD": TARGET_SOURCE_SHA,
          };
          return { stdout: outputs[key] ?? "", stderr: "" };
        }
        const outdir = args[args.indexOf("--outdir") + 1];
        await mkdir(path.join(outdir, "chunks"), { recursive: true });
        await writeFile(path.join(outdir, "_worker.js"), entry);
        await writeFile(path.join(outdir, "chunks", "value.js"), chunk);
        await writeFile(path.join(outdir, "README.md"), "ignored metadata\n");
        return { stdout: "", stderr: "" };
      });

      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        TARGET_SOURCE_SHA,
        null,
        runCommand,
      )).resolves.toMatchObject(expected);
      const dryRunArgs = (runCommand.mock.calls.find(([command]) => command === "pnpm") ?? [
        "",
        [],
      ])[1];
      expect(dryRunArgs).not.toContain("--env");
    });

    it("rejects a non-file entry emitted by a Wrangler dry-run", async () => {
      const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
        if (command === "git") {
          const key = args.join(" ");
          const outputs: Record<string, string> = {
            [`rev-parse ${TARGET_SOURCE_SHA}^{tree}`]: TARGET_TREE_SHA,
            [`rev-parse ${TARGET_SOURCE_SHA}^`]: TARGET_BASE_SHA,
            [`show ${TARGET_SOURCE_SHA}:.github/workflows/production-deploy.yml`]:
              "env:\n  SPOONJOY_RELEASE_MODE: atomic-product-activation\n",
            "rev-parse HEAD": TARGET_SOURCE_SHA,
          };
          return { stdout: outputs[key] ?? "", stderr: "" };
        }
        const outdir = args[args.indexOf("--outdir") + 1];
        await writeFile(path.join(outdir, "_worker.js"), "export default {};\n");
        await symlink(path.join(outdir, "_worker.js"), path.join(outdir, "runtime-link"));
        return { stdout: "", stderr: "" };
      });

      await expect(requireApi("readProductCutoverSourceRecord")(
        "production",
        TARGET_SOURCE_SHA,
        null,
        runCommand,
      )).rejects.toThrow("unsupported entry");
    });
  });

  describe("source-controlled evidence adapters", () => {
    it.each([
      ["invalid environment", (receipt: BidirectionalSkewReceipt) => {
        (receipt as unknown as { environment: string }).environment = "staging";
      }, "environment"],
      ["wrong manifest kind", (receipt: BidirectionalSkewReceipt) => {
        receipt.predecessorWorkerManifest.sourcePath = "workers/cook-session.ts";
      }, "manifest kind"],
    ] as const)("rejects a skew receipt with %s", async (_label, mutate, message) => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-skew-coverage-"));
      const value = ordinaryRepairAttempt();
      const receipt = bidirectionalSkewReceipt(value);
      mutate(receipt);
      const directory = path.join(artifactDir, "product-skew-receipts");
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(
            directory,
            `production-from-${value.predecessor.lineageParentSourceSha}.json`,
          ),
          JSON.stringify(receipt),
          "utf8",
        );
        await expect(requireApi("readForwardRepairSkewReceiptFile")(
          artifactDir,
          "production",
          value.predecessor.lineageParentSourceSha,
        )).rejects.toThrow(message);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("rejects an executed receipt whose filename digest does not match its bytes", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-executed-digest-"));
      const receipt = bidirectionalSkewReceipt(ordinaryRepairAttempt());
      const claimedDigest = "a".repeat(64);
      const directory = path.join(artifactDir, "product-skew-receipts");
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, `executed-${claimedDigest}.json`),
          JSON.stringify(receipt),
          "utf8",
        );
        await expect(requireApi("readExecutedSkewReceiptFile")(
          artifactDir,
          claimedDigest,
        )).rejects.toThrow("digest");
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("rejects a latest repair artifact bound to another environment", async () => {
      const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-chain-binding-"));
      const latest = failedPostRestorationArtifact(
        POST_REPAIR_SOURCE_SHA,
        FAILED_RESTORATION_SHA,
      );
      latest.environment = "qa";
      const directory = path.join(evidenceDir, "product-repair-chain");
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "production.json"), JSON.stringify({
          runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
          originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
          latestFailedRepairArtifact: latest,
        }), "utf8");
        await expect(requireApi("readPostRestorationChainStateFile")(
          evidenceDir,
          "production",
        )).rejects.toThrow("chain binding");
      } finally {
        await rm(evidenceDir, { recursive: true, force: true });
      }
    });
  });

  describe("artifact invariant rejection paths", () => {
    it.each([
      ["deployment source", () => {
        const value = artifact();
        value.deployment.sourceSha = OTHER_TREE_SHA;
        return value;
      }, "deployment target"],
      ["failed migration bookmark", () => {
        const value = artifactForFailure("migration", "migration_apply_failed");
        value.migration.recoveryBookmarkId = null;
        return value;
      }, "migration state"],
      ["repair migration readback", () => {
        const value = artifactForTransitionAtPhase("forward-repair", "deployment", "pending");
        value.migration.recoveryBookmarkId = RECOVERY_BOOKMARK_ID;
        return value;
      }, "repair migration state"],
      ["failed unlock inventory", () => {
        const value = artifactForPhase("unlock", "failed");
        value.unlock.inventoryBefore = null;
        return value;
      }, "unlock state"],
      ["premature target version", () => {
        const value = artifactForPhase("precheck", "pending");
        value.target.versionId = TARGET_VERSION_ID;
        return value;
      }, "target version"],
      ["failed deployment reachability", () => {
        const value = artifactForFailure("deployment", "deployment_failed");
        value.target.versionId = TARGET_VERSION_ID;
        return value;
      }, "deployment reached state"],
      ["precheck migration reachability", () => {
        const value = artifactForPhase("precheck", "pending");
        value.migration.applyState = "already_applied";
        value.migration.triggerInventory = [];
        return value;
      }, "migration reached state"],
      ["precheck unlock reachability", () => {
        const value = artifactForPhase("precheck", "pending");
        value.unlock.inventoryBefore = [];
        value.unlock.applyState = "already_absent";
        value.unlock.inventoryAfter = [];
        return value;
      }, "unlock reached state"],
      ["verified unlock reachability", () => {
        const value = artifact();
        value.unlock.applyState = "failed";
        value.unlock.inventoryAfter = null;
        return value;
      }, "unlock reached state"],
    ] as const)("rejects invalid %s evidence", (_label, makeValue, message) => {
      expect(() => requireApi("assertProductCutoverArtifact")(makeValue())).toThrow(message);
    });

    it("rejects a migration state that changes while an artifact is being validated", () => {
      const value = artifactForPhase("deployment", "pending");
      let reads = 0;
      Object.defineProperty(value.migration, "applyState", {
        configurable: true,
        enumerable: true,
        get: () => ++reads < 6 ? "applied" : "not_started",
      });
      expect(() => requireApi("assertProductCutoverArtifact")(value))
        .toThrow("migration reached state");
    });

    it("canonicalizes an undefined immutable value before rejecting cross-phase drift", () => {
      const previous = artifactForPhase("precheck", "pending");
      const current = artifactForPhase("precheck", "succeeded");
      let reads = 0;
      Object.defineProperty(current, "protocolBoundarySha", {
        configurable: true,
        enumerable: true,
        get: () => ++reads === 1 ? PROTOCOL_BOUNDARY_SHA : undefined,
      });
      expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
        .toThrow("cross-phase");
    });

    it("rejects cross-phase migration metadata that changes after basic validation", () => {
      const previous = artifactForPhase("precheck", "succeeded");
      const current = artifactForPhase("migration", "pending");
      let reads = 0;
      Object.defineProperty(current.migration, "name", {
        configurable: true,
        enumerable: true,
        get: () => ++reads === 1 ? MIGRATION_NAME : "0026_changed.sql",
      });
      expect(() => requireApi("assertProductCutoverArtifact")(current, previous))
        .toThrow("cross-phase");
    });
  });

  describe("precondition evidence rejection paths", () => {
    it("verifies a receipt by executing every recorded deterministic runtime builder", async () => {
      const value = ordinaryRepairAttempt("both");
      const baseRunner = gitEvidenceRunner();
      const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args, options) => {
        if (command === "node" && args[0] === RUNTIME_BUNDLE_BUILDER_PATH) {
          return {
            stdout: execFileSync(command, args, { encoding: "utf8" }),
            stderr: "",
          };
        }
        return baseRunner(command, args, options);
      });

      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value, {}, { runCommand }),
      )).resolves.toBeUndefined();
      expect(runCommand.mock.calls.filter(([command]) => command === "node")).toHaveLength(6);
    });

    it.each([
      ["malformed YAML", "env: [", "release mode"],
      ["unsupported mode", "env:\n  SPOONJOY_RELEASE_MODE: gradual\n", "release mode"],
    ])("rejects %s workflow evidence", async (_label, workflow, message) => {
      const value = ordinaryRepairAttempt();
      const baseRunner = gitEvidenceRunner();
      const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args, options) => {
        if (command === "git" && args[0] === "show" &&
            args[1]?.endsWith(":.github/workflows/production-deploy.yml")) {
          return { stdout: workflow, stderr: "" };
        }
        return baseRunner(command, args, options);
      });
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value, {}, { runCommand }),
      )).rejects.toThrow(message);
    });

    it.each([
      ["name", { migrationName: "0026_other.sql" }],
      ["digest", { migrationSha256: OTHER_BUNDLE_SHA256 }],
    ])("rejects a reviewed migration %s mismatch", async (_label, overrides) => {
      const value = attempt(overrides);
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value),
      )).rejects.toThrow("migration identity");
    });

    it("rejects an internally inconsistent same-target retry", async () => {
      const value = sameTargetAttempt();
      value.target.baseSourceSha = OTHER_TREE_SHA;
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value),
      )).rejects.toThrow("Same-target predecessor binding");
    });

    it.each([
      ["wrong digest", JSON.stringify({ bundleSha256: OTHER_BUNDLE_SHA256 })],
      ["malformed output", "not-json"],
    ])("rejects a runtime build with %s", async (_label, output) => {
      const value = ordinaryRepairAttempt();
      const baseRunner = gitEvidenceRunner();
      const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args, options) => {
        if (command === "node") return { stdout: output, stderr: "" };
        return baseRunner(command, args, options);
      });
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value, {}, { runCommand }),
      )).rejects.toThrow("skew build output");
    });

    it("rejects a reused receipt when the loaded executed receipt has another digest", async () => {
      const value = ordinaryRepairAttempt("byte-identical");
      const executed = executedReceiptForActiveSource(value);
      const receipt = bidirectionalSkewReceipt(value, "reused-byte-identical", executed);
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value, {}, {
          loadForwardRepairSkewReceipt: vi.fn(async () => receipt),
          loadExecutedSkewReceipt: vi.fn(async () => validWrongSourceExecutedReceipt(value)),
        }),
      )).rejects.toThrow("skew receipt reuse");
    });

    it("rejects a QA restoration alias not bound to the durable runtime floor", async () => {
      const value = qaPostRestorationAttempt(FAILED_REPAIR_SHA, FAILED_RESTORATION_SHA);
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value, {}, {
          loadPostRestorationChainState: vi.fn(async () => restorationChainState()),
        }),
      )).rejects.toThrow("durable identity");
    });

    it("accepts reviewed restoration paths without a trailing newline", async () => {
      const value = postRestorationAttempt(FAILED_RESTORATION_SHA);
      const baseRunner = gitEvidenceRunner();
      const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args, options) => {
        if (command === "git" && args[0] === "diff") {
          return { stdout: changedPathsForSourceSha(value.target.sourceSha).join("\n"), stderr: "" };
        }
        return baseRunner(command, args, options);
      });
      await expect(requireApi("assertProductCutoverPreconditions")(
        value,
        verificationForAttempt(value, {}, { runCommand }),
      )).resolves.toBeUndefined();
    });
  });

  describe("runner reconciliation branches", () => {
    it("classifies a non-JSON pending migration entry without losing canonical evidence", async () => {
      const runEffects = effects({
        readPendingMigrationNames: vi.fn(async () => [undefined as unknown as string]),
      });
      await expect(requireApi("runProductCutover")(attempt(), runEffects))
        .rejects.toThrow("migration state changed");
      expect(writtenLifecycleArtifacts(runEffects).at(-1)?.failure?.classification)
        .toBe("migration_rejected");
    });

    it("rejects a pending migration on a reconciliation path", async () => {
      const value = sameTargetAttempt();
      const runEffects = successfulEffectsForAttempt(value, {
        readPendingMigrationNames: vi.fn(async () => [MIGRATION_NAME]),
      });
      await expect(requireApi("runProductCutover")(value, runEffects))
        .rejects.toThrow("migration state changed");
      expect(writtenLifecycleArtifacts(runEffects).at(-1)?.failure?.classification)
        .toBe("migration_rejected");
    });

    it.each([
      ["unreadable", vi.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("D1 unavailable"))],
      ["still pending", vi.fn()
        .mockResolvedValueOnce([MIGRATION_NAME])
        .mockResolvedValueOnce([MIGRATION_NAME])],
    ])("classifies %s post-migration state as ambiguous", async (_label, readPending) => {
      const runEffects = effects({ readPendingMigrationNames: readPending });
      await expect(requireApi("runProductCutover")(attempt(), runEffects)).rejects.toThrow();
      expect(writtenLifecycleArtifacts(runEffects).at(-1)).toMatchObject({
        migration: { applyState: "failed" },
        failure: { classification: "migration_state_ambiguous" },
      });
    });

    it("normalizes a non-Error recovery-bookmark failure", async () => {
      const runEffects = effects({
        createRecoveryBookmark: vi.fn(async () => Promise.reject("bookmark unavailable")),
      });
      await expect(requireApi("runProductCutover")(attempt(), runEffects))
        .rejects.toThrow("bookmark unavailable");
      expect(writtenLifecycleArtifacts(runEffects).at(-1)?.failure?.classification)
        .toBe("recovery_bookmark_failed");
    });

    it.each([
      ["after upload", () => attempt(), true, "deployment state is ambiguous",
        "deployment_state_ambiguous"],
      ["without upload", () => sameTargetAttempt(), false, "version unavailable",
        "deployment_failed"],
    ] as const)(
      "classifies target-version lookup failure %s",
      async (_label, makeAttempt, rejectUpload, message, classification) => {
        const value = makeAttempt();
        const runEffects = successfulEffectsForAttempt(value, {
          deployTarget: rejectUpload
            ? vi.fn(async () => Promise.reject(new Error("upload failed")))
            : vi.fn(async () => observedTarget()),
          resolveTargetVersion: vi.fn(async () => Promise.reject(new Error("version unavailable"))),
        });
        await expect(requireApi("runProductCutover")(value, runEffects))
          .rejects.toThrow(message);
        expect(writtenLifecycleArtifacts(runEffects).at(-1)?.failure?.classification)
          .toBe(classification);
      },
    );

    it("records trigger residue observed after a failed unlock", async () => {
      const runEffects = effects({
        applyUnlock: vi.fn(async () => Promise.reject(new Error("unlock failed"))),
        readTriggerInventory: vi.fn()
          .mockResolvedValueOnce([...BOTH_TRIGGERS])
          .mockResolvedValueOnce([INSERT_TRIGGER]),
      });
      await expect(requireApi("runProductCutover")(attempt(), runEffects))
        .rejects.toThrow("unlock state is ambiguous");
      expect(writtenLifecycleArtifacts(runEffects).at(-1)).toMatchObject({
        unlock: { applyState: "failed", inventoryAfter: [INSERT_TRIGGER] },
        failure: { classification: "unlock_state_ambiguous" },
      });
    });

    it("normalizes a not-started unlock after inventory was durably captured", async () => {
      const nativeStructuredClone = globalThis.structuredClone;
      let liveEvidence: ProductCutoverArtifact | undefined;
      const cloneSpy = vi.spyOn(globalThis, "structuredClone").mockImplementation((value) => {
        if (value && typeof value === "object" && "schemaVersion" in value) {
          return value;
        }
        return nativeStructuredClone(value);
      });
      const assertDeploymentOwnership = vi.fn(async () => undefined)
        .mockImplementationOnce(async () => undefined)
        .mockImplementationOnce(async () => undefined)
        .mockImplementationOnce(async () => {
          if (!liveEvidence) throw new Error("missing live evidence");
          liveEvidence.unlock.inventoryBefore = [];
          throw new Error("ownership changed after inventory capture");
        });
      const runEffects = effects({
        assertDeploymentOwnership,
        writeEvidence: vi.fn(async (value) => {
          liveEvidence = value;
        }),
      });
      try {
        await expect(requireApi("runProductCutover")(attempt(), runEffects))
          .rejects.toThrow("ownership changed after inventory capture");
        expect(writtenLifecycleArtifacts(runEffects).at(-1)?.unlock.applyState).toBe("failed");
      } finally {
        cloneSpy.mockRestore();
      }
    });

    it("rejects malformed QA source evidence after successful production unlock", async () => {
      const runEffects = effects({
        readQaActiveSource: vi.fn(async () => ({} as CutoverSourceRecord)),
      });
      await expect(requireApi("runProductCutover")(attempt(), runEffects))
        .rejects.toThrow("QA active source is invalid");
      expect(runEffects.recordQaBinding).not.toHaveBeenCalled();
    });
  });

  it("persists a validator-accepted repair failure when trigger readback is malformed", async () => {
    const value = ordinaryRepairAttempt();
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-repair-readback-"));
    const filename = path.join(artifactDir, "production-product-cutover-state.json");
    const writeEvidence = vi.fn(async (evidence: ProductCutoverArtifact) => (
      requireApi("writeProductCutoverArtifactFile")(artifactDir, evidence)
    ));
    const runEffects = successfulEffectsForAttempt(value, {
      readTriggerInventory: vi.fn(async () => [undefined as unknown as string]),
      writeEvidence,
    });
    try {
      await expect(requireApi("runProductCutover")(value, runEffects))
        .rejects.toThrow("trigger inventory evidence is invalid");
      await expect(requireApi("validateProductCutoverStateFile")(
        filename,
        "production",
      )).resolves.toMatchObject({
        phase: "migration",
        status: "failed",
        migration: {
          recoveryBookmarkId: null,
          applyState: "failed",
          triggerInventory: null,
        },
        failure: { classification: "migration_state_ambiguous" },
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("persists a validator-accepted ambiguous unlock after successful apply readback fails", async () => {
    const value = attempt();
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-unlock-readback-"));
    const filename = path.join(artifactDir, "production-product-cutover-state.json");
    const writeEvidence = vi.fn(async (evidence: ProductCutoverArtifact) => (
      requireApi("writeProductCutoverArtifactFile")(artifactDir, evidence)
    ));
    const runEffects = effects({
      readTriggerInventory: vi.fn()
        .mockResolvedValueOnce([...BOTH_TRIGGERS])
        .mockRejectedValueOnce(new Error("D1 readback unavailable")),
      writeEvidence,
    });
    try {
      await expect(requireApi("runProductCutover")(value, runEffects))
        .rejects.toThrow("unlock state is ambiguous");
      await expect(requireApi("validateProductCutoverStateFile")(
        filename,
        "production",
      )).resolves.toMatchObject({
        phase: "unlock",
        status: "failed",
        unlock: {
          inventoryBefore: [...BOTH_TRIGGERS],
          applyState: "failed",
          inventoryAfter: null,
        },
        failure: { classification: "unlock_state_ambiguous" },
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  describe("durable state edge cases", () => {
    it("refuses to erase a same-attempt recovery bookmark", async () => {
      const previous = artifactForPhase("migration", "succeeded");
      const current = artifactForPhase("precheck", "pending");
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-bookmark-edge-"));
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      const original = JSON.stringify({ cutover: previous });
      try {
        await writeFile(filename, original, "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .rejects.toThrow("recovery bookmark continuity");
        await expect(readFile(filename, "utf8")).resolves.toBe(original);
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("restarts an ordinary failed attempt without deleting durable evidence", async () => {
      const previous = artifactForPhase("migration", "failed");
      const current = artifactForPhase("precheck", "pending");
      current.migration.recoveryBookmarkId = previous.migration.recoveryBookmarkId;
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-restart-edge-"));
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      try {
        await writeFile(filename, JSON.stringify({ cutover: previous }), "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .resolves.toBeUndefined();
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("rejects an unsupported restoration restart", async () => {
      const previous = failedPostRestorationArtifact(
        POST_REPAIR_SOURCE_SHA,
        FAILED_RESTORATION_SHA,
      );
      const current = artifactForPhase("precheck", "pending");
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-restart-edge-"));
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      try {
        await writeFile(filename, JSON.stringify({ cutover: previous }), "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .rejects.toThrow("artifact");
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("rejects an unrelated transition after a nonterminal successful phase", async () => {
      const previous = artifactForPhase("migration", "succeeded");
      const current = artifactForTransition("forward-repair");
      current.phase = "precheck";
      current.status = "pending";
      current.target.versionId = null;
      current.migration = {
        ...current.migration,
        recoveryBookmarkId: null,
        applyState: "not_started",
        triggerInventory: null,
      };
      current.deployment = {
        deploymentId: null,
        versionId: null,
        sourceSha: current.target.sourceSha,
        trafficPercent: null,
      };
      current.unlock = {
        ...current.unlock,
        inventoryBefore: null,
        applyState: "not_started",
        inventoryAfter: null,
      };
      current.failure = null;
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-restart-edge-"));
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      try {
        await writeFile(filename, JSON.stringify({ cutover: previous }), "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .rejects.toThrow("artifact");
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("permits same-target reconciliation after an ambiguously reconciled unlock", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-ambiguous-restart-"));
      const previous = artifactForPhase("unlock", "ambiguous_reconciled");
      const current = artifactForTransition("same-target-reconcile");
      current.phase = "precheck";
      current.status = "pending";
      current.migration = {
        ...current.migration,
        recoveryBookmarkId: null,
        applyState: "not_started",
        triggerInventory: null,
      };
      current.deployment = {
        deploymentId: null,
        versionId: null,
        sourceSha: current.target.sourceSha,
        trafficPercent: null,
      };
      current.unlock = {
        ...current.unlock,
        inventoryBefore: null,
        applyState: "not_started",
        inventoryAfter: null,
      };
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      try {
        await writeFile(filename, JSON.stringify({ cutover: previous }), "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(artifactDir, current))
          .resolves.toBeUndefined();
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("refuses to overwrite syntactically invalid durable JSON", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-invalid-json-"));
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      try {
        await writeFile(filename, "{", "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(
          artifactDir,
          artifactForPhase("precheck", "pending"),
        )).rejects.toThrow();
        await expect(readFile(filename, "utf8")).resolves.toBe("{");
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("treats an explicitly undefined parsed cutover as an empty state envelope", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-undefined-envelope-"));
      const filename = path.join(artifactDir, "production-product-cutover-state.json");
      const parse = vi.spyOn(JSON, "parse").mockReturnValueOnce({ cutover: undefined });
      try {
        await writeFile(filename, "synthetic envelope", "utf8");
        await expect(requireApi("writeProductCutoverArtifactFile")(
          artifactDir,
          artifactForPhase("precheck", "pending"),
        )).resolves.toBeUndefined();
      } finally {
        parse.mockRestore();
        await rm(artifactDir, { recursive: true, force: true });
      }
    });

    it("rejects a valid state file for the wrong expected environment", async () => {
      const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-state-environment-"));
      const filename = path.join(artifactDir, "state.json");
      try {
        await writeFile(filename, JSON.stringify({ cutover: artifact() }), "utf8");
        await expect(requireApi("validateProductCutoverStateFile")(filename, "qa"))
          .rejects.toThrow("state file environment");
      } finally {
        await rm(artifactDir, { recursive: true, force: true });
      }
    });
  });
});

describe("product-cutover final reachable branch coverage", () => {
  it("loads a post-restoration chain with no prior failed repair", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-empty-chain-"));
    const directory = path.join(evidenceDir, "product-repair-chain");
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "production.json"), JSON.stringify({
        runtimeFloorSourceSha: RUNTIME_FLOOR_SHA,
        originalFailedRestorationSourceSha: FAILED_RESTORATION_SHA,
        latestFailedRepairArtifact: null,
      }), "utf8");
      await expect(requireApi("readPostRestorationChainStateFile")(
        evidenceDir,
        "production",
      )).resolves.toEqual(restorationChainState());
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it("accepts initial trigger-mismatch evidence from an already-applied migration", () => {
    const value = artifactForFailure("migration", "trigger_inventory_mismatch");
    value.migration.recoveryBookmarkId = null;
    value.migration.applyState = "already_applied";
    value.migration.triggerInventory = [INSERT_TRIGGER];
    expect(() => requireApi("assertProductCutoverArtifact")(value)).not.toThrow();
  });

  it("rejects failed migration evidence whose classification disappears during validation", () => {
    const value = artifactForFailure("migration", "migration_rejected");
    const failure = value.failure;
    let reads = 0;
    Object.defineProperty(value, "failure", {
      configurable: true,
      enumerable: true,
      get: () => ++reads === 1 ? null : failure,
    });
    expect(() => requireApi("assertProductCutoverArtifact")(value))
      .toThrow("migration failure state");
  });

  it("handles a deployment classification that appears after basic failure parsing", () => {
    const value = artifactForFailure("deployment", "deployment_failed");
    const failure = value.failure;
    let reads = 0;
    Object.defineProperty(value, "failure", {
      configurable: true,
      enumerable: true,
      get: () => ++reads <= 2 ? null : failure,
    });
    expect(() => requireApi("assertProductCutoverArtifact")(value)).not.toThrow();
  });

  it("treats a missing flexible-deployment classification as non-flexible", () => {
    const value = artifactForFailure("deployment", "deployment_failed");
    const failure = value.failure;
    if (!failure) throw new Error("deployment failure fixture must be present");
    let reads = 0;
    Object.defineProperty(failure, "classification", {
      configurable: true,
      enumerable: true,
      get: () => ++reads <= 4 ? "deployment_failed" : undefined,
    });
    expect(() => requireApi("assertProductCutoverArtifact")(value)).not.toThrow();
  });

  it("rejects non-100 traffic when a flexible classification disappears", () => {
    const value = artifactForFailure("deployment", "deployment_failed");
    value.target.versionId = TARGET_VERSION_ID;
    value.deployment = observedTarget({ trafficPercent: 37 });
    const failure = value.failure;
    if (!failure) throw new Error("deployment failure fixture must be present");
    let reads = 0;
    Object.defineProperty(failure, "classification", {
      configurable: true,
      enumerable: true,
      get: () => ++reads <= 6 ? "deployment_failed" : undefined,
    });
    expect(() => requireApi("assertProductCutoverArtifact")(value))
      .toThrow("deployment traffic");
  });
});
