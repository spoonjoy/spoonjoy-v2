import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReleaseArtifactCli } from "../../scripts/validate-release-artifact";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function releaseFile(overrides: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-release-validator-"));
  directories.push(directory);
  const filePath = path.join(directory, "production-release.json");
  await writeFile(filePath, `${JSON.stringify({
    status: "promoted",
    sourceSha: "a".repeat(40),
    releaseMode: "atomic-bootstrap",
    deploymentStrategy: "atomic",
    phase: "complete",
    treeHash: "b".repeat(40),
    reviewedMigrations: [],
    migrationApply: "not_needed",
    databaseRollbackSupported: false,
    previousVersionId: "11111111-1111-4111-8111-111111111111",
    candidateVersionId: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  }, null, 2)}\n`);
  return filePath;
}

async function productCutoverStateFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-cutover-state-validator-"));
  directories.push(directory);
  const filePath = path.join(directory, "production-product-cutover-state.json");
  const triggerInventory = [
    "SavedRecipe_cutover_block_membership_delete",
    "SavedRecipe_cutover_block_membership_insert",
  ];
  const sourceRecord = (
    sourceSha: string,
    versionId: string | null,
    releaseMode: "atomic-bootstrap" | "atomic-product-activation",
    baseSourceSha: string,
  ) => ({
    sourceSha,
    treeSha: "b".repeat(40),
    workerBundleSha256: "1".repeat(64),
    durableObjectBundleSha256: "2".repeat(64),
    versionId,
    releaseMode,
    baseSourceSha,
  });
  const cutover = {
    schemaVersion: 1,
    environment: "production",
    transition: "initial",
    phase: "verified",
    status: "succeeded",
    activeBefore: sourceRecord(
      "40b8f4c85f85f0fa1f807e150013bc7b9675eff5",
      "144bd85d-d0c8-41ea-ae3a-9abf0dbcb6aa",
      "atomic-bootstrap",
      "0".repeat(40),
    ),
    target: sourceRecord(
      "a".repeat(40),
      "22222222-2222-4222-8222-222222222222",
      "atomic-product-activation",
      "3".repeat(40),
    ),
    predecessor: {
      relationship: "exact",
      canonicalSourceSha: "40b8f4c85f85f0fa1f807e150013bc7b9675eff5",
      canonicalTreeSha: "b".repeat(40),
      canonicalWorkerBundleSha256: "1".repeat(64),
      canonicalDurableObjectBundleSha256: "2".repeat(64),
      lineageParentSourceSha: "40b8f4c85f85f0fa1f807e150013bc7b9675eff5",
      runtimeFloorSourceSha: null,
      originalFailedRestorationSourceSha: null,
    },
    protocolBoundarySha: "d".repeat(40),
    compatibilitySourceSha: "40b8f4c85f85f0fa1f807e150013bc7b9675eff5",
    migration: {
      name: "0025_clem_feedback_product.sql",
      sha256: "151009d5410997365ec56c249a50c75b7aeecadd0841b677f1b0bd7a9ab2c6e6",
      recoveryBookmarkId: "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683",
      applyState: "applied",
      triggerInventory,
    },
    deployment: {
      deploymentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      versionId: "22222222-2222-4222-8222-222222222222",
      sourceSha: "a".repeat(40),
      trafficPercent: 100,
    },
    unlock: {
      inventoryBefore: triggerInventory,
      statementsSha256: "066fa3193e478418d7805c49e4053b8e1ffd5f87e96124bfa33ce6297950e51b",
      applyState: "applied",
      inventoryAfter: [],
    },
    failure: null,
  };
  await writeFile(filePath, `${JSON.stringify({ cutover }, null, 2)}\n`);
  return filePath;
}

describe("release artifact validator CLI", () => {
  it("executes the TypeScript workflow validator through tsx", () => {
    let stderr = "";
    try {
      execFileSync("pnpm", ["exec", "tsx", "scripts/validate-release-artifact.ts"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      throw new Error("Expected the validator to reject missing options.");
    } catch (error) {
      stderr = String((error as { stderr?: string | Buffer }).stderr ?? "");
    }
    expect(stderr).toContain("Release artifact validation failed.");
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("accepts an exact production release identity", async () => {
    const filePath = await releaseFile();
    await expect(validateReleaseArtifactCli([
      "--kind", "production-release",
      "--file", filePath,
      "--source-sha", "a".repeat(40),
      "--expected-mode", "atomic-bootstrap",
    ])).resolves.toBeUndefined();
  });

  it("rejects malformed options, lifecycle, and workflow identity", async () => {
    await expect(validateReleaseArtifactCli(["--wat", "value"]))
      .rejects.toThrow("options are invalid");
    await expect(validateReleaseArtifactCli(["--kind", "--file"]))
      .rejects.toThrow("options are invalid");
    await expect(validateReleaseArtifactCli(["--kind", "production-release"]))
      .rejects.toThrow("requires");
    await expect(validateReleaseArtifactCli([
      "--kind", "production-release", "--file", "missing",
      "--kind", "production-release", "--expected-mode", "atomic-product-activation",
    ])).rejects.toThrow("requires one --kind");
    await expect(validateReleaseArtifactCli([
      "--kind", "unknown", "--file", "missing",
    ])).rejects.toThrow("kind");
    const malformedJson = await releaseFile();
    await writeFile(malformedJson, "not-json\n");
    await expect(validateReleaseArtifactCli([
      "--kind", "production-release", "--file", malformedJson,
      "--source-sha", "a".repeat(40), "--expected-mode", "atomic-bootstrap",
    ])).rejects.toThrow("not valid JSON");
    const invalidLifecycle = await releaseFile({ deploymentStrategy: "gradual" });
    await expect(validateReleaseArtifactCli([
      "--kind", "production-release", "--file", invalidLifecycle,
      "--source-sha", "a".repeat(40), "--expected-mode", "atomic-bootstrap",
    ])).rejects.toThrow("lifecycle");
    const valid = await releaseFile();
    await expect(validateReleaseArtifactCli([
      "--kind", "production-release", "--file", valid,
      "--source-sha", "c".repeat(40), "--expected-mode", "atomic-bootstrap",
    ])).rejects.toThrow("identity");
  });

  it("validates the separate durable production cutover state envelope", async () => {
    const filePath = await productCutoverStateFile();
    await expect(validateReleaseArtifactCli([
      "--kind", "product-cutover-state", "--file", filePath,
    ])).resolves.toBeUndefined();
    await expect(validateReleaseArtifactCli([
      "--kind", "product-cutover-state", "--file", filePath,
      "--source-sha", "a".repeat(40),
    ])).rejects.toThrow("state options are invalid");
  });

  it("requires product success to bind the exact durable cutover state", async () => {
    const statePath = await productCutoverStateFile();
    const state = JSON.parse(await readFile(statePath, "utf8")) as { cutover: unknown };
    const releasePath = await releaseFile({
      releaseMode: "atomic-product-activation",
      reviewedMigrations: ["0025_clem_feedback_product.sql"],
      migrationApply: "succeeded",
      previousVersionId: "144bd85d-d0c8-41ea-ae3a-9abf0dbcb6aa",
      cutover: state.cutover,
    });
    const args = [
      "--kind", "production-release", "--file", releasePath,
      "--source-sha", "a".repeat(40), "--expected-mode", "atomic-product-activation",
    ];
    await expect(validateReleaseArtifactCli(args)).rejects.toThrow("requires durable cutover state");
    await expect(validateReleaseArtifactCli([
      ...args, "--state-file", statePath,
    ])).resolves.toBeUndefined();
    await writeFile(statePath, `${JSON.stringify({
      cutover: Object.fromEntries(
        Object.entries(state.cutover as Record<string, unknown>).reverse(),
      ),
    }, null, 2)}\n`);
    await expect(validateReleaseArtifactCli([
      ...args, "--state-file", statePath,
    ])).resolves.toBeUndefined();

    const differentStatePath = await productCutoverStateFile();
    const different = JSON.parse(await readFile(differentStatePath, "utf8")) as {
      cutover: { protocolBoundarySha: string };
    };
    different.cutover.protocolBoundarySha = "e".repeat(40);
    await writeFile(differentStatePath, `${JSON.stringify(different, null, 2)}\n`);
    await expect(validateReleaseArtifactCli([
      ...args, "--state-file", differentStatePath,
    ])).rejects.toThrow("differ");

    await expect(validateReleaseArtifactCli([
      "--kind", "production-release", "--file", await releaseFile(),
      "--source-sha", "a".repeat(40), "--expected-mode", "atomic-bootstrap",
      "--state-file", statePath,
    ])).rejects.toThrow("cannot bind");
  });
});
