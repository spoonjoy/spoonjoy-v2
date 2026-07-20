import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAdditiveMigrationSql,
  buildWorkerVersionOverride,
  createReleaseCommandRunner,
  parsePendingMigrationNames,
  parseReleaseCliOptions,
  readPublicWorkerVersion,
  runProductionCanaryRelease,
  runProductionRollback,
  runProductionReleaseCli,
  selectCurrentProductionVersion,
  selectUploadedVersion,
  writeReleaseArtifactFile,
  type ReleaseArtifact,
  type ReleaseCommandRunner,
} from "../../scripts/deploy-production-canary";

const RELEASE_SHA = "a".repeat(40);
const TREE_HASH = "b".repeat(40);
const TOOLING_SHA = "c".repeat(40);
const PREVIOUS_VERSION = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";
const PRODUCT_BOUNDARY_SHA = "d".repeat(40);
const PREVIOUS_PRODUCT_SHA = "e".repeat(40);
const CANARY_UPLOAD_COMMAND = `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`;
const CANARY_STAGE_COMMAND = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`;
const CANARY_PROMOTE_COMMAND = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`;
const CANARY_RESTORE_COMMAND = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function commandKey(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

const D1_APPLY_COMMAND = "pnpm exec wrangler d1 migrations apply DB --remote";

function isRemoteMutationCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "pnpm" || tokens[1] !== "exec" || tokens[2] !== "wrangler") {
    return false;
  }
  if (tokens[3] === "deployments" && tokens[4] === "list") return false;
  if (tokens[3] === "versions" && tokens[4] === "list") return false;
  if (tokens[3] === "d1") {
    if (tokens[4] === "migrations" && tokens[5] === "list") return false;
    if (tokens.includes("--local")) return false;
    if (
      tokens[4] === "migrations" &&
      tokens[5] === "apply" &&
      !tokens.includes("--remote")
    ) return false;
  }
  return true;
}

function remoteMutationCommands(commands: readonly string[]) {
  return commands.filter(isRemoteMutationCommand);
}

function workerVersion(
  id: unknown,
  tag: unknown,
  createdOn = "2026-07-15T00:00:00Z",
  number: unknown = 1,
) {
  return {
    id,
    number,
    annotations: tag === undefined ? {} : { "workers/tag": tag },
    metadata: { created_on: createdOn },
  };
}

function deploymentPayload(versionId: string, createdOn = "2026-07-15T00:05:00Z"): string {
  return JSON.stringify([{
    id: `deployment-${versionId}`,
    created_on: createdOn,
    versions: [{ version_id: versionId, percentage: 100 }],
  }]);
}

type CommandResponse = Error | string;

function successfulRunner(overrides: Record<string, CommandResponse | readonly CommandResponse[]> = {}) {
  const responses: Record<string, string | readonly string[]> = {
    "git rev-parse HEAD": RELEASE_SHA,
    "git status --porcelain --untracked-files=no": "",
    "git rev-parse HEAD^{tree}": TREE_HASH,
    "pnpm exec wrangler d1 migrations list DB --remote": JSON.stringify([{ Name: "0024_add_release_marker.sql" }]),
    "pnpm exec wrangler deployments list --json": [
      JSON.stringify([
        {
          id: "deployment-old",
          created_on: "2026-07-14T00:00:00Z",
          versions: [{ version_id: "00000000-0000-4000-8000-000000000000", percentage: 100 }],
        },
        {
          id: "deployment-current",
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
        },
      ]),
      JSON.stringify([
        {
          id: "deployment-promoted",
          created_on: "2026-07-15T00:05:00Z",
          versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }],
        },
      ]),
    ],
    "pnpm exec wrangler versions list --json": [
      JSON.stringify([
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA, "2026-07-14T00:00:00Z"),
      ]),
      JSON.stringify([
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA, "2026-07-14T00:00:00Z"),
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-07-15T00:00:00Z", 2),
      ]),
    ],
  };

  const callCounts = new Map<string, number>();
  const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
    const key = commandKey(command, args);
    const callIndex = callCounts.get(key) ?? 0;
    callCounts.set(key, callIndex + 1);
    const configured = overrides[key] ?? responses[key] ?? "";
    const response = Array.isArray(configured)
      ? configured[Math.min(callIndex, configured.length - 1)]
      : configured;
    if (response instanceof Error) throw response;
    return { stdout: response, stderr: "" };
  });
  return runCommand;
}

function recordedCommands(runCommand: ReturnType<typeof successfulRunner>): string[] {
  return runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
}

describe("remote mutation command oracle", () => {
  it.each([
    ["a bare Worker deploy", "pnpm exec wrangler deploy", true],
    ["a tagged Worker deploy", "pnpm exec wrangler deploy --tag abc", true],
    ["a Worker rollback alias", "pnpm exec wrangler rollback", true],
    ["a Worker version upload", "pnpm exec wrangler versions upload --tag abc", true],
    ["a Worker version traffic deploy", "pnpm exec wrangler versions deploy version@100%", true],
    ["a remote D1 apply with later environment flags", "pnpm exec wrangler d1 migrations apply DB --env qa --remote", true],
    ["a Worker deletion", "pnpm exec wrangler delete --force", true],
    ["a remote D1 execute", "pnpm exec wrangler d1 execute DB --remote --command DELETE", true],
    ["a D1 database deletion", "pnpm exec wrangler d1 delete DB --skip-confirmation", true],
    ["an unknown Wrangler command", "pnpm exec wrangler future-command", true],
    ["a deployments inspection", "pnpm exec wrangler deployments list --json", false],
    ["a versions inspection", "pnpm exec wrangler versions list --json", false],
    ["a local D1 apply", "pnpm exec wrangler d1 migrations apply DB", false],
    ["an explicit local D1 execute", "pnpm exec wrangler d1 execute DB --local --command DELETE", false],
    ["an unrelated command", "git deploy", false],
  ])("classifies %s", (_label, command, expected) => {
    expect(isRemoteMutationCommand(command)).toBe(expected);
    expect(remoteMutationCommands([command])).toEqual(expected ? [command] : []);
  });
});

function releaseDeps(runCommand: ReleaseCommandRunner) {
  return {
    artifactDir: "mcp-oauth-canary-artifacts",
    env: {
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_D1_API_TOKEN: "d1-secret",
      CLOUDFLARE_WORKERS_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    },
    readMigrationFile: vi.fn(async () => "CREATE TABLE ReleaseMarker (id TEXT PRIMARY KEY);"),
    readPublicWorkerVersion: vi.fn(async () => CANDIDATE_VERSION),
    releaseSha: RELEASE_SHA,
    releaseMode: "protocol-v1-canary" as const,
    protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
    runCommand,
    sleep: vi.fn(async () => undefined),
    verificationAttempts: 3,
    writeReleaseArtifact: vi.fn(async () => undefined),
  };
}

function atomicReleaseDeps(
  runCommand: ReleaseCommandRunner,
  releaseMode: "atomic-bootstrap" | "atomic-product-activation",
) {
  const deps = releaseDepsWithoutBoundary(runCommand);
  return { ...deps, releaseMode };
}

function releaseDepsWithoutBoundary(runCommand: ReleaseCommandRunner) {
  const { protocolV1BoundarySha: _omitted, ...deps } = releaseDeps(runCommand);
  return deps;
}

function rollbackDeps(runCommand: ReleaseCommandRunner) {
  return {
    artifactDir: "mcp-oauth-canary-artifacts",
    env: {
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_WORKERS_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    },
    readPublicWorkerVersion: vi.fn(async () => CANDIDATE_VERSION),
    releaseSha: RELEASE_SHA,
    releaseMode: "protocol-v1-canary" as const,
    protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
    rollbackVersionId: CANDIDATE_VERSION,
    runCommand,
    sleep: vi.fn(async () => undefined),
    verificationAttempts: 2,
    writeReleaseArtifact: vi.fn(async () => undefined),
  };
}

describe("trusted production rollback orchestration", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid verification attempt count %s before any command",
    async (verificationAttempts) => {
    const runCommand = successfulRunner();
    const deps = rollbackDeps(runCommand);
    deps.verificationAttempts = verificationAttempts;

    await expect(runProductionRollback(deps)).rejects.toThrow("positive integer");

    expect(recordedCommands(runCommand)).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "validate",
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      failure: "Production verification attempts must be a positive integer.",
    });
    },
  );

  it("uses current-main tooling to deploy an exact known source-tagged version", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const deps = rollbackDeps(runCommand);

    const result = await runProductionRollback(deps);

    expect(result).toEqual({
      status: "rollback_promoted",
      sourceSha: RELEASE_SHA,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      deploymentStrategy: "gradual",
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary",
    });
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
      "pnpm exec wrangler deployments list --json",
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
    ]);
    expect(runCommand.mock.calls[4]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
  });

  it("records stale rollback tooling provenance before deployment", async () => {
    const staleRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": "d".repeat(40),
    });
    const deps = rollbackDeps(staleRunner);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Rollback tooling is not checked out at current origin/main.",
    );

    expect(recordedCommands(staleRunner)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
    ]);
    expect(remoteMutationCommands(recordedCommands(staleRunner))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "provenance",
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      failure: "Rollback tooling is not checked out at current origin/main.",
    });
  });

  it("records a mismatched rollback target tag before deployment", async () => {
    const tagRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, "d".repeat(40)),
      ]),
    });
    const deps = rollbackDeps(tagRunner);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Rollback target is not the exact source-tagged Worker version.",
    );

    expect(recordedCommands(tagRunner)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(tagRunner))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "rollback_version_lookup",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      failure: "Rollback target is not the exact source-tagged Worker version.",
    });
  });

  it.each([
    ["a missing requested version", [], "Rollback target is not the exact source-tagged Worker version."],
    ["an untagged requested version", [workerVersion(CANDIDATE_VERSION, undefined)], "Rollback target is not the exact source-tagged Worker version."],
    ["a malformed requested source tag", [workerVersion(CANDIDATE_VERSION, "main")], "Rollback target is not the exact source-tagged Worker version."],
    ["duplicate requested version records", [
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-07-15T00:01:00Z", 2),
    ], "Wrangler version output contained duplicate version IDs."],
  ] as const)("rejects %s even when an unrelated version carries the requested SHA", async (
    _label,
    targetVersions,
    expectedError,
  ) => {
    const unrelatedVersionId = "33333333-3333-4333-8333-333333333333";
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(unrelatedVersionId, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
        ...targetVersions,
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
    });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(expectedError);

    expect(recordedCommands(runCommand)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "rollback_version_lookup",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      failure: expectedError,
    });
  });

  it("records invalid rollback input without running commands", async () => {
    const invalidRunner = successfulRunner();
    const invalidDeps = rollbackDeps(invalidRunner);
    delete invalidDeps.env;
    invalidDeps.releaseSha = "main";

    await expect(runProductionRollback(invalidDeps)).rejects.toThrow(
      "Production releases require a 40-character lowercase Git SHA.",
    );

    expect(recordedCommands(invalidRunner)).toEqual([]);
    expect(remoteMutationCommands(recordedCommands(invalidRunner))).toEqual([]);
    expect(invalidDeps.writeReleaseArtifact).not.toHaveBeenCalled();
  });

  it("records dirty rollback tooling provenance before deployment", async () => {
    const dirtyRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "git status --porcelain --untracked-files=no": " M scripts/deploy-production-canary.ts",
    });
    const deps = rollbackDeps(dirtyRunner);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Rollback tooling checkout has tracked changes.",
    );

    expect(recordedCommands(dirtyRunner)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
    ]);
    expect(remoteMutationCommands(recordedCommands(dirtyRunner))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "provenance",
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      failure: "Rollback tooling checkout has tracked changes.",
    });
  });

  it("records an already-active rollback target as an explicit no-op failure", async () => {
    const activeRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(CANDIDATE_VERSION),
    });
    const deps = rollbackDeps(activeRunner);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "The requested rollback version is already active in production.",
    );

    expect(recordedCommands(activeRunner)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(activeRunner))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "rollback_already_active",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: CANDIDATE_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "The requested rollback version is already active in production.",
    });
  });

  it.each([
    [
      "malformed JSON",
      "not-json",
      "Wrangler deployment output was not valid JSON.",
    ],
    [
      "an empty list",
      "[]",
      "Wrangler deployment output did not contain an active deployment.",
    ],
    [
      "a split deployment",
      JSON.stringify([{
        created_on: "2026-07-15T00:00:00Z",
        versions: [
          { version_id: PREVIOUS_VERSION, percentage: 90 },
          { version_id: CANDIDATE_VERSION, percentage: 10 },
        ],
      }]),
      "The active production deployment is not a single-version deployment.",
    ],
    [
      "a newest-deployment timestamp tie",
      JSON.stringify([
        {
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
        },
        {
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }],
        },
      ]),
      "Newest production deployments have an ambiguous timestamp tie.",
    ],
  ] as const)("records rollback current-deployment failure for %s", async (
    _label,
    deploymentOutput,
    failure,
  ) => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentOutput,
    });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(failure);

    expect(recordedCommands(runCommand)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "rollback_current_deployment",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      candidateVersionId: CANDIDATE_VERSION,
      failure,
    });
  });

  it("restores the prior version when rollback promotion cannot be verified", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("did not converge");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "verify_promotion",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "Production version did not converge to " + CANDIDATE_VERSION + ".",
    });
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it("records failure when restoring after a failed rollback also fails", async () => {
    const restore = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
    const runner = () => successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": TOOLING_SHA,
        "pnpm exec wrangler versions list --json": JSON.stringify([
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
        ]),
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION),
          new Error("deployment list unavailable"),
          new Error("still unavailable"),
        ],
        [restore]: new Error("restore failed"),
      });
    const runCommand = runner();
    const deps = {
      ...rollbackDeps(runCommand),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };
    deps.readPublicWorkerVersion.mockRejectedValue(new Error("public unavailable"));

    await expect(runProductionRollback(deps)).rejects.toThrow("Rollback failed: restore failed");
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
      restore,
    ]);
    const rollbackFailedArtifact = {
      status: "rollback_failed",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "verify_promotion",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "Production version did not converge to " + CANDIDATE_VERSION + ".",
      rollbackFailure: "restore failed",
    };
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(rollbackFailedArtifact);

    const secondRunner = runner();
    const secondDeps = {
      ...rollbackDeps(secondRunner),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };
    secondDeps.readPublicWorkerVersion.mockRejectedValue(new Error("public unavailable"));
    secondDeps.writeReleaseArtifact.mockRejectedValueOnce(new Error("artifact failed"));
    await expect(runProductionRollback(secondDeps)).rejects.toThrow("artifact write also failed");
    expect(remoteMutationCommands(recordedCommands(secondRunner))).toEqual([
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
      restore,
    ]);
    expect(secondDeps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(secondDeps.writeReleaseArtifact).toHaveBeenLastCalledWith(rollbackFailedArtifact);
  });

  it("restores the prior version after an ambiguous rollback deploy failure", async () => {
    const deploy = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`;
    const restore = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
      [deploy]: new Error("Wrangler timed out after Cloudflare accepted the deployment"),
    });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("Wrangler timed out");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([deploy, restore]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "promote",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "Wrangler timed out after Cloudflare accepted the deployment",
    });
  });

  it("restores the previous compatible version when the rollback success artifact cannot be written", async () => {
    const targetDeploy = "pnpm exec wrangler versions deploy " + CANDIDATE_VERSION +
      "@100% -y --message Roll back to " + RELEASE_SHA;
    const restore = "pnpm exec wrangler versions deploy " + PREVIOUS_VERSION +
      "@100% -y --message Restore after failed rollback " + RELEASE_SHA;
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(CANDIDATE_VERSION)
      .mockResolvedValueOnce(PREVIOUS_VERSION);
    deps.writeReleaseArtifact
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runProductionRollback(deps)).rejects.toThrow("disk unavailable");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([targetDeploy, restore]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(2);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "artifact",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "disk unavailable",
    });
  });
});

describe("production canary release orchestration", () => {
  it("stages a candidate at zero traffic, smokes that exact version, and promotes it", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);

    const result = await runProductionCanaryRelease(deps);

    expect(result).toEqual({
      status: "promoted",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    });
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toEqual([
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm run deploy:preflight",
      "pnpm run build",
      "git status --porcelain --untracked-files=no",
      "pnpm exec wrangler d1 migrations list DB --remote",
      "pnpm exec wrangler deployments list --json",
      "pnpm exec wrangler versions list --json",
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
      "pnpm exec wrangler d1 migrations apply DB --remote",
      "pnpm run deploy:preflight",
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      "pnpm exec wrangler versions list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
    ]);
    expect(deps.readMigrationFile).toHaveBeenCalledWith("migrations/0024_add_release_marker.sql");
    expect(runCommand.mock.calls[3]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
      SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1",
    });
    expect(runCommand.mock.calls[4]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(runCommand.mock.calls[11]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "d1-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(runCommand.mock.calls[15]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(runCommand.mock.calls[16]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "d1-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(deps.readPublicWorkerVersion).toHaveBeenCalledWith("https://spoonjoy.app");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
  });

  it("restores the previous version when the candidate smoke fails", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler versions list --json": [
        JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
        JSON.stringify([
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        ]),
      ],
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = {
      ...releaseDeps(runCommand),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "canary",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "canary failed",
    });
  });

  it("allows the default rollback verification window to outlast delayed Cloudflare convergence", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const delayedDeployments = [
      deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
      ...Array.from({ length: 20 }, () => deploymentPayload(CANDIDATE_VERSION)),
      deploymentPayload(PREVIOUS_VERSION),
    ];
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": delayedDeployments,
    });
    const deps = releaseDeps(runCommand);
    delete (deps as { verificationAttempts?: number }).verificationAttempts;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.sleep).toHaveBeenCalledTimes(20);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      previousVersionId: PREVIOUS_VERSION,
    }));
  });

  it.each([
    ["a missing public version", null],
    ["a failed public probe", new Error("edge unavailable")],
    ["a mismatched public version", CANDIDATE_VERSION],
  ])("fails restoration when %s persists", async (_label, publicObservation) => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;
    if (publicObservation instanceof Error) {
      deps.readPublicWorkerVersion.mockRejectedValue(publicObservation);
    } else {
      deps.readPublicWorkerVersion.mockResolvedValue(publicObservation);
    }

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rollback_failed",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "canary",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "canary failed",
      rollbackFailure: `Production version did not converge to ${PREVIOUS_VERSION}.`,
    });
  });

  it.each([
    ["a transient public probe failure", new Error("edge unavailable")],
    ["a mismatched public version", CANDIDATE_VERSION],
  ])("recovers only after the public restore probe recovers from %s", async (_label, interruption) => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": Array.from(
        { length: 5 },
        () => deploymentPayload(PREVIOUS_VERSION),
      ),
    });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 5;
    deps.readPublicWorkerVersion.mockResolvedValueOnce(null);
    if (interruption instanceof Error) {
      deps.readPublicWorkerVersion.mockRejectedValueOnce(interruption);
    } else {
      deps.readPublicWorkerVersion.mockResolvedValueOnce(interruption);
    }
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
    }));
  });

  it("restores the prior version after an ambiguous staging failure", async () => {
    const stageCommand = CANARY_STAGE_COMMAND;
    const runCommand = successfulRunner({
      [stageCommand]: new Error("stage failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
      ],
      "pnpm exec wrangler versions list --json": [
        JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
        JSON.stringify([
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        ]),
      ],
    });
    const deps = {
      ...releaseDeps(runCommand),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("stage failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      stageCommand,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "stage",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "stage failed",
    });
  });

  it.each(["restore command", "restore convergence"] as const)(
    "records rollback failure when staging fails and %s fails",
    async (failurePoint) => {
      const restoreFailure = failurePoint === "restore command"
        ? "restore failed"
        : `Production version did not converge to ${PREVIOUS_VERSION}.`;
      const runCommand = successfulRunner({
        [CANARY_STAGE_COMMAND]: new Error("stage failed"),
        ...(failurePoint === "restore command"
          ? { [CANARY_RESTORE_COMMAND]: new Error("restore failed") }
          : {}),
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
          deploymentPayload(CANDIDATE_VERSION),
        ],
        "pnpm exec wrangler versions list --json": [
          JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
          JSON.stringify([
            workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
            workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
          ]),
        ],
      });
      const deps = releaseDeps(runCommand);
      deps.verificationAttempts = 1;
      deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

      expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
        D1_APPLY_COMMAND,
        CANARY_UPLOAD_COMMAND,
        CANARY_STAGE_COMMAND,
        CANARY_RESTORE_COMMAND,
      ]);
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "stage",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "stage failed",
        rollbackFailure: restoreFailure,
      });
    },
  );

  it("waits for both deployment state and the public version header to converge", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:01:00Z"),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(PREVIOUS_VERSION)
      .mockResolvedValueOnce(CANDIDATE_VERSION);

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
    ]);

    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("retries transient deployment and public verification failures", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        new Error("Cloudflare unavailable"),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockRejectedValueOnce(new Error("edge unavailable"))
      .mockResolvedValueOnce(CANDIDATE_VERSION);

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid production verification attempt count %s",
    async (verificationAttempts) => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = verificationAttempts;

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("positive integer");
    expect(recordedCommands(runCommand)).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "validate",
      reviewedMigrations: [],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
      failure: "Production verification attempts must be a positive integer.",
    });
    },
  );

  it("restores the previous version when promotion never converges", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("did not converge");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "verify_promotion",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "Production version did not converge to " + CANDIDATE_VERSION + ".",
    });
  });

  it("reports rollback failure when the restored version cannot be verified", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler versions list --json": [
        JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
        JSON.stringify([
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        ]),
      ],
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const deps = {
      ...releaseDeps(runCommand),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };
    deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rollback_failed",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "canary",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "canary failed",
      rollbackFailure: "Production version did not converge to " + PREVIOUS_VERSION + ".",
    });
  });

  it("rejects invalid release SHAs before running commands", async () => {
    const runCommand = successfulRunner();
    const deps = { ...releaseDeps(runCommand), releaseSha: "main" };

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("40-character lowercase Git SHA");
    expect(runCommand).not.toHaveBeenCalled();
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a different checked-out commit",
      overrides: { "git rev-parse HEAD": "c".repeat(40) },
      failure: "Checked-out HEAD does not match release SHA.",
      phase: "provenance",
      commands: ["git rev-parse HEAD"],
    },
    {
      label: "tracked changes",
      overrides: { "git status --porcelain --untracked-files=no": " M app/root.tsx" },
      failure: "Release checkout has tracked changes.",
      phase: "provenance",
      commands: [
        "git rev-parse HEAD",
        "git status --porcelain --untracked-files=no",
      ],
    },
    {
      label: "an invalid tree hash",
      overrides: { "git rev-parse HEAD^{tree}": "not-a-tree" },
      failure: "Git did not return a valid lowercase tree hash.",
      phase: "provenance",
      commands: [
        "git rev-parse HEAD",
        "git status --porcelain --untracked-files=no",
        "git rev-parse HEAD^{tree}",
      ],
    },
    {
      label: "tracked build output changes",
      overrides: {
        "git status --porcelain --untracked-files=no": [
          "",
          " M app/lib/generated/api-v1-playground.ts",
        ],
      },
      failure: "Production build changed tracked files.",
      phase: "post_build_provenance",
      treeHash: TREE_HASH,
      commands: [
        "git rev-parse HEAD",
        "git status --porcelain --untracked-files=no",
        "git rev-parse HEAD^{tree}",
        "pnpm run deploy:preflight",
        "pnpm run build",
        "git status --porcelain --untracked-files=no",
      ],
    },
  ] as const)("rejects $label before any D1 mutation", async ({
    label: _label,
    overrides,
    failure,
    phase,
    commands,
    ...optionalArtifactFields
  }) => {
    const runCommand = successfulRunner(overrides);
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);

    expect(recordedCommands(runCommand)).toEqual(commands);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase,
      ...optionalArtifactFields,
      reviewedMigrations: [],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
      failure,
    });
  });
});

describe("production release parsing and compatibility", () => {
  it("selects the newest single-version 100% deployment", () => {
    expect(selectCurrentProductionVersion(JSON.stringify([
      { created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }] },
      { created_on: "2026-07-14T00:00:00Z", versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }] },
    ]))).toBe(PREVIOUS_VERSION);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["an empty deployment list", "[]"],
    ["a split deployment", JSON.stringify([{ created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 90 },
      { version_id: CANDIDATE_VERSION, percentage: 10 },
    ] }])],
    ["a non-100% deployment", JSON.stringify([{ created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 99 },
    ] }])],
  ])("rejects %s", (_label, payload) => {
    expect(() => selectCurrentProductionVersion(payload)).toThrow();
  });

  it("rejects conflicting newest deployments with identical timestamps", () => {
    const tied = JSON.stringify([
      {
        created_on: "2026-07-15T00:00:00Z",
        versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
      },
      {
        created_on: "2026-07-15T00:00:00Z",
        versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }],
      },
    ]);

    expect(() => selectCurrentProductionVersion(tied)).toThrow(
      "Newest production deployments have an ambiguous timestamp tie.",
    );
  });

  it("selects exactly one uploaded version by release tag", () => {
    expect(selectUploadedVersion("[]", JSON.stringify([
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
    ]), RELEASE_SHA)).toBe(
      CANDIDATE_VERSION,
    );
  });

  it.each([
    ["missing", JSON.stringify([workerVersion(CANDIDATE_VERSION, "other")])],
    ["malformed", "{"],
  ])("rejects a %s uploaded release tag", (_label, payload) => {
    expect(() => selectUploadedVersion("[]", payload, RELEASE_SHA)).toThrow();
  });

  it("selects only the new exact-tag ID on a same-SHA retry", () => {
    const before = JSON.stringify([
      workerVersion(PREVIOUS_VERSION, RELEASE_SHA, "2026-07-14T00:00:00Z", 8),
    ]);
    const after = JSON.stringify([
      workerVersion(PREVIOUS_VERSION, RELEASE_SHA, "2026-07-14T00:00:00Z", 8),
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-07-15T00:00:00Z", 9),
    ]);

    expect(selectUploadedVersion(before, after, RELEASE_SHA)).toBe(CANDIDATE_VERSION);
  });

  it.each([
    "DROP TABLE Recipe;",
    "ALTER TABLE Recipe DROP COLUMN title;",
    "ALTER TABLE Recipe RENAME TO OldRecipe;",
    "DELETE FROM Recipe;",
    "TRUNCATE TABLE Recipe;",
    "PRAGMA writable_schema = 1;",
  ])("rejects destructive pending migration SQL: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql("0024_bad.sql", sql)).toThrow("not additive");
  });

  it("allows destructive words in SQL comments while accepting additive statements", () => {
    expect(() => assertAdditiveMigrationSql(
      "0024_good.sql",
      "-- Do not DROP this table\nCREATE TABLE ReleaseMarker (id TEXT PRIMARY KEY);\n/* DELETE FROM nothing */",
    )).not.toThrow();
  });

  it("builds the exact structured Worker version-override header", () => {
    expect(buildWorkerVersionOverride("spoonjoy-v2", CANDIDATE_VERSION)).toBe(
      `spoonjoy-v2=\"${CANDIDATE_VERSION}\"`,
    );
  });
});

describe("pending D1 migration discovery", () => {
  it("parses, validates, and deduplicates the exact current Wrangler table output", () => {
    expect(parsePendingMigrationNames([
      "Wrangler 4.90.0",
      "Migrations to be applied:",
      "┌───────────────────────────┐",
      "│ Name                      │",
      "├───────────────────────────┤",
      "│ 0024_add_marker.sql       │",
      "├───────────────────────────┤",
      "│ 0024_add_marker.sql       │",
      "├───────────────────────────┤",
      "│ 0025_add_index.v2.sql     │",
      "└───────────────────────────┘",
    ].join("\n"))).toEqual(["0024_add_marker.sql", "0025_add_index.v2.sql"]);
  });

  it.each([
    ["JSON", "[]"],
    ["text", "Wrangler 4.90.0\nNo migrations to apply!"],
  ])("accepts no pending migrations from %s output", (_label, payload) => {
    expect(parsePendingMigrationNames(payload)).toEqual([]);
  });

  it.each([
    ["invalid JSON", "{"],
    ["a JSON object", "{}"],
    ["a null row", "[null]"],
    ["an array row", "[[]]"],
    ["a primitive row", "[1]"],
    ["a missing Name", "[{}]"],
    ["a non-string Name", '[{"Name":1}]'],
    ["an invalid filename", '[{"Name":"migration.sql"}]'],
    ["a traversal filename", '[{"Name":"0024_bad..sql"}]'],
    ["unrecognized text", "Wrangler changed this output"],
    [
      "a partially parsed migration table",
      [
        "Migrations to be applied:",
        "┌──────────────────────┐",
        "│ Name                 │",
        "├──────────────────────┤",
        "│ 0024_reviewed.sql    │",
        "UNPARSED 0025_hidden.sql",
        "└──────────────────────┘",
      ].join("\n"),
    ],
    [
      "an unreviewed filename outside the migration table",
      [
        "Wrangler also found 0025_hidden.sql",
        "Migrations to be applied:",
        "┌──────────────────────┐",
        "│ Name                 │",
        "├──────────────────────┤",
        "│ 0024_reviewed.sql    │",
        "└──────────────────────┘",
      ].join("\n"),
    ],
    [
      "a malformed migration table",
      [
        "Migrations to be applied:",
        "not-a-table",
        "│ Name │",
        "├──────┤",
        "└──────┘",
      ].join("\n"),
    ],
    [
      "a malformed migration row",
      [
        "Migrations to be applied:",
        "┌────────────┐",
        "│ Name       │",
        "├────────────┤",
        "│ hidden.sql │",
        "└────────────┘",
      ].join("\n"),
    ],
    ["a false no-migration message with a filename", "✅ No migrations to apply!\n0024_hidden.sql"],
  ])("rejects %s", (_label, payload) => {
    expect(() => parsePendingMigrationNames(payload)).toThrow();
  });
});

describe("additive migration safety", () => {
  it.each([
    "DROP INDEX Recipe_idx;",
    "DROP TRIGGER Recipe_trigger;",
    "DROP VIEW Recipe_view;",
    "ALTER TABLE Recipe RENAME COLUMN title TO name;",
    "TRUNCATE Recipe;",
    "VACUUM;",
    "REINDEX Recipe_idx;",
    "PRAGMA legacy_alter_table = 1;",
    "ATTACH DATABASE 'other.db' AS other;",
    "DETACH DATABASE other;",
    "INSERT OR REPLACE INTO Recipe(id) VALUES ('1');",
    "REPLACE INTO Recipe(id) VALUES ('1');",
    "UPDATE sqlite_master SET sql = '';",
    "INSERT INTO sqlite_schema VALUES ('table');",
    "INSERT INTO Recipe(id) VALUES ('1');",
    "UPDATE Recipe SET title = 'changed';",
    "CREATE TRIGGER safe AFTER DELETE ON Recipe BEGIN SELECT 1; END;",
    "CREATE TEMP TABLE Scratch(id TEXT);",
    "CREATE TABLE Copied AS SELECT * FROM Recipe;",
    "CREATE VIEW SafeView AS SELECT * FROM Recipe;",
    "CREATE UNIQUE INDEX Existing_title_key ON Recipe(title);",
    "ALTER TABLE Recipe ADD COLUMN required TEXT NOT NULL;",
    "ALTER TABLE Recipe ADD COLUMN constrained TEXT CHECK (length(constrained) > 0);",
    "ALTER TABLE Recipe ADD COLUMN parentId TEXT REFERENCES Recipe(id);",
    "ALTER TABLE Recipe ADD COLUMN computed TEXT GENERATED ALWAYS AS (title);",
    "BEGIN; CREATE TABLE Safe(id TEXT); COMMIT;",
    "-- only a comment",
    "/* only a block comment */",
  ])("rejects non-additive SQL: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql("0024_bad.sql", sql)).toThrow("not additive");
  });

  it("accepts only strict schema-expansion statement families", () => {
    const sql = [
      "CREATE TABLE IF NOT EXISTS \"DROP TABLE\" ([DELETE FROM] TEXT DEFAULT 'DELETE FROM Recipe; it''s text');",
      'CREATE INDEX "quoted""DROP INDEX" ON "DROP TABLE"([DELETE FROM]);',
      "CREATE UNIQUE INDEX IF NOT EXISTS `TRUNCATE` ON \"DROP TABLE\"([DELETE FROM]);",
      "CREATE VIRTUAL TABLE IF NOT EXISTS Search USING fts5(title);",
      "CREATE INDEX Existing_title_idx ON Recipe(title);",
      "ALTER TABLE Recipe ADD COLUMN [VACUUM] TEXT DEFAULT 'DROP TABLE';",
      "ALTER TABLE Recipe ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto';",
      "-- DROP TABLE at end of line",
      "/* DELETE FROM Recipe */",
    ].join("\n");

    expect(() => assertAdditiveMigrationSql("0024_good.sql", sql)).not.toThrow();
  });

  it("allows a unique index only when its table is created in the same migration", () => {
    expect(() => assertAdditiveMigrationSql(
      "0024_good.sql",
      'CREATE TABLE "Fresh" (id TEXT); CREATE UNIQUE INDEX "Fresh_id_key" ON "Fresh"(id);',
    )).not.toThrow();
    expect(() => assertAdditiveMigrationSql(
      "0024_bad.sql",
      'CREATE TABLE "Fresh" (id TEXT); CREATE UNIQUE INDEX "Recipe_title_key" ON "Recipe"(title);',
    )).toThrow("not additive");
  });

  it("accepts a line comment that ends at EOF", () => {
    expect(() => assertAdditiveMigrationSql("0024_good.sql", "CREATE TABLE Safe(id TEXT); -- DROP TABLE")).not.toThrow();
  });

  it.each([
    ["block comment", "CREATE TABLE Safe(id TEXT); /*"],
    ["single quote", "CREATE TABLE Safe(value TEXT DEFAULT 'oops);"],
    ["double quote", 'CREATE TABLE "Safe(id TEXT);'],
    ["backtick", "CREATE TABLE `Safe(id TEXT);"],
    ["bracket identifier", "CREATE TABLE [Safe(id TEXT);"],
  ])("rejects an unterminated %s", (_label, sql) => {
    expect(() => assertAdditiveMigrationSql("0024_bad.sql", sql)).toThrow("unterminated");
  });
});

describe("strict Wrangler release parsing", () => {
  it.each([
    ["a JSON object", "{}"],
    ["a null deployment row", "[null]"],
    ["an array deployment row", "[[]]"],
    ["a primitive deployment row", "[1]"],
    ["a missing creation time", JSON.stringify([{ versions: [] }])],
    ["an invalid creation time", JSON.stringify([{ created_on: "not-a-date", versions: [] }])],
    ["a non-array versions value", JSON.stringify([{ created_on: "2026-07-15T00:00:00Z", versions: {} }])],
    ["an invalid version row", JSON.stringify([{ created_on: "2026-07-15T00:00:00Z", versions: [null] }])],
    ["a non-string version ID", JSON.stringify([{ created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: 1, percentage: 100 }] }])],
    ["an invalid version ID", JSON.stringify([{ created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: "latest", percentage: 100 }] }])],
  ])("rejects deployment output with %s", (_label, payload) => {
    expect(() => selectCurrentProductionVersion(payload)).toThrow();
  });

  it("rejects a newest split deployment even when an older deployment was single-version", () => {
    expect(() => selectCurrentProductionVersion(JSON.stringify([
      { created_on: "2026-07-14T00:00:00Z", versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }] },
      { created_on: "2026-07-15T00:00:00Z", versions: [
        { version_id: PREVIOUS_VERSION, percentage: 90 },
        { version_id: CANDIDATE_VERSION, percentage: 10 },
      ] },
    ]))).toThrow("single-version");
  });

  it.each([
    ["an invalid release SHA", JSON.stringify([workerVersion(CANDIDATE_VERSION, RELEASE_SHA)]), "main"],
    ["a JSON object", "{}", RELEASE_SHA],
    ["a null version row", "[null]", RELEASE_SHA],
    ["an array version row", "[[]]", RELEASE_SHA],
    ["a primitive version row", "[1]", RELEASE_SHA],
    ["missing annotations", JSON.stringify([{ id: CANDIDATE_VERSION }]), RELEASE_SHA],
    ["array annotations", JSON.stringify([{ id: CANDIDATE_VERSION, annotations: [] }]), RELEASE_SHA],
    ["a numeric tag", JSON.stringify([workerVersion(CANDIDATE_VERSION, 1)]), RELEASE_SHA],
    ["a non-string ID", JSON.stringify([workerVersion(1, RELEASE_SHA)]), RELEASE_SHA],
    ["an invalid ID", JSON.stringify([workerVersion("latest", RELEASE_SHA)]), RELEASE_SHA],
    ["missing metadata", JSON.stringify([{ ...workerVersion(CANDIDATE_VERSION, RELEASE_SHA), metadata: undefined }]), RELEASE_SHA],
    ["array metadata", JSON.stringify([{ ...workerVersion(CANDIDATE_VERSION, RELEASE_SHA), metadata: [] }]), RELEASE_SHA],
    ["a missing creation time", JSON.stringify([{ ...workerVersion(CANDIDATE_VERSION, RELEASE_SHA), metadata: {} }]), RELEASE_SHA],
    ["an invalid creation time", JSON.stringify([workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "not-a-date")]), RELEASE_SHA],
    ["a string version number", JSON.stringify([workerVersion(CANDIDATE_VERSION, RELEASE_SHA, undefined, "2")]), RELEASE_SHA],
    [
      "an infinite version number",
      JSON.stringify([workerVersion(CANDIDATE_VERSION, RELEASE_SHA, undefined, null)])
        .replace('"number":null', '"number":1e999'),
      RELEASE_SHA,
    ],
  ])("rejects version output with %s", (_label, payload, sha) => {
    expect(() => selectUploadedVersion("[]", payload, sha)).toThrow();
  });

  it("allows null and omitted tags on unrelated valid versions", () => {
    expect(selectUploadedVersion("[]", JSON.stringify([
      workerVersion(PREVIOUS_VERSION, null),
      workerVersion("33333333-3333-4333-8333-333333333333", undefined),
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA, undefined, undefined),
    ]), RELEASE_SHA)).toBe(CANDIDATE_VERSION);
  });

  it("rejects malformed before snapshots, duplicate IDs, and ambiguous new exact-tag versions", () => {
    expect(() => selectUploadedVersion("{", "[]", RELEASE_SHA)).toThrow("valid JSON");
    expect(() => selectUploadedVersion("[]", JSON.stringify([
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
    ]), RELEASE_SHA)).toThrow("duplicate version IDs");
    expect(() => selectUploadedVersion("[]", JSON.stringify([
      workerVersion(PREVIOUS_VERSION, RELEASE_SHA),
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
    ]), RELEASE_SHA)).toThrow("exactly one new");
  });

  it.each([
    ["an invalid worker name", "spoonjoy-v2\nInjected", CANDIDATE_VERSION],
    ["an invalid version ID", "spoonjoy-v2", "latest"],
  ])("rejects %s in a version override", (_label, workerName, versionId) => {
    expect(() => buildWorkerVersionOverride(workerName, versionId)).toThrow();
  });
});

describe("release failure containment", () => {
  it("accepts current Wrangler no-migration output without reading a file", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "Wrangler 4.90.0\nNo migrations to apply!",
    });
    const deps = releaseDeps(runCommand);
    delete deps.env;

    const result = await runProductionCanaryRelease(deps);
    expect(deps.readMigrationFile).not.toHaveBeenCalled();
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
    ]);
    expect(result).toEqual({
      status: "promoted",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    });
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
  });

  it("records an exact full-preflight failure when no migration was needed", async () => {
    const failure = new Error("post-migration preflight failed");
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      "pnpm run deploy:preflight": ["", failure],
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("post-migration preflight failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "full_preflight",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      failure: "post-migration preflight failed",
    });
  });

  it.each([
    ["upload", false],
    ["version lookup", false],
    ["stage", false],
    ["stage", true],
    ["canary", false],
    ["canary", true],
    ["promotion", false],
    ["promotion", true],
    ["convergence", false],
    ["convergence", true],
    ["artifact", false],
    ["artifact", true],
  ] as const)("contains zero-migration canary %s failure (restore failure: %s)", async (
    failurePoint,
    restoreFails,
  ) => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const failureMessage = failurePoint === "convergence"
      ? `Production version did not converge to ${CANDIDATE_VERSION}.`
      : failurePoint === "artifact"
        ? "success artifact failed"
        : `${failurePoint} failed`;
    const failure = new Error(failureMessage);
    const afterStage = !["upload", "version lookup"].includes(failurePoint);
    const promotionAttempted = ["promotion", "convergence", "artifact"].includes(failurePoint);
    const overrides: Record<string, CommandResponse | readonly CommandResponse[]> = {
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      "pnpm exec wrangler deployments list --json": failurePoint === "artifact"
        ? [
            deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
            deploymentPayload(CANDIDATE_VERSION),
            deploymentPayload(PREVIOUS_VERSION),
          ]
        : [
            deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
            deploymentPayload(PREVIOUS_VERSION),
            deploymentPayload(PREVIOUS_VERSION),
          ],
      ...(failurePoint === "upload" ? { [CANARY_UPLOAD_COMMAND]: failure } : {}),
      ...(failurePoint === "version lookup"
        ? {
            "pnpm exec wrangler versions list --json": [
              JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
              failure,
            ],
          }
        : {}),
      ...(failurePoint === "stage" ? { [CANARY_STAGE_COMMAND]: failure } : {}),
      ...(failurePoint === "canary" ? { [smokeCommand]: failure } : {}),
      ...(failurePoint === "promotion" ? { [CANARY_PROMOTE_COMMAND]: failure } : {}),
      ...(restoreFails ? { [CANARY_RESTORE_COMMAND]: new Error("restore failed") } : {}),
    };
    const runCommand = successfulRunner(overrides);
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 1;
    if (failurePoint === "artifact") {
      deps.readPublicWorkerVersion
        .mockResolvedValueOnce(CANDIDATE_VERSION)
        .mockResolvedValueOnce(PREVIOUS_VERSION);
      deps.writeReleaseArtifact.mockRejectedValueOnce(failure);
    } else {
      deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);
    }

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(failureMessage);
    if (restoreFails) expect((rejection as Error).message).toContain("Rollback failed: restore failed.");
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      ...(afterStage ? [CANARY_STAGE_COMMAND] : []),
      ...(promotionAttempted ? [CANARY_PROMOTE_COMMAND] : []),
      ...(afterStage ? [CANARY_RESTORE_COMMAND] : []),
    ]);
    expect(recordedCommands(runCommand)).not.toContain(D1_APPLY_COMMAND);

    const phase = {
      upload: "version_upload",
      "version lookup": "version_lookup",
      stage: "stage",
      canary: "canary",
      promotion: "promote",
      convergence: "verify_promotion",
      artifact: "artifact",
    }[failurePoint];
    const failureArtifact = {
      status: restoreFails ? "rollback_failed" : (afterStage ? "rolled_back" : "failed_before_stage"),
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase,
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      ...(afterStage ? { candidateVersionId: CANDIDATE_VERSION } : {}),
      failure: failureMessage,
      ...(restoreFails ? { rollbackFailure: "restore failed" } : {}),
    };
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(failurePoint === "artifact" ? 2 : 1);
    if (failurePoint === "artifact") {
      expect(deps.writeReleaseArtifact).toHaveBeenNthCalledWith(1, {
        status: "promoted",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "complete",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
      });
      expect(deps.writeReleaseArtifact).toHaveBeenNthCalledWith(2, failureArtifact);
    } else {
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(failureArtifact);
    }
  });

  it("records migration review failures before any D1 mutation", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    deps.readMigrationFile.mockRejectedValueOnce(new Error("migration file unavailable"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("migration file unavailable");
    expect(recordedCommands(runCommand)).toEqual([
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm run deploy:preflight",
      "pnpm run build",
      "git status --porcelain --untracked-files=no",
      "pnpm exec wrangler d1 migrations list DB --remote",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "migration_review",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
      failure: "migration file unavailable",
    });
  });

  it("fails closed on a newest-deployment timestamp tie before any mutation", async () => {
    const failure = "Newest production deployments have an ambiguous timestamp tie.";
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": JSON.stringify([
        {
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
        },
        {
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }],
        },
      ]),
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);

    expect(recordedCommands(runCommand)).toEqual([
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm run deploy:preflight",
      "pnpm run build",
      "git status --porcelain --untracked-files=no",
      "pnpm exec wrangler d1 migrations list DB --remote",
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "current_deployment",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
      failure,
    });
  });

  it("records that D1 may have changed when migration apply fails", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations apply DB --remote": new Error("second migration failed"),
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("second migration failed");
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([D1_APPLY_COMMAND]);

    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "migration_apply",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "failed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      failure: "second migration failed",
    });
  });

  it("stops canary release after D1 when the full post-migration preflight fails", async () => {
    const runCommand = successfulRunner({
      "pnpm run deploy:preflight": ["", new Error("full preflight failed")],
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("full preflight failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([D1_APPLY_COMMAND]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "full_preflight",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      failure: "full preflight failed",
    });
  });

  it("records failures after finding the prior version without inventing a candidate", async () => {
    const uploadCommand = `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`;
    const runCommand = successfulRunner({ [uploadCommand]: new Error("upload failed") });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("upload failed");
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      uploadCommand,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "version_upload",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      failure: "upload failed",
    });
  });

  it("rejects release inventory that omits the active version before mutation", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler versions list --json": [
        "[]",
        JSON.stringify([workerVersion(PREVIOUS_VERSION, RELEASE_SHA)]),
      ],
    });
    const deps = releaseDeps(runCommand);

    const failure = "Active Worker version is missing from Worker version inventory.";
    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);
    expect(recordedCommands(runCommand)).toEqual([
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm run deploy:preflight",
      "pnpm run build",
      "git status --porcelain --untracked-files=no",
      "pnpm exec wrangler d1 migrations list DB --remote",
      "pnpm exec wrangler deployments list --json",
      "pnpm exec wrangler versions list --json",
    ]);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "active_version_mapping",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      failure,
    });
  });

  it("redacts sensitive failure text and bounds artifacts", async () => {
    const failure = new Error(
      `Bearer bearer-value token=token-value password:password-value api_key=api-value ` +
      `aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc d1-secret workers-secret ` +
      `${"x".repeat(600)}\nnext`,
    );
    const runCommand = successfulRunner({ "pnpm run deploy:preflight": failure });
    const deps = releaseDeps(runCommand);

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    const artifact = deps.writeReleaseArtifact.mock.calls[0]?.[0];
    expect(artifact.failure).not.toMatch(
      /bearer-value|token-value|password-value|api-value|aaaaaa|d1-secret|workers-secret/,
    );
    expect(artifact.failure?.length).toBeLessThanOrEqual(500);
    expect(artifact.failure).not.toContain("\n");
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).not.toMatch(/d1-secret|workers-secret/);
  });

  it("sanitizes a non-Error thrown value", async () => {
    const runCommand = vi.fn<ReleaseCommandRunner>(async () => {
      throw "secret=plain-value";
    });
    const deps = releaseDeps(runCommand);

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe("secret=[REDACTED]");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      failure: "secret=[REDACTED]",
    }));
  });

  it("reports when a pre-stage failure artifact cannot be written", async () => {
    const runCommand = successfulRunner({
      "pnpm run build": new Error("build failed d1-secret"),
    });
    const deps = releaseDeps(runCommand);
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error("disk unavailable workers-secret"));

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "build failed [REDACTED] Release artifact write also failed: disk unavailable [REDACTED]",
    );
    expect((rejection as Error).message).not.toMatch(/d1-secret|workers-secret/);
    expect(deps.writeReleaseArtifact.mock.calls[0]?.[0].failure).toBe(
      "build failed [REDACTED]",
    );
  });

  it("rolls back a promoted candidate if the success artifact cannot be written", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z"),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(CANDIDATE_VERSION)
      .mockResolvedValueOnce(PREVIOUS_VERSION);
    deps.writeReleaseArtifact
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("disk unavailable");
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(2);
    expect(deps.writeReleaseArtifact).toHaveBeenNthCalledWith(1, {
      status: "promoted",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    });
    expect(deps.writeReleaseArtifact).toHaveBeenNthCalledWith(2, {
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "artifact",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "disk unavailable",
    });
  });

  it("reports when the rolled-back failure artifact cannot be written", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "canary failed Release artifact write also failed: disk unavailable",
    );
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "canary",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "canary failed",
    });
  });

  it("records a rollback command failure", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const rollbackCommand = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      [rollbackCommand]: new Error("rollback failed"),
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed: rollback failed");
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      rollbackCommand,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rollback_failed",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "canary",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "canary failed",
      rollbackFailure: "rollback failed",
    });
  });

  it("restores the prior version after an ambiguous promotion-command failure", async () => {
    const runCommand = successfulRunner({
      [CANARY_PROMOTE_COMMAND]: new Error("promotion failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("promotion failed");

    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rolled_back",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "promote",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "promotion failed",
    });
  });

  it.each(["restore command", "restore convergence"] as const)(
    "records rollback failure after promotion fails and %s fails",
    async (failurePoint) => {
      const rollbackFailure = failurePoint === "restore command"
        ? "restore failed"
        : `Production version did not converge to ${PREVIOUS_VERSION}.`;
      const runCommand = successfulRunner({
        [CANARY_PROMOTE_COMMAND]: new Error("promotion failed"),
        ...(failurePoint === "restore command"
          ? { [CANARY_RESTORE_COMMAND]: new Error("restore failed") }
          : {}),
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
          deploymentPayload(CANDIDATE_VERSION),
        ],
      });
      const deps = releaseDeps(runCommand);
      deps.verificationAttempts = 1;
      deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

      expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
        D1_APPLY_COMMAND,
        CANARY_UPLOAD_COMMAND,
        CANARY_STAGE_COMMAND,
        CANARY_PROMOTE_COMMAND,
        CANARY_RESTORE_COMMAND,
      ]);
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "promote",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "promotion failed",
        rollbackFailure,
      });
    },
  );

  it("reports both rollback and artifact failures", async () => {
    const promoteCommand = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`;
    const rollbackCommand = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      [promoteCommand]: new Error("promotion failed d1-secret"),
      [rollbackCommand]: new Error("rollback failed workers-secret"),
    });
    const deps = releaseDeps(runCommand);
    deps.writeReleaseArtifact.mockRejectedValueOnce(
      new Error("artifact failed d1-secret workers-secret"),
    );

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "promotion failed [REDACTED] Rollback failed: rollback failed [REDACTED]. " +
      "Release artifact write also failed: artifact failed [REDACTED] [REDACTED]",
    );
    expect((rejection as Error).message).not.toMatch(/d1-secret|workers-secret/);
    expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
      D1_APPLY_COMMAND,
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      promoteCommand,
      rollbackCommand,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "rollback_failed",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "promote",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "promotion failed [REDACTED]",
      rollbackFailure: "rollback failed [REDACTED]",
    });
  });
});

describe("execFile command adapter", () => {
  it("returns stdout and stderr without using a shell", async () => {
    const execFile = vi.fn((command, args, options, callback) => {
      expect(command).toBe("pnpm");
      expect(args).toEqual(["run", "build"]);
      expect(options).toEqual({ encoding: "utf8", env: { PATH: "/bin" }, maxBuffer: 16 * 1024 * 1024 });
      callback(null, "built", "notice");
    });
    const runner = createReleaseCommandRunner(execFile);

    await expect(runner("pnpm", ["run", "build"], { env: { PATH: "/bin" } })).resolves.toEqual({
      stdout: "built",
      stderr: "notice",
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["numeric", Object.assign(new Error("failed"), { code: 7 }), "exit code 7"],
    ["string", Object.assign(new Error("failed"), { code: "ENOENT" }), "exit code ENOENT"],
    ["missing", new Error("failed"), "exit code unknown"],
  ])("returns a safe command error for a %s exit code", async (_label, error, message) => {
    const runner = createReleaseCommandRunner((_command, _args, _options, callback) => {
      callback(error, "sensitive stdout", "sensitive stderr");
    });

    await expect(runner("pnpm", ["run", "build"])).rejects.toThrow(message);
    await expect(runner("pnpm", ["run", "build"])).rejects.not.toThrow(/sensitive/);
  });

  it("constructs the default execFile-backed runner without invoking it", () => {
    expect(createReleaseCommandRunner()).toBeTypeOf("function");
  });
});

describe("release artifact and CLI boundary", () => {
  it("reads the public Worker version without following redirects or accepting malformed headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", {
      headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
      status: 200,
    }));

    await expect(readPublicWorkerVersion("https://spoonjoy.app/path", fetchImpl)).resolves.toBe(CANDIDATE_VERSION);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toMatch(/^https:\/\/spoonjoy\.app\/health\?release_verification=\d+$/);
    expect(options).toEqual({
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
    });

    await expect(readPublicWorkerVersion("https://spoonjoy.app", async () => (
      new Response("{}", { headers: { "X-Spoonjoy-Worker-Version": "latest" }, status: 200 })
    ))).rejects.toThrow(/valid Worker version/i);
    await expect(readPublicWorkerVersion("https://spoonjoy.app", async () => (
      new Response("{}", { headers: { "X-Spoonjoy-Worker-Version": "" }, status: 200 })
    ))).rejects.toThrow(/valid Worker version/i);
    await expect(readPublicWorkerVersion("https://spoonjoy.app", async () => (
      new Response("{}", { status: 200 })
    ))).resolves.toBeNull();
    await expect(readPublicWorkerVersion("https://spoonjoy.app", async () => (
      new Response("nope", { status: 503 })
    ))).rejects.toThrow("HTTP 503");
  });

  it("writes only the sanitized artifact schema", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-artifact-"));
    try {
      const artifact = {
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: "d".repeat(40),
        phase: "canary",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "Bearer visible token=value\nnext",
        rollbackFailure: "password=visible",
        extraSecret: "must-not-be-written",
      } as ReleaseArtifact & {
        deploymentStrategy: "gradual";
        extraSecret: string;
        protocolV1BoundarySha: string;
        releaseMode: "protocol-v1-canary";
      };

      await writeReleaseArtifactFile(artifactDir, artifact);
      const payload = JSON.parse(await readFile(path.join(artifactDir, "production-release.json"), "utf8")) as Record<string, unknown>;

      expect(payload).toEqual({
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: "d".repeat(40),
        phase: "canary",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "Bearer [REDACTED] token=[REDACTED] next",
        rollbackFailure: "password=[REDACTED]",
      });
      expect(payload).not.toHaveProperty("extraSecret");

      await writeReleaseArtifactFile(artifactDir, {
        status: "forward_repair_required",
        sourceSha: RELEASE_SHA,
        releaseMode: "atomic-bootstrap",
        deploymentStrategy: "atomic",
        phase: "migration_apply",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "failed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure: "migration apply failed",
      } as ReleaseArtifact & {
        deploymentStrategy: "atomic";
        releaseMode: "atomic-bootstrap";
      });
      const minimal = JSON.parse(await readFile(path.join(artifactDir, "production-release.json"), "utf8"));
      expect(minimal).toEqual({
        status: "forward_repair_required",
        sourceSha: RELEASE_SHA,
        releaseMode: "atomic-bootstrap",
        deploymentStrategy: "atomic",
        phase: "migration_apply",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "failed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure: "migration apply failed",
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("accepts every exact lifecycle tuple and enforces its field contract", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-lifecycle-matrix-"));
    const canaryBase = {
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      reviewedMigrations: [] as string[],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
    };
    const completeBase = {
      ...canaryBase,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    };
    const zeroMigrationCompleteBase = {
      ...completeBase,
      reviewedMigrations: [],
      migrationApply: "not_needed",
    };
    const rollbackFailurePhases = [
      "stage", "canary", "promote", "verify_promotion", "artifact",
    ] as const;
    const earlyFailurePhases = [
      "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
      "migration_list", "migration_review", "current_deployment", "version_snapshot",
      "migration_apply", "full_preflight", "version_upload", "version_lookup",
    ] as const;
    const validArtifacts: Array<Record<string, unknown>> = [
      { ...completeBase, status: "promoted" },
      { ...zeroMigrationCompleteBase, status: "promoted" },
      {
        ...completeBase,
        status: "rollback_promoted",
        reviewedMigrations: [],
        migrationApply: "not_needed",
      },
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).map((releaseMode) => ({
        ...completeBase,
        status: "promoted",
        releaseMode,
        deploymentStrategy: "atomic",
        protocolV1BoundarySha: undefined,
      })),
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).map((releaseMode) => ({
        ...zeroMigrationCompleteBase,
        status: "promoted",
        releaseMode,
        deploymentStrategy: "atomic",
        protocolV1BoundarySha: undefined,
      })),
      ...earlyFailurePhases.map((phase) => ({
        ...canaryBase,
        status: "failed_before_stage",
        phase,
        failure: `${phase} failed`,
        ...(!["validate", "provenance"].includes(phase) ? { treeHash: TREE_HASH } : {}),
        ...(["version_snapshot", "migration_apply", "full_preflight", "version_upload", "version_lookup"]
          .includes(phase) ? { previousVersionId: PREVIOUS_VERSION } : {}),
        ...(["migration_apply", "full_preflight", "version_upload", "version_lookup"].includes(phase)
          ? { reviewedMigrations: ["0024_add_release_marker.sql"] }
          : {}),
        ...(phase === "migration_review"
          ? { reviewedMigrations: ["0024_add_release_marker.sql"] }
          : {}),
        ...(phase === "migration_apply"
          ? { migrationApply: "failed" }
          : (["full_preflight", "version_upload", "version_lookup"].includes(phase)
              ? { migrationApply: "succeeded" }
              : {})),
      })),
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_version_lookup",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        failure: "rollback target was not found",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_current_deployment",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        candidateVersionId: CANDIDATE_VERSION,
        failure: "current deployment was invalid",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_already_active",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        previousVersionId: CANDIDATE_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "rollback target is already active",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "protocol_ancestry",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        previousVersionId: PREVIOUS_VERSION,
        failure: "release source predates protocol v1",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_protocol_ancestry",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "rollback target predates protocol v1",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "active_version_mapping",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        previousVersionId: PREVIOUS_VERSION,
        failure: "active version mapping failed",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_active_version_mapping",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "active version mapping failed",
      },
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).flatMap((releaseMode) =>
        earlyFailurePhases
          .filter((phase) => [
            "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
            "migration_list", "migration_review", "current_deployment", "version_snapshot",
          ].includes(phase))
          .map((phase) => ({
            ...canaryBase,
            status: "failed_before_stage",
            releaseMode,
            deploymentStrategy: "atomic",
            protocolV1BoundarySha: undefined,
            phase,
            failure: `${phase} failed`,
            ...(!["validate", "provenance"].includes(phase) ? { treeHash: TREE_HASH } : {}),
            ...(phase === "version_snapshot" ? { previousVersionId: PREVIOUS_VERSION } : {}),
            ...(phase === "migration_review"
              ? { reviewedMigrations: ["0024_add_release_marker.sql"] }
              : {}),
          })),
      ),
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).map((releaseMode) => ({
        sourceSha: RELEASE_SHA,
        status: "failed_before_stage",
        releaseMode,
        deploymentStrategy: "atomic",
        phase: "full_preflight",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure: "full preflight failed",
      })),
      ...(["version_upload", "version_lookup"] as const).map((phase) => ({
        ...canaryBase,
        status: "failed_before_stage",
        phase,
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
        failure: `${phase} failed`,
      })),
      ...rollbackFailurePhases.flatMap((phase) =>
        [completeBase, zeroMigrationCompleteBase].flatMap((migrationBase) => [
          {
            ...migrationBase,
            status: "rolled_back",
            phase,
            failure: `${phase} failed`,
          },
          {
            ...migrationBase,
            status: "rollback_failed",
            phase,
            failure: `${phase} failed`,
            rollbackFailure: "restore failed",
          },
        ])),
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "full_preflight",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
        failure: "preflight failed",
      },
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).flatMap((releaseMode) =>
        ([
          ["migration_apply", "failed", false],
          ["full_preflight", "succeeded", false],
          ["atomic_deploy", "succeeded", false],
          ["version_lookup", "succeeded", false],
          ["verify_promotion", "succeeded", true],
          ["artifact", "succeeded", true],
          ...(releaseMode === "atomic-bootstrap"
            ? [["bootstrap_probe", "succeeded", true] as const]
            : []),
        ] as const).map(([phase, migrationApply, needsCandidate]) => ({
          sourceSha: RELEASE_SHA,
          status: "forward_repair_required",
          releaseMode,
          deploymentStrategy: "atomic",
          phase,
          treeHash: TREE_HASH,
          reviewedMigrations: migrationApply === "not_needed"
            ? []
            : ["0024_add_release_marker.sql"],
          migrationApply,
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          ...(needsCandidate ? { candidateVersionId: CANDIDATE_VERSION } : {}),
          failure: `${phase} failed`,
        })),
      ),
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).flatMap((releaseMode) =>
        ([
          ["atomic_deploy", false],
          ["version_lookup", false],
          ["verify_promotion", true],
          ["artifact", true],
          ...(releaseMode === "atomic-bootstrap"
            ? [["bootstrap_probe", true] as const]
            : []),
        ] as const).map(([phase, needsCandidate]) => ({
          sourceSha: RELEASE_SHA,
          status: "forward_repair_required",
          releaseMode,
          deploymentStrategy: "atomic",
          phase,
          treeHash: TREE_HASH,
          reviewedMigrations: [],
          migrationApply: "not_needed",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          ...(needsCandidate ? { candidateVersionId: CANDIDATE_VERSION } : {}),
          failure: `${phase} failed`,
        })),
      ),
    ];
    const fieldValues = {
      treeHash: TREE_HASH,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "failure",
      rollbackFailure: "rollback failure",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
    };

    try {
      for (const artifact of validArtifacts) {
        await expect(writeReleaseArtifactFile(
          artifactDir,
          artifact as unknown as ReleaseArtifact,
        )).resolves.toBeUndefined();

        for (const field of Object.keys(fieldValues) as Array<keyof typeof fieldValues>) {
          const mutation = { ...artifact };
          if (artifact[field] === undefined) mutation[field] = fieldValues[field];
          else delete mutation[field];
          await expect(writeReleaseArtifactFile(
            artifactDir,
            mutation as unknown as ReleaseArtifact,
          )).rejects.toThrow("lifecycle");
        }
      }
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("rejects contradictory release lifecycle artifacts before writing", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-invalid-lifecycle-"));
    const canarySuccess = {
      status: "promoted",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    };
    const rolledBack = {
      ...canarySuccess,
      status: "rolled_back",
      phase: "canary",
      failure: "canary failed",
    };
    const rollbackFailed = {
      ...rolledBack,
      status: "rollback_failed",
      rollbackFailure: "restore failed",
    };
    const failedBeforeStage = {
      status: "failed_before_stage",
      sourceSha: RELEASE_SHA,
      releaseMode: "protocol-v1-canary",
      deploymentStrategy: "gradual",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      phase: "validate",
      reviewedMigrations: [],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
      failure: "invalid input",
    };
    const atomicBase = {
      status: "forward_repair_required",
      sourceSha: RELEASE_SHA,
      releaseMode: "atomic-bootstrap",
      deploymentStrategy: "atomic",
      phase: "migration_apply",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "failed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      failure: "migration failed",
    };
    const rollbackPromoted = {
      ...canarySuccess,
      status: "rollback_promoted",
      reviewedMigrations: [],
      migrationApply: "not_needed",
    };
    const failedMigrationApply = {
      ...failedBeforeStage,
      phase: "migration_apply",
      treeHash: TREE_HASH,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "failed",
      previousVersionId: PREVIOUS_VERSION,
      failure: "migration apply failed",
    };
    const failedFullPreflight = {
      ...failedMigrationApply,
      phase: "full_preflight",
      migrationApply: "succeeded",
      failure: "preflight failed",
    };
    const forwardFullPreflight = {
      ...atomicBase,
      phase: "full_preflight",
      migrationApply: "succeeded",
      failure: "preflight failed",
    };
    const allPhases = [
      "validate",
      "provenance",
      "initial_preflight",
      "build",
      "post_build_provenance",
      "migration_list",
      "migration_review",
      "migration_apply",
      "full_preflight",
      "current_deployment",
      "version_snapshot",
      "version_upload",
      "version_lookup",
      "rollback_version_lookup",
      "rollback_current_deployment",
      "rollback_already_active",
      "protocol_ancestry",
      "rollback_protocol_ancestry",
      "active_version_mapping",
      "rollback_active_version_mapping",
      "stage",
      "canary",
      "promote",
      "atomic_deploy",
      "verify_promotion",
      "verify_rollback",
      "bootstrap_probe",
      "artifact",
      "complete",
    ] as const;
    const allowedPhases = {
      promoted: ["complete"],
      rollback_promoted: ["complete"],
      failed_before_stage: [
        "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
        "migration_list", "migration_review", "migration_apply", "full_preflight",
        "current_deployment", "version_snapshot", "version_upload", "version_lookup",
        "rollback_version_lookup", "rollback_current_deployment", "rollback_already_active",
        "protocol_ancestry", "rollback_protocol_ancestry",
        "active_version_mapping", "rollback_active_version_mapping",
      ],
      rolled_back: ["stage", "canary", "promote", "verify_promotion", "artifact"],
      rollback_failed: ["stage", "canary", "promote", "verify_promotion", "artifact"],
      forward_repair_required: [
        "migration_apply", "full_preflight", "atomic_deploy", "version_lookup",
        "verify_promotion", "bootstrap_probe", "artifact",
      ],
    } as const;
    const baseByStatus = {
      promoted: canarySuccess,
      rollback_promoted: rollbackPromoted,
      failed_before_stage: failedBeforeStage,
      rolled_back: rolledBack,
      rollback_failed: rollbackFailed,
      forward_repair_required: atomicBase,
    };
    const invalidArtifacts = [
      ...(["rollback_promoted", "rolled_back", "rollback_failed"] as const).map((status) => ({
        ...atomicBase,
        status,
      })),
      {
        ...atomicBase,
        status: "forward_repair_required",
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      },
      { ...atomicBase, status: "promoted", phase: "artifact" },
      { ...atomicBase, phase: "complete" },
      { ...atomicBase, protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA },
      {
        ...atomicBase,
        status: "rolled_back",
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
      },
      { ...atomicBase, deploymentStrategy: "gradual" },
      { ...atomicBase, treeHash: undefined },
      { ...atomicBase, previousVersionId: undefined },
      { ...atomicBase, reviewedMigrations: [] },
      { ...atomicBase, sourceSha: "main" },
      { ...atomicBase, treeHash: "tree" },
      { ...atomicBase, previousVersionId: "latest" },
      { ...atomicBase, candidateVersionId: CANDIDATE_VERSION },
      { ...atomicBase, failure: undefined },
      { ...atomicBase, rollbackFailure: "not allowed" },
      { ...atomicBase, failure: "" },
      {
        ...failedBeforeStage,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        failure: "migration provenance appeared before discovery",
      },
      {
        ...failedBeforeStage,
        phase: "migration_review",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        failure: "migration review has no discovered migration",
      },
      {
        ...failedBeforeStage,
        phase: "rollback_already_active",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "distinct IDs contradict already-active state",
      },
      { ...atomicBase, reviewedMigrations: ["not-a-migration.txt"] },
      { ...atomicBase, reviewedMigrations: ["0024_bad..name.sql"] },
      { ...atomicBase, reviewedMigrations: [
        "0024_add_release_marker.sql",
        "0024_add_release_marker.sql",
      ] },
      { ...atomicBase, migrationApply: "succeeded" },
      {
        ...atomicBase,
        phase: "full_preflight",
        reviewedMigrations: [],
        migrationApply: "not_needed",
      },
      {
        ...atomicBase,
        releaseMode: "atomic-product-activation",
        phase: "bootstrap_probe",
        migrationApply: "succeeded",
        candidateVersionId: CANDIDATE_VERSION,
      },
      {
        ...atomicBase,
        phase: "version_lookup",
        migrationApply: "succeeded",
        candidateVersionId: CANDIDATE_VERSION,
      },
      { ...canarySuccess, sourceSha: RELEASE_SHA.toUpperCase() },
      { ...canarySuccess, protocolV1BoundarySha: "main" },
      { ...canarySuccess, treeHash: "tree" },
      { ...canarySuccess, previousVersionId: "previous" },
      { ...canarySuccess, candidateVersionId: "candidate" },
      { ...canarySuccess, candidateVersionId: PREVIOUS_VERSION },
      {
        ...canarySuccess,
        previousVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        candidateVersionId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      { ...canarySuccess, treeHash: undefined },
      { ...canarySuccess, previousVersionId: undefined },
      { ...canarySuccess, candidateVersionId: undefined },
      { ...canarySuccess, failure: "not allowed" },
      { ...canarySuccess, rollbackFailure: "not allowed" },
      { ...canarySuccess, migrationApply: "failed" },
      { ...canarySuccess, reviewedMigrations: [], migrationApply: "succeeded" },
      { ...canarySuccess, migrationApply: "not_needed" },
      { ...rollbackPromoted, failure: "not allowed" },
      { ...rollbackPromoted, rollbackFailure: "not allowed" },
      { ...rollbackPromoted, migrationApply: "succeeded" },
      { ...rollbackPromoted, reviewedMigrations: ["0024_add_release_marker.sql"] },
      { ...rolledBack, failure: undefined },
      { ...rolledBack, failure: "" },
      { ...rolledBack, previousVersionId: undefined },
      { ...rolledBack, candidateVersionId: undefined },
      { ...rolledBack, rollbackFailure: "not allowed" },
      { ...rolledBack, migrationApply: "failed" },
      { ...rollbackFailed, failure: undefined },
      { ...rollbackFailed, rollbackFailure: undefined },
      { ...rollbackFailed, rollbackFailure: "" },
      { ...rollbackFailed, previousVersionId: undefined },
      { ...rollbackFailed, candidateVersionId: undefined },
      { ...rollbackFailed, migrationApply: "failed" },
      { ...failedBeforeStage, failure: undefined },
      { ...failedBeforeStage, treeHash: TREE_HASH },
      { ...failedBeforeStage, previousVersionId: PREVIOUS_VERSION },
      { ...failedBeforeStage, candidateVersionId: CANDIDATE_VERSION },
      { ...failedBeforeStage, rollbackFailure: "not allowed" },
      { ...failedBeforeStage, migrationApply: "succeeded" },
      { ...failedMigrationApply, migrationApply: "succeeded" },
      { ...failedMigrationApply, reviewedMigrations: [] },
      { ...failedFullPreflight, migrationApply: "failed" },
      { ...forwardFullPreflight, migrationApply: "failed" },
      { ...canarySuccess, phase: "banana" },
      ...Object.entries(baseByStatus).flatMap(([status, artifact]) =>
        allPhases
          .filter((phase) => !(allowedPhases[status as keyof typeof allowedPhases] as readonly string[])
            .includes(phase))
          .map((phase) => ({ ...artifact, phase })),
      ),
    ];

    try {
      for (const artifact of invalidArtifacts) {
        await expect(writeReleaseArtifactFile(
          artifactDir,
          artifact as unknown as ReleaseArtifact,
        )).rejects.toThrow("lifecycle");
      }
      await expect(readFile(
        path.join(artifactDir, "production-release.json"),
        "utf8",
      )).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("parses environment defaults and explicit CLI overrides", () => {
    expect(parseReleaseCliOptions([], {
      SOURCE_SHA: RELEASE_SHA,
      SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
    })).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      releaseMode: "atomic-bootstrap",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([], {
      GITHUB_SHA: RELEASE_SHA,
      SPOONJOY_RELEASE_MODE: "atomic-product-activation",
    })).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      releaseMode: "atomic-product-activation",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([
      "--artifact-dir", "custom-artifacts",
      "--release-mode", "atomic-product-activation",
      "--source-sha", RELEASE_SHA,
    ], { SOURCE_SHA: "b".repeat(40) })).toEqual({
      artifactDir: "custom-artifacts",
      releaseMode: "atomic-product-activation",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([
      "--source-sha", RELEASE_SHA,
      "--release-mode", "protocol-v1-canary",
      "--rollback-version-id", CANDIDATE_VERSION,
    ], { SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA })).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary",
      releaseSha: RELEASE_SHA,
      rollbackVersionId: CANDIDATE_VERSION,
    });
  });

  it.each([
    ["a missing SHA", [], { SPOONJOY_RELEASE_MODE: "atomic-bootstrap" }, "40-character"],
    ["a missing source value", ["--source-sha"], { SPOONJOY_RELEASE_MODE: "atomic-bootstrap" }, "--source-sha requires"],
    ["a source value that is another option", ["--source-sha", "--artifact-dir"], { SPOONJOY_RELEASE_MODE: "atomic-bootstrap" }, "--source-sha requires"],
    ["a missing artifact value", ["--artifact-dir"], { SOURCE_SHA: RELEASE_SHA, SPOONJOY_RELEASE_MODE: "atomic-bootstrap" }, "--artifact-dir requires"],
    ["an invalid rollback version", ["--rollback-version-id", "latest"], {
      SOURCE_SHA: RELEASE_SHA,
      SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
      SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
    }, "Rollback version"],
    ["an unknown option", ["--wat"], { SOURCE_SHA: RELEASE_SHA, SPOONJOY_RELEASE_MODE: "atomic-bootstrap" }, "Unknown production release option"],
  ])("rejects %s", (_label, argv, env, expectedError) => {
    expect(() => parseReleaseCliOptions(argv, env)).toThrow(expectedError);
  });

  it("runs the CLI with an injected execFile implementation", async () => {
    vi.stubEnv("SOURCE_SHA", RELEASE_SHA);
    vi.stubEnv("SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA", PRODUCT_BOUNDARY_SHA);
    vi.stubEnv("SPOONJOY_RELEASE_MODE", "protocol-v1-canary");
    const responses: Record<string, string> = {
      "git rev-parse HEAD": RELEASE_SHA,
      "git status --porcelain --untracked-files=no": "",
      "git rev-parse HEAD^{tree}": TREE_HASH,
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
    };
    let versionListCalls = 0;
    let deploymentListCalls = 0;
    const execFileImpl = vi.fn((command, args, _options, callback) => {
      const key = commandKey(command, args);
      if (key === "pnpm exec wrangler deployments list --json") {
        deploymentListCalls += 1;
        callback(null, deploymentPayload(deploymentListCalls === 1 ? PREVIOUS_VERSION : CANDIDATE_VERSION), "");
        return;
      }
      if (key === "pnpm exec wrangler versions list --json") {
        versionListCalls += 1;
        callback(null, JSON.stringify(versionListCalls === 1
          ? [workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]
          : [
              workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
              workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
            ]), "");
        return;
      }
      callback(null, responses[key] ?? "", "");
    });
    const writeReleaseArtifact = vi.fn(async () => undefined);

    const result = await runProductionReleaseCli({
      argv: ["--release-mode", "protocol-v1-canary"],
      execFileImpl,
      readPublicWorkerVersion: async () => CANDIDATE_VERSION,
      readMigrationFile: async () => "CREATE TABLE Safe(id TEXT);",
      sleep: async () => undefined,
      writeReleaseArtifact,
    });

    expect(result.status).toBe("promoted");
    expect(execFileImpl).toHaveBeenCalled();
    expect(writeReleaseArtifact).toHaveBeenCalledWith("mcp-oauth-canary-artifacts", result);
  });

  it("routes an intentional rollback through current-main tooling", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });

    await expect(runProductionReleaseCli({
      argv: [
        "--source-sha", RELEASE_SHA,
        "--release-mode", "protocol-v1-canary",
        "--rollback-version-id", CANDIDATE_VERSION,
      ],
      env: {
        PATH: "/test/bin",
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
      },
      readPublicWorkerVersion: async () => CANDIDATE_VERSION,
      runCommand,
      sleep: async () => undefined,
      writeReleaseArtifact: async () => undefined,
    })).resolves.toMatchObject({ status: "rollback_promoted" });
  });

  it("uses the default public-version reader and delay in CLI verification", async () => {
    vi.useFakeTimers();
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
      "pnpm exec wrangler versions list --json": [
        JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
        JSON.stringify([
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        ]),
      ],
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("{}", {
        headers: { "X-Spoonjoy-Worker-Version": PREVIOUS_VERSION },
        status: 200,
      }))
      .mockResolvedValueOnce(new Response("{}", {
        headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchImpl);

    const release = runProductionReleaseCli({
      env: {
        SOURCE_SHA: RELEASE_SHA,
        PATH: "/test/bin",
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
        SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
      },
      runCommand,
      verificationAttempts: 2,
      writeReleaseArtifact: async () => undefined,
    });
    await vi.runAllTimersAsync();

    await expect(release).resolves.toMatchObject({ status: "promoted" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the default migration reader and artifact writer", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-cli-"));
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": JSON.stringify([{ Name: "0023_recipe_cover_prompt_lineage.sql" }]),
    });
    try {
      const result = await runProductionReleaseCli({
        argv: ["--artifact-dir", artifactDir],
        env: {
          SOURCE_SHA: RELEASE_SHA,
          PATH: "/test/bin",
          SPOONJOY_RELEASE_MODE: "atomic-product-activation",
        },
        readPublicWorkerVersion: async () => CANDIDATE_VERSION,
        runCommand,
        sleep: async () => undefined,
      });

      expect(result.status).toBe("promoted");
      const artifact = JSON.parse(await readFile(path.join(artifactDir, "production-release.json"), "utf8"));
      expect(artifact).toMatchObject({ status: "promoted", sourceSha: RELEASE_SHA });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  describe("source-controlled release lifecycle", () => {
    const READ_ONLY_RELEASE_COMMANDS = [
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm run deploy:preflight",
      "pnpm run build",
      "git status --porcelain --untracked-files=no",
      "pnpm exec wrangler d1 migrations list DB --remote",
      "pnpm exec wrangler deployments list --json",
      "pnpm exec wrangler versions list --json",
    ];
    const validProbeResult = {
      status: 200,
      workerVersionHeader: CANDIDATE_VERSION,
      body: {
        ok: true,
        storage: "sqlite",
        residue: 0,
        workerVersionId: CANDIDATE_VERSION,
      },
    };

    function atomicSuccessArtifact(
      releaseMode: "atomic-bootstrap" | "atomic-product-activation",
    ) {
      return {
        status: "promoted",
        sourceSha: RELEASE_SHA,
        releaseMode,
        deploymentStrategy: "atomic",
        phase: "complete",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
      };
    }

    function atomicDeployCommand(mode: "atomic-bootstrap" | "atomic-product-activation") {
      return `pnpm exec wrangler deploy --tag ${RELEASE_SHA} --message Spoonjoy ${mode} ${RELEASE_SHA}`;
    }

    function atomicCommandSequence(mode: "atomic-bootstrap" | "atomic-product-activation") {
      return [
        ...READ_ONLY_RELEASE_COMMANDS,
        D1_APPLY_COMMAND,
        "pnpm run deploy:preflight",
        atomicDeployCommand(mode),
        "pnpm exec wrangler versions list --json",
        "pnpm exec wrangler deployments list --json",
      ];
    }

    it.each(["atomic-bootstrap", "atomic-product-activation"] as const)(
      "completes zero-migration %s without a D1 write",
      async (mode) => {
        const runCommand = successfulRunner({
          "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
          [atomicDeployCommand(mode)]: "",
        });
        const readBootstrapProbe = vi.fn(async () => validProbeResult);
        const deps = {
          ...atomicReleaseDeps(runCommand, mode),
          readBootstrapProbe,
        };

        const result = await runProductionCanaryRelease(deps);

        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
          atomicDeployCommand(mode),
        ]);
        expect(result).toEqual({
          status: "promoted",
          sourceSha: RELEASE_SHA,
          releaseMode: mode,
          deploymentStrategy: "atomic",
          phase: "complete",
          treeHash: TREE_HASH,
          reviewedMigrations: [],
          migrationApply: "not_needed",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          candidateVersionId: CANDIDATE_VERSION,
        });
        expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
        expect(readBootstrapProbe).toHaveBeenCalledTimes(mode === "atomic-bootstrap" ? 2 : 0);
      },
    );

    it.each(["atomic-bootstrap", "atomic-product-activation"] as const)(
      "records zero-migration %s full-preflight failure before any remote write",
      async (mode) => {
        const failure = new Error("full preflight failed");
        const runCommand = successfulRunner({
          "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
          "pnpm run deploy:preflight": ["", failure],
        });
        const deps = atomicReleaseDeps(runCommand, mode);

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow("full preflight failed");

        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
          status: "failed_before_stage",
          sourceSha: RELEASE_SHA,
          releaseMode: mode,
          deploymentStrategy: "atomic",
          phase: "full_preflight",
          treeHash: TREE_HASH,
          reviewedMigrations: [],
          migrationApply: "not_needed",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          failure: "full preflight failed",
        });
      },
    );

    it.each(["atomic-bootstrap", "atomic-product-activation"] as const)(
      "routes %s D1 and Worker commands through disjoint credentials",
      async (mode) => {
        const runCommand = successfulRunner({ [atomicDeployCommand(mode)]: "" });
        const deps = {
          ...atomicReleaseDeps(runCommand, mode),
          readBootstrapProbe: vi.fn(async () => validProbeResult),
        };

        await runProductionCanaryRelease(deps);

        const d1Env = {
          PATH: "/test/bin",
          CLOUDFLARE_ACCOUNT_ID: "account-id",
          CLOUDFLARE_API_TOKEN: "d1-secret",
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
        };
        const workersEnv = {
          PATH: "/test/bin",
          CLOUDFLARE_ACCOUNT_ID: "account-id",
          CLOUDFLARE_API_TOKEN: "workers-secret",
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
        };
        const calls = runCommand.mock.calls.map(([command, args, options]) => ({
          key: commandKey(command, args),
          env: options?.env,
        }));
        for (const key of [
          "pnpm exec wrangler d1 migrations list DB --remote",
          D1_APPLY_COMMAND,
        ]) {
          expect(calls.filter((call) => call.key === key)).not.toHaveLength(0);
          for (const call of calls.filter((item) => item.key === key)) {
            expect(call.env).toEqual(d1Env);
          }
        }
        for (const key of [
          "pnpm exec wrangler deployments list --json",
          "pnpm exec wrangler versions list --json",
          atomicDeployCommand(mode),
        ]) {
          expect(calls.filter((call) => call.key === key)).not.toHaveLength(0);
          for (const call of calls.filter((item) => item.key === key)) {
            expect(call.env).toEqual(workersEnv);
          }
        }
      },
    );

    it("parses only explicit lifecycle modes and forbids rollback in atomic modes", () => {
      expect(parseReleaseCliOptions([
        "--release-mode", "atomic-bootstrap",
      ], { SOURCE_SHA: RELEASE_SHA })).toEqual({
        artifactDir: "mcp-oauth-canary-artifacts",
        releaseMode: "atomic-bootstrap",
        releaseSha: RELEASE_SHA,
      });
      expect(parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_RELEASE_MODE: "atomic-product-activation",
      })).toEqual({
        artifactDir: "mcp-oauth-canary-artifacts",
        releaseMode: "atomic-product-activation",
        releaseSha: RELEASE_SHA,
      });
      expect(parseReleaseCliOptions([
        "--release-mode", "protocol-v1-canary",
        "--protocol-v1-boundary-sha", PRODUCT_BOUNDARY_SHA,
      ], { SOURCE_SHA: RELEASE_SHA })).toEqual({
        artifactDir: "mcp-oauth-canary-artifacts",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        releaseMode: "protocol-v1-canary",
        releaseSha: RELEASE_SHA,
      });
      expect(parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
        SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
      })).toEqual({
        artifactDir: "mcp-oauth-canary-artifacts",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        releaseMode: "protocol-v1-canary",
        releaseSha: RELEASE_SHA,
      });

      expect(() => parseReleaseCliOptions([], { SOURCE_SHA: RELEASE_SHA })).toThrow(
        "release mode",
      );
      expect(() => parseReleaseCliOptions([
        "--release-mode", "gradual",
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("release mode");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "atomic-bootstrap",
        "--rollback-version-id", CANDIDATE_VERSION,
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("rollback");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "atomic-product-activation",
        "--rollback-version-id", CANDIDATE_VERSION,
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("rollback");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "atomic-bootstrap",
        "--protocol-v1-boundary-sha", PRODUCT_BOUNDARY_SHA,
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("boundary");
      expect(() => parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
        SPOONJOY_RELEASE_MODE: "atomic-product-activation",
      })).toThrow("boundary");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "atomic-bootstrap",
        "--release-mode", "atomic-product-activation",
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("duplicate");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "protocol-v1-canary",
        "--protocol-v1-boundary-sha", PRODUCT_BOUNDARY_SHA,
        "--protocol-v1-boundary-sha", RELEASE_SHA,
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("duplicate");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "protocol-v1-canary",
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("boundary");
      expect(() => parseReleaseCliOptions([
        "--release-mode", "protocol-v1-canary",
        "--protocol-v1-boundary-sha", "main",
      ], { SOURCE_SHA: RELEASE_SHA })).toThrow("boundary");
    });

    it.each(["missing", "unknown"] as const)(
      "rejects a %s direct release mode before any remote write",
      async (variant) => {
        const runCommand = successfulRunner();
        const { releaseMode: _omitted, ...withoutMode } = releaseDeps(runCommand);
        const deps = (
          variant === "missing" ? withoutMode : { ...withoutMode, releaseMode: "gradual" }
        ) as unknown as Parameters<typeof runProductionCanaryRelease>[0];

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow("release mode");
        expect(recordedCommands(runCommand)).toEqual([]);
        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).not.toHaveBeenCalled();
      },
    );

    it.each(["missing", "unknown"] as const)(
      "rejects a %s direct rollback mode before any remote write",
      async (variant) => {
        const runCommand = successfulRunner();
        const { releaseMode: _omitted, ...withoutMode } = rollbackDeps(runCommand);
        const deps = (
          variant === "missing" ? withoutMode : { ...withoutMode, releaseMode: "gradual" }
        ) as unknown as Parameters<typeof runProductionRollback>[0];

        await expect(runProductionRollback(deps)).rejects.toThrow("release mode");
        expect(recordedCommands(runCommand)).toEqual([]);
        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).not.toHaveBeenCalled();
      },
    );

    it.each([
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).flatMap((mode) =>
        [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map(
          (verificationAttempts) => [mode, verificationAttempts] as const,
        )
      ),
    ])(
      "rejects invalid %s verification attempt count %s before any command",
      async (mode, verificationAttempts) => {
        const runCommand = successfulRunner();
        const deps = atomicReleaseDeps(runCommand, mode);
        deps.verificationAttempts = verificationAttempts;

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow("positive integer");

        expect(recordedCommands(runCommand)).toEqual([]);
        expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
          status: "failed_before_stage",
          sourceSha: RELEASE_SHA,
          releaseMode: mode,
          deploymentStrategy: "atomic",
          phase: "validate",
          reviewedMigrations: [],
          migrationApply: "not_started",
          databaseRollbackSupported: false,
          failure: "Production verification attempts must be a positive integer.",
        });
      },
    );

    it("deploys the namespace bootstrap atomically and verifies its exact probe twice", async () => {
      const runCommand = successfulRunner({
        [`pnpm exec wrangler deploy --tag ${RELEASE_SHA} --message Spoonjoy atomic-bootstrap ${RELEASE_SHA}`]: "",
      });
      const readBootstrapProbe = vi.fn(async () => validProbeResult);
      const deps = {
        ...atomicReleaseDeps(runCommand, "atomic-bootstrap"),
        readBootstrapProbe,
      };

      const result = await runProductionCanaryRelease(deps);
      const commands = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));

      expect(result).toEqual(atomicSuccessArtifact("atomic-bootstrap"));
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
      expect(commands).toEqual(atomicCommandSequence("atomic-bootstrap"));
      expect(readBootstrapProbe).toHaveBeenCalledTimes(2);
      expect(readBootstrapProbe).toHaveBeenNthCalledWith(
        1,
        "https://spoonjoy.app",
        CANDIDATE_VERSION,
      );
      expect(readBootstrapProbe).toHaveBeenNthCalledWith(
        2,
        "https://spoonjoy.app",
        CANDIDATE_VERSION,
      );
      const verificationCommandIndex = commands.lastIndexOf(
        "pnpm exec wrangler deployments list --json",
      );
      expect(runCommand.mock.invocationCallOrder[verificationCommandIndex])
        .toBeLessThan(deps.readPublicWorkerVersion.mock.invocationCallOrder[0]);
      expect(deps.readPublicWorkerVersion.mock.invocationCallOrder[0])
        .toBeLessThan(readBootstrapProbe.mock.invocationCallOrder[0]);
      expect(readBootstrapProbe.mock.invocationCallOrder[0])
        .toBeLessThan(readBootstrapProbe.mock.invocationCallOrder[1]);
    });

    it("routes environment lifecycle state through the CLI and sends the exact public probe", async () => {
      const runCommand = successfulRunner({
        [atomicDeployCommand("atomic-bootstrap")]: "",
      });
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(validProbeResult.body, {
        headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
      }));
      vi.stubGlobal("fetch", fetchImpl);

      const result = await runProductionReleaseCli({
        env: {
          PATH: "/test/bin",
          SOURCE_SHA: RELEASE_SHA,
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
          SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
        },
        readMigrationFile: async () => "CREATE TABLE Safe(id TEXT);",
        readPublicWorkerVersion: async () => CANDIDATE_VERSION,
        runCommand,
        sleep: async () => undefined,
        writeReleaseArtifact: async () => undefined,
      });

      expect(result).toMatchObject({ releaseMode: "atomic-bootstrap", status: "promoted" });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      for (const [input, options] of fetchImpl.mock.calls) {
        expect(String(input)).toBe(
          "https://spoonjoy.app/.well-known/spoonjoy-cook-session-bootstrap",
        );
        expect(options).toEqual({
          cache: "no-store",
          headers: { Accept: "application/json" },
          method: "POST",
          redirect: "error",
        });
      }
    });

    it("rejects malformed JSON from the default public bootstrap reader", async () => {
      const runCommand = successfulRunner({
        [atomicDeployCommand("atomic-bootstrap")]: "",
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{", {
        headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
        status: 200,
      })));

      await expect(runProductionReleaseCli({
        env: {
          PATH: "/test/bin",
          SOURCE_SHA: RELEASE_SHA,
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
          SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
        },
        readMigrationFile: async () => "CREATE TABLE Safe(id TEXT);",
        readPublicWorkerVersion: async () => CANDIDATE_VERSION,
        runCommand,
        sleep: async () => undefined,
        writeReleaseArtifact: async () => undefined,
      })).rejects.toThrow("bootstrap probe");
      expect(remoteMutationCommands(
        runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
      )).toEqual([D1_APPLY_COMMAND, atomicDeployCommand("atomic-bootstrap")]);
    });

    it.each([
      ["HTTP status", () => Response.json(validProbeResult.body, {
        headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
        status: 503,
      })],
      ["missing version header", () => Response.json(validProbeResult.body)],
      ["wrong version header", () => Response.json(validProbeResult.body, {
        headers: { "X-Spoonjoy-Worker-Version": PREVIOUS_VERSION },
      })],
      ["mismatched body", () => Response.json({
        ...validProbeResult.body,
        workerVersionId: PREVIOUS_VERSION,
      }, {
        headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
      })],
    ] as const)("rejects either real HTTP observation with the wrong %s", async (
      _label,
      invalidResponse,
    ) => {
      for (const invalidCall of [1, 2]) {
        const runCommand = successfulRunner({
          [atomicDeployCommand("atomic-bootstrap")]: "",
        });
        const validResponse = () => Response.json(validProbeResult.body, {
          headers: { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
        });
        const fetchImpl = vi.fn<typeof fetch>();
        if (invalidCall === 1) {
          fetchImpl
            .mockResolvedValueOnce(invalidResponse())
            .mockResolvedValueOnce(validResponse());
        } else {
          fetchImpl
            .mockResolvedValueOnce(validResponse())
            .mockResolvedValueOnce(invalidResponse());
        }
        vi.stubGlobal("fetch", fetchImpl);

        await expect(runProductionReleaseCli({
          env: {
            PATH: "/test/bin",
            SOURCE_SHA: RELEASE_SHA,
            SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
            SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
          },
          readMigrationFile: async () => "CREATE TABLE Safe(id TEXT);",
          readPublicWorkerVersion: async () => CANDIDATE_VERSION,
          runCommand,
          sleep: async () => undefined,
          writeReleaseArtifact: async () => undefined,
        })).rejects.toThrow("bootstrap probe");
        expect(fetchImpl).toHaveBeenCalledTimes(invalidCall);
        expect(remoteMutationCommands(
          runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
        )).toEqual([D1_APPLY_COMMAND, atomicDeployCommand("atomic-bootstrap")]);
      }
    });

    it("activates the first protocol-v1 product atomically without the bootstrap probe", async () => {
      const runCommand = successfulRunner({
        [`pnpm exec wrangler deploy --tag ${RELEASE_SHA} --message Spoonjoy atomic-product-activation ${RELEASE_SHA}`]: "",
      });
      const readBootstrapProbe = vi.fn(async () => {
        throw new Error("bootstrap probe must be disabled");
      });
      const deps = {
        ...atomicReleaseDeps(runCommand, "atomic-product-activation"),
        readBootstrapProbe,
      };

      const result = await runProductionCanaryRelease(deps);
      const commands = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));

      expect(result).toEqual(atomicSuccessArtifact("atomic-product-activation"));
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
      expect(commands).toEqual(atomicCommandSequence("atomic-product-activation"));
      expect(readBootstrapProbe).not.toHaveBeenCalled();
    });

    it.each([
      ["HTTP status", { ...validProbeResult, status: 503 }],
      ["version header", { ...validProbeResult, workerVersionHeader: PREVIOUS_VERSION }],
      ["body version", {
        ...validProbeResult,
        body: { ...validProbeResult.body, workerVersionId: PREVIOUS_VERSION },
      }],
      ["storage kind", {
        ...validProbeResult,
        body: { ...validProbeResult.body, storage: "kv" },
      }],
      ["residue count", {
        ...validProbeResult,
        body: { ...validProbeResult.body, residue: 1 },
      }],
      ["exact body", {
        ...validProbeResult,
        body: { ...validProbeResult.body, unexpected: true },
      }],
      ["malformed body", { ...validProbeResult, body: null }],
    ])("rejects either bootstrap observation with the wrong %s", async (_label, probeResult) => {
      for (const invalidCall of [1, 2]) {
        const runCommand = successfulRunner({
          [atomicDeployCommand("atomic-bootstrap")]: "",
        });
        const readBootstrapProbe = vi.fn();
        if (invalidCall === 1) {
          readBootstrapProbe
            .mockResolvedValueOnce(probeResult)
            .mockResolvedValueOnce(validProbeResult);
        } else {
          readBootstrapProbe
            .mockResolvedValueOnce(validProbeResult)
            .mockResolvedValueOnce(probeResult);
        }
        const deps = {
          ...atomicReleaseDeps(runCommand, "atomic-bootstrap"),
          readBootstrapProbe,
        };

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow("bootstrap probe");
        expect(readBootstrapProbe).toHaveBeenCalledTimes(invalidCall);
        expect(remoteMutationCommands(
          runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
        )).toEqual([D1_APPLY_COMMAND, atomicDeployCommand("atomic-bootstrap")]);
      }
    });

    it.each([
      ["atomic-bootstrap", "no SHA-tagged version", [workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]],
      ["atomic-bootstrap", "multiple SHA-tagged versions", [
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion("33333333-3333-4333-8333-333333333333", RELEASE_SHA),
      ]],
      ["atomic-product-activation", "no SHA-tagged version", [workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]],
      ["atomic-product-activation", "multiple SHA-tagged versions", [
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion("33333333-3333-4333-8333-333333333333", RELEASE_SHA),
      ]],
    ] as const)("rejects %s with %s", async (mode, _label, versionsAfter) => {
      const runCommand = successfulRunner({
        [atomicDeployCommand(mode)]: "",
        "pnpm exec wrangler versions list --json": [
          JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
          JSON.stringify(versionsAfter),
        ],
      });
      const deps = {
        ...atomicReleaseDeps(runCommand, mode),
        readBootstrapProbe: vi.fn(async () => validProbeResult),
      };

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("exactly one new Worker version");
      expect(remoteMutationCommands(
        runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
      )).toEqual([D1_APPLY_COMMAND, atomicDeployCommand(mode)]);
    });

    it.each([
      ["atomic-bootstrap", "control plane"],
      ["atomic-bootstrap", "public version"],
      ["atomic-product-activation", "control plane"],
      ["atomic-product-activation", "public version"],
    ] as const)(
      "rejects %s when the %s disagrees",
      async (mode, mismatch) => {
        const runCommand = successfulRunner({
          [atomicDeployCommand(mode)]: "",
          "pnpm exec wrangler deployments list --json": mismatch === "control plane"
            ? [deploymentPayload(PREVIOUS_VERSION), deploymentPayload(PREVIOUS_VERSION)]
            : [deploymentPayload(PREVIOUS_VERSION), deploymentPayload(CANDIDATE_VERSION)],
        });
        const deps = {
          ...atomicReleaseDeps(runCommand, mode),
          readBootstrapProbe: vi.fn(async () => validProbeResult),
          readPublicWorkerVersion: vi.fn(async () => (
            mismatch === "public version" ? PREVIOUS_VERSION : CANDIDATE_VERSION
          )),
          verificationAttempts: 1,
        };

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow("did not converge");
        expect(remoteMutationCommands(
          runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
        )).toEqual([D1_APPLY_COMMAND, atomicDeployCommand(mode)]);
      },
    );

    it.each(["atomic-bootstrap", "atomic-product-activation"] as const)(
      "retries transient control-plane and public-version lag before completing %s",
      async (mode) => {
        for (const scenario of [
          "control mismatch",
          "control error",
          "public mismatch",
          "public error",
        ] as const) {
          const controlFails = scenario.startsWith("control");
          const runCommand = successfulRunner({
            [atomicDeployCommand(mode)]: "",
            "pnpm exec wrangler deployments list --json": [
              deploymentPayload(PREVIOUS_VERSION),
              controlFails
                ? (scenario === "control error"
                    ? new Error("control plane unavailable")
                    : deploymentPayload(PREVIOUS_VERSION))
                : deploymentPayload(CANDIDATE_VERSION),
              deploymentPayload(CANDIDATE_VERSION),
            ],
          });
          const readBootstrapProbe = vi.fn(async () => validProbeResult);
          const deps = {
            ...atomicReleaseDeps(runCommand, mode),
            readBootstrapProbe,
            verificationAttempts: 2,
          };
          if (scenario === "public error") {
            deps.readPublicWorkerVersion
              .mockRejectedValueOnce(new Error("edge unavailable"))
              .mockResolvedValueOnce(CANDIDATE_VERSION);
          } else if (scenario === "public mismatch") {
            deps.readPublicWorkerVersion
              .mockResolvedValueOnce(PREVIOUS_VERSION)
              .mockResolvedValueOnce(CANDIDATE_VERSION);
          }

          const result = await runProductionCanaryRelease(deps);
          const commands = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));

          expect(result).toEqual(atomicSuccessArtifact(mode));
          expect(commands.filter(
            (command) => command === "pnpm exec wrangler deployments list --json",
          )).toHaveLength(3);
          expect(deps.readPublicWorkerVersion).toHaveBeenCalledTimes(2);
          expect(deps.sleep).toHaveBeenCalledTimes(1);
          expect(remoteMutationCommands(commands)).toEqual([
            D1_APPLY_COMMAND,
            atomicDeployCommand(mode),
          ]);
          if (mode === "atomic-bootstrap") {
            expect(readBootstrapProbe).toHaveBeenCalledTimes(2);
            expect(deps.readPublicWorkerVersion.mock.invocationCallOrder[1])
              .toBeLessThan(readBootstrapProbe.mock.invocationCallOrder[0]);
          } else {
            expect(readBootstrapProbe).not.toHaveBeenCalled();
          }
        }
      },
    );

    it.each(["atomic-bootstrap", "atomic-product-activation"] as const)(
      "rejects direct %s execution with a protocol boundary",
      async (mode) => {
        const runCommand = successfulRunner();
        const deps = {
          ...atomicReleaseDeps(runCommand, mode),
          protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        };

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow("boundary");
        expect(recordedCommands(runCommand)).toEqual([]);
        expect(remoteMutationCommands(
          runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
        )).toEqual([]);
        expect(deps.writeReleaseArtifact).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["a missing", undefined],
      ["a malformed", "main"],
    ] as const)("rejects direct canary execution with %s protocol boundary", async (
      _label,
      protocolV1BoundarySha,
    ) => {
      const runCommand = successfulRunner();
      const deps = {
        ...releaseDepsWithoutBoundary(runCommand),
        protocolV1BoundarySha,
        releaseMode: "protocol-v1-canary" as const,
      };

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("boundary");
      expect(recordedCommands(runCommand)).toEqual([]);
      expect(remoteMutationCommands(
        runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
      )).toEqual([]);
      expect(deps.writeReleaseArtifact).not.toHaveBeenCalled();
    });

    it.each([
      ["protocol-v1-canary", undefined, "boundary"],
      ["protocol-v1-canary", "main", "boundary"],
      ["atomic-bootstrap", undefined, "rollback"],
      ["atomic-product-activation", undefined, "rollback"],
    ] as const)("rejects direct %s rollback with boundary %s", async (
      releaseMode,
      protocolV1BoundarySha,
      expectedError,
    ) => {
      const runCommand = successfulRunner();
      const deps = {
        ...rollbackDeps(runCommand),
        protocolV1BoundarySha,
        releaseMode,
      };

      await expect(runProductionRollback(deps)).rejects.toThrow(expectedError);
      expect(recordedCommands(runCommand)).toEqual([]);
      expect(remoteMutationCommands(
        runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
      )).toEqual([]);
      expect(deps.writeReleaseArtifact).not.toHaveBeenCalled();
    });

    it("allows gradual canary and rollback only above the protocol-v1 boundary", async () => {
      const runCommand = successfulRunner({
        "pnpm exec wrangler versions list --json": [
          JSON.stringify([
            workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA, "2026-07-15T00:00:00Z"),
          ]),
          JSON.stringify([
            workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA, "2026-07-15T00:00:00Z"),
            workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-07-15T00:01:00Z", 2),
          ]),
        ],
      });
      const deps = {
        ...releaseDeps(runCommand),
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        releaseMode: "protocol-v1-canary" as const,
      };

      const result = await runProductionCanaryRelease(deps);
      const commands = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));

      expect(result).toMatchObject({
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      });
      expect(commands).toEqual([
        ...READ_ONLY_RELEASE_COMMANDS,
        `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
        `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
        D1_APPLY_COMMAND,
        "pnpm run deploy:preflight",
        `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
        "pnpm exec wrangler versions list --json",
        `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
        `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
        `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
        "pnpm exec wrangler deployments list --json",
      ]);
    });

    it("fails closed before canary staging when the protocol boundary is absent", async () => {
      const runCommand = successfulRunner();
      const deps = {
        ...releaseDepsWithoutBoundary(runCommand),
        releaseMode: "protocol-v1-canary" as const,
      };

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("boundary");
      expect(remoteMutationCommands(
        runCommand.mock.calls.map(([command, args]) => commandKey(command, args)),
      )).toEqual([]);
    });

    it.each(["candidate", "previous active"])(
      "fails closed when the %s version predates protocol v1",
      async (version) => {
        const failure = version === "candidate"
          ? "Release source is below the protocol-v1 boundary."
          : "Active Worker source is below the protocol-v1 boundary.";
        const ancestryCommand = version === "candidate"
          ? `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`
          : `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`;
        const runCommand = successfulRunner({
          "pnpm exec wrangler versions list --json": [
            JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
            JSON.stringify([
              workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
              workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
            ]),
          ],
          [ancestryCommand]: new Error("not an ancestor"),
        });
        const deps = {
          ...releaseDeps(runCommand),
          protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
          releaseMode: "protocol-v1-canary" as const,
        };

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);
        const expectedCommands = [
          ...READ_ONLY_RELEASE_COMMANDS,
          `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
          ...(version === "previous active"
            ? [`git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`]
            : []),
        ];
        expect(recordedCommands(runCommand)).toEqual(expectedCommands);
        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
          status: "failed_before_stage",
          sourceSha: RELEASE_SHA,
          releaseMode: "protocol-v1-canary",
          deploymentStrategy: "gradual",
          protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
          phase: "protocol_ancestry",
          treeHash: TREE_HASH,
          reviewedMigrations: ["0024_add_release_marker.sql"],
          migrationApply: "not_started",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          failure,
        });
      },
    );

    it.each([
      ["missing", [workerVersion("33333333-3333-4333-8333-333333333333", "f".repeat(40))], "Active Worker version is missing from Worker version inventory."],
      ["untagged", [
        workerVersion(PREVIOUS_VERSION, undefined),
        workerVersion("33333333-3333-4333-8333-333333333333", "f".repeat(40)),
      ], "Active Worker version is not source-tagged."],
      ["tagged with a malformed source SHA", [
        workerVersion(PREVIOUS_VERSION, "main"),
        workerVersion("33333333-3333-4333-8333-333333333333", "f".repeat(40)),
      ], "Active Worker version has a malformed source tag."],
    ])("refuses canary staging when the active version is %s in version inventory", async (
      _label,
      versionsBefore,
      failure,
    ) => {
      const runCommand = successfulRunner({
        "pnpm exec wrangler versions list --json": [
          JSON.stringify(versionsBefore),
          JSON.stringify([
            ...versionsBefore,
            workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
          ]),
        ],
      });
      const deps = {
        ...releaseDeps(runCommand),
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        releaseMode: "protocol-v1-canary" as const,
      };

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);
      expect(recordedCommands(runCommand)).toEqual(READ_ONLY_RELEASE_COMMANDS);
      expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
        status: "failed_before_stage",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "active_version_mapping",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "not_started",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure,
      });
    });

    it.each(["rollback target", "current active"])(
      "refuses a manual %s below the protocol-v1 boundary",
      async (version) => {
        const failure = version === "rollback target"
          ? "Rollback target source is below the protocol-v1 boundary."
          : "Current Worker source is below the protocol-v1 boundary.";
        const targetCommand = `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`;
        const currentCommand = `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`;
        const runCommand = successfulRunner({
          "git rev-parse HEAD": TOOLING_SHA,
          "git rev-parse origin/main": TOOLING_SHA,
          "pnpm exec wrangler versions list --json": JSON.stringify([
            workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
            workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
          ]),
          "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
          [version === "rollback target" ? targetCommand : currentCommand]: new Error("not an ancestor"),
        });
        const deps = {
          ...rollbackDeps(runCommand),
          protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
          releaseMode: "protocol-v1-canary" as const,
        };

        await expect(runProductionRollback(deps)).rejects.toThrow(failure);
        expect(recordedCommands(runCommand)).toEqual([
          "git rev-parse HEAD",
          "git rev-parse origin/main",
          "git status --porcelain --untracked-files=no",
          "git rev-parse HEAD^{tree}",
          "pnpm exec wrangler versions list --json",
          "pnpm exec wrangler deployments list --json",
          targetCommand,
          ...(version === "current active" ? [currentCommand] : []),
        ]);
        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
          status: "failed_before_stage",
          sourceSha: RELEASE_SHA,
          releaseMode: "protocol-v1-canary",
          deploymentStrategy: "gradual",
          protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
          phase: "rollback_protocol_ancestry",
          treeHash: TREE_HASH,
          reviewedMigrations: [],
          migrationApply: "not_needed",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          candidateVersionId: CANDIDATE_VERSION,
          failure,
        });
      },
    );

    it.each([
      ["missing", [
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion("33333333-3333-4333-8333-333333333333", "f".repeat(40)),
      ], "Active Worker version is missing from Worker version inventory."],
      ["untagged", [
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, undefined),
        workerVersion("33333333-3333-4333-8333-333333333333", "f".repeat(40)),
      ], "Active Worker version is not source-tagged."],
      ["tagged with a malformed source SHA", [
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, "main"),
        workerVersion("33333333-3333-4333-8333-333333333333", "f".repeat(40)),
      ], "Active Worker version has a malformed source tag."],
    ])("refuses rollback when the current version is %s in version inventory", async (
      _label,
      versions,
      failure,
    ) => {
      const runCommand = successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": TOOLING_SHA,
        "pnpm exec wrangler versions list --json": JSON.stringify(versions),
        "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
      });
      const deps = {
        ...rollbackDeps(runCommand),
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        releaseMode: "protocol-v1-canary" as const,
      };

      await expect(runProductionRollback(deps)).rejects.toThrow(failure);
      expect(recordedCommands(runCommand)).toEqual([
        "git rev-parse HEAD",
        "git rev-parse origin/main",
        "git status --porcelain --untracked-files=no",
        "git rev-parse HEAD^{tree}",
        "pnpm exec wrangler versions list --json",
        "pnpm exec wrangler deployments list --json",
      ]);
      expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([]);
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
        status: "failed_before_stage",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "rollback_active_version_mapping",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure,
      });
    });

    it("permits a manual rollback only when target and current versions are protocol-v1 capable", async () => {
      const runCommand = successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": TOOLING_SHA,
        "pnpm exec wrangler versions list --json": JSON.stringify([
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
        ]),
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(CANDIDATE_VERSION),
        ],
      });
      const deps = {
        ...rollbackDeps(runCommand),
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        releaseMode: "protocol-v1-canary" as const,
      };

      await expect(runProductionRollback(deps)).resolves.toMatchObject({
        releaseMode: "protocol-v1-canary",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        status: "rollback_promoted",
      });
      const commands = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
      expect(commands.indexOf(`git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`))
        .toBeLessThan(commands.indexOf(
          `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
        ));
      expect(commands).toContain(
        `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
      );
    });

    it.each([
      ["atomic-bootstrap", "D1 apply"],
      ["atomic-bootstrap", "post-migration preflight"],
      ["atomic-product-activation", "D1 apply"],
      ["atomic-product-activation", "post-migration preflight"],
    ] as const)("keeps %s forward-only after %s fails before Worker deploy", async (
      mode,
      failurePoint,
    ) => {
      const failure = new Error(failurePoint + " failed with token=secret-value");
      const runCommand = successfulRunner(failurePoint === "D1 apply"
        ? { [D1_APPLY_COMMAND]: failure }
        : { "pnpm run deploy:preflight": ["", failure] });
      const deps = {
        ...atomicReleaseDeps(runCommand, mode),
        readBootstrapProbe: vi.fn(async () => validProbeResult),
      };

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow();

      expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([D1_APPLY_COMMAND]);
      expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
        status: "forward_repair_required",
        sourceSha: RELEASE_SHA,
        releaseMode: mode,
        deploymentStrategy: "atomic",
        phase: failurePoint === "D1 apply" ? "migration_apply" : "full_preflight",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: failurePoint === "D1 apply" ? "failed" : "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure: failurePoint + " failed with token=[REDACTED]",
      });
    });

    it.each([
      ["atomic-bootstrap", "deploy"],
      ["atomic-bootstrap", "version lookup"],
      ["atomic-bootstrap", "convergence"],
      ["atomic-bootstrap", "probe"],
      ["atomic-bootstrap", "artifact"],
      ["atomic-product-activation", "deploy"],
      ["atomic-product-activation", "version lookup"],
      ["atomic-product-activation", "convergence"],
      ["atomic-product-activation", "artifact"],
    ] as const)("keeps %s forward-only after %s failure", async (mode, failurePoint) => {
      const failure = new Error(`${failurePoint} failed with token=secret-value`);
      const overrides: Record<string, CommandResponse | readonly CommandResponse[]> = {
        [atomicDeployCommand(mode)]: failurePoint === "deploy" ? failure : "",
      };
      if (failurePoint === "version lookup") {
        overrides["pnpm exec wrangler versions list --json"] = [
          JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
          failure,
        ];
      }
      if (failurePoint === "convergence") {
        overrides["pnpm exec wrangler deployments list --json"] = [
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(PREVIOUS_VERSION),
        ];
      }
      const runCommand = successfulRunner(overrides);
      const writeReleaseArtifact = vi.fn(async () => {
        if (failurePoint === "artifact") throw failure;
      });
      const deps = {
        ...atomicReleaseDeps(runCommand, mode),
        readBootstrapProbe: vi.fn(async () => {
          if (failurePoint === "probe") throw failure;
          return validProbeResult;
        }),
        readPublicWorkerVersion: vi.fn(async () => CANDIDATE_VERSION),
        verificationAttempts: 1,
        writeReleaseArtifact,
      };

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow();

      const commands = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
      expect(remoteMutationCommands(commands)).toEqual([D1_APPLY_COMMAND, atomicDeployCommand(mode)]);
      const candidateWasResolved = ["convergence", "probe", "artifact"].includes(failurePoint);
      const expectedPhase = {
        artifact: "artifact",
        convergence: "verify_promotion",
        deploy: "atomic_deploy",
        "version lookup": "version_lookup",
        probe: "bootstrap_probe",
      }[failurePoint];
      const expectedFailureArtifact = {
        status: "forward_repair_required",
        sourceSha: RELEASE_SHA,
        releaseMode: mode,
        deploymentStrategy: "atomic",
        phase: expectedPhase,
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        ...(candidateWasResolved ? { candidateVersionId: CANDIDATE_VERSION } : {}),
        failure: failurePoint === "convergence"
          ? "Production version did not converge to " + CANDIDATE_VERSION + "."
          : failurePoint + " failed with token=[REDACTED]",
      };
      expect(writeReleaseArtifact).toHaveBeenLastCalledWith(expectedFailureArtifact);
      expect(writeReleaseArtifact.mock.lastCall?.[0]).not.toHaveProperty(
        "protocolV1BoundarySha",
      );
      expect(writeReleaseArtifact).toHaveBeenCalledTimes(failurePoint === "artifact" ? 2 : 1);
      if (failurePoint === "artifact") {
        expect(writeReleaseArtifact).toHaveBeenNthCalledWith(1, atomicSuccessArtifact(mode));
        expect(writeReleaseArtifact).toHaveBeenNthCalledWith(2, expectedFailureArtifact);
      }
    });

    it.each([
      ["atomic-bootstrap", "deploy"],
      ["atomic-bootstrap", "version lookup"],
      ["atomic-bootstrap", "convergence"],
      ["atomic-bootstrap", "probe"],
      ["atomic-bootstrap", "artifact"],
      ["atomic-product-activation", "deploy"],
      ["atomic-product-activation", "version lookup"],
      ["atomic-product-activation", "convergence"],
      ["atomic-product-activation", "artifact"],
    ] as const)("keeps zero-migration %s forward-only after %s failure", async (
      mode,
      failurePoint,
    ) => {
      const failure = new Error(`${failurePoint} failed d1-secret workers-secret`);
      const overrides: Record<string, CommandResponse | readonly CommandResponse[]> = {
        "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
        [atomicDeployCommand(mode)]: failurePoint === "deploy" ? failure : "",
      };
      if (failurePoint === "version lookup") {
        overrides["pnpm exec wrangler versions list --json"] = [
          JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
          failure,
        ];
      }
      if (failurePoint === "convergence") {
        overrides["pnpm exec wrangler deployments list --json"] = [
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(PREVIOUS_VERSION),
        ];
      }
      const runCommand = successfulRunner(overrides);
      const writeReleaseArtifact = vi.fn(async () => undefined);
      if (failurePoint === "artifact") writeReleaseArtifact.mockRejectedValueOnce(failure);
      const deps = {
        ...atomicReleaseDeps(runCommand, mode),
        readBootstrapProbe: vi.fn(async () => {
          if (failurePoint === "probe") throw failure;
          return validProbeResult;
        }),
        readPublicWorkerVersion: vi.fn(async () => CANDIDATE_VERSION),
        verificationAttempts: 1,
        writeReleaseArtifact,
      };

      const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).not.toMatch(/d1-secret|workers-secret/);
      expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
        atomicDeployCommand(mode),
      ]);
      const candidateWasResolved = ["convergence", "probe", "artifact"].includes(failurePoint);
      const expectedPhase = {
        artifact: "artifact",
        convergence: "verify_promotion",
        deploy: "atomic_deploy",
        "version lookup": "version_lookup",
        probe: "bootstrap_probe",
      }[failurePoint];
      const expectedFailureArtifact = {
        status: "forward_repair_required",
        sourceSha: RELEASE_SHA,
        releaseMode: mode,
        deploymentStrategy: "atomic",
        phase: expectedPhase,
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        ...(candidateWasResolved ? { candidateVersionId: CANDIDATE_VERSION } : {}),
        failure: failurePoint === "convergence"
          ? `Production version did not converge to ${CANDIDATE_VERSION}.`
          : `${failurePoint} failed [REDACTED] [REDACTED]`,
      };
      expect(writeReleaseArtifact).toHaveBeenLastCalledWith(expectedFailureArtifact);
      expect(writeReleaseArtifact).toHaveBeenCalledTimes(failurePoint === "artifact" ? 2 : 1);
      if (failurePoint === "artifact") {
        expect(writeReleaseArtifact).toHaveBeenNthCalledWith(1, {
          status: "promoted",
          sourceSha: RELEASE_SHA,
          releaseMode: mode,
          deploymentStrategy: "atomic",
          phase: "complete",
          treeHash: TREE_HASH,
          reviewedMigrations: [],
          migrationApply: "not_needed",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          candidateVersionId: CANDIDATE_VERSION,
        });
        expect(writeReleaseArtifact).toHaveBeenNthCalledWith(2, expectedFailureArtifact);
      }
      if (mode === "atomic-product-activation") {
        expect(deps.readBootstrapProbe).not.toHaveBeenCalled();
      }
    });

    it.each([
      ["atomic-bootstrap", "succeeded"],
      ["atomic-bootstrap", "not_needed"],
      ["atomic-product-activation", "succeeded"],
      ["atomic-product-activation", "not_needed"],
    ] as const)(
      "sanitizes %s double artifact-writer failure propagation with migrations %s",
      async (mode, migrationApply) => {
        const failure = new Error("artifact failed d1-secret workers-secret");
        const reviewedMigrations = migrationApply === "succeeded"
          ? ["0024_add_release_marker.sql"]
          : [];
        const runCommand = successfulRunner({
          ...(migrationApply === "not_needed"
            ? { "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!" }
            : {}),
          [atomicDeployCommand(mode)]: "",
        });
        const writeReleaseArtifact = vi.fn(async () => {
          throw failure;
        });
        const deps = {
          ...atomicReleaseDeps(runCommand, mode),
          readBootstrapProbe: vi.fn(async () => validProbeResult),
          writeReleaseArtifact,
        };

        const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe(
          "artifact failed [REDACTED] [REDACTED] Release artifact write also failed: " +
          "artifact failed [REDACTED] [REDACTED]",
        );
        expect((rejection as Error).message).not.toMatch(/d1-secret|workers-secret/);
        expect(writeReleaseArtifact).toHaveBeenCalledTimes(2);
        expect(writeReleaseArtifact).toHaveBeenNthCalledWith(1, {
          status: "promoted",
          sourceSha: RELEASE_SHA,
          releaseMode: mode,
          deploymentStrategy: "atomic",
          phase: "complete",
          treeHash: TREE_HASH,
          reviewedMigrations,
          migrationApply,
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          candidateVersionId: CANDIDATE_VERSION,
        });
        expect(writeReleaseArtifact).toHaveBeenNthCalledWith(2, {
          status: "forward_repair_required",
          sourceSha: RELEASE_SHA,
          releaseMode: mode,
          deploymentStrategy: "atomic",
          phase: "artifact",
          treeHash: TREE_HASH,
          reviewedMigrations,
          migrationApply,
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          candidateVersionId: CANDIDATE_VERSION,
          failure: "artifact failed [REDACTED] [REDACTED]",
        });
        expect(remoteMutationCommands(recordedCommands(runCommand))).toEqual([
          ...(migrationApply === "succeeded" ? [D1_APPLY_COMMAND] : []),
          atomicDeployCommand(mode),
        ]);
        if (mode === "atomic-product-activation") {
          expect(deps.readBootstrapProbe).not.toHaveBeenCalled();
        }
      },
    );
  });
});
