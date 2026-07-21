import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  OSV_SCANNER,
  createAdvisoryScannerCommand,
  defaultCommandRunner,
  isCliEntry,
  loadAdvisoryAllowlist,
  runAdvisoryScan,
  runAdvisoryScanCli,
  runCliIfEntry,
  type CommandRunner,
} from "../../scripts/advisory-scan";
import { expectConsoleError } from "../warning-policy";

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

  it("rejects allowlists without the required top-level array", async () => {
    await withTempDir(async (directory) => {
      const allowlistPath = path.join(directory, "allowlist.json");
      await writeFile(allowlistPath, JSON.stringify({ policy: "missing array" }));

      await expect(loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).rejects.toThrow(
        "allowedVulnerabilities array",
      );
    });
  });

  it("rejects allowlists with invalid expiry dates", async () => {
    await withTempDir(async (directory) => {
      const allowlistPath = path.join(directory, "allowlist.json");
      await writeFile(
        allowlistPath,
        JSON.stringify({
          allowedVulnerabilities: [
            {
              id: "GHSA-bad-date",
              packageName: "left-pad",
              version: "1.1.1",
              ecosystem: "npm",
              reason: "synthetic fixture",
              expiresOn: "20260716",
            },
          ],
        }),
      );

      await expect(loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).rejects.toThrow(
        "YYYY-MM-DD",
      );
    });
  });

  it("rejects impossible expiry dates", async () => {
    for (const expiresOn of ["2026-99-99", "2026-02-30"]) {
      await withTempDir(async (directory) => {
        const allowlistPath = path.join(directory, "allowlist.json");
        await writeFile(
          allowlistPath,
          JSON.stringify({
            allowedVulnerabilities: [
              {
                id: "GHSA-impossible-date",
                packageName: "left-pad",
                version: "1.1.1",
                ecosystem: "npm",
                reason: "synthetic fixture",
                expiresOn,
              },
            ],
          }),
        );

        await expect(loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).rejects.toThrow(
          "valid date",
        );
      });
    }
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
              version: "1.1.1",
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

  it("rejects non-object allowlist entries", async () => {
    await withTempDir(async (directory) => {
      const allowlistPath = path.join(directory, "allowlist.json");
      await writeFile(allowlistPath, JSON.stringify({ allowedVulnerabilities: [null] }));

      await expect(loadAdvisoryAllowlist(allowlistPath, new Date("2026-07-16T00:00:00Z"))).rejects.toThrow(
        "must be an object",
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

  it("creates the scanner output directory before invoking OSV", async () => {
    await withTempDir(async (directory) => {
      const outputPath = path.join(directory, "nested", "osv.json");
      const calls: Array<{ outputDirectoryExists: boolean }> = [];
      const runner: CommandRunner = async () => {
        calls.push({ outputDirectoryExists: existsSync(path.dirname(outputPath)) });
        await writeFile(outputPath, cleanScannerJson());
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));
      await runAdvisoryScan({
        allowlistPath: path.join(directory, "allowlist.json"),
        outputPath,
        runner,
        scannerPath: "/tmp/osv-scanner",
        now: new Date("2026-07-16T00:00:00Z"),
      });

      expect(calls).toEqual([{ outputDirectoryExists: true }]);
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

  it("fails closed when scanner errors without diagnostic output", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = vi.fn(async () => ({ exitCode: 129, stdout: "", stderr: "" }));
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      await expect(
        runAdvisoryScan({
          allowlistPath: path.join(directory, "allowlist.json"),
          outputPath: path.join(directory, "osv.json"),
          runner,
          scannerPath: "/tmp/osv-scanner",
          now: new Date("2026-07-16T00:00:00Z"),
        }),
      ).rejects.toThrow("no scanner output");
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

  it("passes vulnerabilities covered by an exact unexpired allowlist entry", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(path.join(directory, "osv.json"), vulnerableScannerJson());
        return { exitCode: 1, stdout: "", stderr: "" };
      };
      await writeFile(
        path.join(directory, "allowlist.json"),
        JSON.stringify({
          allowedVulnerabilities: [
            {
              id: "CVE-2099-0001",
              packageName: "left-pad",
              version: "1.1.1",
              ecosystem: "npm",
              reason: "synthetic fixture does not ship",
              expiresOn: "2026-07-17",
            },
          ],
        }),
      );

      const result = await runAdvisoryScan({
        allowlistPath: path.join(directory, "allowlist.json"),
        outputPath: path.join(directory, "osv.json"),
        runner,
        scannerPath: "/tmp/osv-scanner",
        now: new Date("2026-07-16T00:00:00Z"),
      });

      expect(result.ok).toBe(true);
      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.actionableVulnerabilities).toEqual([]);
    });
  });

  it("fails closed when OSV exits with findings but writes no finding records", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(path.join(directory, "osv.json"), cleanScannerJson());
        return { exitCode: 1, stdout: "", stderr: "" };
      };
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

  it("fails closed on malformed OSV JSON", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(path.join(directory, "osv.json"), "{");
        return { exitCode: 0, stdout: "", stderr: "" };
      };
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      await expect(
        runAdvisoryScan({
          allowlistPath: path.join(directory, "allowlist.json"),
          outputPath: path.join(directory, "osv.json"),
          runner,
          scannerPath: "/tmp/osv-scanner",
          now: new Date("2026-07-16T00:00:00Z"),
        }),
      ).rejects.toThrow("Invalid JSON");
    });
  });

  it("fails closed on structurally invalid OSV output", async () => {
    const malformedReports = [
      { label: "missing results", report: { ignored: true }, message: ".results must be an array" },
      { label: "non-object result", report: { results: [null] }, message: "results[0] must be an object" },
      { label: "missing source", report: { results: [{ packages: [] }] }, message: "results[0].source must be an object" },
      {
        label: "missing packages",
        report: { results: [{ source: { path: "pnpm-lock.yaml" } }] },
        message: "results[0].packages must be an array",
      },
      {
        label: "non-object package result",
        report: { results: [{ source: { path: "pnpm-lock.yaml" }, packages: [null] }] },
        message: "results[0].packages[0] must be an object",
      },
      {
        label: "missing package",
        report: { results: [{ source: { path: "pnpm-lock.yaml" }, packages: [{ vulnerabilities: [] }] }] },
        message: "results[0].packages[0].package must be an object",
      },
      {
        label: "missing package version",
        report: {
          results: [
            {
              source: { path: "pnpm-lock.yaml" },
              packages: [{ package: { name: "left-pad", ecosystem: "npm" }, vulnerabilities: [] }],
            },
          ],
        },
        message: "results[0].packages[0].package.version is required",
      },
      {
        label: "missing vulnerabilities",
        report: {
          results: [
            {
              source: { path: "pnpm-lock.yaml" },
              packages: [{ package: { name: "left-pad", version: "1.1.1", ecosystem: "npm" } }],
            },
          ],
        },
        message: "results[0].packages[0].vulnerabilities must be an array",
      },
      {
        label: "non-object vulnerability",
        report: {
          results: [
            {
              source: { path: "pnpm-lock.yaml" },
              packages: [
                { package: { name: "left-pad", version: "1.1.1", ecosystem: "npm" }, vulnerabilities: [null] },
              ],
            },
          ],
        },
        message: "results[0].packages[0].vulnerabilities[0] must be an object",
      },
      {
        label: "missing vulnerability id",
        report: {
          results: [
            {
              source: { path: "pnpm-lock.yaml" },
              packages: [
                { package: { name: "left-pad", version: "1.1.1", ecosystem: "npm" }, vulnerabilities: [{}] },
              ],
            },
          ],
        },
        message: "results[0].packages[0].vulnerabilities[0].id is required",
      },
    ];

    for (const { label, message, report } of malformedReports) {
      await withTempDir(async (directory) => {
        const runner: CommandRunner = async () => {
          await writeFile(path.join(directory, "osv.json"), JSON.stringify(report));
          return { exitCode: 0, stdout: "", stderr: "" };
        };
        await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

        await expect(
          runAdvisoryScan({
            allowlistPath: path.join(directory, "allowlist.json"),
            outputPath: path.join(directory, "osv.json"),
            runner,
            scannerPath: "/tmp/osv-scanner",
            now: new Date("2026-07-16T00:00:00Z"),
          }),
          label,
        ).rejects.toThrow(message);
      });
    }
  });

  it("normalizes optional alias, summary, and severity fields", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(
          path.join(directory, "osv.json"),
          JSON.stringify({
            results: [
              {
                source: { path: "pnpm-lock.yaml" },
                packages: [
                  {
                    package: { name: "left-pad", version: "1.1.1", ecosystem: "npm" },
                    vulnerabilities: [
                      {
                        id: "GHSA-optional-fields",
                        severity: [null, { score: 9 }],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        );
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

      expect(result.vulnerabilities).toEqual([
        {
          id: "GHSA-optional-fields",
          aliases: [],
          packageName: "left-pad",
          version: "1.1.1",
          ecosystem: "npm",
          source: "pnpm-lock.yaml",
          severity: "unknown",
          summary: "",
        },
      ]);
    });
  });

  it("marks vulnerabilities without severity arrays as unknown severity", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(
          path.join(directory, "osv.json"),
          JSON.stringify({
            results: [
              {
                source: { path: "pnpm-lock.yaml" },
                packages: [
                  {
                    package: { name: "left-pad", version: "1.1.1", ecosystem: "npm" },
                    vulnerabilities: [{ id: "GHSA-no-severity" }],
                  },
                ],
              },
            ],
          }),
        );
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

      expect(result.vulnerabilities[0]?.severity).toBe("unknown");
    });
  });
});

describe("advisory scan CLI", () => {
  it("returns success for clean findings", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(path.join(directory, "osv.json"), cleanScannerJson());
        return { exitCode: 0, stdout: "", stderr: "" };
      };
      const messages: string[] = [];
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      const exitCode = await runAdvisoryScanCli(
        [
          "--scanner",
          "/tmp/osv-scanner",
          "--allowlist",
          path.join(directory, "allowlist.json"),
          "--output",
          path.join(directory, "osv.json"),
        ],
        runner,
        { error: (message) => messages.push(String(message)), log: (message) => messages.push(String(message)) },
        new Date("2026-07-16T00:00:00Z"),
      );

      expect(exitCode).toBe(0);
      expect(messages.join("\n")).toContain("Advisory scan passed");
    });
  });

  it("returns a failing status for actionable findings", async () => {
    await withTempDir(async (directory) => {
      const runner: CommandRunner = async () => {
        await writeFile(path.join(directory, "osv.json"), vulnerableScannerJson());
        return { exitCode: 1, stdout: "", stderr: "" };
      };
      const messages: string[] = [];
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      const exitCode = await runAdvisoryScanCli(
        [
          "--scanner",
          "/tmp/osv-scanner",
          "--allowlist",
          path.join(directory, "allowlist.json"),
          "--output",
          path.join(directory, "osv.json"),
        ],
        runner,
        { error: (message) => messages.push(message), log: (message) => messages.push(message) },
        new Date("2026-07-16T00:00:00Z"),
      );

      expect(exitCode).toBe(1);
      expect(messages.join("\n")).toContain("GHSA-test-vuln");
    });
  });

  it("returns failure for invalid CLI arguments", async () => {
    const messages: string[] = [];

    const exitCode = await runAdvisoryScanCli(
      ["--scanner"],
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      { error: (message) => messages.push(String(message)), log: (message) => messages.push(String(message)) },
      new Date("2026-07-16T00:00:00Z"),
    );

    expect(exitCode).toBe(1);
    expect(messages.join("\n")).toContain("Missing value for --scanner");
  });

  it("stringifies non-error CLI failures", async () => {
    await withTempDir(async (directory) => {
      const messages: string[] = [];
      await writeFile(path.join(directory, "allowlist.json"), JSON.stringify({ allowedVulnerabilities: [] }));

      const exitCode = await runAdvisoryScanCli(
        [
          "--scanner",
          "/tmp/osv-scanner",
          "--allowlist",
          path.join(directory, "allowlist.json"),
          "--output",
          path.join(directory, "osv.json"),
        ],
        async () => {
          throw "synthetic boom";
        },
        { error: (message) => messages.push(String(message)), log: (message) => messages.push(String(message)) },
        new Date("2026-07-16T00:00:00Z"),
      );

      expect(exitCode).toBe(1);
      expect(messages).toEqual(["synthetic boom"]);
    });
  });
});

describe("advisory scan process adapter", () => {
  it("captures stdout and zero exit status from the scanner process", async () => {
    await expect(defaultCommandRunner(process.execPath, ["-e", "process.stdout.write('ok')"])).resolves.toEqual({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
  });

  it("captures nonzero scanner process failures", async () => {
    const result = await defaultCommandRunner(process.execPath, [
      "-e",
      "process.stderr.write('network down'); process.exit(127)",
    ]);

    expect(result).toEqual({ exitCode: 127, stdout: "", stderr: "network down" });
  });

  it("normalizes command launch failures to scanner errors", async () => {
    const result = await defaultCommandRunner("/tmp/spoonjoy-missing-osv-scanner", []);

    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("spawn /tmp/spoonjoy-missing-osv-scanner");
  });
});

describe("advisory scan entrypoint", () => {
  it("detects the direct CLI module path", () => {
    const modulePath = path.join(process.cwd(), "scripts/advisory-scan.ts");

    expect(isCliEntry(undefined, pathToFileURL(modulePath).href)).toBe(false);
    expect(isCliEntry(modulePath, pathToFileURL(modulePath).href)).toBe(true);
  });

  it("runs only when invoked as the entry module", async () => {
    const modulePath = path.join(process.cwd(), "scripts/advisory-scan.ts");
    const exitCodes: number[] = [];

    expect(runCliIfEntry({ argv1: path.join(process.cwd(), "other.ts"), moduleUrl: pathToFileURL(modulePath).href })).toBe(
      false,
    );
    expect(
      runCliIfEntry({
        argv1: modulePath,
        moduleUrl: pathToFileURL(modulePath).href,
        argv: ["--scanner", "/tmp/osv-scanner"],
        runCli: async () => 17,
        setExitCode: (exitCode) => exitCodes.push(exitCode),
      }),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exitCodes).toEqual([17]);
  });

  it("uses the real CLI defaults when no entrypoint dependencies are injected", async () => {
    const modulePath = path.join(process.cwd(), "scripts/advisory-scan.ts");
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = [originalArgv[0] ?? "node", modulePath, "--scanner"];
    process.exitCode = undefined;
    expectConsoleError("Error: Missing value for --scanner");
    try {
      expect(runCliIfEntry({ argv1: modulePath, moduleUrl: pathToFileURL(modulePath).href })).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });
});
