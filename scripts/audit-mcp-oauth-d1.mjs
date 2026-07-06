#!/usr/bin/env node
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildMcpOAuthAuditSummary,
  buildMcpOAuthInvariantAuditD1Args,
  mcpOAuthAuditHasFailures,
  normalizeMcpOAuthAuditRows,
  parseD1RowsOutput,
  parseMcpOAuthAuditArgs,
  readGitMetadata,
} from "./smoke-live-helpers.mjs";

const execFileAsync = promisify(execFile);

async function runWranglerD1(args) {
  const { stdout, stderr } = await execFileAsync("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  return { stdout, stderr };
}

async function main() {
  const { baseUrl, outDir, target, targetEnv } = parseMcpOAuthAuditArgs();
  mkdirSync(outDir, { recursive: true });

  const { stdout, stderr } = await runWranglerD1(buildMcpOAuthInvariantAuditD1Args({ targetEnv }));
  const rows = normalizeMcpOAuthAuditRows(parseD1RowsOutput(stdout));
  const report = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    targetEnv,
    environment: {
      targetEnv: target.targetEnv,
      baseUrl: target.baseUrl,
      d1Target: target.d1Target,
      destructiveScope: target.destructiveScope,
    },
    git: readGitMetadata(),
    rows,
    stderr,
  };
  const workflowRunUrl = process.env.MCP_OAUTH_AUDIT_WORKFLOW_RUN_URL ?? "";
  const summary = buildMcpOAuthAuditSummary({
    targetEnv,
    baseUrl,
    generatedAt: report.generatedAt,
    rows,
    workflowRunUrl,
  });

  writeFileSync(join(outDir, "mcp-oauth-d1-audit-results.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "mcp-oauth-d1-audit-summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  console.log(join(outDir, "mcp-oauth-d1-audit-results.json"));
  if (mcpOAuthAuditHasFailures(rows)) {
    process.exitCode = 1;
  }
}

await main();
