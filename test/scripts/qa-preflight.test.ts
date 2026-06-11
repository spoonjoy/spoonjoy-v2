import { describe, expect, it, vi } from "vitest";
import {
  QA_BASE_URL,
  QA_ENV_NAME,
  QA_R2_BUCKET,
  REQUIRED_QA_SECRETS,
  buildQaMigrationListArgs,
  buildQaR2DeleteArgs,
  buildQaR2GetArgs,
  buildQaR2PutArgs,
  buildQaSecretListArgs,
  parseWranglerSecretNames,
  runQaPreflight,
} from "../../scripts/qa-preflight";

function secretListStdout(names = REQUIRED_QA_SECRETS): string {
  return JSON.stringify(names.map((name) => ({ name, type: "secret_text" })));
}

describe("qa-preflight command builders", () => {
  it("targets QA for D1 migration checks", () => {
    expect(buildQaMigrationListArgs()).toEqual([
      "d1",
      "migrations",
      "list",
      "DB",
      "--remote",
      "--env",
      QA_ENV_NAME,
    ]);
  });

  it("targets QA for Worker secret checks", () => {
    expect(buildQaSecretListArgs()).toEqual(["secret", "list", "--env", QA_ENV_NAME]);
  });

  it("targets the QA bucket for R2 object checks", () => {
    expect(buildQaR2PutArgs("preflight/probe.txt", "/tmp/probe.txt")).toEqual([
      "r2",
      "object",
      "put",
      `${QA_R2_BUCKET}/preflight/probe.txt`,
      "--remote",
      "--file",
      "/tmp/probe.txt",
    ]);
    expect(buildQaR2GetArgs("preflight/probe.txt")).toEqual([
      "r2",
      "object",
      "get",
      `${QA_R2_BUCKET}/preflight/probe.txt`,
      "--remote",
      "--pipe",
    ]);
    expect(buildQaR2DeleteArgs("preflight/probe.txt")).toEqual([
      "r2",
      "object",
      "delete",
      `${QA_R2_BUCKET}/preflight/probe.txt`,
      "--remote",
      "--force",
    ]);
  });
});

describe("parseWranglerSecretNames", () => {
  it("parses current Wrangler JSON output even when banners precede it", () => {
    expect(parseWranglerSecretNames(`\n ⛅️ wrangler\n${secretListStdout(["SESSION_SECRET"])}\n`)).toEqual([
      "SESSION_SECRET",
    ]);
  });

  it("returns a parse error for non-array output", () => {
    const parsed = parseWranglerSecretNames("{}");

    expect(parsed).toEqual({ error: expect.stringContaining("array") });
  });
});

describe("runQaPreflight", () => {
  it("passes static, migration, secret, and R2 checks against QA", async () => {
    const cleanup = vi.fn(async () => undefined);
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) {
        return { stdout: "[]", stderr: "", exitCode: 0 };
      }
      if (command === buildQaSecretListArgs().join(" ")) {
        return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      }
      if (command.startsWith("r2 object put")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("r2 object get")) {
        return { stdout: "spoonjoy qa preflight", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("r2 object delete")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup,
      }),
    });

    expect(result.errors).toEqual([]);
    expect(result.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(["QA static config", "QA D1 migrations", "QA secrets", "QA R2 round trip"]),
    );
    expect(runWrangler).toHaveBeenCalledWith(buildQaMigrationListArgs());
    expect(runWrangler).toHaveBeenCalledWith(buildQaSecretListArgs());
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("fails closed when QA secrets are missing", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) {
        return { stdout: "[]", stderr: "", exitCode: 0 };
      }
      if (command === buildQaSecretListArgs().join(" ")) {
        return { stdout: secretListStdout(["SESSION_SECRET"]), stderr: "", exitCode: 0 };
      }
      return { stdout: "spoonjoy qa preflight", stderr: "", exitCode: 0 };
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(result.errors.map((check) => check.name)).toContain("QA secrets");
    expect(result.errors.find((check) => check.name === "QA secrets")?.message).toContain("VAPID_PUBLIC_KEY");
  });

  it("warns instead of hard failing when Wrangler auth prevents remote checks", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "",
      stderr: "Authentication error [code: 10000] please run wrangler login",
      exitCode: 1,
    }));

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((check) => check.name)).toEqual(
      expect.arrayContaining(["QA D1 migrations", "QA secrets", "QA R2 round trip"]),
    );
  });

  it("deletes the R2 probe when the readback fails", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) {
        return { stdout: "[]", stderr: "", exitCode: 0 };
      }
      if (command === buildQaSecretListArgs().join(" ")) {
        return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      }
      if (command.startsWith("r2 object put")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("r2 object get")) {
        return { stdout: "wrong body", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("r2 object delete")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(result.errors.map((check) => check.name)).toContain("QA R2 round trip");
    expect(
      runWrangler.mock.calls.some(([args]) => {
        return (
          args[0] === "r2" &&
          args[1] === "object" &&
          args[2] === "delete" &&
          args[3].startsWith(`${QA_R2_BUCKET}/preflight/`) &&
          args.includes("--force")
        );
      }),
    ).toBe(true);
  });

  it("reports the QA base URL in the static check message", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: async () => ({ stdout: "", stderr: "Authentication error [code: 10000]", exitCode: 1 }),
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(result.checks.find((check) => check.name === "QA static config")?.message).toContain(QA_BASE_URL);
  });
});
