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
const PRODUCT_BOUNDARY_SHA = "d".repeat(40);
const PREVIOUS_PRODUCT_SHA = "e".repeat(40);
const PREVIOUS_DEPLOYMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAGED_DEPLOYMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROMOTED_DEPLOYMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RESTORED_DEPLOYMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REPLACEMENT_DEPLOYMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CLOUDFLARE_ACCOUNT_ID = "1".repeat(32);
const D1_DATABASE_ID = "12345678-1234-4123-8123-123456789abc";
const D1_API_TOKEN = "d1-secret";
const WRANGLER_CONFIG = JSON.stringify({
  d1_databases: [{
    binding: "DB",
    database_name: "spoonjoy",
    database_id: D1_DATABASE_ID,
  }],
});
const PROTOCOL_BOUNDARY_LOG_COMMAND =
  "git log --diff-filter=A --format=%H --reverse -- workers/cook-session-protocol-v1-boundary";
const CANARY_UPLOAD_COMMAND = `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`;
const CANARY_STAGE_COMMAND = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`;
const CANARY_PROMOTE_COMMAND = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`;
const CANARY_RESTORE_COMMAND = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`;
const ROLLBACK_STAGE_COMMAND = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage rollback ${RELEASE_SHA} for inspection`;
const ROLLBACK_PROMOTE_COMMAND = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`;
const ROLLBACK_RESTORE_COMMAND = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
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

function isStageTrafficMutation(command: string | undefined): boolean {
  return command === CANARY_STAGE_COMMAND || command === ROLLBACK_STAGE_COMMAND;
}

interface RecordedCommand {
  command: string;
  args: string[];
}

function wranglerArgv(call: RecordedCommand): readonly string[] | null {
  if (call.command === "wrangler") return call.args;
  if (call.command === "npx" && call.args[0] === "wrangler") return call.args.slice(1);
  if (
    call.command === "pnpm" &&
    call.args[0] === "exec" &&
    call.args[1] === "wrangler"
  ) {
    return call.args.slice(2);
  }
  return null;
}

function isRemoteMutationCommand(call: RecordedCommand): boolean {
  const args = wranglerArgv(call);
  if (!args) return false;
  if (args[0] === "deployments" && args[1] === "list") return false;
  if (args[0] === "versions" && (args[1] === "list" || args[1] === "view")) return false;
  if (args[0] === "d1") {
    if (args[1] === "migrations" && args[2] === "list") return false;
    if (args.includes("--local")) return false;
    if (
      args[1] === "migrations" &&
      args[2] === "apply" &&
      !args.includes("--remote")
    ) return false;
  }
  return true;
}

function remoteMutationCommands(commands: readonly RecordedCommand[]) {
  return commands
    .filter(isRemoteMutationCommand)
    .map(({ command, args }) => commandKey(command, args));
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
    metadata: { created_on: createdOn, source: "wrangler" },
  };
}

function deploymentPayload(
  versionId: string,
  createdOn = "2026-07-15T00:05:00Z",
  deploymentId = versionId === PREVIOUS_VERSION ? PREVIOUS_DEPLOYMENT : PROMOTED_DEPLOYMENT,
): string {
  return JSON.stringify([{
    id: deploymentId,
    created_on: createdOn,
    versions: [{ version_id: versionId, percentage: 100 }],
  }]);
}

function stagedDeploymentPayload(
  previousVersionId = PREVIOUS_VERSION,
  candidateVersionId = CANDIDATE_VERSION,
  deploymentId = STAGED_DEPLOYMENT,
): string {
  return JSON.stringify([{
    id: deploymentId,
    created_on: "2026-07-15T00:04:00Z",
    versions: [
      { version_id: candidateVersionId, percentage: 0 },
      { version_id: previousVersionId, percentage: 100 },
    ],
  }]);
}

function withCurrentDeploymentId(payload: string, deploymentId: string): string {
  try {
    const deployments = JSON.parse(payload) as unknown;
    if (!Array.isArray(deployments) || deployments.length === 0) return payload;
    let newestIndex = 0;
    for (let index = 1; index < deployments.length; index += 1) {
      const newest = deployments[newestIndex] as { created_on?: unknown } | null;
      const candidate = deployments[index] as { created_on?: unknown } | null;
      if (
        typeof candidate?.created_on === "string" &&
        typeof newest?.created_on === "string" &&
        candidate.created_on > newest.created_on
      ) {
        newestIndex = index;
      }
    }
    const newest = deployments[newestIndex];
    if (!newest || typeof newest !== "object" || Array.isArray(newest)) return payload;
    const copy = [...deployments];
    copy[newestIndex] = { ...newest, id: deploymentId };
    return JSON.stringify(copy);
  } catch {
    return payload;
  }
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
  optionsOrEvents: {
    acceptedMutationErrors?: readonly string[];
    exactDeploymentSequence?: boolean;
    exactMigrationSequence?: boolean;
    preserveDeploymentIds?: boolean;
  } | string[] = {},
) {
  const events = Array.isArray(optionsOrEvents) ? optionsOrEvents : [];
  const options = Array.isArray(optionsOrEvents) ? {} : optionsOrEvents;
  const responses: Record<string, string | readonly string[]> = {
    "git rev-parse HEAD": RELEASE_SHA,
    "git status --porcelain --untracked-files=no": "",
    "git rev-parse HEAD^{tree}": TREE_HASH,
    [PROTOCOL_BOUNDARY_LOG_COMMAND]: PRODUCT_BOUNDARY_SHA,
    "git show HEAD:wrangler.json": WRANGLER_CONFIG,
    "git show HEAD:migrations/0024_add_release_marker.sql":
      "CREATE TABLE ReleaseMarker (id TEXT PRIMARY KEY);",
    "pnpm exec wrangler d1 migrations list DB --remote": [
      JSON.stringify([{ Name: "0024_add_release_marker.sql" }]),
      JSON.stringify([{ Name: "0024_add_release_marker.sql" }]),
      "No migrations to apply!",
    ],
    "pnpm exec wrangler deployments list --json": [
      JSON.stringify([
        {
          id: "99999999-9999-4999-8999-999999999999",
          created_on: "2026-07-14T00:00:00Z",
          versions: [{ version_id: "00000000-0000-4000-8000-000000000000", percentage: 100 }],
        },
        {
          id: PREVIOUS_DEPLOYMENT,
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
        },
      ]),
      JSON.stringify([
        {
          id: PROMOTED_DEPLOYMENT,
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
    [`pnpm exec wrangler versions view ${PREVIOUS_VERSION} --json`]: JSON.stringify(
      workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA, "2026-07-14T00:00:00Z"),
    ),
    [`pnpm exec wrangler versions view ${CANDIDATE_VERSION} --json`]: JSON.stringify(
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-07-15T00:00:00Z", 2),
    ),
  };

  const callCounts = new Map<string, number>();
  let legacyDeploymentResponseIndex = 0;
  let exactDeploymentResponseIndex = 0;
  const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
    const key = commandKey(command, args);
    events.push(`command:${key}`);
    const callIndex = callCounts.get(key) ?? 0;
    callCounts.set(key, callIndex + 1);
    if (key === "pnpm exec wrangler d1 migrations list DB --remote") {
      const configuredMigrations = overrides[key];
      if (configuredMigrations !== undefined && options.exactMigrationSequence !== true) {
        const response = Array.isArray(configuredMigrations)
          ? configuredMigrations[Math.min(callIndex, configuredMigrations.length - 1)]
          : callIndex >= 2 && !/no migrations to apply/i.test(configuredMigrations)
            ? "No migrations to apply!"
            : configuredMigrations;
        if (response instanceof Error) throw response;
        return { stdout: response, stderr: "" };
      }
    }
    if (
      command === "pnpm" &&
      args[0] === "exec" &&
      args[1] === "wrangler" &&
      args[2] === "versions" &&
      args[3] === "view" &&
      overrides[key] === undefined &&
      overrides["pnpm exec wrangler versions list --json"] !== undefined
    ) {
      const requestedVersionId = args[4];
      const configuredInventory = overrides["pnpm exec wrangler versions list --json"];
      const inventoryResponse = Array.isArray(configuredInventory)
        ? configuredInventory[0]
        : configuredInventory;
      if (inventoryResponse instanceof Error) throw inventoryResponse;
      let inventory: unknown = [];
      try {
        inventory = JSON.parse(inventoryResponse);
      } catch {
        return { stdout: inventoryResponse, stderr: "" };
      }
      const matchingVersion = Array.isArray(inventory)
        ? inventory.find((row) => (
            row && typeof row === "object" && !Array.isArray(row) &&
            (row as { id?: unknown }).id === requestedVersionId
          ))
        : undefined;
      return { stdout: JSON.stringify(matchingVersion ?? {}), stderr: "" };
    }
    if (
      key === "pnpm exec wrangler deployments list --json" &&
      options.exactDeploymentSequence === true &&
      overrides[key] !== undefined
    ) {
      const commandHistory = runCommand.mock.calls
        .slice(0, -1)
        .map(([pastCommand, pastArgs]) => commandKey(pastCommand, pastArgs));
      const trafficMutations = commandHistory.filter((pastKey) => (
        pastKey.startsWith("pnpm exec wrangler versions deploy ") ||
        pastKey.startsWith("pnpm exec wrangler deploy ")
      ));
      const lastTrafficMutation = trafficMutations.at(-1);
      const deploymentReadsAfterMutation = lastTrafficMutation
        ? commandHistory.slice(commandHistory.lastIndexOf(lastTrafficMutation) + 1)
          .filter((pastKey) => pastKey === key).length
        : 0;
      const mutationFailed = lastTrafficMutation !== undefined &&
        overrides[lastTrafficMutation] instanceof Error &&
        !options.acceptedMutationErrors?.includes(lastTrafficMutation);
      const migrationListCount = commandHistory.filter((pastKey) => (
        pastKey === "pnpm exec wrangler d1 migrations list DB --remote"
      )).length;
      const fullPreflightCount = commandHistory.filter((pastKey) => (
        pastKey === "pnpm run deploy:preflight"
      )).length;
      if (
        migrationListCount >= 3 &&
        fullPreflightCount === 1 &&
        options.preserveDeploymentIds !== true
      ) {
        return { stdout: deploymentPayload(PREVIOUS_VERSION), stderr: "" };
      }
      if (
        !mutationFailed &&
        options.preserveDeploymentIds !== true &&
        lastTrafficMutation &&
        !isStageTrafficMutation(lastTrafficMutation) &&
        deploymentReadsAfterMutation === 0
      ) {
        const activeVersion = lastTrafficMutation.includes(`${PREVIOUS_VERSION}@100%`)
          ? PREVIOUS_VERSION
          : CANDIDATE_VERSION;
        const deploymentId = lastTrafficMutation.includes("Restore after failed")
          ? RESTORED_DEPLOYMENT
          : PROMOTED_DEPLOYMENT;
        return {
          stdout: deploymentPayload(activeVersion, "2026-07-15T00:05:00Z", deploymentId),
          stderr: "",
        };
      }
      const configuredDeployments = overrides[key];
      const response = Array.isArray(configuredDeployments)
        ? configuredDeployments[Math.min(
            exactDeploymentResponseIndex++,
            configuredDeployments.length - 1,
          )]
        : configuredDeployments;
      if (response instanceof Error) throw response;
      if (
        options.preserveDeploymentIds !== true &&
        !mutationFailed &&
        lastTrafficMutation?.includes("Restore after failed") &&
        typeof response === "string"
      ) {
        try {
          if (selectCurrentProductionVersion(response) === PREVIOUS_VERSION) {
            return {
              stdout: deploymentPayload(
                PREVIOUS_VERSION,
                "2026-07-15T00:06:00Z",
                RESTORED_DEPLOYMENT,
              ),
              stderr: "",
            };
          }
        } catch {
          // Preserve malformed/error fixtures for the runtime parser.
        }
      }
      return { stdout: response, stderr: "" };
    }
    if (
      key === "pnpm exec wrangler deployments list --json" &&
      options.exactDeploymentSequence !== true
    ) {
      const commandHistory = runCommand.mock.calls
        .slice(0, -1)
        .map(([pastCommand, pastArgs]) => commandKey(pastCommand, pastArgs));
      const trafficMutations = commandHistory.filter((pastKey) => (
        pastKey.startsWith("pnpm exec wrangler versions deploy ") ||
        pastKey.startsWith("pnpm exec wrangler deploy ")
      ));
      const lastTrafficMutation = trafficMutations.at(-1);
      const callsSinceLastMutation = lastTrafficMutation
        ? commandHistory.slice(commandHistory.lastIndexOf(lastTrafficMutation) + 1)
          .filter((pastKey) => pastKey === "pnpm exec wrangler deployments list --json").length
        : 0;
      const mutationFailed = lastTrafficMutation !== undefined &&
        overrides[lastTrafficMutation] instanceof Error &&
        !options.acceptedMutationErrors?.includes(lastTrafficMutation);
      if (!mutationFailed && isStageTrafficMutation(lastTrafficMutation)) {
        return { stdout: stagedDeploymentPayload(), stderr: "" };
      }
      if (!mutationFailed && lastTrafficMutation && callsSinceLastMutation === 0) {
        const activeVersion = lastTrafficMutation.includes(`${PREVIOUS_VERSION}@100%`)
          ? PREVIOUS_VERSION
          : CANDIDATE_VERSION;
        const deploymentId = lastTrafficMutation.includes("Restore after failed")
          ? RESTORED_DEPLOYMENT
          : PROMOTED_DEPLOYMENT;
        return {
          stdout: deploymentPayload(activeVersion, "2026-07-15T00:05:00Z", deploymentId),
          stderr: "",
        };
      }
      if (mutationFailed) {
        const predecessorMutation = trafficMutations.slice(0, -1).reverse().find((pastMutation) => !(
          overrides[pastMutation] instanceof Error &&
          !options.acceptedMutationErrors?.includes(pastMutation)
        ));
        if (isStageTrafficMutation(predecessorMutation)) {
          return { stdout: stagedDeploymentPayload(), stderr: "" };
        }
        if (predecessorMutation) {
          return {
            stdout: deploymentPayload(CANDIDATE_VERSION, "2026-07-15T00:05:00Z", PROMOTED_DEPLOYMENT),
            stderr: "",
          };
        }
        return { stdout: deploymentPayload(PREVIOUS_VERSION), stderr: "" };
      }

      const configuredDeployments = overrides[key];
      if (configuredDeployments !== undefined) {
        if (!lastTrafficMutation) {
          legacyDeploymentResponseIndex = Math.max(legacyDeploymentResponseIndex, 1);
        }
        const response = Array.isArray(configuredDeployments)
          ? configuredDeployments[Math.min(
              lastTrafficMutation ? legacyDeploymentResponseIndex++ : 0,
              configuredDeployments.length - 1,
            )]
          : configuredDeployments;
        if (response instanceof Error) throw response;
        if (
          options.preserveDeploymentIds !== true &&
          !mutationFailed &&
          lastTrafficMutation &&
          typeof response === "string"
        ) {
          const deploymentId = lastTrafficMutation.includes("Restore after failed")
            ? RESTORED_DEPLOYMENT
            : isStageTrafficMutation(lastTrafficMutation)
              ? STAGED_DEPLOYMENT
              : PROMOTED_DEPLOYMENT;
          return { stdout: withCurrentDeploymentId(response, deploymentId), stderr: "" };
        }
        return { stdout: response, stderr: "" };
      }

      const activeVersion = lastTrafficMutation?.includes(`${PREVIOUS_VERSION}@100%`)
        ? PREVIOUS_VERSION
        : (lastTrafficMutation ? CANDIDATE_VERSION : PREVIOUS_VERSION);
      const deploymentId = isStageTrafficMutation(lastTrafficMutation)
        ? STAGED_DEPLOYMENT
        : lastTrafficMutation?.includes("Restore after failed")
          ? RESTORED_DEPLOYMENT
          : lastTrafficMutation
            ? PROMOTED_DEPLOYMENT
            : PREVIOUS_DEPLOYMENT;
      return { stdout: deploymentPayload(activeVersion, "2026-07-15T00:05:00Z", deploymentId), stderr: "" };
    }
    const configured = overrides[key] ?? responses[key] ?? "";
    const response = Array.isArray(configured)
      ? configured[Math.min(callIndex, configured.length - 1)]
      : configured;
    if (response instanceof Error) throw response;
    return { stdout: response, stderr: "" };
  });
  return runCommand;
}

function recordedCommandCalls(runCommand: ReturnType<typeof successfulRunner>): RecordedCommand[] {
  return runCommand.mock.calls.map(([command, args]) => ({ command, args: [...args] }));
}

function recordedCommands(runCommand: ReturnType<typeof successfulRunner>): string[] {
  const calls = recordedCommandCalls(runCommand);
  const rollbackFlow = calls.some(({ command, args }) => (
    command === "git" && args.join(" ") === "rev-parse origin/main"
  ));
  let d1ListSeen = false;
  let treeReadCount = 0;
  let statusReadCount = 0;
  let rollbackVersionViewMapped = false;
  let latestTrafficMutation: string | undefined;
  let deploymentReadsAfterMutation = 0;
  let d1ListCount = 0;
  let hidePostMigrationDeploymentRead = false;
  const projected: string[] = [];

  for (const call of calls) {
    const display = commandKey(call.command, call.args);
    if (
      display === PROTOCOL_BOUNDARY_LOG_COMMAND ||
      display === "git show HEAD:wrangler.json" ||
      display.startsWith("git show HEAD:migrations/")
    ) {
      continue;
    }
    if (display === "git rev-parse HEAD^{tree}") {
      treeReadCount += 1;
      if (treeReadCount > 1) continue;
    }
    if (display === "git status --porcelain --untracked-files=no") {
      statusReadCount += 1;
      if (statusReadCount > (rollbackFlow ? 1 : 2)) continue;
    }
    if (display === "pnpm exec wrangler d1 migrations list DB --remote") {
      d1ListCount += 1;
      if (d1ListCount >= 3) hidePostMigrationDeploymentRead = true;
      if (d1ListSeen) continue;
      d1ListSeen = true;
    }
    if (display.startsWith("pnpm exec wrangler versions view ")) {
      if (rollbackFlow && !rollbackVersionViewMapped) {
        projected.push("pnpm exec wrangler versions list --json");
        rollbackVersionViewMapped = true;
      }
      continue;
    }
    if (
      display.startsWith("pnpm exec wrangler versions deploy ") ||
      display.startsWith("pnpm exec wrangler deploy ")
    ) {
      latestTrafficMutation = display;
      deploymentReadsAfterMutation = 0;
    }
    if (display === "pnpm exec wrangler deployments list --json") {
      if (hidePostMigrationDeploymentRead) {
        hidePostMigrationDeploymentRead = false;
        continue;
      }
      if (latestTrafficMutation) {
        deploymentReadsAfterMutation += 1;
        const stageMutation = isStageTrafficMutation(latestTrafficMutation);
        if (!stageMutation && deploymentReadsAfterMutation === 1) continue;
      }
    }
    projected.push(display);
  }
  return projected;
}

function successfulD1Fetch() {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result: [{ success: true, results: [], meta: {} }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("remote mutation command oracle", () => {
  it.each([
    ["a bare Worker deploy", { command: "pnpm", args: ["exec", "wrangler", "deploy"] }, true],
    ["a tagged Worker deploy", { command: "pnpm", args: ["exec", "wrangler", "deploy", "--tag", "abc"] }, true],
    ["a direct Wrangler rollback", { command: "wrangler", args: ["rollback"] }, true],
    ["an npx Worker version upload", { command: "npx", args: ["wrangler", "versions", "upload", "--tag", "abc"] }, true],
    ["a Worker version traffic deploy", { command: "pnpm", args: ["exec", "wrangler", "versions", "deploy", "version@100%"] }, true],
    ["a remote D1 apply with later environment flags", { command: "pnpm", args: ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--env", "qa", "--remote"] }, true],
    ["a Worker deletion", { command: "pnpm", args: ["exec", "wrangler", "delete", "--force"] }, true],
    ["a remote D1 execute", { command: "pnpm", args: ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--command", "DELETE"] }, true],
    ["a D1 database deletion", { command: "pnpm", args: ["exec", "wrangler", "d1", "delete", "DB", "--skip-confirmation"] }, true],
    ["an unknown Wrangler command", { command: "pnpm", args: ["exec", "wrangler", "future-command"] }, true],
    ["a deployments inspection", { command: "pnpm", args: ["exec", "wrangler", "deployments", "list", "--json"] }, false],
    ["a versions inspection", { command: "pnpm", args: ["exec", "wrangler", "versions", "list", "--json"] }, false],
    ["an exact version inspection", { command: "pnpm", args: ["exec", "wrangler", "versions", "view", PREVIOUS_VERSION, "--json"] }, false],
    ["a local D1 apply", { command: "pnpm", args: ["exec", "wrangler", "d1", "migrations", "apply", "DB"] }, false],
    ["an explicit local D1 execute", { command: "pnpm", args: ["exec", "wrangler", "d1", "execute", "DB", "--local", "--command", "DELETE"] }, false],
    ["an invalid combined executable name", { command: "pnpm exec", args: ["wrangler", "deploy"] }, false],
    ["an unrelated command", { command: "git", args: ["deploy"] }, false],
  ] satisfies ReadonlyArray<readonly [string, RecordedCommand, boolean]>)
  ("classifies %s", (_label, call, expected) => {
    expect(isRemoteMutationCommand(call)).toBe(expected);
    expect(remoteMutationCommands([call])).toEqual(expected ? [commandKey(call.command, call.args)] : []);
  });
});

describe("exact release ownership boundaries", () => {
  it("rejects a malformed deployment UUID even when its topology is valid", () => {
    expect(() => selectCurrentProductionVersion(deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:05:00Z",
      "deployment-current",
    ))).toThrow("deployment ID");
  });

  it("resolves a rollback target older than Wrangler's ten-version list by exact ID", async () => {
    const recentVersions = Array.from({ length: 10 }, (_, index) => workerVersion(
      `${String(index + 1).padStart(8, "0")}-3333-4333-8333-333333333333`,
      "f".repeat(40),
      `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      index + 1,
    ));
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify(recentVersions),
      [`pnpm exec wrangler versions view ${CANDIDATE_VERSION} --json`]: JSON.stringify(
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      ),
      [`pnpm exec wrangler versions view ${PREVIOUS_VERSION} --json`]: JSON.stringify(
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ),
    });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).resolves.toMatchObject({
      status: "rollback_promoted",
      candidateVersionId: CANDIDATE_VERSION,
    });

    expect(recordedCommandCalls(runCommand)).toContainEqual({
      command: "pnpm",
      args: ["exec", "wrangler", "versions", "view", CANDIDATE_VERSION, "--json"],
    });
    expect(recordedCommandCalls(runCommand)).toContainEqual({
      command: "pnpm",
      args: ["exec", "wrangler", "versions", "view", PREVIOUS_VERSION, "--json"],
    });
    expect(recordedCommandCalls(runCommand)).not.toContainEqual({
      command: "pnpm exec",
      args: ["wrangler", "versions", "view", CANDIDATE_VERSION, "--json"],
    });
    expect(recordedCommandCalls(runCommand).map(({ command, args }) => commandKey(command, args)))
      .not.toContain("pnpm exec wrangler versions list --json");
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["an array", JSON.stringify([workerVersion(CANDIDATE_VERSION, RELEASE_SHA)])],
    ["the wrong ID", JSON.stringify(workerVersion(PREVIOUS_VERSION, RELEASE_SHA))],
    ["a malformed creation time", JSON.stringify(workerVersion(
      CANDIDATE_VERSION,
      RELEASE_SHA,
      "not-a-time",
    ))],
    ["a missing source", JSON.stringify({
      ...workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
      metadata: { created_on: "2026-07-15T00:00:00Z" },
    })],
    ["an invalid version number", JSON.stringify(workerVersion(
      CANDIDATE_VERSION,
      RELEASE_SHA,
      "2026-07-15T00:00:00Z",
      "two",
    ))],
    ["an invalid tag", JSON.stringify(workerVersion(CANDIDATE_VERSION, 42))],
  ])("rejects exact version view output containing %s", async (_label, payload) => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      [`pnpm exec wrangler versions view ${CANDIDATE_VERSION} --json`]: payload,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
    });

    await expect(runProductionRollback(rollbackDeps(runCommand))).rejects.toThrow("version output");
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
  });

  it("strictly parses malformed active-version detail JSON", async () => {
    const runCommand = successfulRunner({
      [`pnpm exec wrangler versions view ${PREVIOUS_VERSION} --json`]: "not-json",
    });

    await expect(runProductionCanaryRelease(releaseDeps(runCommand))).rejects.toThrow(
      "Wrangler version output was not valid JSON.",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
  });

  it.each([
    ["missing history", ""],
    ["malformed history", "main"],
    ["ambiguous history", `${PRODUCT_BOUNDARY_SHA}\n${"f".repeat(40)}`],
    ["a configured mismatch", "f".repeat(40)],
  ])("rejects protocol-v1 canary when marker history has %s", async (_label, markerHistory) => {
    const runCommand = successfulRunner({
      [PROTOCOL_BOUNDARY_LOG_COMMAND]: markerHistory,
    });
    const deps = releaseDeps(runCommand);
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-marker-provenance-"));
    deps.artifactDir = artifactDir;
    deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);

    try {
      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("protocol-v1 boundary marker");

      expect(recordedCommandCalls(runCommand)).toContainEqual({
        command: "git",
        args: [
          "log",
          "--diff-filter=A",
          "--format=%H",
          "--reverse",
          "--",
          "workers/cook-session-protocol-v1-boundary",
        ],
      });
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
      const artifact = JSON.parse(
        await readFile(path.join(artifactDir, "production-release.json"), "utf8"),
      ) as ReleaseArtifact;
      expect(artifact).toMatchObject({
        status: "failed_before_stage",
        phase: "provenance",
        migrationApply: "not_started",
      });
      expect(artifact).not.toHaveProperty("treeHash");
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("writes a provenance-valid rollback artifact when protocol marker history is invalid", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      [PROTOCOL_BOUNDARY_LOG_COMMAND]: "",
    });
    const deps = rollbackDeps(runCommand);
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-rollback-marker-provenance-"));
    deps.artifactDir = artifactDir;
    deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);

    try {
      await expect(runProductionRollback(deps)).rejects.toThrow("protocol-v1 boundary marker");
      const artifact = JSON.parse(
        await readFile(path.join(artifactDir, "production-release.json"), "utf8"),
      ) as ReleaseArtifact;
      expect(artifact).toMatchObject({
        status: "failed_before_stage",
        phase: "provenance",
        migrationApply: "not_needed",
      });
      expect(artifact).not.toHaveProperty("treeHash");
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it.each(["atomic-bootstrap", "atomic-product-activation"] as const)(
    "keeps %s pre-boundary and never queries marker history",
    async (releaseMode) => {
      const runCommand = successfulRunner({
        [PROTOCOL_BOUNDARY_LOG_COMMAND]: new Error("must not inspect protocol marker"),
      });
      const deps = {
        ...atomicReleaseDeps(runCommand, releaseMode),
        readBootstrapProbe: vi.fn(async () => ({
          status: 200,
          workerVersionHeader: CANDIDATE_VERSION,
          body: {
            ok: true,
            storage: "sqlite",
            residue: 0,
            workerVersionId: CANDIDATE_VERSION,
          },
        })),
      };

      await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ releaseMode });
      expect(recordedCommands(runCommand)).not.toContain(PROTOCOL_BOUNDARY_LOG_COMMAND);
    },
  );
});

function releaseDeps(runCommand: ReleaseCommandRunner) {
  const d1Fetch = successfulD1Fetch();
  return {
    artifactDir: "mcp-oauth-canary-artifacts",
    d1Fetch,
    env: {
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_D1_API_TOKEN: D1_API_TOKEN,
      CLOUDFLARE_WORKERS_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    },
    postHogHost: "https://us.i.posthog.com",
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
      CLOUDFLARE_ACCOUNT_ID,
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
    releaseMode: "protocol-v1-canary" as const,
    protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
    rollbackVersionId: CANDIDATE_VERSION,
    runCommand,
    sleep: vi.fn(async () => undefined),
    verificationAttempts: 2,
    writeReleaseArtifact: vi.fn(async () => undefined),
  };
}

describe("immutable migration apply boundary", () => {
  const pendingMigration = JSON.stringify([{ Name: "0024_add_release_marker.sql" }]);
  const noPendingMigrations = "No migrations to apply!";
  const reviewedSql = "CREATE TABLE ReleaseMarker (id TEXT PRIMARY KEY);";
  const d1QueryUrl =
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
  const expectedMigrationSql = `${reviewedSql}
								INSERT INTO d1_migrations (name)
								values ('0024_add_release_marker.sql');
						`;

  it("reviews immutable Git bytes and revalidates exact argv before and after apply", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": [
        pendingMigration,
        pendingMigration,
        noPendingMigrations,
      ],
      "git show HEAD:migrations/0024_add_release_marker.sql": reviewedSql,
    }, { exactMigrationSequence: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({
      status: "promoted",
      migrationApply: "succeeded",
    });

    expect(recordedCommandCalls(runCommand).filter(({ command, args }) => (
      command === "git" && args[0] === "show" && args[1]?.startsWith("HEAD:migrations/")
    ))).toEqual(Array.from({ length: 3 }, () => ({
      command: "git",
      args: ["show", "HEAD:migrations/0024_add_release_marker.sql"],
    })));
    expect(recordedCommandCalls(runCommand)).toContainEqual({
      command: "git",
      args: ["show", "HEAD:wrangler.json"],
    });
    expect(recordedCommandCalls(runCommand).filter(({ command, args }) => (
      command === "pnpm" &&
      args.join(" ") === "exec wrangler d1 migrations list DB --remote"
    ))).toHaveLength(3);
    expect(deps.d1Fetch).toHaveBeenCalledTimes(1);
    const [url, request] = deps.d1Fetch.mock.calls[0];
    expect(url).toBe(d1QueryUrl);
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>).Authorization)
      .toBe(`Bearer ${D1_API_TOKEN}`);
    expect((request?.headers as Record<string, string>)["Content-Type"])
      .toBe("application/json");
    expect(request?.body).toBe(JSON.stringify({ sql: expectedMigrationSql }));
    expect(recordedCommands(runCommand)).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
  });

  it("uses the runtime fetch implementation when no D1 fetch dependency is injected", async () => {
    const runCommand = successfulRunner();
    const runtimeFetch = successfulD1Fetch();
    vi.stubGlobal("fetch", runtimeFetch);
    const { d1Fetch: _omitted, ...deps } = releaseDeps(runCommand);

    try {
      await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({
        status: "promoted",
        migrationApply: "succeeded",
      });
      expect(runtimeFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    {
      label: "a rejected request",
      response: new Error(`transport ${D1_API_TOKEN} ${reviewedSql}`),
      failure: "Cloudflare D1 migration query request failed.",
    },
    {
      label: "an HTTP error",
      response: new Response(`${D1_API_TOKEN} ${reviewedSql}`, { status: 503 }),
      failure: "Cloudflare D1 migration query failed with HTTP 503.",
    },
    {
      label: "malformed JSON",
      response: new Response(`${D1_API_TOKEN} ${reviewedSql}`, { status: 200 }),
      failure: "Cloudflare D1 migration query returned malformed JSON.",
    },
    {
      label: "an unsuccessful envelope",
      response: new Response(JSON.stringify({
        success: false,
        errors: [{ message: `${D1_API_TOKEN} ${reviewedSql}` }],
        result: [{ success: true }],
      }), { status: 200 }),
      failure: "Cloudflare D1 migration query did not report complete success.",
    },
    {
      label: "reported envelope errors",
      response: new Response(JSON.stringify({
        success: true,
        errors: [{ message: `${D1_API_TOKEN} ${reviewedSql}` }],
        result: [{ success: true }],
      }), { status: 200 }),
      failure: "Cloudflare D1 migration query did not report complete success.",
    },
    {
      label: "an empty result",
      response: new Response(JSON.stringify({ success: true, errors: [], result: [] }), {
        status: 200,
      }),
      failure: "Cloudflare D1 migration query did not report complete success.",
    },
    {
      label: "an unsuccessful result",
      response: new Response(JSON.stringify({
        success: true,
        errors: [],
        result: [{ success: false, error: `${D1_API_TOKEN} ${reviewedSql}` }],
      }), { status: 200 }),
      failure: "Cloudflare D1 migration query did not report complete success.",
    },
  ] as const)("sanitizes $label from the D1 response boundary", async ({ response, failure }) => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    if (response instanceof Error) deps.d1Fetch.mockRejectedValueOnce(response);
    else deps.d1Fetch.mockResolvedValueOnce(response);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);

    const artifact = deps.writeReleaseArtifact.mock.calls[0][0];
    expect(artifact).toMatchObject({
      status: "forward_repair_required",
      phase: "migration_apply",
      migrationApply: "failed",
      failure,
    });
    expect(JSON.stringify(artifact)).not.toContain(D1_API_TOKEN);
    expect(JSON.stringify(artifact)).not.toContain(reviewedSql);
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
  });

  it("applies multiple reviewed migrations in one ordered transaction with an immutable custom table", async () => {
    const secondMigration = "0025_add_second_marker.sql";
    const secondSql = "CREATE TABLE SecondReleaseMarker (id TEXT PRIMARY KEY);";
    const pending = JSON.stringify([
      { Name: "0024_add_release_marker.sql" },
      { Name: secondMigration },
    ]);
    const runCommand = successfulRunner({
      "git show HEAD:wrangler.json": JSON.stringify({
        d1_databases: [{
          binding: "DB",
          database_id: D1_DATABASE_ID,
          migrations_table: "release_migrations",
        }],
      }),
      [`git show HEAD:migrations/${secondMigration}`]: secondSql,
      "pnpm exec wrangler d1 migrations list DB --remote": [
        pending,
        pending,
        noPendingMigrations,
      ],
    }, { exactMigrationSequence: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({
      reviewedMigrations: ["0024_add_release_marker.sql", secondMigration],
      migrationApply: "succeeded",
    });

    expect(deps.d1Fetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(deps.d1Fetch.mock.calls[0][1]?.body)) as { sql: string };
    expect(requestBody.sql).toContain(
      "INSERT INTO release_migrations (name)\n\t\t\t\t\t\t\t\tvalues ('0024_add_release_marker.sql');",
    );
    expect(requestBody.sql).toContain(`${secondSql}
								INSERT INTO release_migrations (name)
								values ('${secondMigration}');
						`);
    expect(requestBody.sql.indexOf("0024_add_release_marker.sql"))
      .toBeLessThan(requestBody.sql.indexOf(secondMigration));
  });

  it.each([
    ["invalid JSON", "{", "was not valid JSON"],
    ["a non-object", "[]", "was not an object"],
    ["missing bindings", "{}", "did not declare production D1 bindings"],
    ["no production binding", JSON.stringify({ d1_databases: [null, [], { binding: "QA" }] }), "exactly one production DB binding"],
    ["duplicate production bindings", JSON.stringify({
      d1_databases: [
        { binding: "DB", database_id: D1_DATABASE_ID },
        { binding: "DB", database_id: D1_DATABASE_ID },
      ],
    }), "exactly one production DB binding"],
    ["an invalid database UUID", JSON.stringify({
      d1_databases: [{ binding: "DB", database_id: "production" }],
    }), "invalid production D1 database UUID"],
    ["an unsafe migrations table", JSON.stringify({
      d1_databases: [{
        binding: "DB",
        database_id: D1_DATABASE_ID,
        migrations_table: "d1_migrations; DROP TABLE Recipe",
      }],
    }), "invalid D1 migrations table"],
  ] as const)("fails before mutation when immutable Wrangler config has %s", async (
    _label,
    config,
    failure,
  ) => {
    const runCommand = successfulRunner({ "git show HEAD:wrangler.json": config });
    const deps = releaseDeps(runCommand);
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-d1-config-refusal-"));
    deps.artifactDir = artifactDir;
    deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);
    try {
      await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);
      expect(deps.d1Fetch).not.toHaveBeenCalled();
      const artifact = JSON.parse(
        await readFile(path.join(artifactDir, "production-release.json"), "utf8"),
      ) as ReleaseArtifact;
      expect(artifact).toMatchObject({
        status: "failed_before_stage",
        phase: "migration_review",
        migrationApply: "not_started",
        previousVersionId: PREVIOUS_VERSION,
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["a missing account ID", undefined, D1_API_TOKEN, "valid Cloudflare account ID"],
    ["an invalid account ID", "account-id", D1_API_TOKEN, "valid Cloudflare account ID"],
    ["a missing scoped token", CLOUDFLARE_ACCOUNT_ID, undefined, "valid scoped Cloudflare API token"],
    ["an invalid scoped token", CLOUDFLARE_ACCOUNT_ID, "bad token\n", "valid scoped Cloudflare API token"],
  ] as const)("fails before mutation with %s", async (_label, accountId, token, failure) => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    if (accountId === undefined) delete deps.env.CLOUDFLARE_ACCOUNT_ID;
    else deps.env.CLOUDFLARE_ACCOUNT_ID = accountId;
    if (token === undefined) delete deps.env.CLOUDFLARE_D1_API_TOKEN;
    else deps.env.CLOUDFLARE_D1_API_TOKEN = token;
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-d1-credential-refusal-"));
    deps.artifactDir = artifactDir;
    deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);
    try {
      await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);
      expect(deps.d1Fetch).not.toHaveBeenCalled();
      const artifact = JSON.parse(
        await readFile(path.join(artifactDir, "production-release.json"), "utf8"),
      ) as ReleaseArtifact;
      expect(artifact).toMatchObject({
        status: "failed_before_stage",
        phase: "migration_review",
        migrationApply: "not_started",
        previousVersionId: PREVIOUS_VERSION,
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "pending names changed before apply",
      overrides: {
        "pnpm exec wrangler d1 migrations list DB --remote": [
          pendingMigration,
          JSON.stringify([{ Name: "0025_other.sql" }]),
        ],
      },
      failure: "Pending migrations changed before D1 migration apply.",
      expectedStatus: "failed_before_stage",
      expectedPhase: "migration_review",
      expectedMigrationApply: "not_started",
    },
    {
      label: "a migration remained pending after apply",
      overrides: {
        "pnpm exec wrangler d1 migrations list DB --remote": [
          pendingMigration,
          pendingMigration,
          pendingMigration,
        ],
      },
      failure: "D1 migration apply did not clear the reviewed pending migrations.",
      expectedStatus: "forward_repair_required",
      expectedPhase: "full_preflight",
      expectedMigrationApply: "succeeded",
    },
    {
      label: "reviewed Git bytes changed before apply",
      overrides: {
        "pnpm exec wrangler d1 migrations list DB --remote": [pendingMigration, pendingMigration],
        "git show HEAD:migrations/0024_add_release_marker.sql": [
          reviewedSql,
          "CREATE TABLE ChangedBeforeApply (id TEXT PRIMARY KEY);",
        ],
      },
      failure: "Reviewed migration bytes changed during D1 migration apply.",
      expectedStatus: "failed_before_stage",
      expectedPhase: "migration_review",
      expectedMigrationApply: "not_started",
    },
    {
      label: "reviewed Git bytes changed after apply",
      overrides: {
        "pnpm exec wrangler d1 migrations list DB --remote": [
          pendingMigration,
          pendingMigration,
          noPendingMigrations,
        ],
        "git show HEAD:migrations/0024_add_release_marker.sql": [
          reviewedSql,
          reviewedSql,
          "CREATE TABLE ChangedAfterApply (id TEXT PRIMARY KEY);",
        ],
      },
      failure: "Reviewed migration bytes changed during D1 migration apply.",
      expectedStatus: "forward_repair_required",
      expectedPhase: "full_preflight",
      expectedMigrationApply: "succeeded",
    },
    {
      label: "the tracked tree changed before apply",
      overrides: {
        "git rev-parse HEAD^{tree}": [TREE_HASH, "f".repeat(40)],
        "pnpm exec wrangler d1 migrations list DB --remote": [pendingMigration, pendingMigration],
      },
      failure: "Tracked release tree changed during D1 migration apply.",
      expectedStatus: "failed_before_stage",
      expectedPhase: "migration_review",
      expectedMigrationApply: "not_started",
    },
    {
      label: "tracked files changed after apply",
      overrides: {
        "git status --porcelain --untracked-files=no": [
          "",
          "",
          "",
          " M migrations/0024_add_release_marker.sql",
        ],
        "pnpm exec wrangler d1 migrations list DB --remote": [
          pendingMigration,
          pendingMigration,
          noPendingMigrations,
        ],
      },
      failure: "Tracked release files changed during D1 migration apply.",
      expectedStatus: "forward_repair_required",
      expectedPhase: "full_preflight",
      expectedMigrationApply: "succeeded",
    },
  ])("fails closed when $label", async ({
    overrides,
    failure,
    expectedStatus,
    expectedPhase,
    expectedMigrationApply,
  }) => {
    const runCommand = successfulRunner(overrides, { exactMigrationSequence: true });
    const deps = releaseDeps(runCommand);
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-migration-refusal-"));
    deps.artifactDir = artifactDir;
    deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);
    try {
      await expect(runProductionCanaryRelease(deps)).rejects.toThrow(failure);

      const artifact = JSON.parse(
        await readFile(path.join(artifactDir, "production-release.json"), "utf8"),
      ) as ReleaseArtifact;
      expect(artifact).toMatchObject({
        status: expectedStatus,
        phase: expectedPhase,
        migrationApply: expectedMigrationApply,
        previousVersionId: PREVIOUS_VERSION,
        failure,
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});

describe("restore observation after command errors", () => {
  it("proves a canary restoration accepted before the command error", async () => {
    const runCommand = successfulRunner({
      [`pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`]:
        new Error("smoke failed"),
      [CANARY_RESTORE_COMMAND]: new Error("transport closed after accept"),
    }, { acceptedMutationErrors: [CANARY_RESTORE_COMMAND] });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion = vi.fn(async () => PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("smoke failed");

    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      failure: "smoke failed",
    }));
    expect(recordedCommands(runCommand).filter(
      (command) => command === "pnpm exec wrangler deployments list --json",
    ).length).toBeGreaterThanOrEqual(8);
  });

  it("proves a rollback restoration accepted before the command error", async () => {
    const restoreCommand =
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed rollback ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      [restoreCommand]: new Error("transport closed after accept"),
    }, { acceptedMutationErrors: [restoreCommand] });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion = vi.fn(async () => PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("did not converge");

    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      failure: expect.stringContaining("did not converge"),
    }));
    expect(recordedCommands(runCommand)).toContain(restoreCommand);
  });
});

describe("deployment mutation identity protocol", () => {
  const noPendingMigrations = "No migrations to apply!";

  it.each([
    {
      label: "stage",
      deployments: [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    },
    {
      label: "promotion",
      deployments: [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    },
  ])("tolerates one exact predecessor observation after canary $label", async ({ deployments }) => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": deployments,
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("surfaces a deployment-list command failure after the mutation observation bound", async () => {
    const listFailure = new Error("deployment list remained unavailable");
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        listFailure,
        listFailure,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = atomicReleaseDeps(runCommand, "atomic-product-activation");
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "deployment list remained unavailable",
    );
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("retries transient invalid JSON during exact deployment convergence", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        "not-json",
        deploymentPayload(CANDIDATE_VERSION),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["command failure", new Error("deployment list temporarily unavailable")],
    ["invalid JSON", "not-json"],
  ] as const)("retries one transient deployment-list %s after an accepted stage", async (
    _label,
    transientResponse,
  ) => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        transientResponse,
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("tolerates one exact predecessor observation after an atomic deploy", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = atomicReleaseDeps(runCommand, "atomic-product-activation");
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).resolves.toMatchObject({ status: "promoted" });
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("tolerates one exact predecessor observation after a rollback deploy", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);
    deps.verificationAttempts = 2;

    await expect(runProductionRollback(deps)).resolves.toMatchObject({ status: "rollback_promoted" });
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("tolerates one exact owned deployment observation after restoration", async () => {
    const smokeCommand =
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const restored = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:06:00Z",
      RESTORED_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        restored,
        restored,
        restored,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
    }));
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it("treats a failed stage command with an unchanged predecessor as already restored", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      [CANARY_STAGE_COMMAND]: new Error("stage failed before mutation"),
      "pnpm exec wrangler deployments list --json": Array.from(
        { length: 7 },
        () => deploymentPayload(PREVIOUS_VERSION),
      ),
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("stage failed before mutation");
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "stage",
    }));
  });

  it("reconciles a successful rollback inspection command that creates no deployment", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": Array.from(
        { length: 8 },
        () => deploymentPayload(PREVIOUS_VERSION),
      ),
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Rollback inspection stage did not create the expected production deployment.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "stage",
      failure: "Rollback inspection stage did not create the expected production deployment.",
    }));
  });

  it("restores an inspection stage accepted before its command reported failure", async () => {
    const stageError = new Error("transport closed after rollback inspection was accepted");
    const restored = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:06:00Z",
      RESTORED_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      [ROLLBACK_STAGE_COMMAND]: stageError,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        restored,
        restored,
        restored,
      ],
    }, {
      acceptedMutationErrors: [ROLLBACK_STAGE_COMMAND],
      exactDeploymentSequence: true,
      preserveDeploymentIds: true,
    });
    const deps = rollbackDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow(stageError.message);

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      ROLLBACK_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "stage",
      failure: stageError.message,
    }));
  });

  it("refuses restoration when promotion first reveals a foreign deployment", async () => {
    const replacement = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:07:00Z",
      REPLACEMENT_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        replacement,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Automatic restoration refused because production no longer matched the rollback deployment.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      ROLLBACK_PROMOTE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "promote",
      rollbackFailure:
        "Automatic restoration refused because production no longer matched the rollback deployment.",
    }));
  });

  it("verifies without another mutation when a failed inspection is already restored", async () => {
    const inspectionError = new Error("rollback candidate edge inspection unavailable");
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readCandidateCspHeaders.mockRejectedValue(inspectionError);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow(inspectionError.message);

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "candidate_csp",
      failure: inspectionError.message,
    }));
  });

  it("restores the staged deployment when promotion fails without mutating", async () => {
    const restored = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:06:00Z",
      RESTORED_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      [CANARY_PROMOTE_COMMAND]: new Error("promotion failed before mutation"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        restored,
        restored,
        restored,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("promotion failed before mutation");
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "promote",
    }));
  });

  it("reconciles a successful stage command that creates no deployment", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": Array.from(
        { length: 9 },
        () => deploymentPayload(PREVIOUS_VERSION),
      ),
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Staged production topology changed before canary smoke.",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "promotion_revalidation",
    }));
  });

  it("restores a successful promotion command that creates no deployment", async () => {
    const restored = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:06:00Z",
      RESTORED_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        restored,
        restored,
        restored,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Canary promotion did not create the expected production deployment.",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "promote",
    }));
  });

  it("reconciles a successful rollback command that creates no deployment", async () => {
    const restored = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:06:00Z",
      RESTORED_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": Array.from(
        { length: 9 },
        (_, index) => index < 2 ? deploymentPayload(PREVIOUS_VERSION) : stagedDeploymentPayload(),
      ).concat([restored, restored, restored]),
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);
    deps.verificationAttempts = 2;
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Rollback did not create the expected production deployment.",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "promote",
    }));
  });

  it("keeps an atomic release forward-only when a successful deploy creates no deployment", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": Array.from(
        { length: 4 },
        () => deploymentPayload(PREVIOUS_VERSION),
      ),
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = atomicReleaseDeps(runCommand, "atomic-product-activation");
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Atomic release did not create the expected production deployment.",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "forward_repair_required",
      phase: "verify_promotion",
      candidateVersionId: CANDIDATE_VERSION,
    }));
  });

  it.each([
    ["no new deployment", stagedDeploymentPayload()],
    ["the historical deployment ID", deploymentPayload(PREVIOUS_VERSION)],
  ])("fails restoration when a successful command leaves $label", async (_label, restoreObservation) => {
    const smokeCommand =
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        restoreObservation,
        restoreObservation,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 2;

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Restoration did not create the expected production deployment.",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      rollbackFailure: "Restoration did not create the expected production deployment.",
    }));
  });

  it("refuses a foreign deployment immediately after a rollback mutation", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:07:00Z", REPLACEMENT_DEPLOYMENT),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Automatic restoration refused because production no longer matched the rollback deployment.",
    );
    expect(recordedCommands(runCommand)).not.toContain(CANARY_RESTORE_COMMAND);
  });

  it("refuses a foreign deployment immediately after promotion", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:07:00Z", REPLACEMENT_DEPLOYMENT),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Canary promotion did not create the expected production deployment.",
    );
    expect(recordedCommands(runCommand)).not.toContain(CANARY_RESTORE_COMMAND);
  });

  it.each([
    ["same topology", deploymentPayload(CANDIDATE_VERSION, "2026-07-15T00:07:00Z", REPLACEMENT_DEPLOYMENT)],
    ["different topology", deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:07:00Z", REPLACEMENT_DEPLOYMENT)],
  ])("fails immediately on a foreign UUID with $label during convergence", async (_label, replacement) => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        replacement,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = atomicReleaseDeps(runCommand, "atomic-product-activation");
    deps.verificationAttempts = 3;

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Production deployment identity changed during verification.",
    );
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("never restores after canary convergence has observed a foreign UUID", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION, "2026-07-15T00:07:00Z", REPLACEMENT_DEPLOYMENT),
        deploymentPayload(CANDIDATE_VERSION),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Automatic restoration refused",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_PROMOTE_COMMAND,
    ]);
  });

  it("never restores after rollback convergence has observed a foreign UUID", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION, "2026-07-15T00:07:00Z", REPLACEMENT_DEPLOYMENT),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Automatic restoration refused",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      ROLLBACK_PROMOTE_COMMAND,
    ]);
  });

  it("rejects malformed deployment identity on the first post-mutation observation", async () => {
    const malformedDeployment = JSON.parse(deploymentPayload(CANDIDATE_VERSION)) as Array<Record<string, unknown>>;
    malformedDeployment[0].id = "deployment-not-a-uuid";
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": noPendingMigrations,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        JSON.stringify(malformedDeployment),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = atomicReleaseDeps(runCommand, "atomic-product-activation");

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("valid deployment ID");
    expect(deps.sleep).not.toHaveBeenCalled();
  });
});

describe("same-topology deployment replacement races", () => {
  const replacementPrevious = deploymentPayload(
    PREVIOUS_VERSION,
    "2026-07-15T00:07:00Z",
    REPLACEMENT_DEPLOYMENT,
  );

  it.each([
    {
      label: "before migration apply",
      deployments: [deploymentPayload(PREVIOUS_VERSION), replacementPrevious],
      expectedPhase: "migration_review",
      expectedStatus: "failed_before_stage",
      expectedMigrationApply: "not_started",
    },
    {
      label: "after migration apply",
      deployments: [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        replacementPrevious,
      ],
      expectedPhase: "full_preflight",
      expectedStatus: "forward_repair_required",
      expectedMigrationApply: "succeeded",
    },
    {
      label: "after full preflight",
      deployments: [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        replacementPrevious,
      ],
      expectedPhase: "deployment_revalidation",
      expectedStatus: "forward_repair_required",
      expectedMigrationApply: "succeeded",
    },
  ])("refuses a replacement UUID with unchanged topology $label", async ({
    deployments,
    expectedPhase,
    expectedStatus,
    expectedMigrationApply,
  }) => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": deployments,
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      /Active production version changed/,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: expectedStatus,
      phase: expectedPhase,
      migrationApply: expectedMigrationApply,
    }));
  });

  it("refuses a same-topology replacement immediately before staging", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        replacementPrevious,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Active production topology changed before canary staging.",
    );
    expect(recordedCommands(runCommand)).not.toContain(CANARY_STAGE_COMMAND);
  });

  it("refuses a same-topology replacement immediately before promotion", async () => {
    const replacementStage = stagedDeploymentPayload(
      PREVIOUS_VERSION,
      CANDIDATE_VERSION,
      REPLACEMENT_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        replacementStage,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Staged production topology changed before canary promotion.",
    );
    expect(recordedCommands(runCommand)).not.toContain(CANARY_PROMOTE_COMMAND);
    expect(recordedCommands(runCommand)).not.toContain(CANARY_RESTORE_COMMAND);
  });

  it("refuses restoration over a same-topology replacement", async () => {
    const smokeCommand =
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(PREVIOUS_VERSION, CANDIDATE_VERSION, REPLACEMENT_DEPLOYMENT),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Automatic restoration refused",
    );
    expect(recordedCommands(runCommand)).not.toContain(CANARY_RESTORE_COMMAND);
  });

  it("refuses rollback when its trusted deployment UUID is replaced with the same topology", async () => {
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        replacementPrevious,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Active production version changed during rollback.",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
  });

  it("refuses a same-topology replacement during restoration convergence", async () => {
    const smokeCommand =
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const restored = deploymentPayload(
      PREVIOUS_VERSION,
      "2026-07-15T00:06:00Z",
      RESTORED_DEPLOYMENT,
    );
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        restored,
        replacementPrevious,
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Production deployment identity changed during verification.",
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      rollbackFailure: "Production deployment identity changed during verification.",
    }));
  });
});

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

  it("uses the process environment when rollback dependencies omit an environment", async () => {
    const runCommand = successfulRunner();
    const deps = rollbackDeps(runCommand);
    delete (deps as { env?: NodeJS.ProcessEnv }).env;
    deps.verificationAttempts = 0;

    await expect(runProductionRollback(deps)).rejects.toThrow("positive integer");

    expect(runCommand).not.toHaveBeenCalled();
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "validation",
      configure: (deps: ReturnType<typeof rollbackDeps>) => {
        deps.verificationAttempts = 0;
      },
      expectedPhase: "validate",
      expectedFailure: "Production verification attempts must be a positive integer.",
    },
    {
      label: "tooling provenance",
      configure: (_deps: ReturnType<typeof rollbackDeps>) => undefined,
      expectedPhase: "provenance",
      expectedFailure: "Rollback tooling is not checked out at current origin/main.",
    },
  ])("writes a lifecycle-valid rollback artifact for $label failures", async ({
    configure,
    expectedFailure,
    expectedPhase,
  }) => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-rollback-artifact-"));
    try {
      const runCommand = successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": "d".repeat(40),
      });
      const deps = rollbackDeps(runCommand);
      configure(deps);
      deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);

      await expect(runProductionRollback(deps)).rejects.toThrow(expectedFailure);
      await expect(readFile(path.join(artifactDir, "production-release.json"), "utf8"))
        .resolves.toSatisfy((contents: string) => {
          const artifact = JSON.parse(contents) as ReleaseArtifact;
          return artifact.phase === expectedPhase && artifact.failure === expectedFailure;
        });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("uses current-main tooling to deploy an exact known source-tagged version", async () => {
    const events: string[] = [];
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
      deploymentStrategy: "gradual",
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary",
    });
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
    expect(recordedCommands(runCommand)).toEqual([
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "git status --porcelain --untracked-files=no",
      "git rev-parse HEAD^{tree}",
      "pnpm exec wrangler versions list --json",
      "pnpm exec wrangler deployments list --json",
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage rollback ${RELEASE_SHA} for inspection`,
      "pnpm exec wrangler deployments list --json",
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`,
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      ROLLBACK_PROMOTE_COMMAND,
    ]);
    const targetViewCall = runCommand.mock.calls.find(([command, args]) => (
      command === "pnpm" &&
      args.join(" ") === `exec wrangler versions view ${CANDIDATE_VERSION} --json`
    ));
    expect(targetViewCall?.[2]?.env).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID,
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

  it("retries the exact-version rollback probe while the staged override propagates", async () => {
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
    deps.verificationAttempts = 3;
    deps.readCandidateCspHeaders
      .mockRejectedValueOnce(new Error("override not propagated"))
      .mockResolvedValueOnce(new Headers({
        "Content-Security-Policy": VALID_CANDIDATE_CSP,
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": PREVIOUS_VERSION,
      }))
      .mockResolvedValueOnce(new Headers({
        "Content-Security-Policy": VALID_CANDIDATE_CSP,
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION,
      }));

    await expect(runProductionRollback(deps)).resolves.toMatchObject({
      status: "rollback_promoted",
      candidateVersionId: CANDIDATE_VERSION,
    });

    expect(deps.readCandidateCspHeaders).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(deps.sleep).toHaveBeenNthCalledWith(2, 1_000);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
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
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
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
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
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
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
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
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
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
    expect(remoteMutationCommands(recordedCommandCalls(staleRunner))).toEqual([]);
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
    expect(remoteMutationCommands(recordedCommandCalls(tagRunner))).toEqual([]);
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
    expect(remoteMutationCommands(recordedCommandCalls(invalidRunner))).toEqual([]);
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
    expect(remoteMutationCommands(recordedCommandCalls(dirtyRunner))).toEqual([]);
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
    expect(remoteMutationCommands(recordedCommandCalls(activeRunner))).toEqual([]);
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
        id: PREVIOUS_DEPLOYMENT,
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
          id: PREVIOUS_DEPLOYMENT,
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
        },
        {
          id: PROMOTED_DEPLOYMENT,
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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

  it("writes a lifecycle-valid artifact when the initial rollback deployment lookup fails", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-rollback-lookup-"));
    try {
      const runCommand = successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": TOOLING_SHA,
        "pnpm exec wrangler versions list --json": JSON.stringify([
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
        ]),
        "pnpm exec wrangler deployments list --json": "{}",
      });
      const deps = rollbackDeps(runCommand);
      deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);

      await expect(runProductionRollback(deps)).rejects.toThrow(
        "Wrangler deployment output was not a JSON array.",
      );

      await expect(readFile(path.join(artifactDir, "production-release.json"), "utf8"))
        .resolves.toSatisfy((contents: string) => {
          const artifact = JSON.parse(contents) as ReleaseArtifact;
          return artifact.phase === "rollback_current_deployment" &&
            artifact.previousVersionId === undefined &&
            artifact.candidateVersionId === CANDIDATE_VERSION;
        });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("restores the inspection stage when rollback promotion fails without mutating production", async () => {
    const deploy =
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`;
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
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
      ],
      [deploy]: new Error("rollback command failed before mutation"),
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("rollback command failed before mutation");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      deploy,
      ROLLBACK_RESTORE_COMMAND,
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
      reviewedMigrations: [],
      migrationApply: "not_needed",
      databaseRollbackSupported: false,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "rollback command failed before mutation",
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
          deploymentPayload(PREVIOUS_VERSION),
          stagedDeploymentPayload(),
          stagedDeploymentPayload(),
          deploymentPayload(CANDIDATE_VERSION),
          new Error("deployment list unavailable"),
          new Error("still unavailable"),
          deploymentPayload(CANDIDATE_VERSION),
          deploymentPayload(CANDIDATE_VERSION),
          deploymentPayload(CANDIDATE_VERSION),
        ],
        [restore]: new Error("restore failed"),
      }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const runCommand = runner();
    const deps = {
      ...rollbackDeps(runCommand),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };
    deps.readPublicWorkerVersion.mockRejectedValue(new Error("public unavailable"));

    await expect(runProductionRollback(deps)).rejects.toThrow("Rollback failed: restore failed");
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      ROLLBACK_PROMOTE_COMMAND,
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
    expect(remoteMutationCommands(recordedCommandCalls(secondRunner))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      ROLLBACK_PROMOTE_COMMAND,
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
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
      ],
      [deploy]: new Error("Wrangler timed out after Cloudflare accepted the deployment"),
    }, {
      acceptedMutationErrors: [deploy],
      exactDeploymentSequence: true,
      preserveDeploymentIds: true,
    });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionRollback(deps)).rejects.toThrow("Wrangler timed out");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      deploy,
      restore,
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
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
      ],
    }, { exactDeploymentSequence: true, preserveDeploymentIds: true });
    const deps = rollbackDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(CANDIDATE_VERSION)
      .mockResolvedValue(PREVIOUS_VERSION);
    deps.writeReleaseArtifact
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runProductionRollback(deps)).rejects.toThrow("disk unavailable");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      targetDeploy,
      restore,
    ]);
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

  it("refuses rollback when production changes after the trusted snapshot", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const runCommand = successfulRunner({
      "git rev-parse HEAD": TOOLING_SHA,
      "git rev-parse origin/main": TOOLING_SHA,
      "pnpm exec wrangler versions list --json": JSON.stringify([
        workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ]),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(replacementVersion),
      ],
    }, { exactDeploymentSequence: true });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Active production version changed during rollback.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      failure: "Active production version changed during rollback.",
    });
  });

  it("refuses compensating rollback when production changes after the target deploy attempt", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const deploy = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`;
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
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(replacementVersion),
      ],
      [deploy]: new Error("rollback deploy outcome unknown"),
    }, { exactDeploymentSequence: true });
    const deps = rollbackDeps(runCommand);

    await expect(runProductionRollback(deps)).rejects.toThrow(
      "Automatic restoration refused because production no longer matched the rollback deployment.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      ROLLBACK_STAGE_COMMAND,
      deploy,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "promote",
      rollbackFailure: "Automatic restoration refused because production no longer matched the rollback deployment.",
    }));
  });

  it("sanitizes artifact failure after refusing an unsafe rollback restoration", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const credential = "rollback-restoration-token";
    const deploy = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Roll back to ${RELEASE_SHA}`;
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
        deploymentPayload(replacementVersion),
      ],
      [deploy]: new Error("rollback deploy outcome unknown"),
    }, { exactDeploymentSequence: true });
    const deps = rollbackDeps(runCommand);
    deps.env.CLOUDFLARE_WORKERS_API_TOKEN = credential;
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error(`disk failed ${credential}`));

    const rejection = await runProductionRollback(deps).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain("Release artifact write also failed");
    expect((rejection as Error).message).not.toContain(credential);
  });

  it("writes a lifecycle-valid artifact when rollback revalidation detects a race", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-rollback-race-"));
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    try {
      const runCommand = successfulRunner({
        "git rev-parse HEAD": TOOLING_SHA,
        "git rev-parse origin/main": TOOLING_SHA,
        "pnpm exec wrangler versions list --json": JSON.stringify([
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
        ]),
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(replacementVersion),
        ],
      }, { exactDeploymentSequence: true });
      const deps = rollbackDeps(runCommand);
      deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);

      await expect(runProductionRollback(deps)).rejects.toThrow(
        "Active production version changed during rollback.",
      );

      await expect(readFile(path.join(artifactDir, "production-release.json"), "utf8"))
        .resolves.toSatisfy((contents: string) => {
          const artifact = JSON.parse(contents) as ReleaseArtifact;
          return artifact.phase === "rollback_current_deployment" &&
            artifact.previousVersionId === PREVIOUS_VERSION &&
            artifact.candidateVersionId === CANDIDATE_VERSION;
        });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
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
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
      `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
      "pnpm exec wrangler deployments list --json",
      "pnpm run deploy:preflight",
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      "pnpm exec wrangler versions list --json",
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      "pnpm exec wrangler deployments list --json",
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
      "pnpm exec wrangler deployments list --json",
    ]);
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
    ]);
    expect(recordedCommandCalls(runCommand).filter(({ command, args }) => (
      command === "git" && args.join(" ") === "show HEAD:migrations/0024_add_release_marker.sql"
    ))).toHaveLength(3);
    const commandEnv = (display: string) => runCommand.mock.calls.find(([command, args]) => (
      commandKey(command, args) === display
    ))?.[2]?.env;
    expect(deps.readCandidateCspHeaders).toHaveBeenCalledWith(
      "https://spoonjoy.app",
      CANDIDATE_VERSION,
    );
    expect(commandEnv("pnpm run deploy:preflight")).toEqual({
      PATH: "/test/bin",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
      SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1",
    });
    expect(commandEnv("pnpm run build")).toEqual({
      PATH: "/test/bin",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(commandEnv(CANARY_UPLOAD_COMMAND)).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: "workers-secret",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(commandEnv(
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
    )).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: D1_API_TOKEN,
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
    });
    expect(deps.readPublicWorkerVersion).toHaveBeenCalledWith("https://spoonjoy.app");
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
  });

  it("refuses to stage when production changes after candidate upload", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(replacementVersion),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Active production topology changed before canary staging.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "forward_repair_required",
      phase: "stage_revalidation",
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    }));
  });

  it("refuses promotion and restoration when staged production topology changes", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        deploymentPayload(replacementVersion),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Staged production topology changed before canary promotion.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "promotion_revalidation",
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
      rollbackFailure: "Automatic restoration refused because production no longer matched the staged deployment.",
    }));
  });

  it("refuses restoration when promotion topology cannot be revalidated", async () => {
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        new Error("deployment topology unavailable"),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Automatic restoration refused because production no longer matched the staged deployment.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "promotion_revalidation",
      rollbackFailure: "Automatic restoration refused because production no longer matched the staged deployment.",
    }));
  });

  it("refuses compensating restoration when production changes after a failed canary", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        deploymentPayload(replacementVersion),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Automatic restoration refused because production no longer matched the staged deployment.",
    );

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "canary",
      rollbackFailure: "Automatic restoration refused because production no longer matched the staged deployment.",
    }));
  });

  it("does not redeploy when a failed canary is already back on the prior version", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({
      [smokeCommand]: new Error("canary failed"),
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
    ]);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rolled_back",
      phase: "canary",
    }));
  });

  it("does not declare a stage rollback complete until the public Worker converges twice", async () => {
    const runCommand = successfulRunner({
      [CANARY_STAGE_COMMAND]: new Error("stage outcome unknown"),
    }, { acceptedMutationErrors: [CANARY_STAGE_COMMAND] });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      `Production version did not converge to ${PREVIOUS_VERSION}.`,
    );

    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "rollback_failed",
      phase: "stage",
      rollbackFailure: `Production version did not converge to ${PREVIOUS_VERSION}.`,
    }));
  });

  it("sanitizes artifact-write failure after refusing an unsafe restoration", async () => {
    const replacementVersion = "33333333-3333-4333-8333-333333333333";
    const credential = "topology-race-workers-token";
    const runCommand = successfulRunner({
      "pnpm exec wrangler deployments list --json": [
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
        stagedDeploymentPayload(),
        deploymentPayload(replacementVersion),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);
    deps.env.CLOUDFLARE_WORKERS_API_TOKEN = credential;
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error(`disk failed ${credential}`));

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      "Staged production topology changed before canary promotion.",
    );
    expect((rejection as Error).message).toContain("Release artifact write also failed");
    expect((rejection as Error).message).not.toContain(credential);
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
    expect(events.slice(3, 10)).toEqual([
      `command:${PROTOCOL_BOUNDARY_LOG_COMMAND}`,
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

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.sleep).toHaveBeenCalledTimes(21);
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

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
      .mockResolvedValueOnce(PREVIOUS_VERSION)
      .mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("canary failed");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      CANARY_STAGE_COMMAND,
      CANARY_RESTORE_COMMAND,
    ]);
    expect(deps.sleep).toHaveBeenCalledTimes(4);
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
    }, { acceptedMutationErrors: [stageCommand] });
    const deps = {
      ...releaseDeps(runCommand),
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary" as const,
    };
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("stage failed");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
      }, { acceptedMutationErrors: [CANARY_STAGE_COMMAND] });
      const deps = releaseDeps(runCommand);
      deps.verificationAttempts = 1;
      deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
        stagedDeploymentPayload(),
        stagedDeploymentPayload(),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:05:00Z", PROMOTED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:05:00Z", PROMOTED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:05:00Z", PROMOTED_DEPLOYMENT),
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z", RESTORED_DEPLOYMENT),
      ],
    }, { exactDeploymentSequence: true });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("did not converge");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      { id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }] },
      { id: PROMOTED_DEPLOYMENT, created_on: "2026-07-14T00:00:00Z", versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }] },
    ]))).toBe(PREVIOUS_VERSION);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["an empty deployment list", "[]"],
    ["duplicate deployment IDs", JSON.stringify([
      { id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }] },
      { id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-14T00:00:00Z", versions: [{ version_id: CANDIDATE_VERSION, percentage: 100 }] },
    ])],
    ["a split deployment", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 90 },
      { version_id: CANDIDATE_VERSION, percentage: 10 },
    ] }])],
    ["a non-100% deployment", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 99 },
    ] }])],
    ["a non-numeric traffic percentage", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: "100" },
    ] }])],
    ["a negative traffic percentage", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: -1 },
    ] }])],
    ["an excessive traffic percentage", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 101 },
    ] }])],
    ["an empty active topology", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [] }])],
    ["duplicate active versions", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 50 },
      { version_id: PREVIOUS_VERSION, percentage: 50 },
    ] }])],
    ["a locale creation time", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "July 15, 2026", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 100 },
    ] }])],
    ["an impossible creation date", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-02-30T00:00:00Z", versions: [
      { version_id: PREVIOUS_VERSION, percentage: 100 },
    ] }])],
  ])("rejects %s", (_label, payload) => {
    expect(() => selectCurrentProductionVersion(payload)).toThrow();
  });

  it("rejects conflicting newest deployments with identical timestamps", () => {
    const tied = JSON.stringify([
      {
        id: PREVIOUS_DEPLOYMENT,
        created_on: "2026-07-15T00:00:00Z",
        versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
      },
      {
        id: PROMOTED_DEPLOYMENT,
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
    ["a missing creation time", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, versions: [] }])],
    ["an invalid creation time", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "not-a-date", versions: [] }])],
    ["a non-array versions value", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: {} }])],
    ["an invalid version row", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [null] }])],
    ["a non-string version ID", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: 1, percentage: 100 }] }])],
    ["an invalid version ID", JSON.stringify([{ id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [{ version_id: "latest", percentage: 100 }] }])],
  ])("rejects deployment output with %s", (_label, payload) => {
    expect(() => selectCurrentProductionVersion(payload)).toThrow();
  });

  it("rejects a newest split deployment even when an older deployment was single-version", () => {
    expect(() => selectCurrentProductionVersion(JSON.stringify([
      { id: PREVIOUS_DEPLOYMENT, created_on: "2026-07-14T00:00:00Z", versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }] },
      { id: PROMOTED_DEPLOYMENT, created_on: "2026-07-15T00:00:00Z", versions: [
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
    ["a locale version creation time", JSON.stringify([
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "July 15, 2026"),
    ]), RELEASE_SHA],
    ["an impossible version creation date", JSON.stringify([
      workerVersion(CANDIDATE_VERSION, RELEASE_SHA, "2026-02-30T00:00:00Z"),
    ]), RELEASE_SHA],
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
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
            deploymentPayload(CANDIDATE_VERSION),
            deploymentPayload(PREVIOUS_VERSION),
            deploymentPayload(PREVIOUS_VERSION),
          ]
        : failurePoint === "convergence"
          ? [
              deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
              deploymentPayload(PREVIOUS_VERSION),
              deploymentPayload(PREVIOUS_VERSION),
              deploymentPayload(CANDIDATE_VERSION),
              deploymentPayload(CANDIDATE_VERSION),
              deploymentPayload(PREVIOUS_VERSION),
            ]
          : ["stage", "canary"].includes(failurePoint)
            ? [
                deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
                deploymentPayload(PREVIOUS_VERSION),
              ]
            : [
                deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:00:00Z"),
                deploymentPayload(CANDIDATE_VERSION),
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
    const acceptedMutationErrors = failurePoint === "stage"
      ? [CANARY_STAGE_COMMAND]
      : failurePoint === "promotion"
        ? [CANARY_PROMOTE_COMMAND]
        : [];
    const runCommand = successfulRunner(overrides, { acceptedMutationErrors });
    const deps = releaseDeps(runCommand);
    deps.verificationAttempts = 3;
    if (failurePoint === "artifact") {
      deps.readPublicWorkerVersion
        .mockResolvedValueOnce(CANDIDATE_VERSION)
        .mockResolvedValue(PREVIOUS_VERSION);
      deps.writeReleaseArtifact.mockRejectedValueOnce(failure);
    } else {
      deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);
    }

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(failureMessage);
    if (restoreFails) expect((rejection as Error).message).toContain("Rollback failed: restore failed.");
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
      CANARY_UPLOAD_COMMAND,
      ...(afterStage ? [CANARY_STAGE_COMMAND] : []),
      ...(promotionAttempted ? [CANARY_PROMOTE_COMMAND] : []),
      ...(afterStage ? [CANARY_RESTORE_COMMAND] : []),
    ]);
    expect(recordedCommands(runCommand)).not.toContain(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );

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
    const runCommand = successfulRunner({
      "git show HEAD:migrations/0024_add_release_marker.sql":
        new Error("migration file unavailable"),
    });
    const deps = releaseDeps(runCommand);

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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
          id: PREVIOUS_DEPLOYMENT,
          created_on: "2026-07-15T00:00:00Z",
          versions: [{ version_id: PREVIOUS_VERSION, percentage: 100 }],
        },
        {
          id: PROMOTED_DEPLOYMENT,
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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

  it("records that D1 may have changed when a migration query request fails", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);
    deps.d1Fetch.mockRejectedValueOnce(new Error("migration batch failed"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "Cloudflare D1 migration query request failed.",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);

    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "forward_repair_required",
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
      failure: "Cloudflare D1 migration query request failed.",
    });
  });

  it("stops canary release after D1 when the full post-migration preflight fails", async () => {
    const runCommand = successfulRunner({
      "pnpm run deploy:preflight": ["", new Error("full preflight failed")],
    });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("full preflight failed");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
    expect(deps.writeReleaseArtifact).toHaveBeenCalledTimes(1);
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
      status: "forward_repair_required",
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
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-post-migration-upload-"));
    deps.artifactDir = artifactDir;
    deps.writeReleaseArtifact = (artifact) => writeReleaseArtifactFile(artifactDir, artifact);

    try {
      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("upload failed");
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
        uploadCommand,
      ]);
      expect(JSON.parse(
        await readFile(path.join(artifactDir, "production-release.json"), "utf8"),
      )).toEqual({
        status: "forward_repair_required",
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
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      `Authorization: Basic dXNlcjpwYXNz ` +
      `aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc d1-secret workers-secret ` +
      `${"x".repeat(600)}\nnext`,
    );
    const runCommand = successfulRunner({ "pnpm run deploy:preflight": failure });
    const deps = releaseDeps(runCommand);

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
    const artifact = deps.writeReleaseArtifact.mock.calls[0]?.[0];
    expect(artifact.failure).not.toMatch(
      /bearer-value|token-value|password-value|api-value|dXNlcjpwYXNz|aaaaaa|d1-secret|workers-secret/,
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION, "2026-07-15T00:06:00Z"),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion
      .mockResolvedValueOnce(CANDIDATE_VERSION)
      .mockResolvedValue(PREVIOUS_VERSION);
    deps.writeReleaseArtifact
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("disk unavailable");
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);
    deps.writeReleaseArtifact.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
      "canary failed Release artifact write also failed: disk unavailable",
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
        deploymentPayload(CANDIDATE_VERSION),
        deploymentPayload(PREVIOUS_VERSION),
      ],
    }, { acceptedMutationErrors: [CANARY_PROMOTE_COMMAND] });
    const deps = releaseDeps(runCommand);
    deps.readPublicWorkerVersion.mockResolvedValue(PREVIOUS_VERSION);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("promotion failed");

    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
      }, { acceptedMutationErrors: [CANARY_PROMOTE_COMMAND] });
      const deps = releaseDeps(runCommand);
      deps.verificationAttempts = 1;
      deps.readPublicWorkerVersion.mockResolvedValue(CANDIDATE_VERSION);

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow("Rollback failed");

      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
    const d1Credential = "bareD1CredentialAlpha0123456789";
    const workersCredential = "bareWorkersCredentialBeta0123456789";
    const promoteCommand = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`;
    const rollbackCommand = `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`;
    const runCommand = successfulRunner({
      [promoteCommand]: new Error(`promotion failed ${d1Credential}`),
      [rollbackCommand]: new Error(`rollback failed ${workersCredential}`),
    });
    const deps = releaseDeps(runCommand);
    deps.env.CLOUDFLARE_D1_API_TOKEN = d1Credential;
    deps.env.CLOUDFLARE_WORKERS_API_TOKEN = workersCredential;
    deps.writeReleaseArtifact.mockRejectedValueOnce(
      new Error(`artifact failed ${d1Credential} ${workersCredential}`),
    );

    const rejection = await runProductionCanaryRelease(deps).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      "promotion failed [REDACTED] Rollback failed: rollback failed [REDACTED]. " +
      "Release artifact write also failed: artifact failed [REDACTED] [REDACTED]",
    );
    expect((rejection as Error).message).not.toMatch(
      /bareD1CredentialAlpha|bareWorkersCredentialBeta/,
    );
    expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
    [
      "Basic authorization header",
      "Authorization: Basic dXNlcjpwYXNz\n",
      "Authorization=[REDACTED]\n",
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

  it("rejects failure text that sanitizes to an empty artifact field", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-empty-failure-"));
    try {
      await expect(writeReleaseArtifactFile(artifactDir, {
        status: "rollback_failed",
        sourceSha: RELEASE_SHA,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "canary",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: " \n\t ",
        rollbackFailure: "restore failed",
      })).rejects.toThrow("lifecycle");
      await expect(readFile(path.join(artifactDir, "production-release.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
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
      "stage", "canary", "promotion_revalidation", "promote", "verify_promotion", "artifact",
    ] as const;
    const earlyFailurePhases = [
      "validate", "provenance", "initial_preflight", "build", "post_build_provenance",
      "migration_list", "migration_review", "current_deployment", "version_snapshot",
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
      {
        ...canaryBase,
        status: "forward_repair_required",
        phase: "migration_apply",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "failed",
        previousVersionId: PREVIOUS_VERSION,
        failure: "migration apply failed",
      },
      ...(["full_preflight", "deployment_revalidation", "version_upload", "version_lookup"] as const)
        .map((phase) => ({
          ...canaryBase,
          status: "forward_repair_required",
          phase,
          treeHash: TREE_HASH,
          reviewedMigrations: ["0024_add_release_marker.sql"],
          migrationApply: "succeeded",
          previousVersionId: PREVIOUS_VERSION,
          failure: `${phase} failed after D1 mutation`,
        })),
      {
        ...canaryBase,
        status: "forward_repair_required",
        phase: "stage_revalidation",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "succeeded",
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "stage revalidation failed after D1 mutation",
      },
      ...earlyFailurePhases.map((phase) => ({
        ...canaryBase,
        status: "failed_before_stage",
        phase,
        failure: `${phase} failed`,
        ...(!["validate", "provenance"].includes(phase) ? { treeHash: TREE_HASH } : {}),
        ...(phase === "version_snapshot" ? { previousVersionId: PREVIOUS_VERSION } : {}),
        ...(phase === "migration_review"
          ? { reviewedMigrations: ["0024_add_release_marker.sql"] }
          : {}),
      })),
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "migration_review",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        previousVersionId: PREVIOUS_VERSION,
        failure: "late migration review failed",
      },
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_version_lookup",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        failure: "rollback target was not found",
      },
      ...(["not_started", "not_needed"] as const).map((migrationApply) => ({
        ...canaryBase,
        status: "failed_before_stage",
        phase: "deployment_revalidation",
        treeHash: TREE_HASH,
        reviewedMigrations: migrationApply === "not_needed"
          ? []
          : ["0024_add_release_marker.sql"],
        migrationApply,
        previousVersionId: PREVIOUS_VERSION,
        failure: "active deployment changed",
      })),
      {
        ...canaryBase,
        status: "failed_before_stage",
        phase: "rollback_current_deployment",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "current deployment was invalid",
      },
      ...(["not_needed"] as const).map((migrationApply) => ({
        ...canaryBase,
        status: "failed_before_stage",
        phase: "stage_revalidation",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply,
        previousVersionId: PREVIOUS_VERSION,
        candidateVersionId: CANDIDATE_VERSION,
        failure: "active deployment changed before staging",
      })),
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
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).map((releaseMode) => ({
        sourceSha: RELEASE_SHA,
        status: "failed_before_stage",
        releaseMode,
        deploymentStrategy: "atomic",
        phase: "deployment_revalidation",
        treeHash: TREE_HASH,
        reviewedMigrations: [],
        migrationApply: "not_needed",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure: "active deployment changed",
      })),
      ...(["atomic-bootstrap", "atomic-product-activation"] as const).map((releaseMode) => ({
        sourceSha: RELEASE_SHA,
        status: "failed_before_stage",
        releaseMode,
        deploymentStrategy: "atomic",
        phase: "deployment_revalidation",
        treeHash: TREE_HASH,
        reviewedMigrations: ["0024_add_release_marker.sql"],
        migrationApply: "not_started",
        databaseRollbackSupported: false,
        previousVersionId: PREVIOUS_VERSION,
        failure: "active deployment changed before migration apply",
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
          ["deployment_revalidation", "succeeded", false],
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
          if (
            (artifact.phase === "rollback_current_deployment" || artifact.phase === "migration_review") &&
            field === "previousVersionId"
          ) {
            continue;
          }
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
      "deployment_revalidation",
      "version_snapshot",
      "version_upload",
      "version_lookup",
      "stage_revalidation",
      "promotion_revalidation",
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
        "current_deployment", "deployment_revalidation", "version_snapshot", "version_upload", "version_lookup",
        "stage_revalidation",
        "rollback_version_lookup", "rollback_current_deployment", "rollback_already_active",
        "protocol_ancestry", "rollback_protocol_ancestry",
        "active_version_mapping", "rollback_active_version_mapping",
      ],
      rolled_back: ["stage", "canary", "promotion_revalidation", "promote", "verify_promotion", "artifact"],
      rollback_failed: ["stage", "canary", "promotion_revalidation", "promote", "verify_promotion", "artifact"],
      forward_repair_required: [
        "migration_apply", "full_preflight", "deployment_revalidation", "version_upload",
        "version_lookup", "stage_revalidation", "atomic_deploy", "verify_promotion",
        "bootstrap_probe", "artifact",
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
      { ...canarySuccess, releaseMode: "legacy" },
      { ...canarySuccess, databaseRollbackSupported: true },
      { ...canarySuccess, reviewedMigrations: "0024_add_release_marker.sql" },
      { ...canarySuccess, migrationApply: "unknown" },
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
        phase: "atomic_deploy",
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
      { ...atomicBase, migrationApply: "not_started" },
      {
        ...atomicBase,
        status: "failed_before_stage",
        phase: "atomic_deploy",
        reviewedMigrations: [],
        migrationApply: "not_needed",
      },
      {
        ...atomicBase,
        phase: "atomic_deploy",
        migrationApply: "attempted",
      },
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
      { ...failedMigrationApply, migrationApply: "not_started" },
      { ...failedMigrationApply, migrationApply: "succeeded" },
      { ...failedMigrationApply, reviewedMigrations: [] },
      { ...failedFullPreflight, migrationApply: "failed" },
      { ...failedFullPreflight, phase: "deployment_revalidation", migrationApply: "attempted" },
      { ...forwardFullPreflight, migrationApply: "failed" },
      {
        ...forwardFullPreflight,
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
        phase: "version_upload",
        reviewedMigrations: [],
        migrationApply: "not_needed",
      },
      {
        ...atomicBase,
        phase: "deployment_revalidation",
        reviewedMigrations: [],
        migrationApply: "not_needed",
      },
      {
        ...failedBeforeStage,
        phase: "protocol_ancestry",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
        previousVersionId: PREVIOUS_VERSION,
      },
      {
        ...failedBeforeStage,
        phase: "rollback_version_lookup",
        treeHash: TREE_HASH,
        migrationApply: "not_started",
      },
      {
        ...failedBeforeStage,
        releaseMode: "atomic-bootstrap",
        deploymentStrategy: "atomic",
        protocolV1BoundarySha: undefined,
        migrationApply: "not_needed",
      },
      {
        ...failedBeforeStage,
        phase: "initial_preflight",
        treeHash: TREE_HASH,
        migrationApply: "not_needed",
      },
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

  it("parses source-controlled environment lifecycle and operational CLI overrides", () => {
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
      "--source-sha", RELEASE_SHA,
    ], {
      SOURCE_SHA: "b".repeat(40),
      SPOONJOY_RELEASE_MODE: "atomic-product-activation",
    })).toEqual({
      artifactDir: "custom-artifacts",
      releaseMode: "atomic-product-activation",
      releaseSha: RELEASE_SHA,
    });
    expect(parseReleaseCliOptions([
      "--source-sha", RELEASE_SHA,
      "--rollback-version-id", CANDIDATE_VERSION,
    ], {
      SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
      SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
    })).toEqual({
      artifactDir: "mcp-oauth-canary-artifacts",
      protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      releaseMode: "protocol-v1-canary",
      releaseSha: RELEASE_SHA,
      rollbackVersionId: CANDIDATE_VERSION,
    });
  });

  it("rejects lifecycle CLI arguments instead of overriding source-controlled environment state", () => {
    expect(() => parseReleaseCliOptions([
      "--release-mode", "atomic-product-activation",
    ], {
      SOURCE_SHA: RELEASE_SHA,
      SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
    })).toThrow("Unknown production release option");
    expect(() => parseReleaseCliOptions([
      "--protocol-v1-boundary-sha", PRODUCT_BOUNDARY_SHA,
    ], {
      SOURCE_SHA: RELEASE_SHA,
      SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
      SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
    })).toThrow("Unknown production release option");
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

  it("runs the CLI with injected commands and the authoritative Wrangler PostHog host", async () => {
    vi.stubEnv("SOURCE_SHA", RELEASE_SHA);
    vi.stubEnv("SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA", PRODUCT_BOUNDARY_SHA);
    vi.stubEnv("SPOONJOY_RELEASE_MODE", "protocol-v1-canary");
    const responses: Record<string, string> = {
      "git rev-parse HEAD": RELEASE_SHA,
      "git status --porcelain --untracked-files=no": "",
      "git rev-parse HEAD^{tree}": TREE_HASH,
      [PROTOCOL_BOUNDARY_LOG_COMMAND]: PRODUCT_BOUNDARY_SHA,
      "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      [`pnpm exec wrangler versions view ${PREVIOUS_VERSION} --json`]: JSON.stringify(
        workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
      ),
    };
    let versionListCalls = 0;
    let deploymentListCalls = 0;
    const execFileImpl = vi.fn((command, args, _options, callback) => {
      const key = commandKey(command, args);
      if (key === "pnpm exec wrangler deployments list --json") {
        deploymentListCalls += 1;
        callback(
          null,
          deploymentListCalls === 4 || deploymentListCalls === 5
            ? stagedDeploymentPayload()
            : deploymentPayload(deploymentListCalls <= 3 ? PREVIOUS_VERSION : CANDIDATE_VERSION),
          "",
        );
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
        "--rollback-version-id", CANDIDATE_VERSION,
      ],
      env: {
        PATH: "/test/bin",
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
        SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
      },
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
      "pnpm exec wrangler versions list --json": [
        JSON.stringify([workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA)]),
        JSON.stringify([
          workerVersion(PREVIOUS_VERSION, PREVIOUS_PRODUCT_SHA),
          workerVersion(CANDIDATE_VERSION, RELEASE_SHA),
        ]),
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
      ...postHogArtifactReaderDeps(),
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
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(release).resolves.toMatchObject({ status: "promoted" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        "Cloudflare-Workers-Version-Overrides": buildWorkerVersionOverride("spoonjoy-v2", CANDIDATE_VERSION),
      },
    });
  });

  it("uses immutable migration bytes with the default artifact writer", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-cli-"));
    const runCommand = successfulRunner({
      "pnpm exec wrangler d1 migrations list DB --remote": JSON.stringify([{ Name: "0023_recipe_cover_prompt_lineage.sql" }]),
      "git show HEAD:migrations/0023_recipe_cover_prompt_lineage.sql":
        "CREATE TABLE RecipeCoverPromptLineage (id TEXT PRIMARY KEY);",
    });
    try {
      const result = await runProductionReleaseCli({
        ...postHogArtifactReaderDeps("https://us.i.posthog.com"),
        argv: ["--artifact-dir", artifactDir],
        d1Fetch: successfulD1Fetch(),
        env: {
          CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_D1_API_TOKEN: D1_API_TOKEN,
          SOURCE_SHA: RELEASE_SHA,
          PATH: "/test/bin",
          SPOONJOY_RELEASE_MODE: "atomic-product-activation",
        },
        readWranglerConfig: async () => ({
          vars: { VITE_POSTHOG_HOST: "https://us.i.posthog.com" },
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

    it.each([
      ["protocol-v1-canary", "gradual"],
      ["atomic-bootstrap", "atomic"],
      ["atomic-product-activation", "atomic"],
    ] as const)(
      "refuses %s when production changes after the trusted snapshot",
      async (releaseMode, deploymentStrategy) => {
        const replacementVersion = "33333333-3333-4333-8333-333333333333";
        const runCommand = successfulRunner({
          "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
          "pnpm exec wrangler deployments list --json": [
            deploymentPayload(PREVIOUS_VERSION),
            deploymentPayload(replacementVersion),
          ],
        }, { exactDeploymentSequence: true });
        const deps = releaseMode === "protocol-v1-canary"
          ? releaseDeps(runCommand)
          : atomicReleaseDeps(runCommand, releaseMode);
        if (releaseMode === "atomic-bootstrap") {
          deps.readBootstrapProbe = vi.fn(async () => validProbeResult);
        }

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
          "Active production version changed during release.",
        );

        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
          status: "failed_before_stage",
          sourceSha: RELEASE_SHA,
          releaseMode,
          deploymentStrategy,
          ...(releaseMode === "protocol-v1-canary"
            ? { protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA }
            : {}),
          phase: "deployment_revalidation",
          treeHash: TREE_HASH,
          reviewedMigrations: [],
          migrationApply: "not_needed",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          failure: "Active production version changed during release.",
        });
      },
    );

    it.each([
      ["protocol-v1-canary", "gradual"],
      ["atomic-bootstrap", "atomic"],
      ["atomic-product-activation", "atomic"],
    ] as const)(
      "refuses %s before D1 migration apply when production ownership changes",
      async (releaseMode, deploymentStrategy) => {
        const replacementVersion = "33333333-3333-4333-8333-333333333333";
        const runCommand = successfulRunner({
          "pnpm exec wrangler deployments list --json": [
            deploymentPayload(PREVIOUS_VERSION),
            deploymentPayload(replacementVersion),
          ],
        }, { exactDeploymentSequence: true });
        const deps = releaseMode === "protocol-v1-canary"
          ? releaseDeps(runCommand)
          : atomicReleaseDeps(runCommand, releaseMode);

        await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
          "Active production version changed before D1 migration apply.",
        );

        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
        expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith({
          status: "failed_before_stage",
          sourceSha: RELEASE_SHA,
          releaseMode,
          deploymentStrategy,
          ...(releaseMode === "protocol-v1-canary"
            ? { protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA }
            : {}),
          phase: "migration_review",
          treeHash: TREE_HASH,
          reviewedMigrations: ["0024_add_release_marker.sql"],
          migrationApply: "not_started",
          databaseRollbackSupported: false,
          previousVersionId: PREVIOUS_VERSION,
          failure: "Active production version changed before D1 migration apply.",
        });
      },
    );

    it("revalidates staged ownership immediately before the D1-writing canary smoke", async () => {
      const replacementVersion = "33333333-3333-4333-8333-333333333333";
      const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
      const runCommand = successfulRunner({
        "pnpm exec wrangler deployments list --json": [
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(PREVIOUS_VERSION),
          deploymentPayload(replacementVersion),
        ],
      }, { exactDeploymentSequence: true });
      const deps = releaseDeps(runCommand);

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow(
        "Staged production topology changed before canary smoke.",
      );

      expect(recordedCommands(runCommand)).not.toContain(smokeCommand);
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
        CANARY_UPLOAD_COMMAND,
        CANARY_STAGE_COMMAND,
      ]);
      expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
        status: "rollback_failed",
        phase: "promotion_revalidation",
        rollbackFailure: "Automatic restoration refused because production no longer matched the staged deployment.",
      }));
    });

    function atomicCommandSequence(mode: "atomic-bootstrap" | "atomic-product-activation") {
      return [
        ...READ_ONLY_RELEASE_COMMANDS,
        "pnpm exec wrangler deployments list --json",
        "pnpm run deploy:preflight",
        "pnpm exec wrangler deployments list --json",
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

        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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

        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
          CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_API_TOKEN: D1_API_TOKEN,
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
        };
        const workersEnv = {
          PATH: "/test/bin",
          CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_API_TOKEN: "workers-secret",
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
        };
        const calls = runCommand.mock.calls.map(([command, args, options]) => ({
          key: commandKey(command, args),
          env: options?.env,
        }));
        for (const key of ["pnpm exec wrangler d1 migrations list DB --remote"]) {
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

    it("parses only source-controlled lifecycle modes and forbids rollback in atomic modes", () => {
      expect(parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
      })).toEqual({
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
      expect(() => parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_RELEASE_MODE: "gradual",
      })).toThrow("release mode");
      expect(() => parseReleaseCliOptions([
        "--rollback-version-id", CANDIDATE_VERSION,
      ], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
      })).toThrow("rollback");
      expect(() => parseReleaseCliOptions([
        "--rollback-version-id", CANDIDATE_VERSION,
      ], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_RELEASE_MODE: "atomic-product-activation",
      })).toThrow("rollback");
      expect(() => parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: PRODUCT_BOUNDARY_SHA,
        SPOONJOY_RELEASE_MODE: "atomic-product-activation",
      })).toThrow("boundary");
      expect(() => parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
      })).toThrow("boundary");
      expect(() => parseReleaseCliOptions([], {
        SOURCE_SHA: RELEASE_SHA,
        SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: "main",
        SPOONJOY_RELEASE_MODE: "protocol-v1-canary",
      })).toThrow("boundary");
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      const commands = recordedCommands(runCommand);

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

    it("uses process-environment defaults for the bootstrap probe base URL", async () => {
      const runCommand = successfulRunner({
        [atomicDeployCommand("atomic-bootstrap")]: "",
        "pnpm exec wrangler d1 migrations list DB --remote": "No migrations to apply!",
      });
      const readBootstrapProbe = vi.fn(async () => validProbeResult);
      const deps = {
        ...atomicReleaseDeps(runCommand, "atomic-bootstrap"),
        readBootstrapProbe,
      };
      delete (deps as { env?: NodeJS.ProcessEnv }).env;

      await runProductionCanaryRelease(deps);

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
        ...postHogArtifactReaderDeps(),
        d1Fetch: successfulD1Fetch(),
        env: {
          CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_D1_API_TOKEN: D1_API_TOKEN,
          PATH: "/test/bin",
          SOURCE_SHA: RELEASE_SHA,
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
          SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
        },
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
        ...postHogArtifactReaderDeps(),
        d1Fetch: successfulD1Fetch(),
        env: {
          CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_D1_API_TOKEN: D1_API_TOKEN,
          PATH: "/test/bin",
          SOURCE_SHA: RELEASE_SHA,
          SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
          SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
        },
        readPublicWorkerVersion: async () => CANDIDATE_VERSION,
        runCommand,
        sleep: async () => undefined,
        writeReleaseArtifact: async () => undefined,
      })).rejects.toThrow("bootstrap probe");
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([atomicDeployCommand("atomic-bootstrap")]);
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
          ...postHogArtifactReaderDeps(),
          d1Fetch: successfulD1Fetch(),
          env: {
            CLOUDFLARE_ACCOUNT_ID,
            CLOUDFLARE_D1_API_TOKEN: D1_API_TOKEN,
            PATH: "/test/bin",
            SOURCE_SHA: RELEASE_SHA,
            SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
            SPOONJOY_RELEASE_MODE: "atomic-bootstrap",
          },
          readPublicWorkerVersion: async () => CANDIDATE_VERSION,
          runCommand,
          sleep: async () => undefined,
          writeReleaseArtifact: async () => undefined,
        })).rejects.toThrow("bootstrap probe");
        expect(fetchImpl).toHaveBeenCalledTimes(invalidCall);
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([atomicDeployCommand("atomic-bootstrap")]);
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
      const commands = recordedCommands(runCommand);

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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([atomicDeployCommand("atomic-bootstrap")]);
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([atomicDeployCommand(mode)]);
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([atomicDeployCommand(mode)]);
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
          const commands = recordedCommands(runCommand);

          expect(result).toEqual(atomicSuccessArtifact(mode));
          expect(commands.filter(
            (command) => command === "pnpm exec wrangler deployments list --json",
          )).toHaveLength(5);
          expect(deps.readPublicWorkerVersion).toHaveBeenCalledTimes(2);
          expect(deps.sleep).toHaveBeenCalledTimes(1);
          expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      const commands = recordedCommands(runCommand);

      expect(result).toMatchObject({
        releaseMode: "protocol-v1-canary",
        deploymentStrategy: "gradual",
        protocolV1BoundarySha: PRODUCT_BOUNDARY_SHA,
      });
      expect(commands).toEqual([
        ...READ_ONLY_RELEASE_COMMANDS,
        `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${RELEASE_SHA}`,
        `git merge-base --is-ancestor ${PRODUCT_BOUNDARY_SHA} ${PREVIOUS_PRODUCT_SHA}`,
        "pnpm exec wrangler deployments list --json",
        "pnpm run deploy:preflight",
        "pnpm exec wrangler deployments list --json",
        `pnpm exec wrangler versions upload --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
        "pnpm exec wrangler versions list --json",
        "pnpm exec wrangler deployments list --json",
        `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
        "pnpm exec wrangler deployments list --json",
        `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
        "pnpm exec wrangler deployments list --json",
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
      const commands = recordedCommands(runCommand);
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
        ? {}
        : { "pnpm run deploy:preflight": ["", failure] });
      const deps = {
        ...atomicReleaseDeps(runCommand, mode),
        readBootstrapProbe: vi.fn(async () => validProbeResult),
      };
      if (failurePoint === "D1 apply") {
        deps.d1Fetch.mockRejectedValueOnce(failure);
      }

      await expect(runProductionCanaryRelease(deps)).rejects.toThrow();

      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([]);
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
        failure: failurePoint === "D1 apply"
          ? "Cloudflare D1 migration query request failed."
          : failurePoint + " failed with token=[REDACTED]",
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

      const commands = recordedCommands(runCommand);
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
      expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
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
        expect(remoteMutationCommands(recordedCommandCalls(runCommand))).toEqual([
          atomicDeployCommand(mode),
        ]);
        if (mode === "atomic-product-activation") {
          expect(deps.readBootstrapProbe).not.toHaveBeenCalled();
        }
      },
    );
  });
});
