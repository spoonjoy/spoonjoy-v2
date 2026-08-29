#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  MCP_CANARY_ISSUE_LABEL,
  MCP_CANARY_ISSUE_TITLE,
  buildMcpCanaryIssueBody,
  buildMcpCanaryStepSummary,
  decideMcpCanaryIssueAction,
  findMcpCanarySecretLeaks,
  redactMcpCanaryText,
  validateMcpCanaryRecoveryEvidence,
} from "./smoke-live-helpers.mjs";

function arg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function readCanaryReport(outDir) {
  const path = join(outDir, "mcp-oauth-canary-results.json");
  if (!existsSync(path)) {
    return {
      checks: [],
      failure: { message: `Missing canary result file at ${path}` },
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      checks: [],
      failure: { message: `Malformed canary result file at ${path}: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

function readReleaseEvidence(outDir) {
  const path = join(outDir, "production-release.json");
  if (!existsSync(path)) return { error: `Missing production release file at ${path}` };
  try {
    const release = JSON.parse(readFileSync(path, "utf8"));
    if (release?.status !== "promoted" || release?.phase !== "complete") {
      return { error: "Production release did not prove a promoted complete deployment." };
    }
    return { release };
  } catch (error) {
    return { error: `Malformed production release file at ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function redactJson(value) {
  if (typeof value === "string") return redactMcpCanaryText(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJson(entry)]));
  }
  return value;
}

function textArtifactPaths(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return textArtifactPaths(path);
    return /\.(?:json|md|txt|log|html)$/i.test(path) ? [path] : [];
  });
}

function scanTextArtifacts(outDir) {
  return textArtifactPaths(outDir).flatMap((path) =>
    findMcpCanarySecretLeaks(readFileSync(path, "utf8")).map((leak) => ({ ...leak, path })),
  );
}

async function githubRequest({ method, path, token, body }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (response.ok) return payload;
  const message = payload?.message ?? text;
  throw new Error(`GitHub ${method} ${path} failed with ${response.status}: ${message}`);
}

async function ensureIssueLabel({ repository, token, request }) {
  const body = { name: MCP_CANARY_ISSUE_LABEL, color: "8B4513", description: "MCP OAuth canary failures" };
  try {
    await request({ method: "POST", path: `/repos/${repository}/labels`, token, body });
  } catch (error) {
    if (!/already_exists|Validation Failed/i.test(String(error?.message ?? error))) throw error;
  }
}

async function findOpenCanaryIssue({ repository, token, request }) {
  const labels = encodeURIComponent(MCP_CANARY_ISSUE_LABEL);
  const issues = await request({ method: "GET", path: `/repos/${repository}/issues?state=open&labels=${labels}`, token });
  return issues.find((issue) => issue.title === MCP_CANARY_ISSUE_TITLE && !issue.pull_request) ?? null;
}

export async function manageIssue({
  report,
  status,
  workflowRunUrl,
  artifactUrl,
  token,
  repository,
  canRecover,
  request = githubRequest,
}) {
  if (status === "success" && !canRecover) return;
  if (!token || !repository) {
    throw new Error("MCP canary issue automation requires GITHUB_TOKEN and GITHUB_REPOSITORY.");
  }
  await ensureIssueLabel({ repository, token, request });
  const openIssue = await findOpenCanaryIssue({ repository, token, request });
  const decision = decideMcpCanaryIssueAction({ status, openIssueNumber: openIssue?.number ?? null });
  const body = buildMcpCanaryIssueBody({ report, status, workflowRunUrl, artifactUrl });

  if (decision.action === "create") {
    await request({
      method: "POST",
      path: `/repos/${repository}/issues`,
      token,
      body: { title: MCP_CANARY_ISSUE_TITLE, body, labels: [MCP_CANARY_ISSUE_LABEL] },
    });
    return;
  }
  if (decision.action === "comment") {
    await request({
      method: "POST",
      path: `/repos/${repository}/issues/${decision.issueNumber}/comments`,
      token,
      body: { body },
    });
    return;
  }
  if (decision.action === "close") {
    await request({
      method: "POST",
      path: `/repos/${repository}/issues/${decision.issueNumber}/comments`,
      token,
      body: { body: `Recovered.\n\n${body}` },
    });
    await request({
      method: "PATCH",
      path: `/repos/${repository}/issues/${decision.issueNumber}`,
      token,
      body: { state: "closed", state_reason: "completed" },
    });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const outDir = arg(argv, "--artifact-dir", process.env.MCP_CANARY_ARTIFACT_DIR ?? "mcp-oauth-canary-artifacts");
  const status = arg(argv, "--status", process.env.MCP_CANARY_STATUS ?? "success");
  const workflowRunUrl = arg(argv, "--workflow-run-url", process.env.MCP_CANARY_WORKFLOW_RUN_URL ?? "");
  const artifactUrl = arg(argv, "--artifact-url", process.env.MCP_CANARY_ARTIFACT_URL ?? "");
  const shouldManageIssue = argv.includes("--manage-issue");
  const requireReleaseEvidence = argv.includes("--require-release-evidence");
  const canRecover = requireReleaseEvidence;

  mkdirSync(outDir, { recursive: true });
  const leaks = scanTextArtifacts(outDir);
  let report = redactJson(readCanaryReport(outDir));
  let effectiveStatus = status;
  if (requireReleaseEvidence) {
    const releaseEvidence = readReleaseEvidence(outDir);
    const validation = releaseEvidence.release
      ? validateMcpCanaryRecoveryEvidence(report, {
        sourceSha: releaseEvidence.release.sourceSha,
        workerVersionId: releaseEvidence.release.candidateVersionId,
      })
      : { ok: false, error: releaseEvidence.error };
    effectiveStatus = validation.ok ? "success" : "failure";
    if (!validation.ok) {
      report = {
        ...report,
        failure: { message: validation.error },
      };
      process.exitCode = 1;
    }
  }
  if (leaks.length > 0) {
    writeFileSync(
      join(outDir, "mcp-oauth-canary-redaction-failures.json"),
      JSON.stringify(leaks.map((leak) => ({ ...leak, match: redactMcpCanaryText(leak.match) })), null, 2),
    );
    effectiveStatus = "failure";
    report = {
      ...report,
      failure: { message: "MCP OAuth canary artifacts contained a sensitive value." },
    };
    console.error(redactMcpCanaryText(`MCP OAuth canary artifacts contain ${leaks.length} sensitive value(s).`));
    process.exitCode = 1;
  }

  writeFileSync(join(outDir, "mcp-oauth-canary-results.json"), JSON.stringify(report, null, 2));

  const summary = buildMcpCanaryStepSummary({ report, status: effectiveStatus, workflowRunUrl, artifactUrl });
  const summaryPath = join(outDir, "mcp-oauth-canary-summary.md");
  writeFileSync(summaryPath, summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (shouldManageIssue) {
    await manageIssue({
      report,
      status: effectiveStatus,
      workflowRunUrl,
      artifactUrl,
      token: process.env.GITHUB_TOKEN,
      repository: process.env.GITHUB_REPOSITORY,
      canRecover,
    });
  }

  console.log(summaryPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
