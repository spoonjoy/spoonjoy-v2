#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildOAuthGrantBackfillApplySql,
  buildOAuthGrantBackfillSnapshotQueries,
  digestOAuthGrantBackfillPlan,
  planOAuthGrantBackfill,
  projectOAuthGrantBackfillReport,
  validateOAuthGrantBackfillPostApply,
} from "./oauth-grant-backfill-helpers.mjs";
import {
  arg,
  PRODUCTION_D1_DATABASE_NAME,
  QA_D1_DATABASE_NAME,
  resolveScriptTarget,
} from "./script-environment.mjs";
import { parseD1RowsOutput } from "./smoke-live-helpers.mjs";

const execFileAsync = promisify(execFile);

function databaseName(targetEnv) {
  if (targetEnv === "production") return PRODUCTION_D1_DATABASE_NAME;
  if (targetEnv === "qa") return QA_D1_DATABASE_NAME;
  return "DB";
}

async function executeD1(target, args) {
  const result = await execFileAsync("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "execute",
    databaseName(target.targetEnv),
    ...target.d1Args,
    ...args,
  ], { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
  return result.stdout;
}

async function readSnapshot(target) {
  const snapshot = {};
  for (const [name, query] of Object.entries(buildOAuthGrantBackfillSnapshotQueries())) {
    snapshot[name] = parseD1RowsOutput(await executeD1(target, ["--command", query]));
  }
  return snapshot;
}

async function applySql(target, sql) {
  if (!sql.trim()) return;
  const directory = mkdtempSync(join(tmpdir(), "spoonjoy-oauth-grant-backfill-"));
  const file = join(directory, "apply.sql");
  try {
    writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
    await executeD1(target, ["--file", file]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const target = resolveScriptTarget({
    argv,
    defaultBaseUrl: "http://localhost",
    defaultTargetEnv: "local",
  });
  const apply = argv.includes("--apply");
  const out = arg(argv, "--out", "oauth-grant-backfill-report.json");
  const before = planOAuthGrantBackfill(await readSnapshot(target));
  const planSha256 = digestOAuthGrantBackfillPlan(before);
  const report = {
    schemaVersion: 1,
    targetEnv: target.targetEnv,
    mode: apply ? "apply" : "dry-run",
    planSha256,
    before: projectOAuthGrantBackfillReport(before),
  };

  if (apply) {
    const expected = arg(argv, "--expect-plan-sha256", "");
    if (!/^[0-9a-f]{64}$/.test(expected) || expected !== planSha256) {
      throw new Error("plan_digest_mismatch");
    }
    if (target.targetEnv === "production" && !argv.includes("--confirm-production-apply")) {
      throw new Error("production_confirmation_required");
    }
    await applySql(target, buildOAuthGrantBackfillApplySql(before));
    const after = planOAuthGrantBackfill(await readSnapshot(target));
    report.after = projectOAuthGrantBackfillReport(after);
    report.afterPlanSha256 = digestOAuthGrantBackfillPlan(after);
    const validation = validateOAuthGrantBackfillPostApply(before, after);
    if (!validation.ok) {
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      throw new Error(validation.reason);
    }
  }

  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

try {
  await main();
} catch (error) {
  const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "execution_failed";
  process.stderr.write(`OAuth grant backfill failed: ${code}\n`);
  process.exitCode = 1;
}
