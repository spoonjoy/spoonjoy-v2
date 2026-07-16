import { execFileSync } from "node:child_process";

import {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  PRODUCTION_D1_DATABASE_NAME,
  QA_BASE_URL,
  QA_D1_DATABASE_NAME,
  QA_R2_BUCKET,
  arg,
  resolveScriptTarget,
  usesLocalD1,
} from "./script-environment.mjs";

export {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  PRODUCTION_D1_DATABASE_NAME,
  QA_BASE_URL,
  QA_D1_DATABASE_NAME,
  QA_R2_BUCKET,
  arg,
  usesLocalD1,
};

export const IMAGE_COVER_SMOKE_FLAG = "--include-image-cover-smoke";
const WORKER_VERSION_ID_FLAG = "--worker-version-id";
const WORKER_VERSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_VERSION_OVERRIDE_HEADER = "Cloudflare-Workers-Version-Overrides";
const WORKER_VERSION_RESPONSE_HEADER = "X-Spoonjoy-Worker-Version";
const WORKER_VERSION_READINESS_TIMEOUT_MS = 60_000;
const WORKER_VERSION_READINESS_INTERVAL_MS = 500;
const CLOUDFLARE_SECRET_ENV_NAMES = [
  "CF_API_KEY",
  "CF_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_D1_API_TOKEN",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_WORKERS_API_TOKEN",
];

function withoutCloudflareSecrets(env) {
  const sanitized = { ...env };
  for (const name of CLOUDFLARE_SECRET_ENV_NAMES) delete sanitized[name];
  return sanitized;
}

export function buildD1CommandEnvironment(env) {
  const token = env.CLOUDFLARE_D1_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  const scoped = withoutCloudflareSecrets(env);
  if (token) scoped.CLOUDFLARE_API_TOKEN = token;
  return scoped;
}

export function buildBrowserEnvironment(env) {
  const scoped = withoutCloudflareSecrets(env);
  delete scoped.CLOUDFLARE_ACCOUNT_ID;
  return scoped;
}

function normalizeWorkerVersionId(value) {
  if (typeof value !== "string" || !WORKER_VERSION_UUID.test(value)) {
    throw new Error("--worker-version-id must be supplied exactly once with a valid UUID.");
  }
  return value.toLowerCase();
}

export function buildWorkerVersionOverrideHeaders(workerVersionId) {
  if (workerVersionId === null) return {};
  const normalized = normalizeWorkerVersionId(workerVersionId);
  return {
    [WORKER_VERSION_OVERRIDE_HEADER]: `spoonjoy-v2="${normalized}"`,
  };
}

function headerEntries(headers) {
  if (headers instanceof Headers) return [...headers.entries()];
  if (typeof headers !== "object" || headers === null) return [];
  return Object.entries(headers);
}

function headerValue(headers, name) {
  return headerEntries(headers).find(([headerName]) => headerName.toLowerCase() === name.toLowerCase())?.[1] ?? null;
}

function workerVersionResponseId(headers) {
  const value = headerValue(headers, WORKER_VERSION_RESPONSE_HEADER);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function workerVersionReadinessError(expected, attempts, elapsedMs, lastObserved) {
  return new Error(
    `Candidate Worker ${expected} was not ready after ${attempts} ${attempts === 1 ? "attempt" : "attempts"} and ${elapsedMs}ms; last observed version: ${lastObserved ?? "missing"}.`,
  );
}

function isSameOrigin(requestUrl, baseUrl) {
  try {
    return new URL(requestUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function isRouteActionResponse({ baseUrl, responseUrl, routePath, requestMethod }) {
  if (requestMethod.toUpperCase() !== "POST") return false;
  try {
    const response = new URL(responseUrl);
    return response.origin === new URL(baseUrl).origin
      && (response.pathname === routePath || response.pathname === `${routePath}.data`);
  } catch {
    return false;
  }
}

function isStaticAssetBindingUrl(requestUrl) {
  const pathname = new URL(requestUrl).pathname;
  return pathname === "/assets" || pathname.startsWith("/assets/");
}

export function buildWorkerVersionRequestHeaders({ baseUrl, requestUrl, headers = {}, workerVersionId }) {
  const normalized = workerVersionId === null ? null : normalizeWorkerVersionId(workerVersionId);
  const scopedHeaders = Object.fromEntries(
    headerEntries(headers).filter(([name]) => name.toLowerCase() !== WORKER_VERSION_OVERRIDE_HEADER.toLowerCase()),
  );
  if (normalized !== null && isSameOrigin(requestUrl, baseUrl)) {
    scopedHeaders[WORKER_VERSION_OVERRIDE_HEADER] = `spoonjoy-v2="${normalized}"`;
  }
  return scopedHeaders;
}

export function assertWorkerVersionResponse(headers, workerVersionId, label = "Spoonjoy response") {
  if (workerVersionId === null) return;
  const expected = normalizeWorkerVersionId(workerVersionId);
  const actual = workerVersionResponseId(headers);

  if (!actual) {
    throw new Error(`${label} is missing ${WORKER_VERSION_RESPONSE_HEADER}; candidate Worker ${expected} was not proven.`);
  }
  if (actual.toLowerCase() !== expected) {
    throw new Error(`${label} expected candidate Worker ${expected} but received ${actual}.`);
  }
}

export async function waitForWorkerVersionReady({
  workerVersionId,
  probe,
  timeoutMs = WORKER_VERSION_READINESS_TIMEOUT_MS,
  intervalMs = WORKER_VERSION_READINESS_INTERVAL_MS,
  now = Date.now,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  if (workerVersionId === null) {
    return { attempts: 0, elapsedMs: 0, workerVersionId: null };
  }
  const expected = normalizeWorkerVersionId(workerVersionId);
  if (typeof probe !== "function") {
    throw new Error("Worker version readiness requires a probe function.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Worker version readiness timeout must be a positive finite number.");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Worker version readiness interval must be a positive finite number.");
  }

  const startedAt = now();
  let attempts = 0;
  let lastObserved = null;
  while (true) {
    const elapsedBeforeProbe = Math.max(0, now() - startedAt);
    if (attempts > 0 && elapsedBeforeProbe >= timeoutMs) {
      throw workerVersionReadinessError(expected, attempts, elapsedBeforeProbe, lastObserved);
    }
    attempts += 1;
    const remainingMs = Math.max(1, timeoutMs - elapsedBeforeProbe);
    lastObserved = workerVersionResponseId(await probe(attempts, remainingMs));
    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= timeoutMs) {
      throw workerVersionReadinessError(expected, attempts, elapsedMs, lastObserved);
    }
    if (lastObserved?.toLowerCase() === expected) {
      return { attempts, elapsedMs, workerVersionId: expected };
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}

export async function waitForBrowserWorkerVersionReady({
  workerVersionId,
  navigate,
  timeoutMs = WORKER_VERSION_READINESS_TIMEOUT_MS,
  intervalMs = WORKER_VERSION_READINESS_INTERVAL_MS,
  now = Date.now,
  sleep,
}) {
  if (workerVersionId !== null && typeof navigate !== "function") {
    throw new Error("Browser Worker readiness requires a navigate function.");
  }
  return waitForWorkerVersionReady({
    workerVersionId,
    timeoutMs,
    intervalMs,
    now,
    sleep,
    probe: async (attempt, remainingMs) => {
      try {
        const response = await navigate({ attempt, timeoutMs: remainingMs });
        return response?.status === 200 ? response.headers : {};
      } catch {
        return {};
      }
    },
  });
}

export function createWorkerVersionResponseTracker({ baseUrl, workerVersionId }) {
  const expected = workerVersionId === null ? null : normalizeWorkerVersionId(workerVersionId);
  const records = [];

  const assertSince = (checkpoint, phase) => {
    if (expected === null) return;
    if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint > records.length) {
      throw new Error(`${phase} used an invalid Worker response checkpoint.`);
    }
    const phaseRecords = records.slice(checkpoint);
    if (phaseRecords.length === 0) {
      throw new Error(`${phase} observed no Spoonjoy responses to verify.`);
    }
    const failures = phaseRecords.filter((record) => record.error !== null);
    if (failures.length > 0) {
      throw new Error(`${phase}: ${failures.map((record) => record.error.message).join(" ")}`);
    }
  };

  return {
    checkpoint() {
      return records.length;
    },
    record({ url, headers, label = url }) {
      if (expected === null || !isSameOrigin(url, baseUrl) || isStaticAssetBindingUrl(url)) return false;
      let error = null;
      try {
        assertWorkerVersionResponse(headers, expected, label);
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }
      records.push({ error });
      return true;
    },
    assertSince,
    assertAll(phase) {
      assertSince(0, phase);
    },
  };
}

export function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function shouldRunAppleOAuthCheck(targetEnv) {
  return targetEnv === "production";
}

export function parseSmokeArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_SMOKE_BASE_URL ?? DEFAULT_PRODUCTION_BASE_URL,
  });
  const { baseUrl, targetEnv } = target;
  const outDir = arg(argv, "--out", "live-smoke-artifacts");
  const includeImageCoverSmoke = argv.includes(IMAGE_COVER_SMOKE_FLAG);
  if (includeImageCoverSmoke && targetEnv !== "qa") {
    throw new Error("The image-cover smoke is QA-only and must use `--target-env qa`.");
  }

  return {
    baseUrl,
    includeImageCoverSmoke,
    outDir,
    targetEnv,
    target,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
  };
}

export function parseMcpCanaryArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app",
  });
  const versionFlagCount = argv.filter((value) => value === WORKER_VERSION_ID_FLAG).length;
  if (versionFlagCount > 1) {
    throw new Error("--worker-version-id must be supplied exactly once with a valid UUID.");
  }
  const rawWorkerVersionId = arg(argv, WORKER_VERSION_ID_FLAG, null);
  const workerVersionId = rawWorkerVersionId === null ? null : normalizeWorkerVersionId(rawWorkerVersionId);

  return {
    baseUrl: target.baseUrl,
    outDir: arg(argv, "--out", "mcp-oauth-canary-artifacts"),
    targetEnv: target.targetEnv,
    target,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
    includeLegacyDbProbe: !argv.includes("--skip-legacy-db-probe"),
    workerVersionId,
  };
}

export function parseMcpOAuthAuditArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_MCP_AUDIT_BASE_URL ?? "https://spoonjoy.app",
  });
  return {
    baseUrl: target.baseUrl,
    outDir: arg(argv, "--out", "mcp-oauth-d1-audit-artifacts"),
    targetEnv: target.targetEnv,
    target,
  };
}

function d1ExecuteTarget(targetEnv) {
  if (targetEnv === "local") {
    return {
      database: "DB",
      args: resolveScriptTarget({ argv: ["--base-url", "http://localhost"], defaultBaseUrl: "http://localhost" }).d1Args,
    };
  }
  if (targetEnv === "qa") {
    return { database: QA_D1_DATABASE_NAME, args: ["--remote"] };
  }
  if (targetEnv === "production") {
    return { database: PRODUCTION_D1_DATABASE_NAME, args: ["--remote"] };
  }
  throw new Error("D1 smoke operation requires targetEnv local, qa, or production.");
}

export function buildCleanupD1Args(email, { targetEnv }) {
  const command = `DELETE FROM "User" WHERE email = ${sqlString(email)};`;
  return buildD1CommandArgs(command, { targetEnv });
}

export function buildD1CommandArgs(command, { targetEnv }) {
  const target = d1ExecuteTarget(targetEnv);
  return ["exec", "wrangler", "d1", "execute", target.database, ...target.args, "--command", command];
}

export function buildUserCountD1Args(email, { targetEnv }) {
  const command = `SELECT COUNT(*) AS count FROM "User" WHERE email = ${sqlString(email)};`;
  return buildD1CommandArgs(command, { targetEnv });
}

export function buildMcpCanaryUserLookupD1Args(email, { targetEnv }) {
  return buildD1CommandArgs(`SELECT id FROM "User" WHERE email = ${sqlString(email)} LIMIT 1;`, { targetEnv });
}

export function buildMcpCanaryLegacyRefreshInsertD1Args(input, { targetEnv }) {
  return buildD1CommandArgs([
    `INSERT INTO "OAuthRefreshToken" (id, tokenHash, userId, clientId, scope, resource, connectionKey, revokedAt, createdAt)`,
    `VALUES (${sqlString(input.id)}, ${sqlString(input.tokenHash)}, ${sqlString(input.userId)}, ${sqlString(input.clientId)}, ${sqlString(input.scope)}, NULL, ${sqlString(input.connectionKey)}, NULL, CURRENT_TIMESTAMP);`,
  ].join(" "), { targetEnv });
}

export function buildMcpCanaryConnectionResourceD1Args(input, { targetEnv }) {
  return buildD1CommandArgs([
    `SELECT resource FROM "OAuthRefreshToken"`,
    `WHERE userId = ${sqlString(input.userId)} AND clientId = ${sqlString(input.clientId)} AND connectionKey = ${sqlString(input.connectionKey)} AND revokedAt IS NULL`,
    `ORDER BY createdAt DESC LIMIT 1;`,
  ].join(" "), { targetEnv });
}

export function buildMcpCanaryCleanupD1Args(input, { targetEnv }) {
  const commands = [
    `DELETE FROM "OAuthRefreshToken" WHERE connectionKey = ${sqlString(input.connectionKey)};`,
  ];
  if (input.clientId) {
    commands.push(`DELETE FROM "OAuthClient" WHERE id = ${sqlString(input.clientId)};`);
  }
  commands.push(`DELETE FROM "User" WHERE email = ${sqlString(input.email)};`);
  return buildD1CommandArgs(commands.join(" "), { targetEnv });
}

export function buildMcpOAuthInvariantAuditD1Args({ targetEnv }) {
  return buildD1CommandArgs([
    `WITH audit(invariant, count) AS (VALUES`,
    `('active_refresh_missing_resource', (SELECT COUNT(*) FROM "OAuthRefreshToken" rt_missing JOIN "OAuthClient" oc_missing ON oc_missing.id = rt_missing.clientId WHERE rt_missing.revokedAt IS NULL AND rt_missing.resource IS NULL AND oc_missing.clientName = 'Claude' AND oc_missing.redirectUris LIKE '%https://claude.ai/api/mcp/auth_callback%')),`,
    `('duplicate_active_connection_keys', (SELECT COUNT(*) FROM (SELECT connectionKey FROM "OAuthRefreshToken" WHERE revokedAt IS NULL AND connectionKey IS NOT NULL GROUP BY connectionKey HAVING COUNT(*) > 1))),`,
    `('access_refresh_resource_mismatch', (SELECT COUNT(*) FROM "ApiCredential" ac WHERE ac.revokedAt IS NULL AND ac.oauthClientId IS NOT NULL AND (ac.expiresAt IS NULL OR datetime(ac.expiresAt) > datetime('now')) AND NOT EXISTS (SELECT 1 FROM "OAuthRefreshToken" rt WHERE rt.userId = ac.userId AND rt.clientId = ac.oauthClientId AND rt.revokedAt IS NULL AND COALESCE(rt.resource, '') = COALESCE(ac.oauthResource, '')))),`,
    `('canary_user_residue', (SELECT COUNT(*) FROM "User" WHERE email LIKE 'codex-mcp-canary-%@example.com')),`,
    `('canary_refresh_residue', (SELECT COUNT(*) FROM "OAuthRefreshToken" WHERE connectionKey LIKE 'mcp_canary_connection_%')),`,
    `('claude_redirect_client_count', (SELECT COUNT(*) FROM "OAuthClient" WHERE clientName = 'Claude' AND redirectUris LIKE '%https://claude.ai/api/mcp/auth_callback%'))`,
    `) SELECT invariant, count FROM audit;`,
  ].join(" "), { targetEnv });
}

export function buildQaR2GetArgs(key) {
  return ["exec", "wrangler", "r2", "object", "get", `${QA_R2_BUCKET}/${key}`, "--remote", "--pipe"];
}

export function buildQaR2DeleteArgs(key) {
  return ["exec", "wrangler", "r2", "object", "delete", `${QA_R2_BUCKET}/${key}`, "--remote", "--force"];
}

function errorText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

export function isQaR2ObjectMissingError(error) {
  const parts = [];
  if (typeof error === "string") parts.push(error);
  if (error instanceof Error) parts.push(error.message);
  if (typeof error === "object" && error !== null) {
    for (const key of ["stdout", "stderr", "output"]) {
      if (key in error) parts.push(errorText(error[key]));
    }
  }
  return /(?:the specified key does not exist|nosuchkey|not found)/i.test(parts.join("\n"));
}

export function parseD1CountOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler D1 count output did not contain a JSON array.");
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  const first = parsed?.[0];
  const row = first?.results?.[0];
  const count = row?.count ?? row?.["COUNT(*)"] ?? row?.["count(*)"];
  if (typeof count === "number") return count;
  if (typeof count === "string" && /^\d+$/.test(count)) return Number(count);
  throw new Error("Wrangler D1 count output did not include a numeric count.");
}

export function parseD1RowsOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler D1 output did not contain a JSON array.");
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  const rows = parsed?.[0]?.results;
  if (Array.isArray(rows)) return rows;
  throw new Error("Wrangler D1 output did not include a results array.");
}

export function readGitMetadata(runCommand = execFileSync) {
  const read = (args) => {
    try {
      return String(runCommand("git", args, { encoding: "utf8" })).trim() || "unknown";
    } catch {
      return "unknown";
    }
  };
  return {
    branch: read(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: read(["rev-parse", "--short=12", "HEAD"]),
  };
}

export const MCP_CANARY_ISSUE_TITLE = "MCP OAuth canary failing";
export const MCP_CANARY_ISSUE_LABEL = "mcp-oauth-canary";

const MCP_CANARY_SECRET_PATTERNS = [
  {
    kind: "bearer_authorization",
    pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._~-]+/gi,
    replacement: "Authorization: Bearer [REDACTED]",
  },
  {
    kind: "spoonjoy_access_token",
    pattern: /\bsj_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    kind: "oauth_refresh_token",
    pattern: /\bort_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    kind: "oauth_authorization_code",
    pattern: /\boac_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    kind: "callback_code_query",
    pattern: /([?&]code=)(?!\[REDACTED\])[^&\s]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    kind: "client_secret",
    pattern: /(client_secret=)(?!\[REDACTED\])[^&\s]+/gi,
    replacement: "$1[REDACTED]",
  },
];

export function redactMcpCanaryText(value) {
  return MCP_CANARY_SECRET_PATTERNS.reduce(
    (text, rule) => text.replace(rule.pattern, rule.replacement),
    String(value),
  );
}

export function serializeSanitizedMcpCanaryReport(report) {
  return redactMcpCanaryText(JSON.stringify(report, null, 2));
}

export function findMcpCanarySecretLeaks(value) {
  const text = String(value);
  return MCP_CANARY_SECRET_PATTERNS.flatMap((rule) =>
    [...text.matchAll(rule.pattern)].map((match) => ({ kind: rule.kind, match: match[0] })),
  );
}

function markdownValue(value) {
  return redactMcpCanaryText(value === undefined || value === null || value === "" ? "n/a" : String(value));
}

function workflowLink(url) {
  return url ? `[workflow run](${url})` : "n/a";
}

function artifactLink(url) {
  return url ? `[artifact](${url})` : "n/a";
}

function checkRows(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return checks.map((check) => `| ${markdownValue(check.name)} | ${markdownValue(check.elapsedMs)} |`);
}

export function buildMcpCanaryStepSummary({ report, status, workflowRunUrl, artifactUrl }) {
  const cleanup = report.cleanup ?? {};
  const failure = report.failure?.message ?? "";
  const rows = checkRows(report);
  return redactMcpCanaryText([
    "# MCP OAuth Canary",
    "",
    `Status: **${markdownValue(status)}**`,
    `Target: ${markdownValue(report.targetEnv)} (${markdownValue(report.baseUrl)})`,
    `Resource: ${markdownValue(report.resource)}`,
    `Generated: ${markdownValue(report.generatedAt)}`,
    `Run: ${workflowLink(workflowRunUrl)}`,
    `Artifact: ${artifactLink(artifactUrl)}`,
    "",
    "## Checks",
    "| Check | Elapsed ms |",
    "| --- | ---: |",
    ...rows,
    "",
    "## Cleanup",
    `Target: ${markdownValue(cleanup.target)}`,
    `Remaining disposable users: ${markdownValue(cleanup.remaining)}`,
    `Error: ${markdownValue(cleanup.error)}`,
    "",
    "## Legacy Probe",
    `legacy Claude refresh promotion: ${markdownValue(report.legacyProbe?.promotedResource ?? report.legacyProbe?.reason ?? "n/a")}`,
    "",
    "## Failure",
    markdownValue(failure),
    "",
  ].join("\n"));
}

export function buildMcpCanaryIssueBody({ report, status, workflowRunUrl, artifactUrl }) {
  const failure = report.failure?.message ?? "n/a";
  const cleanup = report.cleanup ?? {};
  return redactMcpCanaryText([
    "## Current Status",
    `Status: **${markdownValue(status)}**`,
    `Target: ${markdownValue(report.targetEnv)} (${markdownValue(report.baseUrl)})`,
    `Resource: ${markdownValue(report.resource)}`,
    `Commit: ${markdownValue(report.git?.commit)}`,
    `Run: ${workflowLink(workflowRunUrl)}`,
    `Artifact: ${artifactLink(artifactUrl)}`,
    "",
    "## Failure",
    markdownValue(failure),
    "",
    "## Cleanup",
    `Remaining disposable users: ${markdownValue(cleanup.remaining)}`,
    `Cleanup error: ${markdownValue(cleanup.error)}`,
    "",
    "## Completed Checks",
    "| Check | Elapsed ms |",
    "| --- | ---: |",
    ...checkRows(report),
    "",
  ].join("\n"));
}

export function decideMcpCanaryIssueAction({ status, openIssueNumber }) {
  if (status === "failure" && openIssueNumber) return { action: "comment", issueNumber: openIssueNumber };
  if (status === "failure") return { action: "create" };
  if (status === "success" && openIssueNumber) return { action: "close", issueNumber: openIssueNumber };
  return { action: "none" };
}

const MCP_OAUTH_AUDIT_INFO_INVARIANTS = new Set(["claude_redirect_client_count"]);

export function normalizeMcpOAuthAuditRows(rows) {
  return rows.map((row) => {
    const count = typeof row.count === "number" ? row.count : (/^\d+$/.test(String(row.count)) ? Number(row.count) : Number.NaN);
    if (!Number.isFinite(count)) {
      throw new Error(`MCP OAuth audit invariant ${row.invariant} did not include a numeric count.`);
    }
    const status = MCP_OAUTH_AUDIT_INFO_INVARIANTS.has(row.invariant) ? "info" : (count === 0 ? "pass" : "fail");
    return { invariant: row.invariant, count, status };
  });
}

export function mcpOAuthAuditHasFailures(rows) {
  return rows.some((row) => row.status === "fail");
}

export function buildMcpOAuthAuditSummary({ targetEnv, baseUrl, generatedAt, rows, workflowRunUrl }) {
  return [
    "# MCP OAuth D1 Audit",
    "",
    `Target: ${targetEnv} (${baseUrl})`,
    `Generated: ${generatedAt}`,
    `Run: ${workflowLink(workflowRunUrl)}`,
    "",
    "| Invariant | Count | Status |",
    "| --- | ---: | --- |",
    ...rows.map((row) => `| ${row.invariant} | ${row.count} | ${row.status} |`),
    "",
  ].join("\n");
}

function environmentReport(target) {
  return {
    targetEnv: target.targetEnv,
    baseUrl: target.baseUrl,
    d1Target: target.d1Target,
    r2Target: target.r2Target,
    destructiveScope: target.destructiveScope,
  };
}

function r2ReportFrom(imageCoverSmoke) {
  const r2 = imageCoverSmoke?.r2 ?? {};
  const report = {
    retainedKeys: Array.isArray(r2.retainedKeys) ? r2.retainedKeys : [],
    deletedKeys: Array.isArray(r2.deletedKeys) ? r2.deletedKeys : [],
    verifiedDeletedKeys: Array.isArray(r2.verifiedDeletedKeys) ? r2.verifiedDeletedKeys : [],
  };
  if (Array.isArray(r2.generatedCoverKeys)) {
    report.generatedCoverKeys = r2.generatedCoverKeys;
  }
  return report;
}

export function buildSmokeReport({
  generatedAt,
  target,
  git,
  created,
  screenshots = [],
  consoleErrors = [],
  pageErrors = [],
  cleanup = null,
  cleanupVerification = null,
  imageCoverSmoke = null,
  apple = null,
  pushPublicKeyStatus,
}) {
  return {
    baseUrl: target.baseUrl,
    generatedAt,
    email: created.email,
    username: created.username,
    recipeTitle: created.recipeTitle,
    recipeId: created.recipeId,
    screenshots,
    consoleErrors,
    pageErrors,
    cleanup,
    cleanupVerification,
    imageCoverSmoke,
    targetEnv: target.targetEnv,
    apple,
    pushPublicKeyStatus,
    environment: environmentReport(target),
    git,
    created,
    r2: r2ReportFrom(imageCoverSmoke),
  };
}
