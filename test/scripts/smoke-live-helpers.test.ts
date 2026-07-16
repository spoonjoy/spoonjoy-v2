import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as smokeHelpers from "../../scripts/smoke-live-helpers.mjs";
import {
  assertWorkerVersionResponse,
  buildWorkerVersionRequestHeaders,
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
  buildWorkerVersionOverrideHeaders,
  buildBrowserEnvironment,
  buildD1CommandEnvironment,
  createWorkerVersionResponseTracker,
  decideMcpCanaryIssueAction,
  findMcpCanarySecretLeaks,
  isRouteActionResponse,
  installWorkerVersionBrowserRouting,
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
  serializeSanitizedMcpCanaryReport,
  shouldRunAppleOAuthCheck,
  usesLocalD1,
  waitForBrowserWorkerVersionReady,
  waitForWorkerChannelsReady,
  waitForWorkerVersionReady,
} from "../../scripts/smoke-live-helpers.mjs";

const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";

describe("smoke-live helpers", () => {
  it("recognizes React Router action responses at canonical and data URLs", () => {
    const input = {
      baseUrl: "https://spoonjoy.app",
      routePath: "/signup",
      requestMethod: "POST",
    };

    expect(isRouteActionResponse({ ...input, responseUrl: "https://spoonjoy.app/signup" })).toBe(true);
    expect(isRouteActionResponse({ ...input, responseUrl: "https://spoonjoy.app/signup.data?_routes=routes/signup" })).toBe(true);
    expect(isRouteActionResponse({ ...input, responseUrl: "https://spoonjoy.app/signup", requestMethod: "GET" })).toBe(false);
    expect(isRouteActionResponse({ ...input, responseUrl: "https://spoonjoy.app/login.data" })).toBe(false);
    expect(isRouteActionResponse({ ...input, responseUrl: "https://example.com/signup.data" })).toBe(false);
    expect(isRouteActionResponse({ ...input, responseUrl: "not a url" })).toBe(false);
  });

  it("isolates the D1 token from Chromium and the Workers token from D1 commands", () => {
    const env = {
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "legacy-token",
      CLOUDFLARE_D1_API_TOKEN: "d1-token",
      CLOUDFLARE_WORKERS_API_TOKEN: "workers-token",
      CF_API_KEY: "api-key",
      CF_API_TOKEN: "cf-token",
      CLOUDFLARE_EMAIL: "ari@example.test",
      SAFE_VALUE: "visible",
    };

    expect(buildD1CommandEnvironment(env)).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "d1-token",
      SAFE_VALUE: "visible",
    });
    expect(buildBrowserEnvironment(env)).toEqual({
      PATH: "/test/bin",
      SAFE_VALUE: "visible",
    });
    expect(buildD1CommandEnvironment({ PATH: "/test/bin", CLOUDFLARE_API_TOKEN: "legacy-token" })).toEqual({
      PATH: "/test/bin",
      CLOUDFLARE_API_TOKEN: "legacy-token",
    });
    expect(buildD1CommandEnvironment({ PATH: "/test/bin" })).toEqual({ PATH: "/test/bin" });
  });

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

  it("normalizes valid Worker version UUIDs and rejects ambiguous or malformed values", () => {
    expect(parseMcpCanaryArgs([
      "--base-url",
      "http://localhost:5173",
      "--worker-version-id",
      CANDIDATE_VERSION.toUpperCase(),
    ])).toMatchObject({ workerVersionId: CANDIDATE_VERSION });

    for (const argv of [
      ["--base-url", "http://localhost:5173", "--worker-version-id"],
      ["--base-url", "http://localhost:5173", "--worker-version-id", "not-a-uuid"],
      ["--base-url", "http://localhost:5173", "--worker-version-id", "22222222222242228222222222222222"],
      ["--base-url", "http://localhost:5173", "--worker-version-id", "22222222-2222-0222-8222-222222222222"],
      ["--base-url", "http://localhost:5173", "--worker-version-id", "22222222-2222-4222-7222-222222222222"],
      [
        "--base-url",
        "http://localhost:5173",
        "--worker-version-id",
        CANDIDATE_VERSION,
        "--worker-version-id",
        "33333333-3333-4333-8333-333333333333",
      ],
    ]) {
      expect(() => parseMcpCanaryArgs(argv)).toThrow(/--worker-version-id.*valid UUID/i);
    }
  });

  it("builds an exact Cloudflare structured Worker-version override header", () => {
    expect(buildWorkerVersionOverrideHeaders(null)).toEqual({});
    expect(buildWorkerVersionOverrideHeaders(CANDIDATE_VERSION)).toEqual({
      "Cloudflare-Workers-Version-Overrides": `spoonjoy-v2="${CANDIDATE_VERSION}"`,
    });
    expect(() => buildWorkerVersionOverrideHeaders("not-a-uuid")).toThrow(/valid UUID/i);
  });

  it("requires every labeled Spoonjoy response to prove the exact candidate Worker version", () => {
    expect(() => assertWorkerVersionResponse({}, null)).not.toThrow();
    expect(() => assertWorkerVersionResponse(
      { "x-spoonjoy-worker-version": CANDIDATE_VERSION },
      CANDIDATE_VERSION,
    )).not.toThrow();
    expect(() => assertWorkerVersionResponse(
      { "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION },
      CANDIDATE_VERSION,
    )).not.toThrow();
    expect(() => assertWorkerVersionResponse(
      new Headers({ "X-Spoonjoy-Worker-Version": CANDIDATE_VERSION }),
      CANDIDATE_VERSION,
    )).not.toThrow();
    expect(() => assertWorkerVersionResponse({}, CANDIDATE_VERSION)).toThrow(/missing.*candidate Worker/i);
    expect(() => assertWorkerVersionResponse(
      { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" },
      CANDIDATE_VERSION,
      "OAuth token exchange",
    )).toThrow(/OAuth token exchange.*expected.*22222222.*received.*33333333/i);
    expect(() => assertWorkerVersionResponse(
      { "x-spoonjoy-worker-version": CANDIDATE_VERSION.toUpperCase() },
      CANDIDATE_VERSION,
    )).not.toThrow();
    expect(() => assertWorkerVersionResponse(null, CANDIDATE_VERSION)).toThrow(/missing/i);
  });

  it("adds the override only to same-origin requests and strips it everywhere else", () => {
    const existingHeaders = {
      Authorization: "Bearer token",
      "cloudflare-workers-version-overrides": "stale-worker=\"stale-version\"",
      Accept: "application/json",
    };

    expect(buildWorkerVersionRequestHeaders({
      baseUrl: "https://spoonjoy.app",
      requestUrl: "https://spoonjoy.app/oauth/token?flow=refresh",
      headers: existingHeaders,
      workerVersionId: CANDIDATE_VERSION,
    })).toEqual({
      Authorization: "Bearer token",
      Accept: "application/json",
      "Cloudflare-Workers-Version-Overrides": `spoonjoy-v2="${CANDIDATE_VERSION}"`,
    });

    for (const requestUrl of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://assets.spoonjoy.app/image.jpg",
      "http://spoonjoy.app/oauth/token",
      "https://spoonjoy.app:444/oauth/token",
      "not a URL",
    ]) {
      expect(buildWorkerVersionRequestHeaders({
        baseUrl: "https://spoonjoy.app",
        requestUrl,
        headers: existingHeaders,
        workerVersionId: CANDIDATE_VERSION,
      })).toEqual({
        Authorization: "Bearer token",
        Accept: "application/json",
      });
    }

    expect(buildWorkerVersionRequestHeaders({
      baseUrl: "https://spoonjoy.app",
      requestUrl: "https://spoonjoy.app/signup",
      headers: new Headers({ "X-Test": "yes" }),
      workerVersionId: null,
    })).toEqual({ "X-Test": "yes" });
    expect(() => buildWorkerVersionRequestHeaders({
      baseUrl: "https://spoonjoy.app",
      requestUrl: "https://spoonjoy.app/signup",
      workerVersionId: "not-a-uuid",
    })).toThrow(/valid UUID/i);
  });

  it("routes every Chromium request through redirect-safe Worker-version interception", async () => {
    let requestPaused: ((event: any) => Promise<void>) | undefined;
    const session = {
      send: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: (input: any) => Promise<void>) => {
        expect(event).toBe("Fetch.requestPaused");
        requestPaused = handler;
      }),
    };
    const page = {
      context: () => ({ newCDPSession: vi.fn(async () => session) }),
    };
    const interceptRequest = vi.fn(async (request: { url: string }) => (
      request.url.startsWith("https://claude.ai/api/mcp/auth_callback")
        ? {
            status: 200,
            headers: { "Content-Type": "text/plain" },
            body: "intercepted",
          }
        : null
    ));

    const routing = await installWorkerVersionBrowserRouting(page, {
      baseUrl: "https://spoonjoy.app",
      workerVersionId: CANDIDATE_VERSION,
      interceptRequest,
    });

    expect(session.send).toHaveBeenNthCalledWith(1, "Fetch.enable", {
      patterns: [{ requestStage: "Request", urlPattern: "*" }],
    });
    await requestPaused?.({
      requestId: "same-origin-hop",
      request: {
        url: "https://spoonjoy.app/oauth/authorize",
        method: "POST",
        headers: {
          Accept: "text/html",
          "cloudflare-workers-version-overrides": `spoonjoy-v2="${CANDIDATE_VERSION}"`,
        },
      },
    });
    expect(session.send).toHaveBeenNthCalledWith(2, "Fetch.continueRequest", {
      requestId: "same-origin-hop",
      headers: [
        { name: "Accept", value: "text/html" },
        {
          name: "Cloudflare-Workers-Version-Overrides",
          value: `spoonjoy-v2="${CANDIDATE_VERSION}"`,
        },
      ],
    });

    await requestPaused?.({
      requestId: "external-hop",
      request: {
        url: "https://claude.ai/api/mcp/auth_callback?code=secret&state=opaque",
        method: "GET",
        headers: {
          Accept: "text/html",
          "Cloudflare-Workers-Version-Overrides": `spoonjoy-v2="${CANDIDATE_VERSION}"`,
        },
      },
    });
    expect(session.send).toHaveBeenNthCalledWith(3, "Fetch.fulfillRequest", {
      requestId: "external-hop",
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/plain" }],
      body: Buffer.from("intercepted").toString("base64"),
    });
    expect(interceptRequest).toHaveBeenCalledTimes(2);
    expect(() => routing.assertHealthy()).not.toThrow();
  });

  it("fails closed and reports Chromium interception errors", async () => {
    let requestPaused: ((event: any) => Promise<void>) | undefined;
    const session = {
      send: vi.fn(async (method: string) => {
        if (method === "Fetch.failRequest") throw new Error("page already closed");
      }),
      on: vi.fn((_event: string, handler: (input: any) => Promise<void>) => {
        requestPaused = handler;
      }),
    };
    const page = { context: () => ({ newCDPSession: vi.fn(async () => session) }) };
    const routing = await installWorkerVersionBrowserRouting(page, {
      baseUrl: "https://spoonjoy.app",
      workerVersionId: null,
      interceptRequest: async () => {
        throw new Error("interceptor exploded");
      },
    });

    await requestPaused?.({
      requestId: "failed-hop",
      request: { url: "https://spoonjoy.app/signup", method: "GET", headers: {} },
    });

    expect(session.send).toHaveBeenLastCalledWith("Fetch.failRequest", {
      requestId: "failed-hop",
      errorReason: "Aborted",
    });
    expect(() => routing.assertHealthy()).toThrow(/Chromium request interception failed.*interceptor exploded/i);
  });

  it("waits through Cloudflare override propagation before declaring the candidate ready", async () => {
    const responses = [
      {},
      { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" },
      { "x-spoonjoy-worker-version": CANDIDATE_VERSION },
    ];
    let now = 1_000;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });
    const probe = vi.fn(async () => responses.shift() ?? {});

    await expect(waitForWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      probe,
      timeoutMs: 2_000,
      intervalMs: 250,
      now: () => now,
      sleep,
    })).resolves.toEqual({
      attempts: 3,
      elapsedMs: 500,
      workerVersionId: CANDIDATE_VERSION,
    });
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 250);
  });

  it("uses the bounded real timer when no sleep dependency is supplied", async () => {
    let attempts = 0;
    await expect(waitForWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      probe: async () => {
        attempts += 1;
        return attempts === 1 ? {} : { "x-spoonjoy-worker-version": CANDIDATE_VERSION };
      },
      timeoutMs: 100,
      intervalMs: 1,
    })).resolves.toMatchObject({ attempts: 2, workerVersionId: CANDIDATE_VERSION });
  });

  it("bounds Worker override readiness and reports the last observed version", async () => {
    let now = 5_000;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });

    await expect(waitForWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      probe: async () => ({
        "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333",
      }),
      timeoutMs: 600,
      intervalMs: 250,
      now: () => now,
      sleep,
    })).rejects.toThrow(/not ready after 3 attempts and 600ms.*33333333/i);
    expect(sleep.mock.calls).toEqual([[250], [250], [100]]);

    await expect(waitForWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      probe: async () => ({}),
      timeoutMs: 1,
      intervalMs: 1,
      now: (() => {
        let current = 0;
        return () => current++;
      })(),
      sleep: async () => undefined,
    })).rejects.toThrow(/last observed version: missing/i);
  });

  it("allows a full minute for default Worker override propagation", async () => {
    let now = 0;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });

    await expect(waitForWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      probe: async () => ({}),
      now: () => now,
      sleep,
    })).rejects.toThrow(/not ready after 120 attempts and 60000ms/i);
    expect(sleep).toHaveBeenCalledTimes(120);
  });

  it("proves readiness on the browser path and caps navigation at the remaining budget", async () => {
    let now = 1_000;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });
    const navigate = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("browser connection reset"))
      .mockResolvedValueOnce({ status: 503, headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION } })
      .mockResolvedValueOnce({ status: 200, headers: { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" } })
      .mockResolvedValueOnce({ status: 200, headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION } });

    await expect(waitForBrowserWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      navigate,
      timeoutMs: 2_000,
      intervalMs: 250,
      now: () => now,
      sleep,
    })).resolves.toEqual({ attempts: 5, elapsedMs: 1_000, workerVersionId: CANDIDATE_VERSION });
    expect(navigate.mock.calls.map(([input]) => input.timeoutMs)).toEqual([2_000, 1_750, 1_500, 1_250, 1_000]);

    const boundedNavigate = vi.fn(async ({ timeoutMs }: { timeoutMs: number }) => {
      now += timeoutMs;
      throw new Error("navigation timed out");
    });
    now = 0;
    await expect(waitForBrowserWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      navigate: boundedNavigate,
      timeoutMs: 1_000,
      intervalMs: 250,
      now: () => now,
      sleep,
    })).rejects.toThrow(/not ready after 1 attempt and 1000ms/i);
    expect(boundedNavigate).toHaveBeenCalledWith({ attempt: 1, timeoutMs: 1_000 });

    await expect(waitForBrowserWorkerVersionReady({
      workerVersionId: null,
      navigate: undefined,
    })).resolves.toEqual({ attempts: 0, elapsedMs: 0, workerVersionId: null });
    await expect(waitForBrowserWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      navigate: undefined,
    })).rejects.toThrow(/navigate function/i);
  });

  it("rejects candidate browser responses at or after the readiness deadline", async () => {
    let now = 0;
    const lateCandidate = vi.fn(async ({ timeoutMs }: { timeoutMs: number }) => {
      now += timeoutMs + 1;
      return { status: 200, headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION } };
    });

    await expect(waitForBrowserWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      navigate: lateCandidate,
      timeoutMs: 1_000,
      intervalMs: 1_000,
      now: () => now,
      sleep: async (delayMs) => {
        now += delayMs;
      },
    })).rejects.toThrow(/not ready after 1 attempt and 1001ms/i);
    expect(lateCandidate).toHaveBeenCalledOnce();

    now = 0;
    const deadlineCandidate = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" },
      })
      .mockResolvedValueOnce({ status: 200, headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION } });
    await expect(waitForBrowserWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      navigate: deadlineCandidate,
      timeoutMs: 1_000,
      intervalMs: 1_000,
      now: () => now,
      sleep: async (delayMs) => {
        now += delayMs;
      },
    })).rejects.toThrow(/not ready after 1 attempt and 1000ms/i);
    expect(deadlineCandidate).toHaveBeenCalledOnce();
  });

  it("requires stable candidate readiness across navigation, API, and browser mutation channels", async () => {
    let now = 1_000;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });
    const candidate = { status: 200, headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION } };
    const browserProbe = vi.fn()
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce({ status: 503, headers: candidate.headers })
      .mockRejectedValueOnce(new Error("browser connection reset"))
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(candidate);
    const apiProbe = vi.fn()
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce({
        status: 200,
        headers: { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" },
      })
      .mockResolvedValue(candidate);
    const mutationProbe = vi.fn()
      .mockResolvedValueOnce({
        status: 405,
        headers: { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" },
      })
      .mockResolvedValue(candidate);

    await expect(waitForWorkerChannelsReady({
      workerVersionId: CANDIDATE_VERSION,
      probes: [browserProbe, apiProbe, mutationProbe],
      timeoutMs: 2_000,
      intervalMs: 250,
      now: () => now,
      sleep,
    })).resolves.toEqual({ attempts: 6, elapsedMs: 1_250, workerVersionId: CANDIDATE_VERSION });
    expect(browserProbe).toHaveBeenCalledTimes(6);
    expect(apiProbe).toHaveBeenCalledTimes(6);
    expect(mutationProbe).toHaveBeenCalledTimes(6);
    expect(browserProbe.mock.calls.map(([input]) => input.timeoutMs)).toEqual([2_000, 1_750, 1_500, 1_250, 1_000, 750]);
    expect(apiProbe.mock.calls.map(([input]) => input.timeoutMs)).toEqual([2_000, 1_750, 1_500, 1_250, 1_000, 750]);
    expect(mutationProbe.mock.calls.map(([input]) => input.timeoutMs)).toEqual([2_000, 1_750, 1_500, 1_250, 1_000, 750]);

    await expect(waitForWorkerChannelsReady({
      workerVersionId: null,
      probes: undefined,
    })).resolves.toEqual({ attempts: 0, elapsedMs: 0, workerVersionId: null });
    for (const probes of [undefined, [], [browserProbe], [browserProbe, undefined]]) {
      await expect(waitForWorkerChannelsReady({
        workerVersionId: CANDIDATE_VERSION,
        probes,
      })).rejects.toThrow(/at least two channel probe functions/i);
    }
  });

  it("enforces the readiness deadline around probes that never settle", async () => {
    let now = 0;
    let deadlineAdvanced = false;
    const setTimer = vi.fn((callback: () => void, delayMs: number) => {
      if (!deadlineAdvanced) {
        now += delayMs;
        deadlineAdvanced = true;
      }
      callback();
      return 17;
    });
    const clearTimer = vi.fn();
    const neverSettles = vi.fn(() => new Promise(() => undefined));
    const candidate = vi.fn(async () => ({
      status: 200,
      headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION },
    }));

    await expect(waitForWorkerChannelsReady({
      workerVersionId: CANDIDATE_VERSION,
      probes: [neverSettles, candidate],
      timeoutMs: 1_000,
      intervalMs: 100,
      now: () => now,
      sleep: async () => undefined,
      setTimer,
      clearTimer,
    })).rejects.toThrow(/not ready after 1 attempt and 1000ms/i);
    expect(setTimer).toHaveBeenCalledTimes(2);
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(clearTimer.mock.calls).toEqual([[17], [17]]);
  });

  it("skips readiness without a candidate and rejects invalid polling configuration", async () => {
    const probe = vi.fn(async () => ({}));
    await expect(waitForWorkerVersionReady({
      workerVersionId: null,
      probe,
    })).resolves.toEqual({
      attempts: 0,
      elapsedMs: 0,
      workerVersionId: null,
    });
    expect(probe).not.toHaveBeenCalled();

    for (const input of [
      { probe: null, timeoutMs: 1, intervalMs: 1 },
      { probe, timeoutMs: 0, intervalMs: 1 },
      { probe, timeoutMs: 1, intervalMs: 0 },
      { probe, timeoutMs: Number.POSITIVE_INFINITY, intervalMs: 1 },
    ]) {
      await expect(waitForWorkerVersionReady({
        workerVersionId: CANDIDATE_VERSION,
        ...input,
      })).rejects.toThrow(/readiness/i);
    }

    const failure = new Error("probe failed");
    await expect(waitForWorkerVersionReady({
      workerVersionId: CANDIDATE_VERSION,
      probe: async () => {
        throw failure;
      },
    })).rejects.toBe(failure);
  });

  it("tracks every same-origin browser response between flow checkpoints", () => {
    const tracker = createWorkerVersionResponseTracker({
      baseUrl: "https://spoonjoy.app",
      workerVersionId: CANDIDATE_VERSION,
    });
    const signupCheckpoint = tracker.checkpoint();

    expect(tracker.record({
      url: "https://claude.ai/api/mcp/auth_callback",
      headers: {},
      label: "Claude callback",
    })).toBe(false);
    expect(tracker.record({
      url: "https://spoonjoy.app/signup",
      headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION },
      label: "GET /signup",
    })).toBe(true);
    expect(() => tracker.assertSince(signupCheckpoint, "signup page")).not.toThrow();

    const submitCheckpoint = tracker.checkpoint();
    tracker.record({
      url: "https://spoonjoy.app/signup",
      headers: {},
      label: "POST /signup",
    });
    tracker.record({
      url: "https://spoonjoy.app/my-recipes",
      headers: { "x-spoonjoy-worker-version": "33333333-3333-4333-8333-333333333333" },
      label: "GET /my-recipes",
    });
    expect(() => tracker.assertSince(submitCheckpoint, "signup submission")).toThrow(
      /signup submission.*POST \/signup.*missing.*GET \/my-recipes.*expected/i,
    );
    expect(() => tracker.assertAll("browser flow")).toThrow(/browser flow.*POST \/signup/i);
  });

  it("requires Worker proof from application responses while ignoring static asset binding responses", () => {
    const tracker = createWorkerVersionResponseTracker({
      baseUrl: "https://spoonjoy.app",
      workerVersionId: CANDIDATE_VERSION,
    });
    const checkpoint = tracker.checkpoint();

    expect(tracker.record({
      url: "https://spoonjoy.app/assets/entry.client-example.js",
      headers: {},
      label: "GET /assets/entry.client-example.js",
    })).toBe(false);
    expect(tracker.record({
      url: "https://spoonjoy.app/signup",
      headers: { "x-spoonjoy-worker-version": CANDIDATE_VERSION },
      label: "GET /signup",
    })).toBe(true);
    expect(() => tracker.assertSince(checkpoint, "signup page")).not.toThrow();

    const assetsOnlyCheckpoint = tracker.checkpoint();
    expect(tracker.record({
      url: "https://spoonjoy.app/assets/root-example.css",
      headers: {},
      label: "GET /assets/root-example.css",
    })).toBe(false);
    expect(() => tracker.assertSince(assetsOnlyCheckpoint, "assets-only phase")).toThrow(
      /observed no Spoonjoy responses/i,
    );
  });

  it("requires browser phases to observe responses and validates tracker checkpoints", () => {
    const tracker = createWorkerVersionResponseTracker({
      baseUrl: "https://spoonjoy.app",
      workerVersionId: CANDIDATE_VERSION,
    });
    expect(() => tracker.assertSince(0, "authorize page")).toThrow(/observed no Spoonjoy responses/i);
    expect(() => tracker.assertSince(-1, "invalid phase")).toThrow(/checkpoint/i);
    expect(() => tracker.assertSince(1, "future phase")).toThrow(/checkpoint/i);

    const disabled = createWorkerVersionResponseTracker({
      baseUrl: "https://spoonjoy.app",
      workerVersionId: null,
    });
    expect(disabled.record({ url: "https://spoonjoy.app/signup", headers: {} })).toBe(false);
    expect(() => disabled.assertSince(0, "local signup")).not.toThrow();
    expect(() => disabled.assertAll("local browser flow")).not.toThrow();

    const hostileHeaders = new Proxy({}, {
      ownKeys() {
        throw "header enumeration failed";
      },
    });
    tracker.record({
      url: "https://spoonjoy.app/oauth/authorize",
      headers: hostileHeaders,
      label: "hostile response",
    });
    expect(() => tracker.assertAll("defensive response handling")).toThrow(/header enumeration failed/i);
  });

  it("keeps the candidate ID while redacting the persisted MCP canary report", () => {
    const serialized = serializeSanitizedMcpCanaryReport({
      workerVersionId: CANDIDATE_VERSION,
      failure: { message: "Authorization: Bearer sj_abcdefghijklmnopqrstuvwxyz0123456789" },
    });

    expect(JSON.parse(serialized)).toEqual({
      workerVersionId: CANDIDATE_VERSION,
      failure: { message: "Authorization: Bearer [REDACTED]" },
    });
    expect(serialized).not.toContain("sj_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("wires pre-mutation readiness, exhaustive response proof, scoped overrides, and sanitized reporting into the live canary", () => {
    const source = readFileSync("scripts/smoke-mcp-oauth-live.mjs", "utf8");
    const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8"));

    expect(source).not.toContain("extraHTTPHeaders");
    expect(source).toContain("installWorkerVersionBrowserRouting(page, {");
    expect(source).toContain("installWorkerVersionBrowserRouting(mutationPage, {");
    expect(source).not.toContain('context.route("**/*"');
    expect(source).not.toContain('page.context().route("**/api/mcp/auth_callback**"');
    expect(source).toContain('context.on("response"');
    expect(source).toContain("createWorkerVersionResponseTracker({");
    expect(source).toContain("assertWorkerVersionResponse(response.headers(), workerVersionId, label)");
    expect(source).toContain("return waitForWorkerChannelsReady({");
    const readinessSource = source.match(/async function waitForCandidateWorker\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(readinessSource).toContain("page.goto(url");
    expect(readinessSource).toContain("request.get(url");
    expect(readinessSource).toContain("mutationPage.goto(mutationUrl");
    expect(readinessSource).toContain("mutationPage.waitForResponse(");
    expect(readinessSource).toContain("isRouteActionResponse({");
    expect(readinessSource).toContain("routePath: mutationPath");
    expect(readinessSource).toContain('getByRole("button", { name: "Probe Worker mutation channel" }).click');
    expect(readinessSource).not.toContain("mutationPage.evaluate(");
    expect(readinessSource).toContain('const mutationPath = "/.well-known/spoonjoy-release-readiness"');
    expect(readinessSource).toContain("timeout: timeoutMs");
    expect(source).toContain("waitForCandidateWorker(page, mutationPage, page.request, { baseUrl, workerVersionId })");
    expect(source.indexOf('check("candidate Worker override readiness"')).toBeLessThan(
      source.indexOf('check("signup disposable user"'),
    );
    expect(source.indexOf('check("candidate Worker override readiness"')).toBeLessThan(
      source.indexOf('context.on("response"'),
    );
    expect(source).toContain("responseTracker.assertAll(\"complete browser flow\")");
    expect(source).toContain("maxRedirects: 0");
    expect(source).toContain('serviceWorkers: "block"');
    expect(source).toContain("env: buildBrowserEnvironment(process.env)");
    expect(source).toContain("env: buildD1CommandEnvironment(process.env)");
    expect(source.indexOf('check("candidate Worker override readiness"')).toBeLessThan(
      source.indexOf("canaryMutationStarted = true"),
    );
    for (const functionName of [
      "readProtectedResource",
      "registerClaudeClient",
      "exchangeCodeForTokens",
      "refreshTokens",
      "expectRefreshReplayRejected",
      "mcpRpc",
    ]) {
      const functionSource = source.match(
        new RegExp(`async function ${functionName}\\([\\s\\S]*?\\n}\\n`),
      )?.[0] ?? "";
      expect(functionSource, `${functionName} must use the verified request wrapper`).toContain("spoonjoyRequest(request");
    }
    expect(source).toContain("workerVersionId,");
    expect(source).toContain("serializeSanitizedMcpCanaryReport(report)");
    expect(wrangler.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
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
    expect(readGitMetadata()).toEqual({
      branch: expect.stringMatching(/\S/),
      commit: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
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
