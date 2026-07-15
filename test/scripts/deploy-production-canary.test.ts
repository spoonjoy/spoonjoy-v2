import { describe, expect, it, vi } from "vitest";
import {
  assertAdditiveMigrationSql,
  buildWorkerVersionOverride,
  runProductionCanaryRelease,
  selectCurrentProductionVersion,
  selectUploadedVersion,
  type ReleaseCommandRunner,
} from "../../scripts/deploy-production-canary";

const RELEASE_SHA = "a".repeat(40);
const PREVIOUS_VERSION = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";

function commandKey(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function successfulRunner(overrides: Record<string, Error | string> = {}) {
  const responses: Record<string, string> = {
    "pnpm exec wrangler d1 migrations list DB --remote": JSON.stringify([{ Name: "0024_add_release_marker.sql" }]),
    "pnpm exec wrangler deployments list --json": JSON.stringify([
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
    "pnpm exec wrangler versions list --json": JSON.stringify([
      { id: "33333333-3333-4333-8333-333333333333", tag: "other" },
      { id: CANDIDATE_VERSION, tag: RELEASE_SHA },
    ]),
  };

  const runCommand = vi.fn<ReleaseCommandRunner>(async (command, args) => {
    const key = commandKey(command, args);
    const override = overrides[key];
    if (override instanceof Error) throw override;
    return { stdout: override ?? responses[key] ?? "", stderr: "" };
  });
  return runCommand;
}

function releaseDeps(runCommand: ReleaseCommandRunner) {
  return {
    artifactDir: "mcp-oauth-canary-artifacts",
    readMigrationFile: vi.fn(async () => "CREATE TABLE ReleaseMarker (id TEXT PRIMARY KEY);"),
    releaseSha: RELEASE_SHA,
    runCommand,
    writeReleaseArtifact: vi.fn(async () => undefined),
  };
}

describe("production canary release orchestration", () => {
  it("stages a candidate at zero traffic, smokes that exact version, and promotes it", async () => {
    const runCommand = successfulRunner();
    const deps = releaseDeps(runCommand);

    const result = await runProductionCanaryRelease(deps);

    expect(result).toMatchObject({
      status: "promoted",
      sourceSha: RELEASE_SHA,
      previousVersionId: PREVIOUS_VERSION,
      candidateVersionId: CANDIDATE_VERSION,
    });
    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).toEqual([
      "pnpm run deploy:preflight",
      "pnpm run build",
      "pnpm exec wrangler d1 migrations list DB --remote",
      "pnpm exec wrangler d1 migrations apply DB --remote",
      "pnpm run deploy:preflight",
      "pnpm exec wrangler deployments list --json",
      `pnpm exec wrangler versions upload --strict --tag ${RELEASE_SHA} --message Spoonjoy source ${RELEASE_SHA}`,
      "pnpm exec wrangler versions list --json",
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`,
      `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`,
      `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@100% -y --message Promote ${RELEASE_SHA}`,
    ]);
    expect(deps.readMigrationFile).toHaveBeenCalledWith("migrations/0024_add_release_marker.sql");
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(result);
  });

  it("restores the previous version when the candidate smoke fails", async () => {
    const smokeCommand = `pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts --worker-version-id ${CANDIDATE_VERSION}`;
    const runCommand = successfulRunner({ [smokeCommand]: new Error("canary failed") });
    const deps = releaseDeps(runCommand);

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

  it("does not create a rollback deployment when staging itself fails", async () => {
    const stageCommand = `pnpm exec wrangler versions deploy ${CANDIDATE_VERSION}@0% ${PREVIOUS_VERSION}@100% -y --message Stage ${RELEASE_SHA} for canary`;
    const runCommand = successfulRunner({ [stageCommand]: new Error("stage failed") });
    const deps = releaseDeps(runCommand);

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("stage failed");

    expect(runCommand.mock.calls.map(([command, args]) => commandKey(command, args))).not.toContain(
      `pnpm exec wrangler versions deploy ${PREVIOUS_VERSION}@100% -y --message Restore after failed ${RELEASE_SHA}`,
    );
    expect(deps.writeReleaseArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed_before_stage",
      failure: "stage failed",
    }));
  });

  it("rejects invalid release SHAs before running commands", async () => {
    const runCommand = successfulRunner();
    const deps = { ...releaseDeps(runCommand), releaseSha: "main" };

    await expect(runProductionCanaryRelease(deps)).rejects.toThrow("40-character lowercase Git SHA");
    expect(runCommand).not.toHaveBeenCalled();
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
    expect(selectUploadedVersion(JSON.stringify([{ id: CANDIDATE_VERSION, tag: RELEASE_SHA }]), RELEASE_SHA)).toBe(
      CANDIDATE_VERSION,
    );
  });

  it.each([
    ["missing", JSON.stringify([{ id: CANDIDATE_VERSION, tag: "other" }])],
    ["duplicate", JSON.stringify([
      { id: CANDIDATE_VERSION, tag: RELEASE_SHA },
      { id: PREVIOUS_VERSION, tag: RELEASE_SHA },
    ])],
    ["malformed", "{"],
  ])("rejects a %s uploaded release tag", (_label, payload) => {
    expect(() => selectUploadedVersion(payload, RELEASE_SHA)).toThrow();
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
