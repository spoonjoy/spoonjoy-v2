import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy } from "../../app/lib/security-headers.server";
import {
  createPostHogBuildContract,
  createPostHogBuildMetadata,
} from "../../scripts/posthog-build-metadata";
import {
  assertAdditiveMigrationSql,
  buildWorkerVersionOverride,
  createReleaseCommandRunner,
  parsePendingMigrationNames,
  parseReleaseCliOptions,
  readCandidateCspHeaders,
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
const VALID_CSP_NONCE = "AbCdEfGhIjKlMnOpQrStUg==";
const VALID_CANDIDATE_CSP = buildContentSecurityPolicy(VALID_CSP_NONCE);
const CUSTOM_POSTHOG_HOST = "https://analytics.example.com";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function commandKey(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
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

function productionGeneratedWorkerConfig(host = CUSTOM_POSTHOG_HOST): Record<string, unknown> {
  return {
    vars: {
      NODE_ENV: "production",
      VITE_POSTHOG_HOST: host,
    },
  };
}

function productionBuildMetadata(host = CUSTOM_POSTHOG_HOST) {
  return createPostHogBuildMetadata(createPostHogBuildContract(
    productionGeneratedWorkerConfig(host),
  ));
}

function productionBundleSources(host = CUSTOM_POSTHOG_HOST): readonly string[] {
  return [`const spoonjoyEnv={VITE_POSTHOG_HOST:${JSON.stringify(host)}};`];
}

function postHogArtifactReaderDeps(host = CUSTOM_POSTHOG_HOST) {
  return {
    readGeneratedWorkerConfig: async () => productionGeneratedWorkerConfig(host),
    readClientBuildMetadata: async () => productionBuildMetadata(host),
    readClientBundleSources: async () => productionBundleSources(host),
  };
}

type CommandResponse = Error | string;

function successfulRunner(
  overrides: Record<string, CommandResponse | readonly CommandResponse[]> = {},
  events: string[] = [],
) {
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
        workerVersion("33333333-3333-4333-8333-333333333333", "other", "2026-07-14T00:00:00Z"),
      ]),
      JSON.stringify([
        workerVersion("33333333-3333-4333-8333-333333333333", "other", "2026-07-14T00:00:00Z"),
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-07-15T00:00:00Z", 2),
      ]),
    ],
  };

  const callCounts = new Map<string, number>();
  const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
    const key = commandKey(command, args);
    events.push(`command:${key}`);
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
    postHogHost: "https://us.i.posthog.com",
    readMigrationFile: vi.fn(async () => "CREATE TABLE ReleaseMarker (id TEXT PRIMARY KEY);"),
    readGeneratedWorkerConfig: vi.fn(async () => productionGeneratedWorkerConfig()),
    readClientBuildMetadata: vi.fn(async () => productionBuildMetadata()),
    readClientBundleSources: vi.fn(async () => productionBundleSources()),
    readCandidateCspHeaders: vi.fn(async () => new Headers({
      "Content-Security-Policy": VALID_CANDIDATE_CSP,
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
    })),
    readPublicWorkerVersion: vi.fn(async () => CANDIDATE_VERSION),
    releaseSha: RELEASE_SHA,
    runCommand,
    sleep: vi.fn(async () => undefined),
    verificationAttempts: 3,
    writeReleaseArtifact: vi.fn(async () => undefined),
  };
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
    postHogHost: "https://us.i.posthog.com",
    readCandidateCspHeaders: vi.fn(async () => new Headers({
      "Content-Security-Policy": VALID_CANDIDATE_CSP,
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
    })),
    readPublicWorkerVersion: vi.fn(async () => CANDIDATE_VERSION),
    releaseSha: RELEASE_SHA,
    rollbackVersionId: CANDIDATE_VERSION,
    runCommand,
    sleep: vi.fn(async () => undefined),
    verificationAttempts: 2,
    writeReleaseArtifact: vi.fn(async () => undefined),
  };
}

describe("trusted production rollback orchestration", () => {
  it("uses current-main tooling to deploy an exact known source-tagged version", async () => {
    const events: string[] = [];
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    }, events);
    const deps = rollbackDeps(runCommand);
    deps.readCandidateCspHeaders.mockImplementation(async () => {
      events.push("probe:candidate-csp");
      return new Headers({
        "Content-Security-Policy": VALID_CANDIDATE_CSP,
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
      });
    });

    const result = await runProductionRollback(deps);

    expect(result).toEqual({
      status: "rollback_promoted",
      sourceSha: RELEASE_SHA,
      phase: "complete",
      treeHash: TREE_HASH,
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    });
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage rollback ${RELEASE_SHA} for inspection`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(runCommand.mock.calls[4]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(deps.readCandidateCspHeaders).toHaveBeenCalledWith(
      "https://spoonjoy.app",
      CANDIDATE_VERSION,
    );
    expect(events.indexOf(
      `command:pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage rollback ${RELEASE_SHA} for inspection`,
    )).toBeLessThan(events.indexOf("probe:candidate-csp"));
    expect(events.indexOf("probe:candidate-csp")).toBeLessThan(events.indexOf(
      `command:pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
    ));
  });

  it.each([
    ["a blank acknowledgement", undefined],
    ["a wrong acknowledgement", "ACK_SOMETHING_ELSE"],
  ])("rejects an old report-only rollback with %s", async (_label, acknowledgement) => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
    });
    const deps = rollbackDeps(runCommand);
    deps.readCandidateCspHeaders.mockResolvedValue(new Headers({
      "Content-Security-Policy-Report-Only": buildContentSecurityPolicy(VALID_CSP_NONCE),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
    }));
    if (acknowledgement) {
      deps.env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS = acknowledgement;
    }
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      /ACK_REPORT_ONLY_CSP_ROLLBACK/,
    );

    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).not.toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
    );
    expect(calls).toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage rollback ${RELEASE_SHA} for inspection`,
    );
    expect(calls).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "candidate_csp",
    }));
  });

  it("allows an old report-only rollback only with the exact break-glass acknowledgement", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const deps = rollbackDeps(runCommand);
    deps.env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS = "ACK_REPORT_ONLY_CSP_ROLLBACK";
    deps.readCandidateCspHeaders.mockResolvedValue(new Headers({
      "Content-Security-Policy-Report-Only": buildContentSecurityPolicy(VALID_CSP_NONCE),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
    }));

    await expect(runProductionRollback(deps)).resolves.toMatchObject({
      status: "rollback_promoted",
      candidateVersionId: CANDIDATE_VERSION,
    });
  });

  it("fails closed when historical rollback CSP inspection is unavailable", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
    });
    const deps = rollbackDeps(runCommand);
    deps.env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS = "ACK_REPORT_ONLY_CSP_ROLLBACK";
    deps.readCandidateCspHeaders.mockRejectedValue(new Error("edge inspection unavailable"));
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("edge inspection unavailable");
    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).not.toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
    );
    expect(calls).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "candidate_csp",
    }));
  });

  it.each([
    ["missing", undefined],
    ["mismatched", PREVIOUS_VERSION],
  ])("fails closed when rollback candidate identity is %s even with break-glass", async (_label, observedVersion) => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
    });
    const deps = rollbackDeps(runCommand);
    deps.env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS = "ACK_REPORT_ONLY_CSP_ROLLBACK";
    deps.readCandidateCspHeaders.mockResolvedValue(new Headers({
      "Content-Security-Policy-Report-Only": buildContentSecurityPolicy(VALID_CSP_NONCE),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      ...(observedVersion ? { "X-Spoonjoy-Worker-Version": observedVersion } : {}),
    }));
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow(/candidate identity/i);
    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).not.toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
    );
    expect(calls).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "candidate_csp",
    }));
  });

  it("rejects stale tooling and mismatched version tags before deployment", async () => {
    const staleRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": "d".repeat(40),
    });
    await expect(runProductionRollback(rollbackDeps(staleRunner))).rejects.toThrow("current origin/main");

    const tagRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, "d".repeat(40)),
      ]),
    });
    await expect(runProductionRollback(rollbackDeps(tagRunner))).rejects.toThrow("source-tagged Worker version");
    expect(tagRunner.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
    );
  });

  it("rejects invalid input, dirty tooling, and an already-active rollback target", async () => {
    const invalidDeps = rollbackDeps(successfulRunner());
    delete invalidDeps.env;
    invalidDeps.releaseSha = "main";
    await expect(runProductionRollback(invalidDeps)).rejects.toThrow("40-character");

    const dirtyRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "git status --porcelain --untracked-files=no": " M scripts/deploy-production-canary.ts",
    });
    await expect(runProductionRollback(rollbackDeps(dirtyRunner))).rejects.toThrow("tracked changes");

    const activeRunner = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(CANDIDATE_VERSION),
    });
    await expect(runProductionRollback(rollbackDeps(activeRunner))).rejects.toThrow("already active");
  });

  it("restores the prior version when rollback promotion cannot be verified", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
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
    deps.readPublicWorkerVersion.mockResolvedValue(null);

    await expect(runProductionRollback(deps)).rejects.toThrow("did not converge");

    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "verify_promotion",
    }));
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it("records failure when restoring after a failed rollback also fails", async () => {
    const restore = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
    const runner = () => successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": TOOLING_SHA,
        "pnpm exec wrangler versions list --json": JSON.stringify([
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        ]),
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION),
          new Error("deployment list unavailable"),
          new Error("still unavailable"),
        ],
        [restore]: new Error("restore failed"),
      });
    const runCommand = runner();
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion.mockRejectedValue(new Error("public unavailable"));

    await expect(runProductionRollback(deps)).rejects.toThrow("Rollback failed: restore failed");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rollback_failed",
      rollbackFailure: "restore failed",
    }));

    const secondDeps = rollbackDeps(runner());
    secondDeps.readPublicWorkerVersion.mockRejectedValue(new Error("public unavailable"));
    secondDeps.writeReleaseArtifact.mockRejectedValueOnce(new Error("artifact failed"));
    await expect(runProductionRollback(secondDeps)).rejects.toThrow("artifact write also failed");
  });

  it("restores the prior version after an ambiguous rollback deploy failure", async () => {
    const deploy = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`;
    const restore = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
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

    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toContain(restore);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "promote",
    }));
  });

  it("reasserts the prior version after an ambiguous rollback staging failure", async () => {
    const stage = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage rollback ${RELEASE_SHA} for inspection`;
    const restore = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": deploymentPayload(PREVIOUS_VERSION),
      [stage]: new Error("rollback stage result unknown"),
    });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("rollback stage result unknown");

    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).toContain(stage);
    expect(calls).toContain(restore);
    expect(deps.readCandidateCspHeaders).not.toHaveBeenCalled();
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "stage",
    }));
  });
});

describe("production canary release orchestration", () => {
  it("stages a candidate at zero traffic, smokes that exact version, and promotes it", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);

    const result = await runProductionCanaryRelease(deps);

    expect(result).toMatchObject({
      status: "promoted",
      sourceSha: RELEASE_SHA,
      treeHash: TREE_HASH,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "succeeded",
      databaseRollbackSupported: false,
    });
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toEqual([
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm run deploy:preflight",
      "pnpm run build",
      "git status --porcelain --untracked-files=no",
      "pnpm exec wrangler d1 migrations list DB --remote",
      "pnpm exec wrangler d1 migrations apply DB --remote",
      "pnpm run deploy:preflight",
      "pnpm exec wrangler deployments list --json",
      "pnpm exec wrangler versions list --json",
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      "pnpm exec wrangler versions list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(deps.readMigrationFile).toHaveBeenCalledWith("migrations/0024_add_release_marker.sql");
    expect(deps.readCandidateCspHeaders).toHaveBeenCalledWith("https://spoonjoy.app", CANDIDATE_VERSION);
    expect(runCommand.mock.calls[3]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
      SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1",
    });
    expect(runCommand.mock.calls[4]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(runCommand.mock.calls[7]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "d1-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(runCommand.mock.calls[13]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(runCommand.mock.calls[14]?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "d1-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(deps.readPublicWorkerVersion).toHaveBeenCalledWith("https://spoonjoy.app");
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
  });

  it("validates generated production PostHog artifacts after build before migration or deploy actions", async () => {
    const events: string[] = [];
    const runCommand = successfulRunner({}, events);
    const deps = releaseDeps(runCommand);
    deps.readGeneratedWorkerConfig.mockImplementation(async () => {
      events.push("posthog:worker-config");
      return productionGeneratedWorkerConfig(CUSTOM_POSTHOG_HOST);
    });
    deps.readClientBuildMetadata.mockImplementation(async () => {
      events.push("posthog:metadata");
      return productionBuildMetadata(CUSTOM_POSTHOG_HOST);
    });
    deps.readClientBundleSources.mockImplementation(async () => {
      events.push("posthog:bundle");
      return productionBundleSources(CUSTOM_POSTHOG_HOST);
    });

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });

    expect(deps.readGeneratedWorkerConfig).toHaveBeenCalledTimes(1);
    expect(deps.readClientBuildMetadata).toHaveBeenCalledTimes(1);
    expect(deps.readClientBundleSources).toHaveBeenCalledTimes(1);
    expect(events.slice(3, 9)).toEqual([
      "command:pnpm run deploy:preflight",
      "command:pnpm run build",
      "posthog:worker-config",
      "posthog:metadata",
      "posthog:bundle",
      "command:git status --porcelain --untracked-files=no",
    ]);
    expect(events.indexOf("posthog:bundle")).toBeLessThan(
      events.indexOf("command:pnpm exec wrangler d1 migrations list DB --remote"),
    );
    expect(events.indexOf("posthog:bundle")).toBeLessThan(
      events.indexOf(`command:pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`),
    );
  });

  it("uses the default generated production PostHog artifact readers when deps do not override them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-posthog-"));
    const previousCwd = process.cwd();
    try {
      const host = CUSTOM_POSTHOG_HOST;
      await Promise.all([
        mkdir(path.join(root, "build/server"), { recursive: true }),
        mkdir(path.join(root, "build/client/.vite"), { recursive: true }),
        mkdir(path.join(root, "build/client/assets"), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(root, "build/server/wrangler.json"),
          JSON.stringify(productionGeneratedWorkerConfig(host)),
          "utf8",
        ),
        writeFile(
          path.join(root, "build/client/.vite/spoonjoy-build-metadata.json"),
          JSON.stringify(productionBuildMetadata(host)),
          "utf8",
        ),
        writeFile(path.join(root, "build/client/assets/app.js"), productionBundleSources(host)[0], "utf8"),
      ]);
      process.chdir(root);
      const runCommand = successfulRunner();
      const deps = releaseDeps(runCommand);
      delete deps.readGeneratedWorkerConfig;
      delete deps.readClientBuildMetadata;
      delete deps.readClientBundleSources;

      await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "invalid generated Worker config JSON",
      async (root: string) => {
        await mkdir(path.join(root, "build/server"), { recursive: true });
        await writeFile(path.join(root, "build/server/wrangler.json"), "{", "utf8");
      },
      /Generated Worker config could not be read as JSON/,
    ],
    [
      "non-object generated metadata JSON",
      async (root: string) => {
        await Promise.all([
          mkdir(path.join(root, "build/server"), { recursive: true }),
          mkdir(path.join(root, "build/client/.vite"), { recursive: true }),
        ]);
        await Promise.all([
          writeFile(
            path.join(root, "build/server/wrangler.json"),
            JSON.stringify(productionGeneratedWorkerConfig()),
            "utf8",
          ),
          writeFile(path.join(root, "build/client/.vite/spoonjoy-build-metadata.json"), "[]", "utf8"),
        ]);
      },
      /Generated PostHog metadata was not a JSON object/,
    ],
  ])("rejects %s from default PostHog artifact readers before mutation", async (_label, writeArtifacts, message) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-posthog-"));
    const previousCwd = process.cwd();
    try {
      await writeArtifacts(root);
      process.chdir(root);
      const runCommand = successfulRunner();
      const deps = releaseDeps(runCommand);
      delete deps.readGeneratedWorkerConfig;
      delete deps.readClientBuildMetadata;
      delete deps.readClientBundleSources;

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow(message);

      expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
        "pnpm exec wrangler d1 migrations list DB --remote",
      );
      expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
        status: "failed_before_stage",
        phase: "post_build_posthog",
      }));
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "missing generated Worker config",
      (deps: ReturnType<typeof releaseDeps>) => {
        deps.readGeneratedWorkerConfig.mockRejectedValueOnce(new Error("missing generated Worker config"));
      },
      /missing generated Worker config/,
    ],
    [
      "malformed generated Worker PostHog config",
      (deps: ReturnType<typeof releaseDeps>) => {
        deps.readGeneratedWorkerConfig.mockResolvedValueOnce({ vars: {} });
      },
      /origin-only HTTPS VITE_POSTHOG_HOST/,
    ],
    [
      "mismatched metadata",
      (deps: ReturnType<typeof releaseDeps>) => {
        deps.readClientBuildMetadata.mockResolvedValueOnce(productionBuildMetadata("https://eu.i.posthog.com"));
      },
      /metadata/i,
    ],
    [
      "malformed metadata",
      (deps: ReturnType<typeof releaseDeps>) => {
        deps.readClientBuildMetadata.mockResolvedValueOnce({
          ...productionBuildMetadata(CUSTOM_POSTHOG_HOST),
          extra: [undefined],
        });
      },
      /metadata/i,
    ],
    [
      "mismatched bundle",
      (deps: ReturnType<typeof releaseDeps>) => {
        deps.readClientBundleSources.mockResolvedValueOnce(productionBundleSources("https://eu.i.posthog.com"));
      },
      /bundle/i,
    ],
    [
      "missing bundle host",
      (deps: ReturnType<typeof releaseDeps>) => {
        deps.readClientBundleSources.mockResolvedValueOnce([]);
      },
      /bundle/i,
    ],
  ])("rejects %s before any migration or deploy action", async (_label, mutateDeps, message) => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    mutateDeps(deps);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(message);

    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).not.toContain("pnpm exec wrangler d1 migrations list DB --remote");
    expect(calls).not.toContain("pnpm exec wrangler d1 migrations apply DB --remote");
    expect(calls).not.toContain(
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      phase: "post_build_posthog",
      migrationApply: "not_started",
    }));
  });

  it("uses the built-in candidate CSP reader when release deps do not override it", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    delete (deps as { readCandidateCspHeaders?: unknown }).readCandidateCspHeaders;
    const fetchImpl = vi.fn(async () => new Response("<!doctype html>", {
      status: 200,
      headers: {
        "Content-Security-Policy": VALID_CANDIDATE_CSP,
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
      },
    }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({
      status: "promoted",
      candidateVersionId: CANDIDATE_VERSION,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://spoonjoy.app/?candidate_csp_verification=1");
    expect(init).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "text/html",
        "Cloudflare-Workers-Version-Overrides": `spoonjoy-v2=\"${CANDIDATE_VERSION}\"`,
      },
    });
  });

  it("restores the previous version when the candidate smoke fails", async () => {
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

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "canary failed",
    }));
  });

  it("restores the previous version when candidate CSP validation fails before promotion", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readCandidateCspHeaders.mockResolvedValue(new Headers({
      "Content-Security-Policy-Report-Only": "default-src 'self'; report-uri /csp-report",
      "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
    }));
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(/Candidate CSP validation failed/);

    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(calls).not.toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "candidate_csp",
      failure: expect.stringContaining("Content-Security-Policy"),
    }));
  });

  it("rejects an insecure candidate CSP before promotion even when canary smoke passes", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readCandidateCspHeaders.mockResolvedValue(new Headers({
      "Content-Security-Policy": "default-src *; script-src * 'unsafe-inline' 'unsafe-eval' 'nonce-live'; object-src *; frame-ancestors *; base-uri *; form-action *; report-uri /csp-report; report-to csp-endpoint",
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
    }));
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      /CSP default-src lockdown.*CSP script-src exact sources/,
    );

    const calls = runCommand.mock.calls.map(([command, args]) => commandKey(command, args));
    expect(calls).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(calls).not.toContain(
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
    );
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

    expect(deps.sleep).toHaveBeenCalledTimes(20);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      previousVersionId: PREVIOUS_VERSION,
    }));
  });

  it("accepts a healthy legacy restore only after repeated exact control-plane observations", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(null);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      previousVersionId: PREVIOUS_VERSION,
    }));
  });

  it.each([
    ["a transient public probe failure", new Error("edge unavailable")],
    ["a mismatched public version", CANDIDATE_VERSION],
  ])("resets legacy restore convergence after %s", async (_label, interruption) => {
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
      .mockResolvedValueOnce(null);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
    }));
  });

  it("reasserts the prior deployment when staging may have failed after mutation", async () => {
    const stageCommand = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`;
    const runCommand = successfulRunner({
      [stageCommand]: new Error("stage failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("stage failed");

    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "stage",
      failure: "stage failed",
    }));
  });

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

  it("rejects an invalid production verification attempt count", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 0;

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("positive integer");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rollback_failed",
      rollbackFailure: expect.stringContaining("positive integer"),
    }));
  });

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

    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "verify_promotion",
    }));
  });

  it("reports rollback failure when the restored version cannot be verified", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "canary",
      rollbackFailure: expect.stringContaining("did not converge"),
    }));
  });

  it("rejects invalid release SHAs before running commands", async () => {
    const runCommand = successfulRunner();
    const deps = { ...releaseDeps(runCommand), releaseSha: "main" };

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("40-character lowercase Git SHA");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["a different checked-out commit", { "git rev-parse HEAD": "c".repeat(40) }, "does not match"],
    ["tracked changes", { "git status --porcelain --untracked-files=no": " M app/root.tsx" }, "tracked changes"],
    ["an invalid tree hash", { "git rev-parse HEAD^{tree}": "not-a-tree" }, "tree hash"],
    [
      "tracked build output changes",
      { "git status --porcelain --untracked-files=no": ["", " M app/lib/generated/api-v1-playground.ts"] },
      "build changed tracked files",
    ],
  ])("rejects %s before any D1 mutation", async (_label, overrides, message) => {
    const runCommand = successfulRunner(overrides);
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(message);

    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      databaseRollbackSupported: false,
    }));
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

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(deps.readMigrationFile).not.toHaveBeenCalled();
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
    }));
  });

  it("records migration review failures before any D1 mutation", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    deps.readMigrationFile.mockRejectedValueOnce(new Error("migration file unavailable"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("migration file unavailable");
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      phase: "migration_review",
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "not_started",
      databaseRollbackSupported: false,
    }));
  });

  it("records that D1 may have changed when migration apply fails", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations apply DB --remote": new Error("second migration failed"),
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("second migration failed");

    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      phase: "migration_apply",
      reviewedMigrations: ["0024_add_release_marker.sql"],
      migrationApply: "failed",
      databaseRollbackSupported: false,
    }));
  });

  it("records failures after finding the prior version without inventing a candidate", async () => {
    const uploadCommand = `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`;
    const runCommand = successfulRunner({ [uploadCommand]: new Error("upload failed") });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("upload failed");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      phase: "version_upload",
      previousVersionId: PREVIOUS_VERSION,
    }));
    expect(deps.writeReleaseArtifact.mock.calls[0]?.[0]).not.toHaveProperty("candidateVersionId");
  });

  it("rejects an uploaded version that is already active", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler versions list --json": [
        "[]",
        JSON.stringify([workerVersion(PREVIOUS_VERSION, RELEASE_SHA)]),
      ],
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("already the active");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      phase: "version_lookup",
      candidateVersionId: PREVIOUS_VERSION,
    }));
  });

  it("redacts sensitive failure text and bounds artifacts", async () => {
    const failure = new Error(
      `Bearer bearer-value token=token-value password:password-value api_key=api-value ` +
      `aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc ${"x".repeat(600)}\nnext`,
    );
    const runCommand = successfulRunner({ "pnpm run deploy:preflight": failure });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toBe(failure);
    const artifact = deps.writeReleaseArtifact.mock.calls[0]?.[0];
    expect(artifact.failure).not.toMatch(/bearer-value|token-value|password-value|api-value|aaaaaa/);
    expect(artifact.failure?.length).toBeLessThanOrEqual(500);
    expect(artifact.failure).not.toContain("\n");
  });

  it("sanitizes a non-Error thrown value", async () => {
    const runCommand = vi.fn<ReleaseCommandRunner>(async () => {
      throw "secret=plain-value";
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toBe("secret=plain-value");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      failure: "secret=[REDACTED]",
    }));
  });

  it("reports when a pre-stage failure artifact cannot be written", async () => {
    const runCommand = successfulRunner({ "pnpm run build": new Error("build failed") });
    const deps = releaseDeps(runCommand);
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "build failed Release artifact write also failed: disk unavailable",
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
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "artifact",
    }));
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
    expect(deps.writeReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "canary",
      rollbackFailure: "rollback failed",
    }));
  });

  it("reports both rollback and artifact failures", async () => {
    const promoteCommand = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`;
    const rollbackCommand = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      [promoteCommand]: new Error("promotion failed"),
      [rollbackCommand]: new Error("rollback failed"),
    });
    const deps = releaseDeps(runCommand);
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error("artifact failed"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "promotion failed Rollback failed: rollback failed. Release artifact write also failed: artifact failed",
    );
  });
});

describe("execFile command adapter", () => {
  it("returns warning-clean stdout without using a shell", async () => {
    const execFile = vi.fn((command, args, options, callback) => {
      expect(command).toBe("pnpm");
      expect(args).toEqual(["run", "build"]);
      expect(options).toEqual({ encoding: "utf8", env: { PATH: "/bin" }, maxBuffer: 16 * 1024 * 1024 });
      callback(null, "built", "");
      return { stdout: null, stderr: {} };
    });
    const runner = createReleaseCommandRunner(execFile);

    await expect(runner("pnpm", ["run", "build"], { env: { PATH: "/bin" } })).resolves.toEqual({
      stdout: "built",
      stderr: "",
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("ignores non-emitter child streams when the callback completes asynchronously", async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      queueMicrotask(() => callback(null, "built", ""));
      return { stdout: null, stderr: {} };
    });
    const runner = createReleaseCommandRunner(execFile);

    await expect(runner("pnpm", ["run", "build"])).resolves.toEqual({
      stdout: "built",
      stderr: "",
    });
  });

  it("streams successful child stdout while retaining captured output", async () => {
    const childStdout = new EventEmitter();
    const childStderr = new EventEmitter();
    const execFile = vi.fn((_command, _args, _options, callback) => {
      queueMicrotask(() => {
        childStdout.emit("data", "build complete\n");
        callback(null, "captured stdout", "");
      });
      return { stdout: childStdout, stderr: childStderr };
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout.mockClear();
    stderr.mockClear();
    const runner = createReleaseCommandRunner(execFile);

    await expect(runner("pnpm", ["run", "build"])).resolves.toEqual({
      stdout: "captured stdout",
      stderr: "",
    });

    expect(stdout).toHaveBeenCalledWith("build complete\n");
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each([
    ["warning token on stdout", "Warning: build fallback used\n", ""],
    ["plural warning summary on stdout", "Found 2 warnings\n", ""],
    ["otherwise unmarked stderr", "build complete\n", "fallback used\n"],
  ])("rejects successful commands with %s", async (_label, stdout, stderr) => {
    const runner = createReleaseCommandRunner((_command, _args, _options, callback) => {
      callback(null, stdout, stderr);
    });

    await expect(runner("pnpm", ["run", "build"])).rejects.toThrow(
      "Command emitted unexpected warning output: pnpm",
    );
  });

  it("redacts sensitive streamed child output without putting captured output in command errors", async () => {
    const childStdout = new EventEmitter();
    const childStderr = new EventEmitter();
    const execFile = vi.fn((_command, _args, _options, callback) => {
      queueMicrotask(() => {
        childStdout.emit("data", "Bearer bearer-value\n");
        childStderr.emit("data", "api_key=plain-secret\n");
        callback(Object.assign(new Error("failed"), { code: 1 }), "secret=stdout-value", "token=stderr-value");
      });
      return { stdout: childStdout, stderr: childStderr };
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout.mockClear();
    stderr.mockClear();
    const runner = createReleaseCommandRunner(execFile);

    await expect(runner("pnpm", ["run", "build"])).rejects.toThrow("exit code 1");
    await expect(runner("pnpm", ["run", "build"])).rejects.not.toThrow(/stdout-value|stderr-value/);

    expect(stdout).toHaveBeenCalledWith("Bearer [REDACTED]\n");
    expect(stderr).toHaveBeenCalledWith("api_key=[REDACTED]\n");
  });

  it("redacts credentials split across arbitrary stream chunks and flushes trailing output", async () => {
    const childStdout = new EventEmitter();
    const childStderr = new EventEmitter();
    const jwt = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`;
    const execFile = vi.fn((_command, _args, _options, callback) => {
      queueMicrotask(() => {
        childStdout.emit("data", "Bea");
        childStdout.emit("data", `rer bearer-value\n${jwt.slice(0, 25)}`);
        childStdout.emit("data", `${jwt.slice(25)}\npass`);
        childStdout.emit("data", "word:trailing-secret");
        childStderr.emit("data", "api_");
        childStderr.emit("data", "key=split-secret\n");
        callback(null, "captured stdout", "");
      });
      return { stdout: childStdout, stderr: childStderr };
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout.mockClear();
    stderr.mockClear();
    const runner = createReleaseCommandRunner(execFile);

    await expect(runner("pnpm", ["run", "build"])).resolves.toEqual({
      stdout: "captured stdout",
      stderr: "",
    });

    const streamedStdout = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    const streamedStderr = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(streamedStdout).toBe(
      "Bearer [REDACTED]\n[REDACTED]\npassword=[REDACTED]",
    );
    expect(streamedStderr).toBe("api_key=[REDACTED]\n");
    expect(`${streamedStdout}${streamedStderr}`).not.toMatch(
      /bearer-value|split-secret|trailing-secret|aaaaaaaaaaaaaaaa/,
    );
  });

  it.each([
    ["Bearer token", "Bearer bearer-value\n", "Bearer [REDACTED]\n"],
    ["token assignment", "token=token-value\n", "token=[REDACTED]\n"],
    ["secret assignment", "secret: secret-value\n", "secret=[REDACTED]\n"],
    ["password assignment", "password = password-value\n", "password=[REDACTED]\n"],
    [
      "authorization assignment",
      "authorization: authorization-value\n",
      "authorization=[REDACTED]\n",
    ],
    ["underscore API key", "api_key=api-value\n", "api_key=[REDACTED]\n"],
    ["hyphenated API key", "api-key: api-value\n", "api-key=[REDACTED]\n"],
    [
      "JWT",
      `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}\n`,
      "[REDACTED]\n",
    ],
    ["newline-spanning Bearer token", "Bearer \nsecret-value\n", "Bearer [REDACTED]\n"],
    ["newline-spanning assignment", "token =\nsecret-value\n", "token=[REDACTED]\n"],
  ])("redacts a %s at every possible stream split", async (_label, sensitiveLine, expected) => {
    let writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    stdout.mockClear();

    for (let split = 1; split < sensitiveLine.length; split += 1) {
      writes = [];
      const childStdout = new EventEmitter();
      const childStderr = new EventEmitter();
      const runner = createReleaseCommandRunner((_command, _args, _options, callback) => {
        queueMicrotask(() => {
          childStdout.emit("data", sensitiveLine.slice(0, split));
          childStdout.emit("data", sensitiveLine.slice(split));
          callback(null, "captured stdout", "");
        });
        return { stdout: childStdout, stderr: childStderr };
      });

      await expect(runner("pnpm", ["run", "build"])).resolves.toEqual({
        stdout: "captured stdout",
        stderr: "",
      });
      expect(writes.join("")).toBe(expected);
    }
  });

  it("flushes trailing stream output once across end, close, and callback", async () => {
    const childStdout = new EventEmitter();
    const childStderr = new EventEmitter();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stdout.mockClear();
    let callsBeforeEnd = -1;
    let callsAfterEnd = -1;
    const runner = createReleaseCommandRunner((_command, _args, _options, callback) => {
      queueMicrotask(() => {
        childStdout.emit("data", "ordinary trailing output");
        callsBeforeEnd = stdout.mock.calls.length;
        childStdout.emit("end");
        callsAfterEnd = stdout.mock.calls.length;
        childStdout.emit("close");
        callback(null, "captured stdout", "");
      });
      return { stdout: childStdout, stderr: childStderr };
    });

    await expect(runner("pnpm", ["run", "build"])).resolves.toEqual({
      stdout: "captured stdout",
      stderr: "",
    });

    expect(callsBeforeEnd).toBe(0);
    expect(callsAfterEnd).toBe(1);
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      "ordinary trailing output",
    );
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

  it("reads candidate CSP headers through the exact Cloudflare Worker-version override", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html>", {
      headers: {
        "Content-Security-Policy": "default-src 'self'",
        "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
      },
      status: 200,
    }));

    await expect(readCandidateCspHeaders("https://spoonjoy.app/path", CANDIDATE_VERSION, fetchImpl)).resolves.toEqual(
      expect.any(Headers),
    );
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("https://spoonjoy.app/?candidate_csp_verification=1");
    expect(options).toEqual({
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "Cloudflare-Workers-Version-Overrides": `spoonjoy-v2="${CANDIDATE_VERSION}"`,
      },
      redirect: "error",
    });

    await expect(readCandidateCspHeaders("https://spoonjoy.app", CANDIDATE_VERSION, async () => (
      new Response("nope", { status: 503 })
    ))).rejects.toThrow("HTTP 503");
  });

  it("writes only the sanitized artifact schema", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-artifact-"));
    try {
      const artifact = {
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        phase: "canary",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "failed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "Bearer visible token=value\nnext",
        rollbackFailure: "password=visible",
        extraSecret: "must-not-be-written",
      } as ReleaseArtifact & { extraSecret: string };

      await writeReleaseArtifactFile(artifactDir, artifact);
      const payload = JSON.parse(await readFile(path.join(artifactDir, "production-release.json"), "utf8")) as Record<string, unknown>;

      expect(payload).toEqual({
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        phase: "canary",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "failed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "Bearer [REDACTED] token=[REDACTED] next",
        rollbackFailure: "password=[REDACTED]",
      });
      expect(payload).not.toHaveProperty("extraSecret");

      await writeReleaseArtifactFile(artifactDir, {
        status: "promoted",
        sourceSha: RELEASE_SHA,
        phase: "complete",
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
      });
      const minimal = JSON.parse(await readFile(path.join(artifactDir, "production-release.json"), "utf8"));
      expect(minimal).toEqual({
        status: "promoted",
        sourceSha: RELEASE_SHA,
        phase: "complete",
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("parses environment defaults and explicit CLI overrides", () => {
    expect(parseReleaseCliOptions([], { SOURCE_SHA: RELEASE_SHA })).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([], { GITHUB_SHA: RELEASE_SHA })).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([
      "--artifact-dir", "custom-artifacts", "--source-sha", RELEASE_SHA,
    ], { SOURCE_SHA: "b".repeat(40) })).toEqual({
      artifactDir: "custom-artifacts",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([
      "--source-sha", RELEASE_SHA, "--rollback-version-id", CANDIDATE_VERSION,
    ], {})).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      releaseSha: RELEASE_SHA,
      rollbackVersionId: CANDIDATE_VERSION,
    });
  });

  it.each([
    ["a missing SHA", [], {}],
    ["a missing source value", ["--source-sha"], {}],
    ["a source value that is another option", ["--source-sha", "--artifact-dir"], {}],
    ["a missing artifact value", ["--artifact-dir"], { SOURCE_SHA: RELEASE_SHA }],
    ["an invalid rollback version", ["--rollback-version-id", "latest"], { SOURCE_SHA: RELEASE_SHA }],
    ["an unknown option", ["--wat"], { SOURCE_SHA: RELEASE_SHA }],
  ])("rejects %s", (_label, argv, env) => {
    expect(() => parseReleaseCliOptions(argv, env)).toThrow();
  });

  it("runs the CLI with injected commands and the authoritative Wrangler PostHog host", async () => {
    vi.stubEnv("SOURCE_SHA", RELEASE_SHA);
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
          ? [workerVersion(PREVIOUS_VERSION, "previous")]
          : [workerVersion(CANDIDATE_VERSION, RELEASE_SHA), workerVersion(PREVIOUS_VERSION, "previous")]), "");
        return;
      }
      callback(null, responses[key] ?? "", "");
    });
    const writeReleaseArtifact = vi.fn(async () => undefined);

    const result = await runProductionReleaseCli({
      ...postHogArtifactReaderDeps(CUSTOM_POSTHOG_HOST),
      execFileImpl,
      readCandidateCspHeaders: async () => new Headers({
        "Content-Security-Policy": buildContentSecurityPolicy(VALID_CSP_NONCE, {
          VITE_POSTHOG_HOST: CUSTOM_POSTHOG_HOST,
        }),
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
      }),
      readWranglerConfig: async () => ({
        vars: { VITE_POSTHOG_HOST: CUSTOM_POSTHOG_HOST },
      }),
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
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });

    await expect(runProductionReleaseCli({
      argv: ["--source-sha", RELEASE_SHA, "--rollback-version-id", CANDIDATE_VERSION],
      env: { PATH: "/test/bin" },
      readCandidateCspHeaders: async () => new Headers({
        "Content-Security-Policy": VALID_CANDIDATE_CSP,
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
      }),
      readPublicWorkerVersion: async () => CANDIDATE_VERSION,
      runCommand,
      sleep: async () => undefined,
      writeReleaseArtifact: async () => undefined,
    })).resolves.toMatchObject({ status: "rollback_promoted" });
  });

  it("uses the default candidate/public readers and delay in CLI verification", async () => {
    vi.useFakeTimers();
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("<html></html>", {
        headers: {
          "Content-Security-Policy": VALID_CANDIDATE_CSP,
          "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
          "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
        },
        status: 200,
      }))
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
      ...postHogArtifactReaderDeps("https://us.i.posthog.com"),
      env: { SOURCE_SHA: RELEASE_SHA, PATH: "/test/bin" },
      readWranglerConfig: async () => ({
        vars: { VITE_POSTHOG_HOST: "https://us.i.posthog.com" },
      }),
      runCommand,
      verificationAttempts: 2,
      writeReleaseArtifact: async () => undefined,
    });
    await vi.runAllTimersAsync();

    await expect(release).resolves.toMatchObject({ status: "promoted" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        "Cloudflare-Workers-Version-Overrides": buildWorkerVersionOverride("spoonjoy-v2", CANDIDATE_VERSION),
      },
    });
  });

  it("uses the default migration reader and artifact writer", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-cli-"));
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": JSON.stringify([{ Name: "0023_recipe_cover_prompt_lineage.sql" }]),
    });
    try {
      const result = await runProductionReleaseCli({
        ...postHogArtifactReaderDeps("https://us.i.posthog.com"),
        argv: ["--artifact-dir", artifactDir],
        env: { SOURCE_SHA: RELEASE_SHA, PATH: "/test/bin" },
        readCandidateCspHeaders: async () => new Headers({
          "Content-Security-Policy": VALID_CANDIDATE_CSP,
          "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
          "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
        }),
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
});
