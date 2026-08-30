import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { hashApiToken } from "../../app/lib/api-auth.server";
import { hashOAuthOpaqueToken } from "../../app/lib/oauth-server.server";

const RESULT_PREFIX = "OAUTH_D1_RESTART_RESULT=";
const NOW = "2026-08-29T19:00:00.000Z";

interface TokenProcessResult {
  accessToken: string;
  refreshToken: string;
}

interface ObservedProcessResult {
  user: Record<string, unknown>;
  client: Record<string, unknown>;
  refreshRows: Array<Record<string, unknown>>;
  accessRows: Array<Record<string, unknown>>;
}

function sanitizeDiagnostic(value: string): string {
  return value.replace(/\b(?:sj_|ort_)[A-Za-z0-9_-]+/g, "[REDACTED]");
}

async function runRestartProcess<T>(
  mode: "issue" | "rotate" | "observe",
  persistencePath: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const executable = resolve("node_modules/.bin/tsx");
  const fixture = resolve("test/fixtures/oauth-d1-restart-process.ts");
  const child = spawn(executable, [fixture, mode, persistencePath], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(JSON.stringify(input));
  let timedOut = false;
  const terminationTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 20_000);
  terminationTimer.unref();
  let exitCode: number | null;
  try {
    exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
  } finally {
    clearTimeout(terminationTimer);
  }
  if (timedOut) throw new Error(`OAuth D1 restart process timed out (${mode})`);
  if (exitCode !== 0) {
    throw new Error(`OAuth D1 restart process failed (${mode}, ${exitCode}): ${sanitizeDiagnostic(stderr)}`);
  }
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX));
  if (!resultLine) throw new Error(`OAuth D1 restart process omitted its result (${mode})`);
  return JSON.parse(resultLine.slice(RESULT_PREFIX.length)) as T;
}

describe("OAuth persistence across complete local server-process restarts", () => {
  it("reconstructs every connector binding from D1 after issuance and rotation processes exit", async () => {
    const persistencePath = await mkdtemp(resolve(tmpdir(), "spoonjoy-oauth-d1-restart-"));
    try {
      const issued = await runRestartProcess<TokenProcessResult>("issue", persistencePath);
      const originalRefreshHash = await hashOAuthOpaqueToken(issued.refreshToken);
      const originalAccessHash = await hashApiToken(issued.accessToken);

      const rotated = await runRestartProcess<TokenProcessResult>("rotate", persistencePath, {
        refreshToken: issued.refreshToken,
      });
      const childRefreshHash = await hashOAuthOpaqueToken(rotated.refreshToken);
      const childAccessHash = await hashApiToken(rotated.accessToken);

      const observed = await runRestartProcess<ObservedProcessResult>("observe", persistencePath);
      expect(observed.user).toMatchObject({
        id: "oauth-process-restart-user",
        email: "oauth-process-restart@example.com",
        username: "oauth_process_restart",
      });
      expect(observed.client).toMatchObject({
        id: "oauth-process-restart-client",
        clientName: "Process restart connector",
        redirectUris: "https://example.com/callback",
        issuer: "https://spoonjoy.test",
        revokedAt: null,
      });
      expect(observed.refreshRows.map((row) => row.tokenHash).sort())
        .toEqual([originalRefreshHash, childRefreshHash].sort());
      expect(observed.accessRows.map((row) => row.tokenHash).sort())
        .toEqual([originalAccessHash, childAccessHash].sort());

      const parent = observed.refreshRows.find((row) => row.tokenHash === originalRefreshHash);
      const child = observed.refreshRows.find((row) => row.tokenHash === childRefreshHash);
      const originalAccess = observed.accessRows.find((row) => row.tokenHash === originalAccessHash);
      const childAccess = observed.accessRows.find((row) => row.tokenHash === childAccessHash);
      expect(parent).toMatchObject({
        userId: "oauth-process-restart-user",
        clientId: "oauth-process-restart-client",
        issuer: "https://spoonjoy.test",
        scope: "kitchen:read",
        resource: "https://spoonjoy.test/mcp",
        revokedAt: NOW,
        connectionKey: child?.connectionKey,
      });
      expect(child).toMatchObject({
        userId: "oauth-process-restart-user",
        clientId: "oauth-process-restart-client",
        issuer: "https://spoonjoy.test",
        scope: "kitchen:read",
        resource: "https://spoonjoy.test/mcp",
        revokedAt: null,
      });
      expect(originalAccess).toMatchObject({
        userId: "oauth-process-restart-user",
        scopes: "kitchen:read",
        oauthClientId: "oauth-process-restart-client",
        oauthIssuer: "https://spoonjoy.test",
        oauthResource: "https://spoonjoy.test/mcp",
        oauthConnectionKey: child?.connectionKey,
        revokedAt: null,
        expiresAt: null,
      });
      expect(childAccess).toMatchObject({
        userId: "oauth-process-restart-user",
        scopes: "kitchen:read",
        oauthClientId: "oauth-process-restart-client",
        oauthIssuer: "https://spoonjoy.test",
        oauthResource: "https://spoonjoy.test/mcp",
        oauthConnectionKey: child?.connectionKey,
        revokedAt: null,
        expiresAt: "2026-08-29T19:15:00.000Z",
      });
    } finally {
      await rm(persistencePath, { recursive: true, force: true });
    }
  }, 60_000);
});
