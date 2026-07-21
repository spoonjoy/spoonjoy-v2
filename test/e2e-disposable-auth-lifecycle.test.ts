import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDisposableE2EUser,
  recordDisposableE2EUser,
  runDisposableE2ETeardown,
  secureDisposableE2EAuthFile,
} from "../e2e/support/disposable-auth";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("e2e disposable auth lifecycle", () => {
  const legacyDemoEmail = "demo@" + "spoonjoy.com";
  const legacyDemoPassword = "demo" + "1234";

  it("generates a unique disposable user contract for every run", () => {
    const first = createDisposableE2EUser({ now: () => new Date("2026-07-15T12:00:00Z"), random: () => "abc123" });
    const second = createDisposableE2EUser({ now: () => new Date("2026-07-15T12:00:00Z"), random: () => "def456" });

    expect(first).toMatchObject({
      email: "codex-e2e-20260715t120000z-abc123@example.com",
      username: "codex_e2e_20260715t120000z_abc123",
    });
    expect(first.password).toMatch(/^E2E-20260715t120000z-abc123-/);
    expect(first.email).not.toBe(second.email);
    expect(first.password).not.toBe(second.password);
  });

  it("replaces stale manifest credentials with the current disposable user", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-e2e-auth-"));
    tempDirs.push(tempDir);
    const manifestPath = path.join(tempDir, "users.json");
    const user = createDisposableE2EUser({ now: () => new Date("2026-07-15T12:00:00Z"), random: () => "abc123" });

    recordDisposableE2EUser(createDisposableE2EUser({ random: () => "stale" }), manifestPath);
    recordDisposableE2EUser(user, manifestPath);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown[];
    expect(manifest).toEqual([user]);
  });

  it("forces overwritten manifests and browser session artifacts to owner-only permissions", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-e2e-permissions-"));
    tempDirs.push(tempDir);
    const manifestPath = path.join(tempDir, "users.json");
    const storageStatePath = path.join(tempDir, "user.json");
    const user = createDisposableE2EUser({ random: () => "permissions" });
    writeFileSync(manifestPath, "stale", { mode: 0o644 });
    writeFileSync(storageStatePath, "session", { mode: 0o644 });
    chmodSync(manifestPath, 0o644);
    chmodSync(storageStatePath, 0o644);

    recordDisposableE2EUser(user, manifestPath);
    secureDisposableE2EAuthFile(storageStatePath);

    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    expect(statSync(storageStatePath).mode & 0o777).toBe(0o600);
  });

  it("tears down disposable auth residue with local-only cleanup", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-e2e-teardown-"));
    tempDirs.push(tempDir);
    const authPaths = [path.join(tempDir, "user.json"), path.join(tempDir, "users.json")];
    for (const authPath of authPaths) writeFileSync(authPath, "secret");
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await runDisposableE2ETeardown({ runCommand, authPaths });

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["run", "cleanup:local:apply"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(authPaths.every((authPath) => !existsSync(authPath))).toBe(true);
  });

  it("removes local auth files when database cleanup fails", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "spoonjoy-e2e-teardown-failure-"));
    tempDirs.push(tempDir);
    const authPaths = [path.join(tempDir, "user.json"), path.join(tempDir, "users.json")];
    for (const authPath of authPaths) writeFileSync(authPath, "secret");
    const runCommand = vi.fn().mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(runDisposableE2ETeardown({ runCommand, authPaths })).rejects.toThrow("cleanup failed");
    expect(authPaths.every((authPath) => !existsSync(authPath))).toBe(true);
  });

  it("wires Playwright setup and teardown without a seed-user login", () => {
    const setupSource = readFileSync("e2e/auth.setup.ts", "utf8");
    const authSource = readFileSync("e2e/support/auth.ts", "utf8");
    const configSource = readFileSync("playwright.config.ts", "utf8");

    expect(setupSource).toContain("createDisposableE2EUser");
    expect(setupSource).toContain("recordDisposableE2EUser");
    expect(setupSource).toContain("secureDisposableE2EAuthFile(DISPOSABLE_E2E_AUTH_STATE)");
    expect(configSource).toContain("globalTeardown");
    expect(`${setupSource}\n${authSource}`).not.toContain("loginAsSeedUser");
    expect(`${setupSource}\n${authSource}`).not.toContain(legacyDemoEmail);
    expect(`${setupSource}\n${authSource}`).not.toContain(legacyDemoPassword);
  });

  it("registers only the OAuth client identity covered by disposable cleanup", () => {
    const passkeySource = readFileSync("e2e/flows/passkey.spec.ts", "utf8");
    const cleanupSource = readFileSync("scripts/cleanup-local-qa-data.mjs", "utf8");

    expect(passkeySource).toContain("client_name: 'E2E OAuth Client'");
    expect(passkeySource).not.toContain("Passkey E2E OAuth Client");
    expect(cleanupSource).toContain("clientName = 'E2E OAuth Client'");
  });
});
