import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { manageIssue } from "../../scripts/report-mcp-oauth-canary.mjs";

const sourceSha = "a".repeat(40);
const workerVersionId = "22222222-2222-4222-8222-222222222222";
const checkNames = [
  "candidate Worker override readiness",
  "signup disposable user",
  "protected-resource metadata",
  "dynamic client registration",
  "authorize consent UI and approve redirect",
  "authorization_code token exchange",
  "mcp initialize and tools/list with issued access token",
  "refresh rotation and replay rejection",
  "mcp initialize and tools/list with refreshed access token",
  "legacy Claude refresh token promotion",
];
const dirs: string[] = [];

function runReporter(outDir: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [
    "scripts/report-mcp-oauth-canary.mjs",
    "--artifact-dir", outDir,
    "--require-release-evidence",
    ...extraArgs,
  ], { cwd: process.cwd(), encoding: "utf8" });
}

function writeRelease(outDir: string) {
  writeFileSync(path.join(outDir, "production-release.json"), JSON.stringify({
    status: "promoted",
    phase: "complete",
    sourceSha,
    candidateVersionId: workerVersionId,
  }));
}

function writeValidCanary(outDir: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(path.join(outDir, "mcp-oauth-canary-results.json"), JSON.stringify({
    schemaVersion: 1,
    git: { branch: "main", commit: sourceSha },
    workerVersionId,
    targetEnv: "production",
    baseUrl: "https://spoonjoy.app",
    resource: "https://spoonjoy.app/mcp",
    checks: checkNames.map((name) => ({ name, elapsedMs: 1 })),
    cleanup: { target: "production D1", remaining: 0 },
    legacyProbe: { promotedResource: "https://spoonjoy.app/mcp" },
    ...overrides,
  }));
}

async function runManageIssueScenario(status: string, canRecover: boolean) {
  const calls: Array<Record<string, unknown>> = [];
  await manageIssue({
    report: { checks: [], cleanup: {} },
    status,
    canRecover,
    workflowRunUrl: "",
    artifactUrl: "",
    token: "test-token",
    repository: "owner/repo",
    request: async (input: Record<string, unknown>) => {
      calls.push(input);
      if (input.method === "GET") return [{ number: 12, title: "MCP OAuth canary failing" }];
      return {};
    },
  });
  return calls;
}

describe("MCP OAuth canary reporter", () => {
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("reports success only for canary evidence bound to the promoted release", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeRelease(outDir);
    writeValidCanary(outDir);

    const result = runReporter(outDir);

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(outDir, "mcp-oauth-canary-summary.md"), "utf8")).toContain("Status: **success**");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "{"],
    ["incomplete", JSON.stringify({ schemaVersion: 1, checks: [] })],
  ])("fails closed for %s canary evidence", (_label, contents) => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeRelease(outDir);
    if (contents !== undefined) writeFileSync(path.join(outDir, "mcp-oauth-canary-results.json"), contents);

    const result = runReporter(outDir);

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(outDir, "mcp-oauth-canary-summary.md"), "utf8")).toContain("Status: **failure**");
  });

  it("does not report recovery when any uploaded artifact leaks a credential", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeRelease(outDir);
    writeValidCanary(outDir);
    writeFileSync(path.join(outDir, "debug.log"), `Authorization: Bearer sj_${"x".repeat(40)}`);

    const result = runReporter(outDir);

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(outDir, "mcp-oauth-canary-summary.md"), "utf8")).toContain("Status: **failure**");
  });

  it("does not manage recovery without release-evidence validation", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeRelease(outDir);
    writeValidCanary(outDir);

    const result = spawnSync(process.execPath, [
      "scripts/report-mcp-oauth-canary.mjs",
      "--artifact-dir", outDir,
      "--manage-issue",
    ], { cwd: process.cwd(), encoding: "utf8" });

    expect(result.status).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "{"],
    ["not promoted", JSON.stringify({ status: "forward_repair_required", phase: "canary", sourceSha, candidateVersionId: workerVersionId })],
    ["not complete", JSON.stringify({ status: "promoted", phase: "artifact", sourceSha, candidateVersionId: workerVersionId })],
  ])("fails closed for %s production release evidence", (_label, releaseContents) => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeValidCanary(outDir);
    if (releaseContents !== undefined) writeFileSync(path.join(outDir, "production-release.json"), releaseContents);

    const result = runReporter(outDir);

    expect(result.status).toBe(1);
  });

  it.each([
    ["source", { git: { branch: "main", commit: "b".repeat(40) } }],
    ["worker", { workerVersionId: "33333333-3333-4333-8333-333333333333" }],
  ])("fails closed for a mismatched %s identity", (_label, overrides) => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeRelease(outDir);
    writeValidCanary(outDir, overrides);

    expect(runReporter(outDir).status).toBe(1);
  });

  it("scans the raw canary result before rewriting a sanitized report", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-canary-report-"));
    dirs.push(outDir);
    writeRelease(outDir);
    writeValidCanary(outDir, { diagnostic: `Authorization: Bearer sj_${"x".repeat(40)}` });

    const result = runReporter(outDir);

    expect(result.status).toBe(1);
    expect(readFileSync(path.join(outDir, "mcp-oauth-canary-summary.md"), "utf8")).toContain("Status: **failure**");
  });

  it("closes only for validated recovery and never for invalid or unbound success", async () => {
    const invalid = await runManageIssueScenario("failure", true);
    const unbound = await runManageIssueScenario("success", false);
    const valid = await runManageIssueScenario("success", true);

    expect(invalid).not.toContainEqual(expect.objectContaining({ method: "PATCH" }));
    expect(invalid).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/repos/owner/repo/issues/12/comments",
    }));
    expect(unbound).toEqual([]);
    const recoveryCommentIndex = valid.findIndex((call) =>
      call.method === "POST" && call.path === "/repos/owner/repo/issues/12/comments"
      && String((call.body as { body?: string } | undefined)?.body).startsWith("Recovered."));
    const closeIndex = valid.findIndex((call) => call.method === "PATCH");
    expect(recoveryCommentIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThan(recoveryCommentIndex);
  });
});
