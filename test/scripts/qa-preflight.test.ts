import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  QA_BASE_URL,
  QA_D1_DATABASE_ID,
  QA_ENV_NAME,
  QA_R2_BUCKET,
  REQUIRED_QA_SECRETS,
  buildQaMigrationListArgs,
  buildQaR2DeleteArgs,
  buildQaR2GetArgs,
  buildQaR2PutArgs,
  buildQaSecretListArgs,
  isCliEntry,
  main,
  parseWranglerSecretNames,
  runCliIfEntry,
  runQaPreflight,
  validateQaGeneratedBuildConfig,
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

  it("reports invalid JSON output", () => {
    const parsed = parseWranglerSecretNames("[not-json]");

    expect(parsed).toEqual({ error: expect.stringContaining("Could not parse Wrangler secret JSON") });
  });

  it("returns a parse error for non-array output", () => {
    const parsed = parseWranglerSecretNames("{}");

    expect(parsed).toEqual({ error: expect.stringContaining("array") });
  });

  it("filters malformed secret rows", () => {
    expect(parseWranglerSecretNames(JSON.stringify([null, "bad", { name: "" }, { name: "SESSION_SECRET" }]))).toEqual([
      "SESSION_SECRET",
    ]);
  });
});

function qaGeneratedBuildConfig() {
  return {
    name: "spoonjoy-v2-qa",
    vars: { NODE_ENV: "production", SPOONJOY_BASE_URL: QA_BASE_URL },
    d1_databases: [{ binding: "DB", database_name: "spoonjoy-qa", database_id: QA_D1_DATABASE_ID }],
    r2_buckets: [{ binding: "PHOTOS", bucket_name: QA_R2_BUCKET }],
    ratelimits: [
      { name: "API_TOKEN_RATE_LIMITER", namespace_id: "2001" },
      { name: "API_IP_RATE_LIMITER", namespace_id: "2002" },
      { name: "AUTH_IP_RATE_LIMITER", namespace_id: "2003" },
    ],
  };
}

function warningCleanStorybookWorkflow(): string {
  return [
    "name: Storybook",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "    branches: [main]",
    "  workflow_dispatch:",
    "env:",
    "  GIT_CONFIG_COUNT: '1'",
    "  GIT_CONFIG_KEY_0: init.defaultBranch",
    "  GIT_CONFIG_VALUE_0: main",
    "jobs:",
    "  build-storybook:",
    "    name: build-storybook",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: read",
    "      deployments: write",
    "    steps:",
    "      - uses: actions/checkout@v6",
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          node-version: '22'",
    "      - name: Activate pnpm",
    "        run: |",
    "          corepack enable",
    "          corepack prepare pnpm@10.28.1 --activate",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm prisma:generate",
    "      - run: pnpm build-storybook",
    "      - name: Prepare Cloudflare Pages deploy directory",
    "        if: github.ref == 'refs/heads/main'",
    "        run: |",
          "          rm -rf storybook-pages-deploy",
          "          mkdir -p storybook-pages-deploy",
          "          mv storybook-static storybook-pages-deploy/storybook-static",
          "          printf '%s\\n' '{' '  \"name\": \"spoonjoy-storybook\",' '  \"pages_build_output_dir\": \"storybook-static\"' '}' > storybook-pages-deploy/wrangler.json",
    "      - name: Deploy to Cloudflare Pages",
    "        if: github.ref == 'refs/heads/main'",
    "        uses: cloudflare/wrangler-action@v4",
    "        with:",
    "          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    "          workingDirectory: storybook-pages-deploy",
    "          packageManager: npm",
    "          command: pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true",
    "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
  ].join("\n");
}

async function createStaticConfigRoot(overrides: {
  gitignore?: string;
  pnpmWorkspace?: string;
  storybookWorkflow?: string;
} = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-qa-static-"));
  await Promise.all([
    mkdir(path.join(root, ".github/workflows"), { recursive: true }),
    mkdir(path.join(root, "app"), { recursive: true }),
    mkdir(path.join(root, "docs"), { recursive: true }),
    mkdir(path.join(root, "migrations"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(path.join(process.cwd(), "wrangler.json"), path.join(root, "wrangler.json")),
    copyFile(path.join(process.cwd(), "package.json"), path.join(root, "package.json")),
    copyFile(
      path.join(process.cwd(), ".github/workflows/ci.yml"),
      path.join(root, ".github/workflows/ci.yml"),
    ),
    copyFile(
      path.join(process.cwd(), ".github/workflows/production-deploy.yml"),
      path.join(root, ".github/workflows/production-deploy.yml"),
    ),
    copyFile(
      path.join(process.cwd(), ".github/workflows/qa-image-cover-smoke.yml"),
      path.join(root, ".github/workflows/qa-image-cover-smoke.yml"),
    ),
    copyFile(path.join(process.cwd(), "app/cloudflare-env.d.ts"), path.join(root, "app/cloudflare-env.d.ts")),
    copyFile(path.join(process.cwd(), "README.md"), path.join(root, "README.md")),
    copyFile(path.join(process.cwd(), "docs/deployment.md"), path.join(root, "docs/deployment.md")),
    copyFile(path.join(process.cwd(), "vitest.config.ts"), path.join(root, "vitest.config.ts")),
    copyFile(path.join(process.cwd(), "tsconfig.scripts.json"), path.join(root, "tsconfig.scripts.json")),
    writeFile(path.join(root, "migrations/0000_init.sql"), "-- migration\n", "utf8"),
    writeFile(
      path.join(root, ".github/workflows/storybook.yml"),
      overrides.storybookWorkflow ?? warningCleanStorybookWorkflow(),
      "utf8",
    ),
    writeFile(
      path.join(root, ".gitignore"),
      overrides.gitignore ?? "node_modules\nstorybook-static\nstorybook-pages-deploy/\n",
      "utf8",
    ),
    writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      overrides.pnpmWorkspace ??
        [
          "allowBuilds:",
          '  "@prisma/client": false',
          '  "@prisma/engines": false',
          '  "@swc/core": false',
          "  core-js: false",
          "  esbuild: false",
          "  prisma: false",
          "  protobufjs: false",
          "  sharp: false",
          "  unrs-resolver: false",
          "  workerd: false",
          "",
        ].join("\n"),
      "utf8",
    ),
  ]);
  return root;
}

describe("validateQaGeneratedBuildConfig", () => {
  it("passes for a generated QA Worker config", () => {
    const check = validateQaGeneratedBuildConfig(qaGeneratedBuildConfig());

    expect(check.ok).toBe(true);
  });

  it("accepts valid bindings after malformed generated config entries", () => {
    const check = validateQaGeneratedBuildConfig({
      ...qaGeneratedBuildConfig(),
      d1_databases: [
        null,
        "bad",
        { binding: "OTHER", database_name: "spoonjoy-qa", database_id: QA_D1_DATABASE_ID },
        { binding: "DB", database_name: "spoonjoy-qa", database_id: QA_D1_DATABASE_ID },
      ],
      r2_buckets: [
        null,
        "bad",
        { binding: "OTHER", bucket_name: QA_R2_BUCKET },
        { binding: "PHOTOS", bucket_name: QA_R2_BUCKET },
      ],
      ratelimits: [
        null,
        "bad",
        { name: "", namespace_id: "" },
        { name: "API_TOKEN_RATE_LIMITER", namespace_id: "2001" },
        { name: "API_IP_RATE_LIMITER", namespace_id: "2002" },
        { name: "AUTH_IP_RATE_LIMITER", namespace_id: "2003" },
      ],
    });

    expect(check.ok).toBe(true);
  });

  it("fails closed for malformed generated config shapes", () => {
    const check = validateQaGeneratedBuildConfig({
      name: "spoonjoy-v2-qa",
      vars: [],
      d1_databases: null,
      r2_buckets: null,
      ratelimits: null,
    });

    expect(check.ok).toBe(false);
  });

  it("fails closed when generated config arrays do not contain the required bindings", () => {
    const check = validateQaGeneratedBuildConfig({
      ...qaGeneratedBuildConfig(),
      d1_databases: [{ binding: "OTHER", database_name: "spoonjoy-qa", database_id: QA_D1_DATABASE_ID }],
      r2_buckets: [{ binding: "OTHER", bucket_name: QA_R2_BUCKET }],
    });

    expect(check.ok).toBe(false);
  });

  it("fails for a generated production Worker config", () => {
    const check = validateQaGeneratedBuildConfig({
      name: "spoonjoy-v2",
      vars: { NODE_ENV: "production", SPOONJOY_BASE_URL: "https://spoonjoy.app" },
      d1_databases: [{ binding: "DB", database_name: "spoonjoy", database_id: "32cb0e04-c45b-4cd2-a798-556556ae288d" }],
      r2_buckets: [{ binding: "PHOTOS", bucket_name: "spoonjoy-photos" }],
      ratelimits: [
        { name: "API_TOKEN_RATE_LIMITER", namespace_id: "1001" },
        { name: "API_IP_RATE_LIMITER", namespace_id: "1002" },
        { name: "AUTH_IP_RATE_LIMITER", namespace_id: "1003" },
      ],
    });

    expect(check.ok).toBe(false);
    expect(check.message).toContain("CLOUDFLARE_ENV=qa");
  });
});

describe("runQaPreflight", () => {
  function successfulProbeFile() {
    return {
      path: "/tmp/spoonjoy-qa-preflight.txt",
      body: "spoonjoy qa preflight",
      cleanup: async () => undefined,
    };
  }

  function successfulWrangler(overrides: Record<string, { stdout: string; stderr: string; exitCode: number }> = {}) {
    return vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command in overrides) return overrides[command];
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
  }

  it("passes static, migration, secret, and R2 checks against QA", async () => {
    const cleanup = vi.fn(async () => undefined);
    const runWrangler = successfulWrangler();

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

  it("uses the default probe file helper when no probe dependency is injected", async () => {
    const runWrangler = successfulWrangler();

    const result = await runQaPreflight(process.cwd(), { runWrangler });

    expect(result.errors).toEqual([]);
    expect(runWrangler.mock.calls.some(([args]) => args[0] === "r2" && args[2] === "put")).toBe(true);
  });

  it("validates generated QA build config when requested", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "",
      stderr: "Authentication error [code: 10000]",
      exitCode: 1,
    }));

    const result = await runQaPreflight(process.cwd(), {
      env: {
        SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1",
        SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG: "1",
      },
      runWrangler,
      readGeneratedBuildConfig: async () => qaGeneratedBuildConfig(),
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(result.errors).toEqual([]);
    expect(result.checks.find((check) => check.name === "QA generated build config")?.ok).toBe(true);
  });

  it("validates the default generated QA build config file when requested", async () => {
    const root = await createStaticConfigRoot();
    try {
      await mkdir(path.join(root, "build/server"), { recursive: true });
      await writeFile(path.join(root, "build/server/wrangler.json"), JSON.stringify(qaGeneratedBuildConfig()), "utf8");

      const result = await runQaPreflight(root, {
        env: {
          SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1",
          SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG: "1",
        },
      });

      expect(result.errors).toEqual([]);
      expect(result.checks.find((check) => check.name === "QA generated build config")?.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses default dependencies safely when remote checks are skipped", async () => {
    const originalSkip = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    try {
      process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
      const result = await runQaPreflight();

      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(
        result.checks
          .filter((check) => check.severity === "warning")
          .map((check) => check.name),
      ).toEqual(
        expect.arrayContaining(["QA D1 migrations", "QA secrets", "QA R2 round trip"]),
      );
    } finally {
      if (originalSkip === undefined) {
        delete process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
      } else {
        process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = originalSkip;
      }
    }
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

  it("reports QA secret parse errors", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaSecretListArgs().join(" ")]: { stdout: "[not-json]", stderr: "", exitCode: 0 },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    expect(result.errors.find((check) => check.name === "QA secrets")?.message).toContain(
      "Could not parse Wrangler secret JSON",
    );
  });

  it("reports pending migrations from JSON output", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: {
          stdout: JSON.stringify([{ Name: "0007_pending.sql" }, null, { Name: "" }, { Other: "ignored.sql" }]),
          stderr: "",
          exitCode: 0,
        },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    const migrationCheck = result.errors.find((check) => check.name === "QA D1 migrations");
    expect(migrationCheck?.message).toContain("0007_pending.sql");
  });

  it("treats Wrangler no-pending text as a clean migration state", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: {
          stdout: "No migrations to apply.",
          stderr: "",
          exitCode: 0,
        },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    expect(result.errors.map((check) => check.name)).not.toContain("QA D1 migrations");
  });

  it("reports malformed Wrangler migration JSON", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: { stdout: "[not-json]", stderr: "", exitCode: 0 },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    expect(result.errors.find((check) => check.name === "QA D1 migrations")?.message).toContain(
      "Could not parse Wrangler migration JSON",
    );
  });

  it("reports non-array Wrangler migration JSON", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: { stdout: "{}", stderr: "", exitCode: 0 },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    expect(result.errors.find((check) => check.name === "QA D1 migrations")?.message).toContain("not an array");
  });

  it("reports pending migrations from text output", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: {
          stdout: "Pending: 0008_remote_pending.sql and 0008_remote_pending.sql",
          stderr: "",
          exitCode: 0,
        },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    expect(result.errors.find((check) => check.name === "QA D1 migrations")?.message).toContain(
      "0008_remote_pending.sql",
    );
  });

  it("reports unparseable Wrangler migration output", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: { stdout: "migrations are mysterious today", stderr: "", exitCode: 0 },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    expect(result.errors.find((check) => check.name === "QA D1 migrations")?.message).toContain(
      "Could not parse Wrangler migration output",
    );
  });

  it("uses stdout as the failure message when Wrangler migration stderr is empty", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaMigrationListArgs().join(" ")]: { stdout: "database unreachable", stderr: "", exitCode: 1 },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    const migrationCheck = result.errors.find((check) => check.name === "QA D1 migrations");
    expect(migrationCheck?.message).toContain("database unreachable");
    expect(migrationCheck?.severity).toBe("error");
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

  it("uses stdout as the failure message when Wrangler secret stderr is empty", async () => {
    const result = await runQaPreflight(process.cwd(), {
      runWrangler: successfulWrangler({
        [buildQaSecretListArgs().join(" ")]: { stdout: "secret list unavailable", stderr: "", exitCode: 1 },
      }),
      createProbeFile: async () => successfulProbeFile(),
    });

    const secretCheck = result.errors.find((check) => check.name === "QA secrets");
    expect(secretCheck?.message).toContain("secret list unavailable");
    expect(secretCheck?.severity).toBe("error");
  });

  it("uses stdout as the failure message when the R2 probe write stderr is empty", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) return { stdout: "[]", stderr: "", exitCode: 0 };
      if (command === buildQaSecretListArgs().join(" ")) return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object put")) return { stdout: "put denied", stderr: "", exitCode: 1 };
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => successfulProbeFile(),
    });

    const r2Check = result.errors.find((check) => check.name === "QA R2 round trip");
    expect(r2Check?.message).toContain("put denied");
    expect(r2Check?.severity).toBe("error");
  });

  it("reports R2 probe read failures after deleting the probe", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) return { stdout: "[]", stderr: "", exitCode: 0 };
      if (command === buildQaSecretListArgs().join(" ")) return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object put")) return { stdout: "", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object get")) return { stdout: "read denied", stderr: "", exitCode: 1 };
      if (command.startsWith("r2 object delete")) return { stdout: "", stderr: "", exitCode: 0 };
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => successfulProbeFile(),
    });

    const r2Check = result.errors.find((check) => check.name === "QA R2 round trip");
    expect(r2Check?.message).toContain("Could not read QA R2 probe");
    expect(r2Check?.message).toContain("read denied");
  });

  it("reports R2 probe delete failures after read failures", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) return { stdout: "[]", stderr: "", exitCode: 0 };
      if (command === buildQaSecretListArgs().join(" ")) return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object put")) return { stdout: "", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object get")) return { stdout: "read denied", stderr: "", exitCode: 1 };
      if (command.startsWith("r2 object delete")) return { stdout: "delete denied", stderr: "", exitCode: 1 };
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => successfulProbeFile(),
    });

    const r2Check = result.errors.find((check) => check.name === "QA R2 round trip");
    expect(r2Check?.message).toContain("after read failure");
    expect(r2Check?.message).toContain("delete denied");
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

  it("reports R2 probe delete failures after readback mismatches", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) return { stdout: "[]", stderr: "", exitCode: 0 };
      if (command === buildQaSecretListArgs().join(" ")) return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object put")) return { stdout: "", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object get")) return { stdout: "wrong body", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object delete")) return { stdout: "delete denied", stderr: "", exitCode: 1 };
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => successfulProbeFile(),
    });

    const r2Check = result.errors.find((check) => check.name === "QA R2 round trip");
    expect(r2Check?.message).toContain("after readback mismatch");
    expect(r2Check?.message).toContain("delete denied");
  });

  it("fails when the R2 probe delete fails after a successful readback", async () => {
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
        return { stdout: "", stderr: "delete denied", exitCode: 1 };
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

    const r2Check = result.errors.find((check) => check.name === "QA R2 round trip");
    expect(r2Check?.message).toContain("Could not delete QA R2 probe");
    expect(r2Check?.message).toContain("delete denied");
  });

  it("uses stdout as the failure message when final R2 probe delete stderr is empty", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) return { stdout: "[]", stderr: "", exitCode: 0 };
      if (command === buildQaSecretListArgs().join(" ")) return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object put")) return { stdout: "", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object get")) return { stdout: "spoonjoy qa preflight", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object delete")) return { stdout: "oauth delete denied", stderr: "", exitCode: 1 };
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    const result = await runQaPreflight(process.cwd(), {
      runWrangler,
      createProbeFile: async () => successfulProbeFile(),
    });

    const r2Check = result.warnings.find((check) => check.name === "QA R2 round trip");
    expect(r2Check?.message).toContain("oauth delete denied");
  });

  it("attempts final R2 cleanup when the read command throws after upload", async () => {
    const runWrangler = vi.fn(async (args: string[]) => {
      const command = args.join(" ");
      if (command === buildQaMigrationListArgs().join(" ")) return { stdout: "[]", stderr: "", exitCode: 0 };
      if (command === buildQaSecretListArgs().join(" ")) return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object put")) return { stdout: "", stderr: "", exitCode: 0 };
      if (command.startsWith("r2 object get")) throw new Error("r2 get crashed");
      if (command.startsWith("r2 object delete")) return { stdout: "", stderr: "", exitCode: 0 };
      throw new Error(`unexpected wrangler args: ${command}`);
    });

    await expect(
      runQaPreflight(process.cwd(), {
        runWrangler,
        createProbeFile: async () => successfulProbeFile(),
      }),
    ).rejects.toThrow("r2 get crashed");
    expect(runWrangler.mock.calls.some(([args]) => args[0] === "r2" && args[2] === "delete")).toBe(true);
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

  it("propagates Storybook deploy warning cleanup static-config failures", async () => {
    const root = await createStaticConfigRoot({
      gitignore: "node_modules\nstorybook-static\n",
      pnpmWorkspace: "allowBuilds:\n  esbuild: false\n",
    });
    try {
      const result = await runQaPreflight(root, {
        env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1" },
        runWrangler: async () => ({ stdout: "", stderr: "Authentication error [code: 10000]", exitCode: 1 }),
        createProbeFile: async () => ({
          path: "/tmp/spoonjoy-qa-preflight.txt",
          body: "spoonjoy qa preflight",
          cleanup: async () => undefined,
        }),
      });

      const staticCheck = result.errors.find((check) => check.name === "QA static config");
      expect(staticCheck?.message).toContain("Storybook generated deploy ignore");
      expect(staticCheck?.message).toContain("pnpm build script policy");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("qa-preflight CLI", () => {
  const resolved = path.resolve(process.cwd(), "scripts/qa-preflight.ts");
  const url = new URL(`file://${resolved}`).href;

  it("identifies CLI entrypoints", () => {
    expect(isCliEntry(undefined, url)).toBe(false);
    expect(isCliEntry("/tmp/other.ts", url)).toBe(false);
    expect(isCliEntry(resolved, url)).toBe(true);
  });

  it("returns false without running main when not the CLI entry", () => {
    const runMain = vi.fn(async () => undefined);

    expect(runCliIfEntry({ argv1: "/tmp/other.ts", moduleUrl: url, runMain })).toBe(false);
    expect(runMain).not.toHaveBeenCalled();
  });

  it("runs injected main and returns true for CLI entry", () => {
    const runMain = vi.fn(async () => undefined);

    expect(runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledTimes(1);
  });

  it("routes injected CLI failures to an injected error handler", async () => {
    const onError = vi.fn();
    const runMain = vi.fn(async () => {
      throw new Error("qa boom");
    });

    expect(runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain, onError })).toBe(true);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "qa boom" })));
  });

  it("logs passing checks with injected dependencies", async () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();

    await main({
      io: { log, error, exit },
      runWrangler: async () => ({ stdout: "", stderr: "Authentication error [code: 10000]", exitCode: 1 }),
      env: { SPOONJOY_PREFLIGHT_SKIP_REMOTE: "1" },
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("QA preflight passed.");
  });

  it("logs failures with injected dependencies", async () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();

    await main({
      io: { log, error, exit },
      runWrangler: async (args) => {
        if (args.join(" ") === buildQaMigrationListArgs().join(" ")) {
          return { stdout: "", stderr: "database unavailable", exitCode: 1 };
        }
        if (args.join(" ") === buildQaSecretListArgs().join(" ")) {
          return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
        }
        if (args[0] === "r2" && args[2] === "get") {
          return { stdout: "spoonjoy qa preflight", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(error).toHaveBeenCalledWith("QA preflight failed with 1 error(s).");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("uses default console IO for successful main runs", async () => {
    const originalSkip = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
      await main();

      expect(log).toHaveBeenCalledWith("QA preflight passed.");
    } finally {
      log.mockRestore();
      if (originalSkip === undefined) {
        delete process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
      } else {
        process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = originalSkip;
      }
    }
  });

  it("uses default console IO and exit for failed main runs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit 1");
    }) as never);
    try {
      await expect(
        main({
          runWrangler: async (args) => {
            if (args.join(" ") === buildQaMigrationListArgs().join(" ")) {
              return { stdout: "", stderr: "database unavailable", exitCode: 1 };
            }
            if (args.join(" ") === buildQaSecretListArgs().join(" ")) {
              return { stdout: secretListStdout(), stderr: "", exitCode: 0 };
            }
            if (args[0] === "r2" && args[2] === "get") {
              return { stdout: "spoonjoy qa preflight", stderr: "", exitCode: 0 };
            }
            return { stdout: "", stderr: "", exitCode: 0 };
          },
          createProbeFile: async () => ({
            path: "/tmp/spoonjoy-qa-preflight.txt",
            body: "spoonjoy qa preflight",
            cleanup: async () => undefined,
          }),
        }),
      ).rejects.toThrow("exit 1");

      expect(errorSpy).toHaveBeenCalledWith("QA preflight failed with 1 error(s).");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("uses the default CLI error handler", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const runMain = vi.fn(async () => {
      throw "string failure";
    });

    expect(runCliIfEntry({ argv1: resolved, moduleUrl: url, runMain })).toBe(true);
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith("QA preflight failed: string failure"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("uses the default CLI main runner", async () => {
    const originalSkip = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
      expect(runCliIfEntry({ argv1: resolved, moduleUrl: url })).toBe(true);
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith("QA preflight passed."));
    } finally {
      log.mockRestore();
      if (originalSkip === undefined) {
        delete process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
      } else {
        process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = originalSkip;
      }
    }
  });

  it("prints a warning suffix when QA preflight has warning findings", async () => {
    const log = vi.fn();

    await main({
      io: { log, error: vi.fn(), exit: vi.fn() },
      runWrangler: async () => ({ stdout: "", stderr: "Authentication error [code: 10000]", exitCode: 1 }),
      createProbeFile: async () => ({
        path: "/tmp/spoonjoy-qa-preflight.txt",
        body: "spoonjoy qa preflight",
        cleanup: async () => undefined,
      }),
    });

    expect(log).toHaveBeenCalledWith("QA preflight passed with 3 warning(s).");
  });
});
