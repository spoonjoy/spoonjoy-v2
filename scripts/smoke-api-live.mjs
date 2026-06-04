#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function request(baseUrl, path, init = {}) {
  const startedAt = Date.now();
  const response = await fetch(new URL(path, baseUrl), init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    path,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    elapsedMs: Date.now() - startedAt,
    text,
    json,
  };
}

function expectHeader(result, name) {
  const value = result.headers[name.toLowerCase()];
  assert.ok(value, `${result.path} missing ${name}`);
  return value;
}

async function main() {
  const baseUrl = arg("--base-url", process.env.SPOONJOY_SMOKE_BASE_URL ?? "https://spoonjoy.app");
  const outDir = arg("--out", "api-live-smoke-artifacts");
  mkdirSync(outDir, { recursive: true });

  const report = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    checks: [],
  };
  const check = async (name, fn) => {
    const startedAt = Date.now();
    await fn();
    report.checks.push({ name, elapsedMs: Date.now() - startedAt });
  };

  await check("api docs route", async () => {
    const result = await request(baseUrl, "/api");
    assert.equal(result.status, 200);
    assert.match(result.text, /Spoonjoy Developer Platform|Spoonjoy API/);
  });

  await check("playground alias route", async () => {
    const result = await request(baseUrl, "/api/playground");
    assert.equal(result.status, 200);
    assert.match(result.text, /Spoonjoy API Playground/);
  });

  await check("request id echo and stable error envelope", async () => {
    const result = await request(baseUrl, "/api/v1/not-a-real-endpoint", {
      headers: { "X-Request-Id": "api_smoke_not_found" },
    });
    assert.equal(result.status, 404);
    assert.equal(expectHeader(result, "X-Request-Id"), "api_smoke_not_found");
    assert.deepEqual(result.json, {
      ok: false,
      requestId: "api_smoke_not_found",
      error: {
        code: "not_found",
        message: "Unknown Spoonjoy API v1 endpoint: /api/v1/not-a-real-endpoint",
        status: 404,
      },
    });
  });

  await check("OpenAPI path parity and dynamic server", async () => {
    const result = await request(baseUrl, "/api/v1/openapi.json", {
      headers: { "X-Request-Id": "api_smoke_openapi" },
    });
    assert.equal(result.status, 200);
    assert.equal(expectHeader(result, "X-Request-Id"), "api_smoke_openapi");
    assert.equal(result.json.openapi, "3.1.0");
    assert.equal(result.json.servers[0].url, new URL(baseUrl).origin);
    for (const path of [
      "/api/v1/openapi.json",
      "/api/v1/openapi.sdk.json",
      "/api/v1/openapi.connector.json",
      "/oauth/register",
      "/oauth/token",
      "/oauth/revoke",
      "/api/tools/start_agent_connection",
      "/api/tools/poll_agent_connection",
      "/mcp",
    ]) {
      assert.ok(result.json.paths[path], `OpenAPI missing ${path}`);
    }
  });

  await check("SDK profile includes token lifecycle", async () => {
    const result = await request(baseUrl, "/api/v1/openapi.sdk.json");
    assert.equal(result.status, 200);
    assert.equal(result.json.servers[0].url, new URL(baseUrl).origin);
    assert.ok(result.json.paths["/oauth/register"]);
    assert.ok(result.json.paths["/oauth/authorize"]);
    assert.ok(result.json.paths["/oauth/token"]);
    assert.ok(result.json.paths["/oauth/revoke"]);
  });

  await check("OAuth token CORS preflight", async () => {
    const result = await request(baseUrl, "/oauth/token", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    assert.equal(result.status, 204);
    assert.equal(expectHeader(result, "Access-Control-Allow-Origin"), "*");
    assert.match(expectHeader(result, "Access-Control-Allow-Methods"), /POST/);
    assert.match(expectHeader(result, "Access-Control-Allow-Headers"), /Content-Type/);
  });

  await check("DELETE mutation header CORS preflight", async () => {
    const result = await request(baseUrl, "/api/v1/shopping-list/items/item_1", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "DELETE",
        "Access-Control-Request-Headers": "Authorization, X-Client-Mutation-Id",
      },
    });
    assert.equal(result.status, 204);
    assert.match(expectHeader(result, "Access-Control-Allow-Headers"), /X-Client-Mutation-Id/);
  });

  await check("public cache headers", async () => {
    const result = await request(baseUrl, "/api/v1/recipes?limit=1");
    assert.equal(result.status, 200);
    assert.match(expectHeader(result, "Cache-Control"), /public, max-age=60/);
    const vary = expectHeader(result, "Vary");
    assert.match(vary, /(?:^|,\s*)Authorization(?:,|$)/);
    assert.match(vary, /(?:^|,\s*)Cookie(?:,|$)/);
  });

  writeFileSync(join(outDir, "api-smoke-results.json"), JSON.stringify(report, null, 2));
  console.log(join(outDir, "api-smoke-results.json"));
}

await main();
