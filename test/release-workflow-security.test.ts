import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIRECTORY = ".github/workflows";

function workflowSource(name: string): string {
  return readFileSync(`${WORKFLOW_DIRECTORY}/${name}`, "utf8");
}

describe("GitHub Actions supply-chain policy", () => {
  it("pins every action to an immutable commit with a readable version comment", () => {
    const mutableReferences: string[] = [];

    for (const file of readdirSync(WORKFLOW_DIRECTORY).filter((name) => /\.ya?ml$/.test(name))) {
      const lines = workflowSource(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/^\s*(?:-\s*)?uses:/.test(line)) return;
        if (!/uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\s+#\s+v\d+\s*$/.test(line)) {
          mutableReferences.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(mutableReferences).toEqual([]);
  });

  it("recognizes both supported workflow file extensions", () => {
    expect(["ci.yml", "release.yaml", "notes.md"].filter((name) => /\.ya?ml$/.test(name))).toEqual([
      "ci.yml",
      "release.yaml",
    ]);
  });
});

describe("production release provenance", () => {
  const production = workflowSource("production-deploy.yml");

  it("runs only after successful main-branch CI or an explicit exact-SHA dispatch", () => {
    expect(production).not.toMatch(/^\s{2}push:/m);
    expect(production).toContain("  workflow_run:");
    expect(production).toContain("    workflows: [CI]");
    expect(production).toContain("    branches: [main]");
    expect(production).toContain("    types: [completed]");
    expect(production).toContain("      source_sha:");
    expect(production).toContain("        required: true");
    expect(production).toContain("      rollback_version_id:");
    expect(production).not.toContain("      allow_rollback:");
    expect(production).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(production).toContain("github.event.workflow_run.event == 'push'");
    expect(production).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(production).toContain("github.event.workflow_run.path == '.github/workflows/ci.yml'");
    expect(production).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(production).toContain("environment: production");
    expect(production).toContain("concurrency:\n  group: production-deploy\n  cancel-in-progress: false");
    expect(production.match(/^concurrency:$/gm)).toHaveLength(1);
    const concurrencyStart = production.indexOf("concurrency:");
    const concurrencyEnd = production.indexOf("\nenv:", concurrencyStart);
    const concurrency = production.slice(concurrencyStart, concurrencyEnd);
    expect(concurrency.match(/^  group: production-deploy$/gm)).toHaveLength(1);
    expect(concurrency.match(/^  cancel-in-progress: false$/gm)).toHaveLength(1);
  });

  it("checks out, validates, deploys, and records the same source SHA", () => {
    expect(production).toContain(
      "SOURCE_SHA: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.source_sha }}",
    );
    expect(production).toContain("ref: ${{ env.SOURCE_SHA }}");
    expect(production).toContain("persist-credentials: false");
    expect(production).toContain("grep -Eq '^[0-9a-f]{40}$'");
    expect(production).toContain('git merge-base --is-ancestor "$SOURCE_SHA" origin/main');
    expect(production).toContain('gh run list --workflow .github/workflows/ci.yml --branch main --commit "$SOURCE_SHA"');
    expect(production).toContain("--event push --status success");
    expect(production).toContain('test "$(git rev-parse origin/main)" = "$SOURCE_SHA"');
    expect(production).toContain("ROLLBACK_VERSION_ID: ${{ github.event_name == 'workflow_dispatch' && inputs.rollback_version_id || '' }}");
    expect(production).toContain(
      'pnpm run deploy:auto -- --release-mode "$SPOONJOY_RELEASE_MODE" --rollback-version-id "$ROLLBACK_VERSION_ID"',
    );
    expect(production).not.toContain("ALLOW_ROLLBACK");
    expect(production).toContain('pnpm run deploy:auto');
    expect(production).toContain('Source SHA: `%s`');
    expect(production).not.toMatch(/^\s{2}issues:\s+write$/m);
    expect(production).toMatch(/report-canary:[\s\S]*permissions:[\s\S]*issues: write/);

    const checkout = production.indexOf("ref: ${{ env.SOURCE_SHA }}");
    const validation = production.indexOf("name: Validate release source");
    const setup = production.indexOf("name: Setup Node.js");
    const deploy = production.indexOf("pnpm run deploy:auto");
    const record = production.indexOf('Source SHA: `%s`');
    expect(checkout).toBeGreaterThan(-1);
    expect(checkout).toBeLessThan(validation);
    expect(validation).toBeLessThan(setup);
    expect(setup).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(record);
  });

  it("pins the bootstrap lifecycle phase in source and refuses cross-boundary rollback", () => {
    const modeLine = "  SPOONJOY_RELEASE_MODE: atomic-bootstrap";
    const boundaryLine = '  SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA: ""';
    const rollbackGuard =
      'if [ -n "$ROLLBACK_VERSION_ID" ] && [ "$SPOONJOY_RELEASE_MODE" != "protocol-v1-canary" ]; then';
    const ancestryCheck =
      'git merge-base --is-ancestor "$SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA" "$SOURCE_SHA"';
    expect(production.split(modeLine)).toHaveLength(2);
    expect(production.split(boundaryLine)).toHaveLength(2);
    expect(production.match(/^  SPOONJOY_RELEASE_MODE:/gm)).toHaveLength(1);
    expect(production.match(/^  SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA:/gm)).toHaveLength(1);
    expect(production.indexOf(modeLine)).toBeLessThan(production.indexOf("jobs:"));
    expect(production.indexOf(boundaryLine)).toBeLessThan(production.indexOf("jobs:"));
    expect(production).not.toContain("      release_mode:");
    expect(production).not.toContain("      protocol_v1_boundary_sha:");
    expect(production).toContain(
      'pnpm run deploy:auto -- --release-mode "$SPOONJOY_RELEASE_MODE"',
    );
    expect(production.split(rollbackGuard)).toHaveLength(2);
    expect(production.split(ancestryCheck)).toHaveLength(2);

    const validationStart = production.indexOf("name: Validate release source");
    const setupStart = production.indexOf("name: Setup Node.js");
    const deployStart = production.indexOf("name: Deploy staged release to Cloudflare Workers");
    const validation = production.slice(validationStart, setupStart);
    expect(validation).toContain(rollbackGuard);
    expect(validation).toContain('test -n "$SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA"');
    expect(validation).toContain(ancestryCheck);
    expect(production.indexOf(rollbackGuard)).toBeLessThan(deployStart);
    expect(production.indexOf(ancestryCheck)).toBeLessThan(deployStart);
    expect(production).toContain('releaseMode: $release_mode');
    expect(production).toContain(
      'status: (if $release_mode == "protocol-v1-canary" then "release_state_unknown" else "forward_repair_required" end)',
    );
    expect(production).toContain('phase: "unknown"');
    expect(production).toContain('migrationApply: "unknown"');
    expect(production).toContain("reviewedMigrations: null");
    expect(production).toContain(
      'sourceSha: (if ($source_sha | test("^[0-9a-f]{40}$")) then $source_sha else null end)',
    );
    expect(production).toContain("databaseRollbackSupported: false");
    expect(production).toContain(
      'failure: "Release workflow failed without a trustworthy orchestrator artifact."',
    );
    const fallbackStart = production.indexOf("name: Ensure release artifact exists");
    const fallbackEnd = production.indexOf("name: Upload MCP OAuth canary artifacts");
    const fallback = production.slice(fallbackStart, fallbackEnd);
    expect(fallback).toContain('if [ -f "$artifact_path" ] && jq -e');
    expect(fallback).toContain('((keys - ["candidateVersionId",');
    expect(fallback).toContain('(.status | IN("promoted",');
    expect(fallback).toContain('(.phase | IN("validate",');
    expect(fallback).toContain('"version_lookup", "rollback_version_lookup", "rollback_current_deployment", "rollback_already_active", "protocol_ancestry", "rollback_protocol_ancestry", "active_version_mapping", "rollback_active_version_mapping", "stage"');
    expect(fallback).toContain('(.sourceSha | type == "string" and test("^[0-9a-f]{40}$"))');
    expect(fallback).toContain('(.treeHash | type == "string" and test("^[0-9a-f]{40}$"))');
    expect(fallback).toContain('(.previousVersionId | type == "string" and test("^[0-9a-f]{8}-');
    expect(fallback).toContain('(.candidateVersionId | type == "string" and test("^[0-9a-f]{8}-');
    expect(fallback).not.toContain('; "i"');
    expect(fallback).toContain('all(.reviewedMigrations[]; (test("^[0-9]{4}_[A-Za-z0-9][A-Za-z0-9_.-]*[.]sql$") and (contains("..") | not)))');
    expect(fallback).toContain('((.reviewedMigrations | unique | length) == (.reviewedMigrations | length))');
    expect(fallback).toContain(
      'then (if .phase == "rollback_already_active" then .previousVersionId == .candidateVersionId else .previousVersionId != .candidateVersionId end) else true end',
    );
    expect(fallback).toContain('if .migrationApply == "not_needed" then (.reviewedMigrations | length) == 0');
    expect(fallback).toContain(
      'if $release_mode == "protocol-v1-canary" then .status != "forward_repair_required"',
    );
    expect(fallback).toContain(
      'if .phase == "bootstrap_probe" then $release_mode == "atomic-bootstrap" else true end',
    );
    expect(fallback).toContain(
      'or (.phase == "full_preflight" and .migrationApply == "not_needed")',
    );
    expect(fallback).toContain(
      'if (.phase | IN("protocol_ancestry", "active_version_mapping")) then .migrationApply == "not_started"',
    );
    expect(fallback).toContain(
      'elif (.phase | IN("rollback_version_lookup", "rollback_current_deployment", "rollback_already_active", "rollback_protocol_ancestry", "rollback_active_version_mapping")) then .migrationApply == "not_needed"',
    );
    expect(fallback).toContain(
      'if (.phase | IN("rollback_current_deployment", "rollback_already_active", "rollback_protocol_ancestry", "rollback_active_version_mapping")) then has("candidateVersionId") else (has("candidateVersionId") | not) end',
    );
    expect(fallback).toContain(
      'if (.phase | IN("validate", "provenance", "initial_preflight", "build", "post_build_provenance", "migration_list")) then (.reviewedMigrations | length) == 0 elif .phase == "migration_review" then (.reviewedMigrations | length) > 0 else true end',
    );
    expect(fallback).toContain(
      'if (.phase == "migration_apply") then ((.treeHash | type == "string") and (.previousVersionId | type == "string") and ((.reviewedMigrations | length) > 0))',
    );
    expect(fallback).toContain(
      'then (.phase == "complete" and has("treeHash") and has("previousVersionId") and has("candidateVersionId") and (has("failure") | not) and (has("rollbackFailure") | not)',
    );
    expect(fallback).toContain(
      'elif .status == "rollback_failed" then ((.phase | IN("stage", "canary", "promote", "verify_promotion", "artifact")) and has("treeHash") and has("previousVersionId") and has("candidateVersionId") and has("failure") and has("rollbackFailure")',
    );
    expect(fallback).toContain(
      'and (if (.phase | IN("verify_promotion", "bootstrap_probe", "artifact")) then has("candidateVersionId") else (has("candidateVersionId") | not) end)',
    );
    expect(fallback).toContain(
      'elif .phase == "migration_apply" then .migrationApply == "failed" else (.migrationApply | IN("not_needed", "succeeded")) end',
    );
    expect(fallback).toContain(
      'elif .phase == "full_preflight" then .migrationApply == "succeeded"',
    );
    expect(fallback).toContain('if [ "$artifact_valid" -ne 1 ]; then');
    expect(fallback).toContain(
      'if $protocol_boundary_sha == "" then {} else {protocolV1BoundarySha: $protocol_boundary_sha} end',
    );
    const generatedFallbackStart = fallback.indexOf("jq -n");
    expect(generatedFallbackStart).toBeGreaterThan(-1);
    const generatedFallback = fallback.slice(generatedFallbackStart);
    expect(generatedFallback).not.toContain("previousVersionId");
    expect(generatedFallback).not.toContain("candidateVersionId");
    expect(generatedFallback).not.toContain("rollbackFailure");
    expect(production.match(/^\s+pnpm run deploy:auto.*$/gm)).toEqual([
      '            pnpm run deploy:auto -- --release-mode "$SPOONJOY_RELEASE_MODE" --rollback-version-id "$ROLLBACK_VERSION_ID"',
      '            pnpm run deploy:auto -- --release-mode "$SPOONJOY_RELEASE_MODE"',
    ]);
    expect(production).toContain(
      'deploymentStrategy: (if $release_mode == "protocol-v1-canary" then "gradual" else "atomic" end)',
    );
    expect(production).toContain("protocolV1BoundarySha: $protocol_boundary_sha");
  });
});

describe("web dependency advisory gate", () => {
  const ci = workflowSource("ci.yml");

  it("runs a fail-closed OSV-compatible pnpm-lock advisory scan in canonical CI", () => {
    expect(ci).toContain("advisory");
    expect(ci).toContain("pnpm run advisory:scan");
    expect(ci).toContain("pnpm-lock.yaml");
    expect(ci).toContain("osv-scanner_linux_amd64");
    expect(ci).toContain("bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc");
    expect(ci).toContain("https://api.github.com/repos/google/osv-scanner/git/ref/tags/${OSV_SCANNER_VERSION}");
    expect(ci).toContain('test "$actual_tag_sha" = "$OSV_SCANNER_TAG_SHA"');
    expect(ci).toContain("pnpm install --frozen-lockfile --ignore-scripts");

    const tagVerification = ci.indexOf('test "$actual_tag_sha" = "$OSV_SCANNER_TAG_SHA"');
    const binaryDownload = ci.indexOf("osv-scanner_linux_amd64");
    const dependencyInstall = ci.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
    const advisoryRun = ci.indexOf("pnpm run advisory:scan");
    expect(tagVerification).toBeGreaterThan(-1);
    expect(binaryDownload).toBeGreaterThan(tagVerification);
    expect(dependencyInstall).toBeGreaterThan(binaryDownload);
    expect(advisoryRun).toBeGreaterThan(dependencyInstall);
  });

  it("requires the advisory job before production deploy can release an exact SHA", () => {
    const production = workflowSource("production-deploy.yml");

    expect(production).toContain("required_job=advisory");
  });
});
