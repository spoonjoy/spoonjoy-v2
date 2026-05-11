import { describe, expect, it, vi } from "vitest";
import {
  checkRemoteMigrations,
  createWranglerRunner,
  runDeploymentPreflight,
  validateDeploymentConfig,
  type DeploymentPreflightInputs,
} from "../../scripts/deployment-preflight";

function validInputs(): DeploymentPreflightInputs {
  return {
    wrangler: {
      name: "spoonjoy-v2",
      main: "./workers/app.ts",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "./build/client" },
      d1_databases: [{ binding: "DB", database_name: "spoonjoy", database_id: "database-id" }],
      r2_buckets: [{ binding: "PHOTOS", bucket_name: "spoonjoy-photos" }],
      vars: { NODE_ENV: "production" },
    },
    packageJson: {
      scripts: {
        build: "react-router build",
        deploy: "pnpm deploy:preflight && pnpm build && pnpm exec wrangler deploy",
        "deploy:auto":
          "pnpm deploy:preflight && pnpm build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy",
        "deploy:preflight": "tsx scripts/deployment-preflight.ts",
        typecheck: "react-router typegen && tsc",
        "test:coverage": "vitest run --coverage",
        "test:e2e": "env -u FORCE_COLOR -u NO_COLOR playwright test",
        "db:seed": "pnpm exec tsx prisma/seed.ts",
      },
    },
    cloudflareEnvDts: "DB?: D1Database; PHOTOS?: R2Bucket; SESSION_SECRET?: string; OPENAI_API_KEY?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; APPLE_CLIENT_ID?: string; APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_PRIVATE_KEY?: string;",
    readme: "pnpm deploy:preflight wrangler d1 migrations apply DB --remote wrangler r2 bucket create spoonjoy-photos wrangler secret put SESSION_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY OPENAI_API_KEY",
    deploymentDoc: "pnpm deploy:preflight wrangler d1 migrations apply DB --remote wrangler r2 bucket create spoonjoy-photos wrangler secret put SESSION_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY OPENAI_API_KEY",
    migrationFiles: ["0000_init.sql"],
  };
}

describe("deployment preflight", () => {
  it("passes against the current repository configuration", async () => {
    const result = await runDeploymentPreflight(process.cwd(), {
      runWrangler: async () => ({ stdout: "[]", stderr: "", exitCode: 0 }),
    });

    expect(result.errors).toEqual([]);
    expect(result.checks.every((item) => item.ok || item.severity === "warning")).toBe(true);
    expect(result.checks.map((item) => item.name)).toContain("remote D1 migrations");
  });

  it("surfaces remote-migration failures as errors", async () => {
    const result = await runDeploymentPreflight(process.cwd(), {
      runWrangler: async () => ({
        stdout: '[{"Name":"0007_api_credentials.sql"}]',
        stderr: "",
        exitCode: 0,
      }),
    });

    expect(result.errors.map((item) => item.name)).toContain("remote D1 migrations");
  });

  it("surfaces remote-migration auth errors as warnings only", async () => {
    const result = await runDeploymentPreflight(process.cwd(), {
      runWrangler: async () => ({
        stdout: "",
        stderr: "Authentication error [code: 10000] please run wrangler login",
        exitCode: 1,
      }),
    });

    const errorNames = result.errors.map((item) => item.name);
    const warningNames = result.warnings.map((item) => item.name);
    expect(errorNames).not.toContain("remote D1 migrations");
    expect(warningNames).toContain("remote D1 migrations");
  });

  it("uses createWranglerRunner by default when no runWrangler dep is provided", async () => {
    const originalSkip = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
    try {
      const result = await runDeploymentPreflight(process.cwd());
      const remoteCheck = result.checks.find((item) => item.name === "remote D1 migrations");
      expect(remoteCheck).toBeDefined();
      expect(remoteCheck!.ok).toBe(true);
      expect(remoteCheck!.severity).toBe("warning");
    } finally {
      if (originalSkip === undefined) {
        delete process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
      } else {
        process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = originalSkip;
      }
    }
  });

  it("flags missing production-critical bindings and docs", () => {
    const inputs = validInputs();
    inputs.wrangler.r2_buckets = [];
    inputs.cloudflareEnvDts = "DB?: D1Database;";
    inputs.readme = "pnpm deploy:preflight";
    inputs.deploymentDoc = "wrangler d1 migrations apply DB --remote";

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["R2 photos binding", "Cloudflare Env typing", "secret documentation", "deployment commands"])
    );
  });

  it("requires deploy:auto in REQUIRED_PACKAGE_SCRIPTS", () => {
    const inputs = validInputs();
    delete (inputs.packageJson.scripts as Record<string, string>)["deploy:auto"];

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("package scripts");
  });

  it("reports NODE_ENV as a warning instead of a hard failure", () => {
    const inputs = validInputs();
    inputs.wrangler.vars = { NODE_ENV: "development" };

    const result = validateDeploymentConfig(inputs);

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((item) => item.name)).toContain("production node env");
  });
});

describe("checkRemoteMigrations", () => {
  it("returns PASS when remote D1 reports no pending migrations", async () => {
    const runWrangler = vi.fn(async () => ({ stdout: "[]", stderr: "", exitCode: 0 }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.name).toBe("remote D1 migrations");
    expect(check.ok).toBe(true);
    expect(check.severity).toBe("error");
    expect(check.message.toLowerCase()).toMatch(/up to date|no pending/);
    expect(runWrangler).toHaveBeenCalledTimes(1);
    expect(runWrangler).toHaveBeenCalledWith([
      "d1",
      "migrations",
      "list",
      "DB",
      "--remote",
      "--json",
    ]);
  });

  it("FAILS when one migration is pending and includes its name in the message", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: '[{"Name":"0007_api_credentials.sql"}]',
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("0007_api_credentials.sql");
  });

  it("FAILS and lists every pending migration name", async () => {
    const stdout = JSON.stringify([
      { Name: "0005_a.sql" },
      { Name: "0006_b.sql" },
      { Name: "0007_c.sql" },
    ]);
    const runWrangler = vi.fn(async () => ({ stdout, stderr: "", exitCode: 0 }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("0005_a.sql");
    expect(check.message).toContain("0006_b.sql");
    expect(check.message).toContain("0007_c.sql");
  });

  it("WARNS instead of failing when wrangler emits an auth-keyed stderr with non-zero exit", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "",
      stderr: "Authentication error [code: 10000] — did you forget to run `wrangler login`?",
      exitCode: 1,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.message.toLowerCase()).toMatch(/auth|login/);
  });

  it("WARNS when wrangler reports it needs a non-interactive API token", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "",
      stderr:
        "In a non-interactive environment, it's necessary that you specify a Cloudflare API token...",
      exitCode: 1,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.message.toLowerCase()).toMatch(/auth|api token|login|unauthenticated/);
  });

  it("FAILS with a parse-error message when stdout is not valid JSON", async () => {
    const runWrangler = vi.fn(async () => ({ stdout: "not json", stderr: "", exitCode: 0 }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message.toLowerCase()).toContain("parse");
  });

  it("FAILS with a shape-error message when JSON is a top-level object instead of an array", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: '{"migrations":[]}',
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message.toLowerCase()).toMatch(/shape|schema|unexpected/);
  });

  it("FAILS with a shape-error message when JSON is an array of strings", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: '["0007.sql"]',
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message.toLowerCase()).toMatch(/shape|schema|unexpected/);
  });

  it("FAILS with a shape-error message when JSON objects use lowercase name instead of Name", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: '[{"name":"0007.sql"}]',
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message.toLowerCase()).toMatch(/shape|schema|unexpected/);
  });

  it("FAILS with a clear message when wrangler exits non-zero without an auth-keyed stderr", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "",
      stderr: "Internal error: database unavailable",
      exitCode: 2,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("Internal error: database unavailable");
  });

  it("FAILS when the runWrangler promise rejects (spawn/binary error)", async () => {
    const runWrangler = vi.fn(async () => {
      throw new Error("ENOENT: wrangler not found");
    });

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("ENOENT");
  });

  it("FAILS with a string representation when runWrangler rejects with a non-Error value", async () => {
    const runWrangler = vi.fn(async () => {
      throw "some string failure";
    });

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("some string failure");
  });

  it("FAILS with a string representation when JSON.parse throws a non-Error", async () => {
    const runWrangler = vi.fn(async () => ({ stdout: "definitely not json", stderr: "", exitCode: 0 }));
    const originalParse = JSON.parse;
    const spy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "weird non-error";
    });

    try {
      const check = await checkRemoteMigrations({ runWrangler, env: {} });
      expect(check.ok).toBe(false);
      expect(check.severity).toBe("error");
      expect(check.message).toContain("weird non-error");
    } finally {
      spy.mockRestore();
      expect(JSON.parse).toBe(originalParse);
    }
  });

  it("returns a warning PASS when SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 even if the fake would have reported pending migrations", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: '[{"Name":"0007.sql"}]',
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({
      runWrangler,
      env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1" },
    });

    expect(check.ok).toBe(true);
    expect(check.severity).toBe("warning");
    expect(check.message).toContain("SPOONJOY_PREFLIGHT_SKIP_REMOTE");
    expect(runWrangler).not.toHaveBeenCalled();
  });

  it("falls back to process.env when no env is provided in deps", async () => {
    const runWrangler = vi.fn(async () => ({ stdout: "[]", stderr: "", exitCode: 0 }));
    const original = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
    try {
      const check = await checkRemoteMigrations({ runWrangler });
      expect(check.ok).toBe(true);
      expect(check.severity).toBe("warning");
      expect(runWrangler).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
      } else {
        process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = original;
      }
    }
  });
});

describe("deployment docs", () => {
  it("docs/deployment.md mentions pnpm deploy:auto", async () => {
    const fs = await import("node:fs/promises");
    const doc = await fs.readFile(`${process.cwd()}/docs/deployment.md`, "utf8");
    expect(doc).toContain("pnpm deploy:auto");
  });

  it("docs/deployment.md documents SPOONJOY_PREFLIGHT_SKIP_REMOTE", async () => {
    const fs = await import("node:fs/promises");
    const doc = await fs.readFile(`${process.cwd()}/docs/deployment.md`, "utf8");
    expect(doc).toContain("SPOONJOY_PREFLIGHT_SKIP_REMOTE");
  });

  it("DEPLOY.md mentions pnpm deploy:auto", async () => {
    const fs = await import("node:fs/promises");
    const doc = await fs.readFile(`${process.cwd()}/DEPLOY.md`, "utf8");
    expect(doc).toContain("pnpm deploy:auto");
  });

  it("DEPLOY.md documents SPOONJOY_PREFLIGHT_SKIP_REMOTE", async () => {
    const fs = await import("node:fs/promises");
    const doc = await fs.readFile(`${process.cwd()}/DEPLOY.md`, "utf8");
    expect(doc).toContain("SPOONJOY_PREFLIGHT_SKIP_REMOTE");
  });
});

describe("package.json deploy scripts", () => {
  it("deploy chains preflight then build then wrangler deploy via pnpm exec", async () => {
    const pkgRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/package.json`, "utf8"),
    );
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };

    expect(pkg.scripts.deploy).toBe(
      "pnpm deploy:preflight && pnpm build && pnpm exec wrangler deploy",
    );
  });

  it("deploy:auto chains preflight then build then migrate then deploy via pnpm exec in that order", async () => {
    const pkgRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/package.json`, "utf8"),
    );
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };

    expect(pkg.scripts["deploy:auto"]).toBe(
      "pnpm deploy:preflight && pnpm build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy",
    );
  });
});

describe("createWranglerRunner", () => {
  type Captured = {
    cmd: string;
    args: readonly string[];
    options: { cwd?: string; env?: NodeJS.ProcessEnv };
  };

  it("invokes the configured wrangler binary with pnpm exec and forwards args", async () => {
    let captured: Captured | null = null;
    const stub = vi.fn(
      (
        cmd: string,
        args: readonly string[],
        options: { cwd?: string; env?: NodeJS.ProcessEnv },
        callback: (
          error: (Error & { code?: number | string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        captured = { cmd, args, options };
        callback(null, "", "");
      },
    );

    const runner = createWranglerRunner(stub);
    await runner(["d1", "migrations", "list", "DB", "--remote", "--json"]);

    expect(stub).toHaveBeenCalledTimes(1);
    expect(captured).not.toBeNull();
    expect(captured!.cmd).toBe("pnpm");
    expect(Array.from(captured!.args)).toEqual([
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "list",
      "DB",
      "--remote",
      "--json",
    ]);
    expect(captured!.options).toEqual({});
  });

  it("resolves with stdout/stderr/exitCode when execFile callback signals success", async () => {
    const stub = vi.fn(
      (
        _cmd: string,
        _args: readonly string[],
        _options: { cwd?: string; env?: NodeJS.ProcessEnv },
        callback: (
          error: (Error & { code?: number | string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        callback(null, "stdoutbody", "");
      },
    );

    const runner = createWranglerRunner(stub);
    const result = await runner(["whoami"]);

    expect(result).toEqual({ stdout: "stdoutbody", stderr: "", exitCode: 0 });
  });

  it("resolves with non-zero exitCode and stderr when execFile callback signals a process error", async () => {
    const stub = vi.fn(
      (
        _cmd: string,
        _args: readonly string[],
        _options: { cwd?: string; env?: NodeJS.ProcessEnv },
        callback: (
          error: (Error & { code?: number | string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        const err = Object.assign(new Error("exit 1"), { code: 1 });
        callback(err, "", "stderrbody");
      },
    );

    const runner = createWranglerRunner(stub);
    const result = await runner(["d1", "migrations", "list", "DB", "--remote", "--json"]);

    expect(result).toEqual({ stdout: "", stderr: "stderrbody", exitCode: 1 });
  });

  it("rejects with the underlying error when execFile reports a spawn failure (no numeric exit code)", async () => {
    const stub = vi.fn(
      (
        _cmd: string,
        _args: readonly string[],
        _options: { cwd?: string; env?: NodeJS.ProcessEnv },
        callback: (
          error: (Error & { code?: number | string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        callback(err, "", "");
      },
    );

    const runner = createWranglerRunner(stub);

    await expect(runner(["d1"])).rejects.toThrow("ENOENT");
  });

  it("exposes a default factory that uses node:child_process execFile", () => {
    const runner = createWranglerRunner();
    expect(typeof runner).toBe("function");
  });
});
