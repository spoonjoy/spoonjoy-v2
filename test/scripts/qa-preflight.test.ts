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
  parseWranglerSecretNames,
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

  it("returns a parse error for non-array output", () => {
    const parsed = parseWranglerSecretNames("{}");

    expect(parsed).toEqual({ error: expect.stringContaining("array") });
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
    "      - uses: pnpm/action-setup@v6",
    "        with:",
    "          version: '10.28.1'",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm prisma:generate",
    "      - run: pnpm build-storybook",
    "      - name: Prepare Cloudflare Pages deploy directory",
    "        if: github.ref == 'refs/heads/main'",
    "        run: |",
    "          rm -rf storybook-pages-deploy",
    "          mkdir -p storybook-pages-deploy",
    "          mv storybook-static storybook-pages-deploy/storybook-static",
    "          printf '%s\\n' '{' '  \"pages_build_output_dir\": \"storybook-static\"' '}' > storybook-pages-deploy/wrangler.json",
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
    writeFile(path.join(root, "migrations/0000_init.sql"), "-- migration\n", "utf8"),
    writeFile(
      path.join(root, ".github/workflows/storybook.yml"),
      overrides.storybookWorkflow ?? warningCleanStorybookWorkflow(),
      "utf8",
    ),
    writeFile(path.join(root, ".gitignore"), overrides.gitignore ?? "node_modules\nstorybook-static\n", "utf8"),
    writeFile(path.join(root, "pnpm-workspace.yaml"), overrides.pnpmWorkspace ?? "allowBuilds:\n  esbuild: false\n", "utf8"),
  ]);
  return root;
}

describe("validateQaGeneratedBuildConfig", () => {
  it("passes for a generated QA Worker config", () => {
    const check = validateQaGeneratedBuildConfig(qaGeneratedBuildConfig());

    expect(check.ok).toBe(true);
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
    const root = await createStaticConfigRoot();
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
