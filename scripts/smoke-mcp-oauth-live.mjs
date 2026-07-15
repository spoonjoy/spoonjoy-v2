#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  assertWorkerVersionResponse,
  buildMcpCanaryCleanupD1Args,
  buildMcpCanaryConnectionResourceD1Args,
  buildMcpCanaryLegacyRefreshInsertD1Args,
  buildMcpCanaryUserLookupD1Args,
  buildUserCountD1Args,
  buildWorkerVersionOverrideHeaders,
  parseD1CountOutput,
  parseD1RowsOutput,
  parseMcpCanaryArgs,
  readGitMetadata,
  serializeSanitizedMcpCanaryReport,
} from "./smoke-live-helpers.mjs";

const execFileAsync = promisify(execFile);
const requireFromCwd = createRequire(join(process.cwd(), "package.json"));
const { chromium, expect } = requireFromCwd("@playwright/test");

const CLAUDE_MCP_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const MCP_PROTOCOL_VERSION = "2025-06-18";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(prefix) {
  return `${prefix}${base64Url(randomBytes(32))}`;
}

function sha256Base64Url(value) {
  return base64Url(createHash("sha256").update(value).digest());
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mcpResourceForTarget({ baseUrl, targetEnv }) {
  return targetEnv === "production" ? "https://spoonjoy.app/mcp" : new URL("/mcp", baseUrl).toString();
}

async function readProtectedResource(request, baseUrl, workerVersionId) {
  const response = await request.get(new URL("/.well-known/oauth-protected-resource/mcp", baseUrl).toString());
  assert.equal(response.status(), 200, `protected-resource metadata failed with ${response.status()}`);
  assertWorkerVersionResponse(response.headers(), workerVersionId);
  const body = await responseJson(response, "MCP protected-resource metadata");
  assert.match(body.resource, /^https?:\/\/.+\/mcp$/);
  return body.resource;
}

async function screenshot(page, outDir, name) {
  await page.waitForLoadState("load").catch(() => null);
  await page.waitForTimeout(250);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function responseJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 200)}`);
  }
}

async function runWranglerD1(args) {
  const { stdout, stderr } = await execFileAsync("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  return { stdout, stderr };
}

async function signupDisposableUser(page, { baseUrl, email, username, password }) {
  await page.goto(new URL("/signup", baseUrl).toString(), { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: /sign up/i })).toBeVisible({ timeout: 15_000 });
  await page.locator('input[name="email"]:visible').fill(email);
  await page.locator('input[name="username"]:visible').fill(username);
  await page.locator('input[name="password"]:visible').fill(password);
  await page.locator('input[name="confirmPassword"]:visible').fill(password);
  await page.getByRole("button", { name: /sign up/i }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 20_000 });
}

async function registerClaudeClient(request, baseUrl) {
  const response = await request.post(new URL("/oauth/register", baseUrl).toString(), {
    data: {
      client_name: "Claude",
      redirect_uris: [CLAUDE_MCP_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "kitchen:read kitchen:write",
    },
  });
  assert.equal(response.status(), 201, `OAuth dynamic registration failed with ${response.status()}`);
  const body = await responseJson(response, "OAuth dynamic registration");
  assert.equal(body.client_name, "Claude");
  assert.equal(body.redirect_uris?.[0], CLAUDE_MCP_REDIRECT_URI);
  assert.ok(body.client_id, "OAuth dynamic registration did not return client_id");
  return body.client_id;
}

async function approveConsent(page, { baseUrl, clientId, codeChallenge, resource, outDir, report }) {
  const authorizeUrl = new URL("/oauth/authorize", baseUrl);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CLAUDE_MCP_REDIRECT_URI,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "kitchen:read kitchen:write",
    state: `mcp-canary-${Date.now().toString(36)}`,
    resource,
  }).toString();

  await page.context().route("**/api/mcp/auth_callback**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Claude callback intercepted by Spoonjoy canary</title>",
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(authorizeUrl.toString(), { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: /connect claude to spoonjoy/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/read recipes, cookbooks, and your shopping list/i)).toBeVisible();
  await expect(page.getByText(/add, edit, and remove kitchen data/i)).toBeVisible();
  const allow = page.getByRole("button", { name: /allow access/i });
  await expect(allow).toBeVisible();
  await expect(allow.locator("xpath=ancestor::form[1]")).toHaveAttribute("method", "post");
  await expect(allow.locator("xpath=ancestor::form[1]")).not.toHaveAttribute("data-discover", /.*/);

  const metrics = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(metrics.width <= metrics.viewportWidth, `Consent page has horizontal overflow: ${metrics.width} > ${metrics.viewportWidth}`);
  assert.ok(metrics.height <= metrics.viewportHeight + 4, `Consent page scrolls at desktop size: ${metrics.height} > ${metrics.viewportHeight}`);
  report.screenshots.push(await screenshot(page, outDir, "01-consent-desktop"));

  const callbackRequest = page.waitForRequest((request) => request.url().startsWith(CLAUDE_MCP_REDIRECT_URI), {
    timeout: 20_000,
  });
  await allow.click();
  const callback = new URL((await callbackRequest).url());
  assert.equal(callback.searchParams.get("state"), authorizeUrl.searchParams.get("state"));
  const code = callback.searchParams.get("code");
  assert.ok(code, "Approve did not redirect back with an authorization code");
  return code;
}

async function exchangeCodeForTokens(request, { baseUrl, clientId, code, codeVerifier }) {
  const response = await request.post(new URL("/oauth/token", baseUrl).toString(), {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: CLAUDE_MCP_REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    },
  });
  assert.equal(response.status(), 200, `authorization_code exchange failed with ${response.status()}`);
  const body = await responseJson(response, "authorization_code token exchange");
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.scope, "kitchen:read kitchen:write");
  assert.equal(body.expires_in, undefined);
  assert.match(body.access_token, /^sj_/);
  assert.match(body.refresh_token, /^ort_/);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function refreshTokens(request, { baseUrl, clientId, refreshToken }) {
  const response = await request.post(new URL("/oauth/token", baseUrl).toString(), {
    form: {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    },
  });
  assert.equal(response.status(), 200, `refresh_token exchange failed with ${response.status()}`);
  const body = await responseJson(response, "refresh_token exchange");
  assert.equal(body.expires_in, undefined);
  assert.match(body.access_token, /^sj_/);
  assert.match(body.refresh_token, /^ort_/);
  assert.notEqual(body.refresh_token, refreshToken);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function expectRefreshReplayRejected(request, { baseUrl, clientId, refreshToken }) {
  const response = await request.post(new URL("/oauth/token", baseUrl).toString(), {
    form: {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    },
  });
  assert.equal(response.status(), 400, `refresh replay should fail, got ${response.status()}`);
  const body = await responseJson(response, "refresh replay rejection");
  assert.equal(body.error, "invalid_grant");
}

async function mcpRpc(request, { baseUrl, accessToken, id, method, params }) {
  const response = await request.post(new URL("/mcp", baseUrl).toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    },
  });
  assert.equal(response.status(), 200, `MCP ${method} failed with ${response.status()}`);
  const body = await responseJson(response, `MCP ${method}`);
  assert.equal(body.error, undefined);
  return body.result;
}

async function expectMcpReady(request, { baseUrl, accessToken }) {
  const init = await mcpRpc(request, {
    baseUrl,
    accessToken,
    id: 1,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION },
  });
  assert.equal(init.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(init.serverInfo?.name, "spoonjoy");

  const tools = await mcpRpc(request, {
    baseUrl,
    accessToken,
    id: 2,
    method: "tools/list",
  });
  const names = tools.tools.map((tool) => tool.name);
  assert.ok(names.includes("search_spoonjoy"), "MCP tools/list omitted search_spoonjoy");
  assert.ok(names.includes("get_shopping_list"), "MCP tools/list omitted get_shopping_list");
}

async function lookupCanaryUserId(email, { targetEnv }) {
  const { stdout } = await runWranglerD1(buildMcpCanaryUserLookupD1Args(email, { targetEnv }));
  const rows = parseD1RowsOutput(stdout);
  const userId = rows[0]?.id;
  assert.ok(userId, `Could not find disposable canary user ${email} in ${targetEnv} D1`);
  return userId;
}

async function verifyLegacyClaudePromotion(request, input) {
  const legacyRefreshToken = randomToken("ort_");
  const legacyRefreshId = `mcp_canary_${input.stamp}`;
  const connectionKey = `mcp_canary_connection_${input.stamp}`;
  const userId = await lookupCanaryUserId(input.email, { targetEnv: input.targetEnv });
  input.report.legacyProbe = {
    userId,
    connectionKey,
    insertedRefreshId: legacyRefreshId,
    resource: input.resource,
  };

  await runWranglerD1(buildMcpCanaryLegacyRefreshInsertD1Args({
    id: legacyRefreshId,
    tokenHash: sha256Hex(legacyRefreshToken),
    userId,
    clientId: input.clientId,
    scope: "kitchen:read kitchen:write",
    connectionKey,
  }, { targetEnv: input.targetEnv }));

  const promoted = await refreshTokens(request, {
    baseUrl: input.baseUrl,
    clientId: input.clientId,
    refreshToken: legacyRefreshToken,
  });
  await expectMcpReady(request, { baseUrl: input.baseUrl, accessToken: promoted.accessToken });

  const { stdout } = await runWranglerD1(buildMcpCanaryConnectionResourceD1Args({
    userId,
    clientId: input.clientId,
    connectionKey,
  }, { targetEnv: input.targetEnv }));
  const rows = parseD1RowsOutput(stdout);
  assert.equal(rows[0]?.resource, input.resource);
  input.report.legacyProbe.promotedResource = rows[0]?.resource;
  return connectionKey;
}

async function cleanupCanary({ email, clientId, connectionKey, targetEnv }) {
  const cleanup = await runWranglerD1(buildMcpCanaryCleanupD1Args({ email, clientId, connectionKey }, { targetEnv }));
  const verify = await runWranglerD1(buildUserCountD1Args(email, { targetEnv }));
  const remaining = parseD1CountOutput(verify.stdout);
  return { target: `${targetEnv} D1`, remaining, stdout: cleanup.stdout, stderr: cleanup.stderr };
}

async function main() {
  const { baseUrl, includeLegacyDbProbe, outDir, shouldCleanup, target, targetEnv, workerVersionId } = parseMcpCanaryArgs();
  const stamp = Date.now().toString(36);
  const email = `codex-mcp-canary-${stamp}@example.com`;
  const username = `codex_mcp_${stamp}`;
  const password = `Mcp-Canary-${stamp}-1234`;
  let resource = mcpResourceForTarget({ baseUrl, targetEnv });
  const report = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    targetEnv,
    environment: {
      targetEnv: target.targetEnv,
      baseUrl: target.baseUrl,
      d1Target: target.d1Target,
      r2Target: target.r2Target,
      destructiveScope: target.destructiveScope,
    },
    git: readGitMetadata(),
    email,
    username,
    redirectUri: CLAUDE_MCP_REDIRECT_URI,
    resource,
    workerVersionId,
    screenshots: [],
    checks: [],
    cleanup: null,
    legacyProbe: includeLegacyDbProbe ? null : { skipped: true, reason: "--skip-legacy-db-probe" },
  };
  let browser;
  let context;
  let clientId = null;
  let connectionKey = `mcp_canary_connection_${stamp}`;
  let failure = null;
  mkdirSync(outDir, { recursive: true });

  const check = async (name, fn) => {
    const startedAt = Date.now();
    await fn();
    report.checks.push({ name, elapsedMs: Date.now() - startedAt });
  };

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: buildWorkerVersionOverrideHeaders(workerVersionId),
    });
    const page = await context.newPage();
    const verifier = randomToken("");
    const challenge = sha256Base64Url(verifier);

    await check("signup disposable user", async () => {
      await signupDisposableUser(page, { baseUrl, email, username, password });
      report.screenshots.push(await screenshot(page, outDir, "00-after-signup"));
    });

    await check("protected-resource metadata", async () => {
      resource = await readProtectedResource(page.request, baseUrl, workerVersionId);
      report.resource = resource;
    });

    await check("dynamic client registration", async () => {
      clientId = await registerClaudeClient(page.request, baseUrl);
      report.clientId = clientId;
    });

    let code = null;
    await check("authorize consent UI and approve redirect", async () => {
      code = await approveConsent(page, { baseUrl, clientId, codeChallenge: challenge, resource, outDir, report });
    });

    let firstTokens;
    await check("authorization_code token exchange", async () => {
      firstTokens = await exchangeCodeForTokens(page.request, { baseUrl, clientId, code, codeVerifier: verifier });
    });

    await check("mcp initialize and tools/list with issued access token", async () => {
      await expectMcpReady(page.request, { baseUrl, accessToken: firstTokens.accessToken });
    });

    let rotatedTokens;
    await check("refresh rotation and replay rejection", async () => {
      rotatedTokens = await refreshTokens(page.request, { baseUrl, clientId, refreshToken: firstTokens.refreshToken });
      await expectRefreshReplayRejected(page.request, { baseUrl, clientId, refreshToken: firstTokens.refreshToken });
    });

    await check("mcp initialize and tools/list with refreshed access token", async () => {
      await expectMcpReady(page.request, { baseUrl, accessToken: rotatedTokens.accessToken });
    });

    if (includeLegacyDbProbe) {
      await check("legacy Claude refresh token promotion", async () => {
        connectionKey = await verifyLegacyClaudePromotion(page.request, {
          baseUrl,
          clientId,
          email,
          report,
          resource,
          stamp,
          targetEnv,
        });
      });
    }
  } catch (error) {
    failure = error;
    report.failure = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    await context?.close().catch(() => null);
    await browser?.close().catch(() => null);

    if (shouldCleanup) {
      try {
        report.cleanup = await cleanupCanary({ email, clientId, connectionKey, targetEnv });
      } catch (error) {
        report.cleanup = { error: error instanceof Error ? error.message : String(error) };
      }
    } else {
      report.cleanup = { skipped: true, reason: "--keep-smoke-data" };
    }

    writeFileSync(join(outDir, "mcp-oauth-canary-results.json"), serializeSanitizedMcpCanaryReport(report));
  }

  if (failure) {
    console.error(`MCP OAuth canary failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    process.exitCode = 1;
    return;
  }
  if (shouldCleanup && report.cleanup?.error) {
    console.error(`MCP OAuth canary passed, but cleanup failed: ${report.cleanup.error}`);
    process.exitCode = 1;
    return;
  }
  if (shouldCleanup && report.cleanup?.remaining !== 0) {
    console.error(`MCP OAuth canary passed, but cleanup left ${report.cleanup?.remaining} disposable user(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(join(outDir, "mcp-oauth-canary-results.json"));
}

await main();
