import { describe, expect, it } from "vitest";

import * as smokeHelpers from "../../scripts/smoke-live-helpers.mjs";
import {
  buildD1CommandArgs,
  buildMcpCanaryCleanupD1Args,
  buildMcpCanaryConnectionResourceD1Args,
  buildMcpCanaryIssueBody,
  buildMcpCanaryLegacyRefreshInsertD1Args,
  buildMcpCanaryStepSummary,
  buildMcpCanaryUserLookupD1Args,
  buildMcpOAuthAuditSummary,
  buildMcpOAuthInvariantAuditD1Args,
  buildQaR2DeleteArgs,
  buildQaR2GetArgs,
  buildCleanupD1Args,
  buildUserCountD1Args,
  decideMcpCanaryIssueAction,
  findMcpCanarySecretLeaks,
  isQaR2ObjectMissingError,
  mcpOAuthAuditHasFailures,
  normalizeMcpOAuthAuditRows,
  parseD1CountOutput,
  parseD1RowsOutput,
  parseMcpCanaryArgs,
  parseMcpOAuthAuditArgs,
  parseSmokeArgs,
  readGitMetadata,
  redactMcpCanaryText,
  shouldRunAppleOAuthCheck,
  usesLocalD1,
} from "../../scripts/smoke-live-helpers.mjs";

const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";

describe("smoke-live helpers", () => {
  it("detects local D1 targets from localhost base URLs", () => {
    expect(usesLocalD1("http://localhost:5173")).toBe(true);
    expect(usesLocalD1("http://127.0.0.1:5173")).toBe(true);
    expect(usesLocalD1("https://spoonjoy-v2-qa.mendelow-studio.workers.dev")).toBe(false);
  });

  it("builds local cleanup args for local smoke targets", () => {
    const args = buildCleanupD1Args("codex-smoke-local@example.com", { targetEnv: "local" });

    expect(args).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--command",
      `DELETE FROM "User" WHERE email = 'codex-smoke-local@example.com';`,
    ]);
  });

  it("builds QA cleanup args with --env qa", () => {
    const args = buildCleanupD1Args("codex-smoke-qa@example.com", { targetEnv: "qa" });

    expect(args).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "spoonjoy-qa",
      "--remote",
      "--command",
      `DELETE FROM "User" WHERE email = 'codex-smoke-qa@example.com';`,
    ]);
  });

  it("builds explicit production cleanup args by database name", () => {
    expect(buildCleanupD1Args("codex-smoke-prod@example.com", { targetEnv: "production" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "spoonjoy",
      "--remote",
      "--command",
      `DELETE FROM "User" WHERE email = 'codex-smoke-prod@example.com';`,
    ]);
  });

  it("builds QA user-count verification args with --env qa", () => {
    expect(buildUserCountD1Args("codex-smoke-qa@example.com", { targetEnv: "qa" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "spoonjoy-qa",
      "--remote",
      "--command",
      `SELECT COUNT(*) AS count FROM "User" WHERE email = 'codex-smoke-qa@example.com';`,
    ]);
  });

  it("builds generic D1 command args for the target environment", () => {
    expect(buildD1CommandArgs("SELECT 1;", { targetEnv: "production" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "spoonjoy",
      "--remote",
      "--command",
      "SELECT 1;",
    ]);
  });

  it("builds MCP canary D1 lookup, legacy insert, resource query, and cleanup args", () => {
    expect(buildMcpCanaryUserLookupD1Args("canary.o'hara@example.com", { targetEnv: "production" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "spoonjoy",
      "--remote",
      "--command",
      `SELECT id FROM "User" WHERE email = 'canary.o''hara@example.com' LIMIT 1;`,
    ]);

    expect(buildMcpCanaryLegacyRefreshInsertD1Args({
      id: "mcp_canary_1",
      tokenHash: "abc123",
      userId: "user_1",
      clientId: "client_1",
      scope: "kitchen:read kitchen:write",
      connectionKey: "connection_1",
    }, { targetEnv: "qa" })).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "spoonjoy-qa",
      "--remote",
      "--command",
      [
        `INSERT INTO "OAuthRefreshToken" (id, tokenHash, userId, clientId, scope, resource, connectionKey, revokedAt, createdAt)`,
        `VALUES ('mcp_canary_1', 'abc123', 'user_1', 'client_1', 'kitchen:read kitchen:write', NULL, 'connection_1', NULL, CURRENT_TIMESTAMP);`,
      ].join(" "),
    ]);

    expect(buildMcpCanaryConnectionResourceD1Args({
      userId: "user_1",
      clientId: "client_1",
      connectionKey: "connection_1",
    }, { targetEnv: "production" }).at(-1)).toBe([
      `SELECT resource FROM "OAuthRefreshToken"`,
      `WHERE userId = 'user_1' AND clientId = 'client_1' AND connectionKey = 'connection_1' AND revokedAt IS NULL`,
      `ORDER BY createdAt DESC LIMIT 1;`,
    ].join(" "));

    expect(buildMcpCanaryCleanupD1Args({
      email: "canary@example.com",
      clientId: "client_1",
      connectionKey: "connection_1",
    }, { targetEnv: "production" }).at(-1)).toBe([
      `DELETE FROM "OAuthRefreshToken" WHERE connectionKey = 'connection_1';`,
      `DELETE FROM "OAuthClient" WHERE id = 'client_1';`,
      `DELETE FROM "User" WHERE email = 'canary@example.com';`,
    ].join(" "));

    expect(buildMcpCanaryCleanupD1Args({
      email: "canary@example.com",
      clientId: null,
      connectionKey: "connection_1",
    }, { targetEnv: "production" }).at(-1)).toBe([
      `DELETE FROM "OAuthRefreshToken" WHERE connectionKey = 'connection_1';`,
      `DELETE FROM "User" WHERE email = 'canary@example.com';`,
    ].join(" "));
  });

  it("only runs the production Apple OAuth guard for production smoke", () => {
    expect(shouldRunAppleOAuthCheck("production")).toBe(true);
    expect(shouldRunAppleOAuthCheck("qa")).toBe(false);
    expect(shouldRunAppleOAuthCheck("local")).toBe(false);
  });

  it("requires explicit target env for remote smoke URLs", () => {
    expect(() =>
      parseSmokeArgs(["--base-url", "https://spoonjoy-v2-qa.mendelow-studio.workers.dev"]),
    ).toThrow(/--target-env/);
  });

  it("uses process argv defaults when no args are provided", () => {
    const originalArgv = process.argv;
    const originalBaseUrl = process.env.SPOONJOY_SMOKE_BASE_URL;
    try {
      process.argv = ["node", "scripts/smoke-live.mjs"];
      delete process.env.SPOONJOY_SMOKE_BASE_URL;
      expect(() => parseSmokeArgs()).toThrow(/--target-env/);
    } finally {
      process.argv = originalArgv;
      if (originalBaseUrl === undefined) {
        delete process.env.SPOONJOY_SMOKE_BASE_URL;
      } else {
        process.env.SPOONJOY_SMOKE_BASE_URL = originalBaseUrl;
      }
    }
  });

  it("allows local smoke URLs to infer local target env", () => {
    expect(parseSmokeArgs(["--base-url", "http://localhost:5173"])).toMatchObject({
      baseUrl: "http://localhost:5173",
      targetEnv: "local",
      shouldCleanup: true,
    });
  });

  it("parses explicit QA smoke args", () => {
    expect(
      parseSmokeArgs([
        "--target-env",
        "qa",
        "--base-url",
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        "--out",
        "qa-live-smoke-artifacts",
        "--keep-smoke-data",
      ]),
    ).toMatchObject({
      targetEnv: "qa",
      baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      outDir: "qa-live-smoke-artifacts",
      shouldCleanup: false,
    });
  });

  it("parses MCP canary args with live-smoke target safeguards", () => {
    expect(parseMcpCanaryArgs([
      "--target-env",
      "production",
      "--base-url",
      "https://spoonjoy.app",
      "--out",
      "mcp-oauth-canary-artifacts",
      "--keep-smoke-data",
      "--skip-legacy-db-probe",
      "--worker-version-id",
      CANDIDATE_VERSION,
    ])).toMatchObject({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
      outDir: "mcp-oauth-canary-artifacts",
      shouldCleanup: false,
      includeLegacyDbProbe: false,
      workerVersionId: CANDIDATE_VERSION,
    });
    expect(parseMcpCanaryArgs(["--base-url", "http://localhost:5173"])).toMatchObject({
      targetEnv: "local",
      includeLegacyDbProbe: true,
      workerVersionId: null,
    });
  });

  it("uses process defaults for omitted MCP canary args", () => {
    const originalArgv = process.argv;
    const originalBaseUrl = process.env.SPOONJOY_MCP_CANARY_BASE_URL;
    process.argv = [originalArgv[0] ?? "node", "smoke-mcp-oauth-live.mjs"];
    process.env.SPOONJOY_MCP_CANARY_BASE_URL = "http://localhost:5173";

    try {
      expect(parseMcpCanaryArgs()).toMatchObject({
        targetEnv: "local",
        baseUrl: "http://localhost:5173",
        outDir: "mcp-oauth-canary-artifacts",
        shouldCleanup: true,
        includeLegacyDbProbe: true,
      });
    } finally {
      process.argv = originalArgv;
      if (originalBaseUrl === undefined) {
        delete process.env.SPOONJOY_MCP_CANARY_BASE_URL;
      } else {
        process.env.SPOONJOY_MCP_CANARY_BASE_URL = originalBaseUrl;
      }
    }
  });

  it("redacts MCP canary artifacts and detects leaked OAuth secrets", () => {
    const leaked = [
      "Authorization: Bearer sj_abcdefghijklmnopqrstuvwxyz0123456789",
      "refresh=ort_abcdefghijklmnopqrstuvwxyz0123456789",
      "callback?code=oac_abcdefghijklmnopqrstuvwxyz0123456789&state=ok",
      "client_secret=something",
    ].join("\n");

    expect(redactMcpCanaryText(leaked)).toBe([
      "Authorization: Bearer [REDACTED]",
      "refresh=[REDACTED]",
      "callback?code=[REDACTED]&state=ok",
      "client_secret=[REDACTED]",
    ].join("\n"));
    expect(findMcpCanarySecretLeaks(leaked).map((leak) => leak.kind)).toEqual([
      "bearer_authorization",
      "spoonjoy_access_token",
      "oauth_refresh_token",
      "oauth_authorization_code",
      "callback_code_query",
      "client_secret",
    ]);
    expect(findMcpCanarySecretLeaks(redactMcpCanaryText(leaked))).toEqual([]);
  });

  it("renders MCP canary step summaries without secrets", () => {
    const summary = buildMcpCanaryStepSummary({
      report: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        resource: "https://spoonjoy.app/mcp",
        generatedAt: "2026-07-06T20:16:18.000Z",
        checks: [
          { name: "authorization_code token exchange", elapsedMs: 123 },
          { name: "mcp initialize and tools/list with issued access token", elapsedMs: 456 },
        ],
        cleanup: { target: "production D1", remaining: 0 },
        legacyProbe: { promotedResource: "https://spoonjoy.app/mcp" },
        failure: { message: "bad token sj_abcdefghijklmnopqrstuvwxyz0123456789" },
      },
      status: "failure",
      workflowRunUrl: "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/1",
      artifactUrl: "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/1/artifacts/2",
    });

    expect(summary).toContain("# MCP OAuth Canary");
    expect(summary).toContain("| authorization_code token exchange | 123 |");
    expect(summary).toContain("legacy Claude refresh promotion");
    expect(summary).toContain("[workflow run](https://github.com/spoonjoy/spoonjoy-v2/actions/runs/1)");
    expect(summary).toContain("[REDACTED]");
    expect(summary).not.toContain("sj_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("decides MCP canary issue actions for failures and recoveries", () => {
    expect(decideMcpCanaryIssueAction({ status: "failure", openIssueNumber: null })).toEqual({ action: "create" });
    expect(decideMcpCanaryIssueAction({ status: "failure", openIssueNumber: 12 })).toEqual({ action: "comment", issueNumber: 12 });
    expect(decideMcpCanaryIssueAction({ status: "success", openIssueNumber: 12 })).toEqual({ action: "close", issueNumber: 12 });
    expect(decideMcpCanaryIssueAction({ status: "success", openIssueNumber: null })).toEqual({ action: "none" });
  });

  it("renders MCP canary issue bodies with safe diagnostics", () => {
    const body = buildMcpCanaryIssueBody({
      report: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        resource: "https://spoonjoy.app/mcp",
        git: { branch: "main", commit: "abc123" },
        cleanup: { error: "cleanup failed" },
        checks: [{ name: "signup disposable user", elapsedMs: 10 }],
        failure: { message: "Authorization: Bearer sj_abcdefghijklmnopqrstuvwxyz0123456789" },
      },
      status: "failure",
      workflowRunUrl: "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/1",
      artifactUrl: "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/1/artifacts/2",
    });

    expect(body).toContain("## Current Status");
    expect(body).toContain("production");
    expect(body).toContain("cleanup failed");
    expect(body).toContain("abc123");
    expect(body).toContain("[artifact](https://github.com/spoonjoy/spoonjoy-v2/actions/runs/1/artifacts/2)");
    expect(body).not.toContain("sj_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(body).toContain("[REDACTED]");
  });

  it("renders MCP canary fallback summaries when optional artifact data is missing", () => {
    const summary = buildMcpCanaryStepSummary({
      report: {
        targetEnv: "production",
        baseUrl: null,
        resource: "",
        generatedAt: undefined,
        checks: null,
        legacyProbe: { reason: "disabled" },
      },
      status: "success",
      workflowRunUrl: "",
      artifactUrl: "",
    });
    const noLegacySummary = buildMcpCanaryStepSummary({
      report: { targetEnv: "production", baseUrl: "https://spoonjoy.app", resource: "https://spoonjoy.app/mcp", generatedAt: "now" },
      status: "success",
      workflowRunUrl: "",
      artifactUrl: "",
    });
    const issue = buildMcpCanaryIssueBody({
      report: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        resource: "https://spoonjoy.app/mcp",
        checks: null,
      },
      status: "success",
      workflowRunUrl: "",
      artifactUrl: "",
    });

    expect(summary).toContain("Run: n/a");
    expect(summary).toContain("Artifact: n/a");
    expect(summary).toContain("legacy Claude refresh promotion: disabled");
    expect(summary).toContain("Target: production (n/a)");
    expect(noLegacySummary).toContain("legacy Claude refresh promotion: n/a");
    expect(issue).toContain("Commit: n/a");
    expect(issue).toContain("Cleanup error: n/a");
    expect(issue).toContain("## Failure\nn/a");
  });

  it("parses the QA-only image-cover smoke flag", () => {
    expect(
      parseSmokeArgs([
        "--target-env",
        "qa",
        "--base-url",
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        "--include-image-cover-smoke",
      ]),
    ).toMatchObject({
      targetEnv: "qa",
      includeImageCoverSmoke: true,
    });
  });

  it("refuses image-cover smoke outside QA", () => {
    expect(() =>
      parseSmokeArgs([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy-v2.mendelow-studio.workers.dev",
        "--include-image-cover-smoke",
      ]),
    ).toThrow(/image-cover smoke.*QA/i);
    expect(() =>
      parseSmokeArgs([
        "--base-url",
        "http://localhost:5173",
        "--include-image-cover-smoke",
      ]),
    ).toThrow(/image-cover smoke.*QA/i);
  });

  it("builds QA R2 object get and delete args", () => {
    expect(buildQaR2GetArgs("recipes/user-1/uploads/photo.jpg")).toEqual([
      "exec",
      "wrangler",
      "r2",
      "object",
      "get",
      "spoonjoy-photos-qa/recipes/user-1/uploads/photo.jpg",
      "--remote",
      "--pipe",
    ]);
    expect(buildQaR2DeleteArgs("spoons/user-1/uploads/photo.png")).toEqual([
      "exec",
      "wrangler",
      "r2",
      "object",
      "delete",
      "spoonjoy-photos-qa/spoons/user-1/uploads/photo.png",
      "--remote",
      "--force",
    ]);
  });

  it("only treats known Wrangler R2 missing-key errors as deleted-object proof", () => {
    expect(isQaR2ObjectMissingError(Object.assign(new Error("wrangler failed"), {
      stderr: "\u001b[31mERROR\u001b[0m The specified key does not exist.",
    }))).toBe(true);
    expect(isQaR2ObjectMissingError({
      stdout: new TextEncoder().encode("NoSuchKey: missing object"),
    })).toBe(true);
    expect(isQaR2ObjectMissingError(Object.assign(new Error("wrangler failed"), {
      stderr: "Authentication failed: invalid API token",
    }))).toBe(false);
    expect(isQaR2ObjectMissingError({ stderr: 403 })).toBe(false);
    expect(isQaR2ObjectMissingError(Object.assign(new Error("network failed"), {
      code: "ENOTFOUND",
    }))).toBe(false);
    expect(isQaR2ObjectMissingError("The specified key does not exist.")).toBe(true);
  });

  it("allows explicit production smoke args for the production Worker URL", () => {
    expect(
      parseSmokeArgs([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy-v2.mendelow-studio.workers.dev",
      ]),
    ).toMatchObject({
      targetEnv: "production",
      baseUrl: "https://spoonjoy-v2.mendelow-studio.workers.dev",
    });
  });

  it("allows explicit production smoke args for the production custom domain", () => {
    expect(parseSmokeArgs(["--target-env", "production", "--base-url", "https://spoonjoy.app"])).toMatchObject({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
    });
  });

  it("refuses mismatched QA target env and production URL", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "qa", "--base-url", "https://spoonjoy-v2.mendelow-studio.workers.dev"]),
    ).toThrow(/QA smoke/);
  });

  it("refuses mismatched production target env and QA URL", () => {
    expect(() =>
      parseSmokeArgs([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      ]),
    ).toThrow(/Production smoke/);
  });

  it("refuses mismatched local target env and remote URL", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "local", "--base-url", "https://spoonjoy-v2.mendelow-studio.workers.dev"]),
    ).toThrow(/Local smoke/);
  });

  it("refuses unknown target envs", () => {
    expect(() =>
      parseSmokeArgs(["--target-env", "staging", "--base-url", "http://localhost:5173"]),
    ).toThrow(/must be one of local, qa, or production/);
  });

  it("parses D1 count output variants and rejects malformed output", () => {
    expect(parseD1CountOutput(JSON.stringify([{ results: [{ count: 2 }] }]))).toBe(2);
    expect(parseD1CountOutput(JSON.stringify([{ results: [{ "COUNT(*)": "3" }] }]))).toBe(3);
    expect(parseD1CountOutput(JSON.stringify([{ results: [{ "count(*)": 4 }] }]))).toBe(4);
    expect(() => parseD1CountOutput("no json here")).toThrow(/JSON array/);
    expect(() => parseD1CountOutput(JSON.stringify([{ results: [{}] }]))).toThrow(/numeric count/);
  });

  it("parses D1 result rows and rejects malformed row output", () => {
    expect(parseD1RowsOutput(JSON.stringify([{ results: [{ id: "user_1" }] }]))).toEqual([{ id: "user_1" }]);
    expect(() => parseD1RowsOutput("no json here")).toThrow(/JSON array/);
    expect(() => parseD1RowsOutput(JSON.stringify([{ result: [] }]))).toThrow(/results array/);
  });

  it("parses MCP OAuth audit args with production safeguards", () => {
    expect(parseMcpOAuthAuditArgs(["--target-env", "production", "--base-url", "https://spoonjoy.app", "--out", "audit-out"])).toMatchObject({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
      outDir: "audit-out",
    });
    expect(parseMcpOAuthAuditArgs(["--base-url", "http://localhost:5173"])).toMatchObject({
      targetEnv: "local",
      baseUrl: "http://localhost:5173",
    });
  });

  it("uses process defaults for omitted MCP OAuth audit args", () => {
    const originalArgv = process.argv;
    const originalBaseUrl = process.env.SPOONJOY_MCP_AUDIT_BASE_URL;
    process.argv = [originalArgv[0] ?? "node", "audit-mcp-oauth-d1.mjs"];
    process.env.SPOONJOY_MCP_AUDIT_BASE_URL = "http://localhost:5173";

    try {
      expect(parseMcpOAuthAuditArgs()).toMatchObject({
        targetEnv: "local",
        baseUrl: "http://localhost:5173",
        outDir: "mcp-oauth-d1-audit-artifacts",
      });
    } finally {
      process.argv = originalArgv;
      if (originalBaseUrl === undefined) {
        delete process.env.SPOONJOY_MCP_AUDIT_BASE_URL;
      } else {
        process.env.SPOONJOY_MCP_AUDIT_BASE_URL = originalBaseUrl;
      }
    }
  });

  it("builds a readonly MCP OAuth invariant audit D1 command", () => {
    const args = buildMcpOAuthInvariantAuditD1Args({ targetEnv: "production" });

    expect(args.slice(0, 6)).toEqual(["exec", "wrangler", "d1", "execute", "spoonjoy", "--remote"]);
    const command = args.at(-1) ?? "";
    expect(command).toContain("active_refresh_missing_resource");
    expect(command).toContain("duplicate_active_connection_keys");
    expect(command).toContain("access_refresh_resource_mismatch");
    expect(command).toContain("canary_user_residue");
    expect(command).toContain("canary_refresh_residue");
    expect(command).toContain("claude_redirect_client_count");
    expect(command).toContain(`oc_missing.clientName = 'Claude'`);
    expect(command).toContain("https://claude.ai/api/mcp/auth_callback");
    expect(command).toContain(`datetime(ac.expiresAt) > datetime('now')`);
    expect(command).toContain("NOT EXISTS");
    expect(command).toContain("SELECT");
    expect(command).not.toMatch(/\b(?:DELETE|UPDATE|INSERT|DROP|ALTER)\b/i);
    expect(command).not.toContain("clientId IS NOT NULL AND resource IS NULL");
  });

  it("normalizes MCP OAuth invariant rows and detects failures", () => {
    const normalized = normalizeMcpOAuthAuditRows([
      { invariant: "active_refresh_missing_resource", count: "0" },
      { invariant: "duplicate_active_connection_keys", count: 2 },
      { invariant: "claude_redirect_client_count", count: "3" },
    ]);

    expect(normalized).toEqual([
      { invariant: "active_refresh_missing_resource", count: 0, status: "pass" },
      { invariant: "duplicate_active_connection_keys", count: 2, status: "fail" },
      { invariant: "claude_redirect_client_count", count: 3, status: "info" },
    ]);
    expect(mcpOAuthAuditHasFailures(normalized)).toBe(true);
    expect(mcpOAuthAuditHasFailures([{ invariant: "claude_redirect_client_count", count: 3, status: "info" }])).toBe(false);
    expect(() => normalizeMcpOAuthAuditRows([{ invariant: "bad", count: "nope" }])).toThrow(/numeric count/);
  });

  it("renders MCP OAuth audit summaries", () => {
    const summary = buildMcpOAuthAuditSummary({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
      generatedAt: "2026-07-06T21:00:00.000Z",
      rows: [
        { invariant: "active_refresh_missing_resource", count: 0, status: "pass" },
        { invariant: "duplicate_active_connection_keys", count: 1, status: "fail" },
        { invariant: "claude_redirect_client_count", count: 4, status: "info" },
      ],
      workflowRunUrl: "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/3",
    });

    expect(summary).toContain("# MCP OAuth D1 Audit");
    expect(summary).toContain("| active_refresh_missing_resource | 0 | pass |");
    expect(summary).toContain("| duplicate_active_connection_keys | 1 | fail |");
    expect(summary).toContain("[workflow run](https://github.com/spoonjoy/spoonjoy-v2/actions/runs/3)");
  });

  it("rejects unsupported target envs for D1 arg builders", () => {
    expect(() => buildUserCountD1Args("codex@example.com", { targetEnv: "staging" })).toThrow(/targetEnv/);
  });

  it("reads git metadata with unknown fallbacks", () => {
    expect(readGitMetadata(() => "")).toEqual({ branch: "unknown", commit: "unknown" });

    let calls = 0;
    expect(readGitMetadata(() => {
      calls += 1;
      if (calls === 1) throw new Error("git unavailable");
      return "abc123def456\n";
    })).toEqual({ branch: "unknown", commit: "abc123def456" });
  });

  it("builds live smoke artifact metadata with empty R2 arrays for normal smoke", () => {
    expect(typeof smokeHelpers.buildSmokeReport).toBe("function");

    const report = smokeHelpers.buildSmokeReport({
      generatedAt: "2026-06-12T14:00:00.000Z",
      target: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        d1Target: "production D1 spoonjoy (--remote)",
        r2Target: "production R2 spoonjoy-photos (--remote)",
        destructiveScope: "production read-only by default; exact smoke cleanup only",
      },
      git: { branch: "spoonjoy/sj-044-cleanup-harness", commit: "abc1234" },
      created: {
        email: "codex-smoke@example.com",
        username: "codex_smoke",
        recipeTitle: "Codex smoke skillet",
        recipeId: "recipe-1",
      },
      screenshots: ["01.png"],
      consoleErrors: [],
      pageErrors: [],
      cleanup: { target: "production D1" },
      cleanupVerification: { remaining: 0 },
      apple: { skipped: false },
      pushPublicKeyStatus: 200,
    });

    expect(report.environment).toEqual({
      targetEnv: "production",
      baseUrl: "https://spoonjoy.app",
      d1Target: "production D1 spoonjoy (--remote)",
      r2Target: "production R2 spoonjoy-photos (--remote)",
      destructiveScope: "production read-only by default; exact smoke cleanup only",
    });
    expect(report.git).toEqual({ branch: "spoonjoy/sj-044-cleanup-harness", commit: "abc1234" });
    expect(report.created).toEqual({
      email: "codex-smoke@example.com",
      username: "codex_smoke",
      recipeTitle: "Codex smoke skillet",
      recipeId: "recipe-1",
    });
    expect(report.cleanup).toEqual({ target: "production D1" });
    expect(report.cleanupVerification).toEqual({ remaining: 0 });
    expect(report.r2).toEqual({ retainedKeys: [], deletedKeys: [], verifiedDeletedKeys: [] });
    expect(report).toMatchObject({
      baseUrl: "https://spoonjoy.app",
      email: "codex-smoke@example.com",
      username: "codex_smoke",
      recipeTitle: "Codex smoke skillet",
      recipeId: "recipe-1",
      targetEnv: "production",
    });
  });

  it("mirrors image-cover R2 arrays into the top-level live smoke artifact", () => {
    expect(typeof smokeHelpers.buildSmokeReport).toBe("function");

    const report = smokeHelpers.buildSmokeReport({
      generatedAt: "2026-06-12T14:00:00.000Z",
      target: {
        targetEnv: "qa",
        baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        d1Target: "QA D1 spoonjoy-qa (--remote --env qa)",
        r2Target: "QA R2 spoonjoy-photos-qa (--remote)",
        destructiveScope: "QA disposable test data only",
      },
      git: { branch: "spoonjoy/sj-044-cleanup-harness", commit: "def5678" },
      created: {
        email: "codex-smoke@example.com",
        username: "codex_smoke",
        recipeTitle: "Codex smoke skillet",
        recipeId: "recipe-1",
      },
      imageCoverSmoke: {
        r2: {
          retainedKeys: ["recipes/other-user/uploads/keep.jpg"],
          deletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
          verifiedDeletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
          generatedCoverKeys: ["covers/generated.jpg"],
        },
      },
    });

    expect(report.r2).toEqual({
      retainedKeys: ["recipes/other-user/uploads/keep.jpg"],
      deletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
      verifiedDeletedKeys: ["recipes/user-1/uploads/oriented.jpg"],
      generatedCoverKeys: ["covers/generated.jpg"],
    });
  });
});
