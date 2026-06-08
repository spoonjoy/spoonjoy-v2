import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  checkRemoteMigrations,
  createWranglerRunner,
  formatCheck,
  isCliEntry,
  main,
  runCliIfEntry,
  runDeploymentPreflight,
  validateDeploymentConfig,
  type CliIO,
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
        deploy: "pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler deploy",
        "deploy:auto":
          "SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm run deploy:preflight && pnpm exec wrangler deploy",
        "deploy:preflight": "tsx scripts/deployment-preflight.ts",
        typecheck: "react-router typegen && tsc",
        "test:coverage": "vitest run --coverage",
        "test:e2e": "env -u FORCE_COLOR -u NO_COLOR playwright test",
        "smoke:api": "node scripts/smoke-api-live.mjs",
        "db:seed": "pnpm exec tsx prisma/seed.ts",
      },
    },
    cloudflareEnvDts: "DB?: D1Database; PHOTOS?: R2Bucket; SESSION_SECRET?: string; OPENAI_API_KEY?: string; GOOGLE_API_KEY?: string; GEMINI_API_KEY?: string; GEMINI_IMAGE_MODEL?: string; GEMINI_IMAGE_TIMEOUT_MS?: string; IMAGE_PROVIDER_PRIMARY?: string; IMAGE_PROVIDER_FALLBACKS?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; APPLE_CLIENT_ID?: string; APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_PRIVATE_KEY?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; POSTHOG_KEY?: string; POSTHOG_HOST?: string; POSTHOG_DISABLED?: string;",
    readme: "pnpm run deploy:preflight wrangler d1 migrations apply DB --remote wrangler r2 bucket create spoonjoy-photos wrangler secret put SESSION_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY OPENAI_API_KEY GOOGLE_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT GEMINI_API_KEY GEMINI_IMAGE_MODEL GEMINI_IMAGE_TIMEOUT_MS gemini-3.1-flash-image IMAGE_PROVIDER_PRIMARY IMAGE_PROVIDER_FALLBACKS VITE_POSTHOG_KEY VITE_POSTHOG_HOST VITE_POSTHOG_DISABLED POSTHOG_KEY POSTHOG_HOST POSTHOG_DISABLED server lifecycle telemetry docs/analytics-privacy.md",
    deploymentDoc: "pnpm run deploy:preflight smoke:api wrangler d1 migrations apply DB --remote wrangler r2 bucket create spoonjoy-photos wrangler secret put SESSION_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY OPENAI_API_KEY GOOGLE_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT GEMINI_API_KEY GEMINI_IMAGE_MODEL GEMINI_IMAGE_TIMEOUT_MS gemini-3.1-flash-image IMAGE_PROVIDER_PRIMARY IMAGE_PROVIDER_FALLBACKS wrangler secret put POSTHOG_KEY VITE_POSTHOG_KEY VITE_POSTHOG_HOST VITE_POSTHOG_DISABLED POSTHOG_KEY POSTHOG_HOST POSTHOG_DISABLED server lifecycle telemetry",
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
    inputs.readme = "pnpm run deploy:preflight";
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

  it("requires deploy:auto to apply migrations before the full remote preflight", () => {
    const inputs = validInputs();
    (inputs.packageJson.scripts as Record<string, string>)["deploy:auto"] =
      "pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy";

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("deploy:auto script");
  });

  it("reports NODE_ENV as a warning instead of a hard failure", () => {
    const inputs = validInputs();
    inputs.wrangler.vars = { NODE_ENV: "development" };

    const result = validateDeploymentConfig(inputs);

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((item) => item.name)).toContain("production node env");
  });

  it("flags missing telemetry typing, documentation, and deployment commands", () => {
    const inputs = validInputs();
    inputs.cloudflareEnvDts = inputs.cloudflareEnvDts.replace(
      " POSTHOG_KEY?: string; POSTHOG_HOST?: string; POSTHOG_DISABLED?: string;",
      "",
    );
    inputs.readme = inputs.readme.replace(
      " VITE_POSTHOG_KEY VITE_POSTHOG_HOST VITE_POSTHOG_DISABLED POSTHOG_KEY POSTHOG_HOST POSTHOG_DISABLED server lifecycle telemetry docs/analytics-privacy.md",
      "",
    );
    inputs.deploymentDoc = inputs.deploymentDoc.replace(
      " wrangler secret put POSTHOG_KEY VITE_POSTHOG_KEY VITE_POSTHOG_HOST VITE_POSTHOG_DISABLED POSTHOG_KEY POSTHOG_HOST POSTHOG_DISABLED server lifecycle telemetry",
      "",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["telemetry env typing", "telemetry documentation", "telemetry deployment commands"]),
    );
  });

  it("flags missing image provider typing and documentation", () => {
    const inputs = validInputs();
    for (const name of [
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY",
      "GEMINI_IMAGE_MODEL",
      "GEMINI_IMAGE_TIMEOUT_MS",
      "IMAGE_PROVIDER_PRIMARY",
      "IMAGE_PROVIDER_FALLBACKS",
    ]) {
      inputs.cloudflareEnvDts = inputs.cloudflareEnvDts.replace(` ${name}?: string;`, "");
      inputs.readme = inputs.readme.replace(` ${name}`, "");
      inputs.deploymentDoc = inputs.deploymentDoc.replace(` ${name}`, "");
    }
    inputs.readme = inputs.readme.replace(" gemini-3.1-flash-image", "");
    inputs.deploymentDoc = inputs.deploymentDoc.replace(" gemini-3.1-flash-image", "");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Cloudflare Env typing", "image provider documentation"]),
    );
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
    ]);
  });

  it("returns PASS when current Wrangler text output reports no pending migrations", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "\n ⛅️ wrangler 4.90.0\n─────────────────────────────────────────────\nResource location: remote \n\n✅ No migrations to apply!\n",
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(true);
    expect(check.message.toLowerCase()).toMatch(/up to date|no pending/);
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

  it("FAILS and lists pending migration names from current Wrangler text output", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: [
        " ⛅️ wrangler 4.90.0",
        "Resource location: remote",
        "Pending migrations:",
        "│ 0007_api_credentials.sql │",
        "│ 0008_s1_spoon_foundation.sql │",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("0007_api_credentials.sql");
    expect(check.message).toContain("0008_s1_spoon_foundation.sql");
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

  it("FAILS with a parse-error message when stdout is neither JSON nor current Wrangler text", async () => {
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
    const runWrangler = vi.fn(async () => ({ stdout: "[malformed json", stderr: "", exitCode: 0 }));
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
    const doc = await readFile(`${process.cwd()}/docs/deployment.md`, "utf8");
    expect(doc).toContain("pnpm deploy:auto");
  });

  it("docs/deployment.md documents SPOONJOY_PREFLIGHT_SKIP_REMOTE", async () => {
    const doc = await readFile(`${process.cwd()}/docs/deployment.md`, "utf8");
    expect(doc).toContain("SPOONJOY_PREFLIGHT_SKIP_REMOTE");
  });

  it("DEPLOY.md mentions pnpm deploy:auto", async () => {
    const doc = await readFile(`${process.cwd()}/DEPLOY.md`, "utf8");
    expect(doc).toContain("pnpm deploy:auto");
  });

  it("DEPLOY.md documents SPOONJOY_PREFLIGHT_SKIP_REMOTE", async () => {
    const doc = await readFile(`${process.cwd()}/DEPLOY.md`, "utf8");
    expect(doc).toContain("SPOONJOY_PREFLIGHT_SKIP_REMOTE");
  });

  it("documents the full PostHog client and server telemetry setup", async () => {
    const [analyticsDoc, readme, deployDoc, envExample, cloudflareEnvDts] = await Promise.all([
      readFile(`${process.cwd()}/docs/analytics-privacy.md`, "utf8"),
      readFile(`${process.cwd()}/README.md`, "utf8"),
      readFile(`${process.cwd()}/DEPLOY.md`, "utf8"),
      readFile(`${process.cwd()}/.env.example`, "utf8"),
      readFile(`${process.cwd()}/app/cloudflare-env.d.ts`, "utf8"),
    ]);

    const eventNames = [
      "spoonjoy.api_v1.request",
      "spoonjoy.legacy_api.request",
      "spoonjoy.mcp.request",
      "spoonjoy.oauth.register",
      "spoonjoy.oauth.authorize",
      "spoonjoy.oauth.token",
      "spoonjoy.oauth.revoke",
      "spoonjoy.developer.docs.viewed",
      "spoonjoy.developer.playground.request_submitted",
      "spoonjoy.developer.playground.response_received",
    ];
    for (const eventName of eventNames) {
      expect(analyticsDoc).toContain(eventName);
    }

    for (const unsafePayload of ["request bodies", "response bodies", "cookies", "headers", "query strings"]) {
      expect(analyticsDoc).toContain(unsafePayload);
    }

    for (const envName of [
      "VITE_POSTHOG_KEY",
      "VITE_POSTHOG_HOST",
      "VITE_POSTHOG_DISABLED",
      "POSTHOG_KEY",
      "POSTHOG_HOST",
      "POSTHOG_DISABLED",
    ]) {
      expect(analyticsDoc).toContain(envName);
      expect(envExample).toContain(envName);
    }

    expect(envExample).toMatch(/^VITE_POSTHOG_KEY=""$/m);
    expect(envExample).toMatch(/^VITE_POSTHOG_DISABLED=""$/m);
    expect(envExample).toMatch(/^POSTHOG_KEY=""$/m);
    expect(envExample).toMatch(/^POSTHOG_DISABLED=""$/m);
    expect(envExample).not.toMatch(/(?:VITE_)?POSTHOG_KEY="(?:phc|phx|sj|sk)_[^"]+"/);

    expect(readme).toContain("POSTHOG_KEY");
    expect(readme).toContain("POSTHOG_DISABLED");
    expect(readme).toContain("server lifecycle telemetry");
    expect(deployDoc).toContain("wrangler secret put POSTHOG_KEY");
    expect(deployDoc).toContain("VITE_POSTHOG_KEY");
    expect(deployDoc).toContain("POSTHOG_DISABLED");
    expect(deployDoc).not.toContain("wrangler secret put VITE_POSTHOG_KEY");
    expect(deployDoc).not.toContain("wrangler secret put VITE_POSTHOG_HOST");
    expect(deployDoc).not.toContain("wrangler secret put VITE_POSTHOG_DISABLED");
    const secretsSummary = deployDoc.slice(
      deployDoc.indexOf("### Secrets (set via `wrangler secret put`)"),
      deployDoc.indexOf("### Optional Worker telemetry variables"),
    );
    const publicBuildTimeSummary = deployDoc.slice(deployDoc.indexOf("### Public build-time variables"));
    expect(secretsSummary).toContain("POSTHOG_KEY");
    expect(secretsSummary).not.toContain("VITE_POSTHOG_KEY");
    expect(secretsSummary).not.toContain("VITE_POSTHOG_HOST");
    expect(secretsSummary).not.toContain("VITE_POSTHOG_DISABLED");
    expect(publicBuildTimeSummary).toContain("VITE_POSTHOG_KEY");
    expect(publicBuildTimeSummary).toContain("VITE_POSTHOG_HOST");
    expect(publicBuildTimeSummary).toContain("VITE_POSTHOG_DISABLED");
    expect(cloudflareEnvDts).toContain("POSTHOG_KEY?: string;");
    expect(cloudflareEnvDts).toContain("POSTHOG_HOST?: string;");
    expect(cloudflareEnvDts).toContain("POSTHOG_DISABLED?: string;");
  });
});

describe("package.json deploy scripts", () => {
  it("deploy chains preflight then build then wrangler deploy via pnpm exec", async () => {
    const pkgRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/package.json`, "utf8"),
    );
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };

    expect(pkg.scripts.deploy).toBe(
      "pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler deploy",
    );
  });

  it("deploy:auto skips only the first remote preflight, then builds, migrates, fully preflights, and deploys", async () => {
    const pkgRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/package.json`, "utf8"),
    );
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };

    expect(pkg.scripts["deploy:auto"]).toBe(
      "SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm run deploy:preflight && pnpm exec wrangler deploy",
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
    await runner(["d1", "migrations", "list", "DB", "--remote"]);

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
    const result = await runner(["d1", "migrations", "list", "DB", "--remote"]);

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

describe("formatCheck", () => {
  it("prefixes passing checks with PASS", () => {
    expect(
      formatCheck({ name: "x", ok: true, severity: "error", message: "ok" }),
    ).toBe("PASS x: ok");
  });

  it("prefixes warning checks with WARN", () => {
    expect(
      formatCheck({ name: "x", ok: false, severity: "warning", message: "soft" }),
    ).toBe("WARN x: soft");
  });

  it("prefixes failing error checks with FAIL", () => {
    expect(
      formatCheck({ name: "x", ok: false, severity: "error", message: "bad" }),
    ).toBe("FAIL x: bad");
  });
});

function makeIO(): { io: CliIO; logs: string[]; errors: string[]; exits: number[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const io: CliIO = {
    log: (m) => {
      logs.push(m);
    },
    error: (m) => {
      errors.push(m);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  return { io, logs, errors, exits };
}

describe("main (CLI entrypoint)", () => {
  it("prints WARN line and a passed-with-warnings summary when wrangler reports an auth-keyed soft failure", async () => {
    const { io, logs, errors, exits } = makeIO();

    await main({
      io,
      runWrangler: async () => ({
        stdout: "",
        stderr: "Authentication error: please run wrangler login",
        exitCode: 1,
      }),
      env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "0" },
    });

    expect(exits).toEqual([]);
    expect(errors).toEqual([]);
    expect(logs.some((line) => line.startsWith("PASS"))).toBe(true);
    expect(logs.some((line) => line.startsWith("WARN"))).toBe(true);
    expect(logs[logs.length - 1]).toBe("Deployment preflight passed with 1 warning(s).");
  });

  it("prints a passed summary without warning suffix when everything is OK", async () => {
    const { io, logs, exits, errors } = makeIO();

    await main({
      io,
      runWrangler: async () => ({ stdout: "[]", stderr: "", exitCode: 0 }),
      env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "0" },
    });

    expect(exits).toEqual([]);
    expect(errors).toEqual([]);
    expect(logs[logs.length - 1]).toBe("Deployment preflight passed.");
  });

  it("calls io.error and io.exit(1) when there is a hard failure", async () => {
    const { io, errors, exits, logs } = makeIO();

    await main({
      io,
      runWrangler: async () => ({
        stdout: '[{"Name":"0007.sql"}]',
        stderr: "",
        exitCode: 0,
      }),
      env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "0" },
    });

    expect(exits).toEqual([1]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Deployment preflight failed with \d+ error\(s\)\./);
    expect(logs.some((line) => line.startsWith("FAIL"))).toBe(true);
  });

  it("uses real console.log/console.error/process.exit when io is not injected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 0}`);
    }) as never);

    try {
      // Trigger a failure path so we hit error + exit defaults.
      await expect(
        main({
          runWrangler: async () => ({
            stdout: '[{"Name":"x.sql"}]',
            stderr: "",
            exitCode: 0,
          }),
          env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "0" },
        }),
      ).rejects.toThrow("__exit__:1");

      expect(logSpy).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe("isCliEntry", () => {
  it("returns false when argv1 is undefined", () => {
    expect(isCliEntry(undefined, "file:///x.ts")).toBe(false);
  });

  it("returns false when argv1 does not resolve to the module url", () => {
    expect(isCliEntry("/some/other/script.ts", "file:///not/the/same.ts")).toBe(false);
  });

  it("returns true when argv1 resolves to the same path as moduleUrl", () => {
    const resolved = "/tmp/fake-preflight-cli-entry.ts";
    const url = `file://${resolved}`;
    expect(isCliEntry(resolved, url)).toBe(true);
  });
});

describe("runCliIfEntry", () => {
  it("returns false and does not invoke runMain when argv1 is not the module", () => {
    const runMain = vi.fn(async () => {});
    const onError = vi.fn();
    const result = runCliIfEntry({
      argv1: "/totally/different.ts",
      moduleUrl: "file:///somewhere/else.ts",
      runMain,
      onError,
    });
    expect(result).toBe(false);
    expect(runMain).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns true and invokes runMain when argv1 matches the moduleUrl", async () => {
    const resolved = "/tmp/fake-preflight-cli-entry.ts";
    const url = `file://${resolved}`;
    let resolveMain!: () => void;
    const ran = new Promise<void>((res) => {
      resolveMain = res;
    });
    const runMain = vi.fn(async () => {
      resolveMain();
    });
    const onError = vi.fn();

    const result = runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain, onError });
    await ran;

    expect(result).toBe(true);
    expect(runMain).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("routes runMain errors through onError", async () => {
    const resolved = "/tmp/fake-preflight-cli-entry.ts";
    const url = `file://${resolved}`;
    const runMain = vi.fn(async () => {
      throw new Error("kaboom");
    });
    let captured: unknown = null;
    const seen = new Promise<void>((resolve) => {
      // onError will receive the error; resolve when invoked
      // and capture for assertion.
      (globalThis as Record<string, unknown>).__captureOnce = (err: unknown) => {
        captured = err;
        resolve();
      };
    });
    const onError = (err: unknown) => {
      (
        (globalThis as Record<string, unknown>).__captureOnce as (e: unknown) => void
      )(err);
    };

    const result = runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain, onError });
    await seen;

    expect(result).toBe(true);
    expect(runMain).toHaveBeenCalledTimes(1);
    expect((captured as Error).message).toBe("kaboom");
    delete (globalThis as Record<string, unknown>).__captureOnce;
  });

  it("uses default onError that prints and calls process.exit(1) when runMain rejects with an Error", async () => {
    const resolved = "/tmp/fake-preflight-cli-entry.ts";
    const url = `file://${resolved}`;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      // swallow; test asserts on call below
      return undefined as never;
    }) as never);

    try {
      const runMain = async () => {
        throw new Error("crash");
      };
      const result = runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain });
      // Wait one microtask cycle for the .catch handler to run
      await Promise.resolve();
      await Promise.resolve();
      expect(result).toBe(true);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("crash"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses default onError that stringifies non-Error rejections", async () => {
    const resolved = "/tmp/fake-preflight-cli-entry.ts";
    const url = `file://${resolved}`;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      return undefined as never;
    }) as never);

    try {
      const runMain = async () => {
        throw "string-failure";
      };
      runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain });
      await Promise.resolve();
      await Promise.resolve();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("string-failure"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses default main when runMain is not provided", async () => {
    // Override env so the default main() can run quickly and safely.
    const originalSkip = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      return undefined as never;
    }) as never);

    try {
      const resolved = "/tmp/fake-preflight-cli-entry.ts";
      const url = `file://${resolved}`;
      const result = runCliIfEntry({ argv1: resolved, moduleUrl: url });
      // Let async main() resolve.
      await new Promise((r) => setTimeout(r, 30));
      expect(result).toBe(true);
      expect(logSpy).toHaveBeenCalled();
      // Should NOT have exited (skip flag → all PASS/WARN, no failure).
      expect(errSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
      if (originalSkip === undefined) {
        delete process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
      } else {
        process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = originalSkip;
      }
    }
  });
});
