import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OSV_SCANNER,
  createAdvisoryScannerCommand,
  loadAdvisoryAllowlist,
  runAdvisoryScan,
  type CommandRunner,
} from "../../scripts/advisory-scan";

async function withTempDir<T>(callback: (directory: string) => Promise<T>): Promise<T> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "spoonjoy-advisory-test-"));
  try {
    return await callback(tempDirectory);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

function cleanScannerJson() {
  return JSON.stringify({ results: [{ source: { path: "pnpm-lock.yaml", type: "lockfile" }, packages: [] }] });
}

function vulnerableScannerJson() {
  return JSON.stringify({
    results: [
      {
        source: { path: "pnpm-lock.yaml", type: "lockfile" },
        packages: [
          {
            package: { name: "left-pad", version: "1.1.1", ecosystem: "npm" },
            vulnerabilities: [
              {
                id: "GHSA-test-vuln",
                aliases: ["CVE-2099-0001"],
                summary: "Synthetic package takeover",
                severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
                affected: [{ ranges: [], versions: ["1.1.1"], database_specific: { source: "synthetic" } }],
              },
            ],
            groups: [{ ids: ["GHSA-test-vuln"] }],
          },
        ],
      },
    ],
  });
}

describe("advisory scanner configuration", () => {
  it("pins a supported OSV-Scanner release by version, tag SHA, and binary digest", () => {
    expect(OSV_SCANNER).toMatchObject({
      name: "OSV-Scanner",
      version: "v2.3.8",
      tagSha: "408fcd6f8707999a29e7ba45e15809764cf24f67",
      linuxAmd64Sha256: "bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc",
    });
    expect(OSV_SCANNER.sourceDocs).toEqual([
      "https://google.github.io/osv-scanner/supported-languages-and-lockfiles/",
      "https://google.github.io/osv-scanner/usage/",
      "https://google.github.io/osv-scanner/output/",
      "https://google.github.io/osv-scanner/configuration/",
    ]);
  });

  it("builds the outgoing OSV command for the web pnpm lockfile only", () => {
    expect(createAdvisoryScannerCommand({ scannerPath: "./bin/osv-scanner", outputPath: "out.json" })).toEqual({
      command: "./bin/osv-scanner",
      args: ["scan", "--lockfile=pnpm-lock.yaml", "--format=json", "--output-file=out.json"],
    });
  });
});

describe("advisory allowlist policy", () => {
  it("accepts an empty allowlist with the required schema", async () => {
    await withTempDir(async (directory) => {
      const allowlistPath = path.join(directory, "allowlist.json");
      await writeFile(
        allowlistPath,
        JSON.stringify({ allowedVulnerabilities: [], policy: "allowlist entries must expire" }),
      );

      expect(await loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).toEqual({
        allowedVulnerabilities: [],
        policy: "allowlist entries must expire",
      });
    });
  });

  it("rejects malformed allowlists before the scanner runs", async () => {
    await withTempDir(async (directory) => {
      const allowlistPath = path.join(directory, "allowlist.json");
      await writeFile(allowlistPath, JSON.stringify({ allowedVulnerabilities: [{ id: "GHSA-no-expiry" }] }));

      await expect(loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).rejects.toThrow(
        "expiresOn",
      );
    });
  });

  it("rejects expired allowlists before the scanner runs", async () => {
    await withTempDir(async (directory) => {
      const allowlistPath = path.join(directory, "allowlist.json");
      await writeFile(
        allowlistPath,
        JSON.stringify({
          allowedVulnerabilities: [
            {
              id: "GHSA-expired",
              packageName: "left-pad",
              ecosystem: "npm",
              reason: "synthetic fixture",
              expiresOn: "2026-07-15",
            },
          ],
        }),
      );

      await expect(loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).rejects.toThrow(
        "expired",
      );
    });
  });
});

describe("advisory scan gate", () => {
  it("passes a clean OSV result and records the outgoing scanner invocation", async () => {
    await withTempDir(async (directory) => {
      const calls: Array<{ command: string; args: string[] }> = [];
      const runner: CommandRunner = async (command, args) => {
        calls.push({ command, args });
        await writeFile(path.join(directory, "osv.json"), cleanScannerJson());
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));
      const result = await runAdvisoryScan({
        allowlistPath: path.join(directory, "allowlist.json"),
        outputPath: path.join(directory, "osv.json"),
        runner,
        scannerPath: "/tmp/osv-scanner",
        now: new Date("2026-07-16T00:00:00Z"),
      });

      expect(result.ok).toBe(true);
      expect(result.actionableVulnerabilities).toEqual([]);
      expect(calls).toEqual([
        {
          command: "/tmp/osv-scanner",
          args: ["scan", "--lockfile=pnpm-lock.yaml", "--format=json", `--output-file=${path.join(directory, "osv.json")}`],
        },
      ]);
    });
  });

  it("fails closed on scanner/network errors", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = vi.fn(async () => ({ exitCode: 127, stdout: "", stderr: "dial tcp timeout" }));
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      await expect(
        runAdvisoryScan({
          allowlistPath: path.join(directory, "allowlist.json"),
          outputPath: path.join(directory, "osv.json"),
          runner,
          scannerPath: "/tmp/osv-scanner",
          now: new Date("2026-07-16T00:00:00Z"),
        }),
      ).rejects.toThrow("OSV-Scanner failed closed");
    });
  });

  it("fails actionable vulnerabilities not covered by an unexpired allowlist", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(path.join(directory, "osv.json"), vulnerableScannerJson());
        return { exitCode: 1, stdout: "", stderr: "" };
      };
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      const result = await runAdvisoryScan({
        allowlistPath: path.join(directory, "allowlist.json"),
        outputPath: path.join(directory, "osv.json"),
        runner,
        scannerPath: "/tmp/osv-scanner",
        now: new Date("2026-07-16T00:00:00Z"),
      });

      expect(result.ok).toBe(false);
      expect(result.actionableVulnerabilities).toEqual([
        expect.objectContaining({
          id: "GHSA-test-vuln",
          packageName: "left-pad",
          source: "pnpm-lock.yaml",
        }),
      ]);
    });
  });
});
