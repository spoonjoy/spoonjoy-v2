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

function validQaImageCoverSmokeWorkflow(): string {
  return [
    "name: QA Image Cover Smoke",
    "on:",
    "  workflow_dispatch:",
    "  schedule:",
    "    - cron: \"17 10 * * *\"",
    "jobs:",
    "  smoke:",
    "    steps:",
    "      - name: Check GitHub Cloudflare credentials",
    "        id: cloudflare",
    "        env:",
    "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    "        run: |",
    "          if [ -z \"${CLOUDFLARE_API_TOKEN:-}\" ] || [ -z \"${CLOUDFLARE_ACCOUNT_ID:-}\" ]; then",
    "            echo \"ready=false\" >> \"$GITHUB_OUTPUT\"",
    "            echo \"Skipping QA image-cover smoke because Cloudflare GitHub secrets are not configured.\"",
    "            exit 0",
    "          fi",
    "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"",
    "      - uses: actions/checkout@v6",
    "        if: steps.cloudflare.outputs.ready == 'true'",
    "      - run: pnpm install --frozen-lockfile",
    "        if: steps.cloudflare.outputs.ready == 'true'",
    "      - run: pnpm prisma:generate",
    "        if: steps.cloudflare.outputs.ready == 'true'",
    "      - name: Check QA image-provider secrets",
    "        id: qa-secrets",
    "        if: steps.cloudflare.outputs.ready == 'true'",
    "        env:",
    "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    "        run: |",
    "          secrets_json=\"$(pnpm exec wrangler secret list --env qa)\"",
    "          echo \"$secrets_json\"",
    "          if ! printf '%s' \"$secrets_json\" | grep -Eq '\"(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\"'; then",
    "            echo \"ready=false\" >> \"$GITHUB_OUTPUT\"",
    "            echo \"Skipping QA image-cover smoke because no QA image-provider secret is configured.\"",
    "            exit 0",
    "          fi",
    "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"",
    "      - name: Run QA image-cover smoke",
    "        if: steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
    "        env:",
    "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    "          SPOONJOY_QA_SMOKE_BASE_URL: https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
    "          SPOONJOY_QA_SMOKE_TARGET: --target-env qa",
    "        run: pnpm run smoke:qa:image-cover",
    "      - name: Upload QA image-cover smoke artifacts",
    "        if: always() && steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
    "        uses: actions/upload-artifact@v7",
    "        with:",
    "          path: qa-image-cover-smoke-artifacts/",
  ].join("\n");
}

function validStorybookWorkflow(): string {
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
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          node-version: '22'",
    "          cache: 'pnpm'",
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

function validGitignore(): string {
  return [
    "node_modules",
    "storybook-static",
    "storybook-pages-deploy/",
  ].join("\n");
}

function validPnpmWorkspace(): string {
  return [
    "allowBuilds:",
    "  \"@prisma/client\": false",
    "  \"@prisma/engines\": false",
    "  \"@swc/core\": false",
    "  core-js: false",
    "  esbuild: false",
    "  prisma: false",
    "  protobufjs: false",
    "  sharp: false",
    "  unrs-resolver: false",
    "  workerd: false",
  ].join("\n");
}

function inputsWithStorybookWorkflow(
  workflow: string,
  overrides: Partial<DeploymentPreflightInputs> = {},
): DeploymentPreflightInputs {
  return { ...validInputs(), storybookWorkflow: workflow, ...overrides };
}

function validInputs(): DeploymentPreflightInputs {
  return {
    wrangler: {
      name: "spoonjoy-v2",
      main: "./workers/app.ts",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "./build/client" },
      d1_databases: [{ binding: "DB", database_name: "spoonjoy", database_id: "database-id" }],
      r2_buckets: [{ binding: "PHOTOS", bucket_name: "spoonjoy-photos" }],
      ratelimits: [
        { name: "API_TOKEN_RATE_LIMITER", namespace_id: "1001" },
        { name: "API_IP_RATE_LIMITER", namespace_id: "1002" },
        { name: "AUTH_IP_RATE_LIMITER", namespace_id: "1003" },
      ],
      vars: { NODE_ENV: "production" },
      env: {
        qa: {
          d1_databases: [
            {
              binding: "DB",
              database_name: "spoonjoy-qa",
              database_id: "c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34",
            },
          ],
          r2_buckets: [{ binding: "PHOTOS", bucket_name: "spoonjoy-photos-qa" }],
          ratelimits: [
            { name: "API_TOKEN_RATE_LIMITER", namespace_id: "2001" },
            { name: "API_IP_RATE_LIMITER", namespace_id: "2002" },
            { name: "AUTH_IP_RATE_LIMITER", namespace_id: "2003" },
          ],
          vars: {
            NODE_ENV: "production",
            SPOONJOY_BASE_URL: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
          },
        },
      },
    },
    packageJson: {
      scripts: {
        build: "react-router build",
        deploy: "pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler deploy",
        "deploy:qa":
          "SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run qa:preflight && CLOUDFLARE_ENV=qa pnpm run build && pnpm run qa:migrate && SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1 pnpm run qa:preflight && pnpm exec wrangler deploy --env qa",
        "deploy:auto":
          "SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm run deploy:preflight && pnpm exec wrangler deploy",
        "deploy:preflight": "tsx scripts/deployment-preflight.ts",
        "qa:preflight": "tsx scripts/qa-preflight.ts",
        "qa:migrate": "pnpm exec wrangler d1 migrations apply DB --remote --env qa",
        "qa:seed": "node scripts/seed-qa.mjs --target-env qa",
        typecheck: "react-router typegen && tsc",
        "test:coverage": "vitest run --coverage",
        "test:e2e": "env -u FORCE_COLOR -u NO_COLOR playwright test",
        "smoke:api": "node scripts/smoke-api-live.mjs",
        "smoke:qa":
          "node scripts/smoke-live.mjs --target-env qa --base-url https://spoonjoy-v2-qa.mendelow-studio.workers.dev --out qa-live-smoke-artifacts",
        "smoke:qa:image-cover":
          "node scripts/smoke-live.mjs --target-env qa --base-url https://spoonjoy-v2-qa.mendelow-studio.workers.dev --out qa-image-cover-smoke-artifacts --include-image-cover-smoke",
        "db:seed": "pnpm exec tsx prisma/seed.ts",
      },
    },
    productionDeployWorkflow: [
      "name: Production Deploy",
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Deploy to Cloudflare Workers",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "        run: pnpm run deploy:auto",
    ].join("\n"),
    qaImageCoverSmokeWorkflow: validQaImageCoverSmokeWorkflow(),
    storybookWorkflow: validStorybookWorkflow(),
    gitignore: validGitignore(),
    pnpmWorkspace: validPnpmWorkspace(),
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

  it("uses process.cwd as the default preflight root directory", async () => {
    const originalSkip = process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE;
    process.env.SPOONJOY_PREFLIGHT_SKIP_REMOTE = "1";
    try {
      const result = await runDeploymentPreflight();

      expect(result.errors).toEqual([]);
      expect(result.checks.map((item) => item.name)).toContain("Storybook deploy workflow");
      expect(result.checks.map((item) => item.name)).toContain("remote D1 migrations");
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

  it("ignores malformed binding entries when valid production bindings are present", () => {
    const inputs = validInputs();
    inputs.wrangler.d1_databases = [
      null,
      "bad-binding",
      { binding: "OTHER_DB", database_name: "other", database_id: "other-id" },
      { binding: "DB", database_name: "spoonjoy", database_id: "database-id" },
    ];
    inputs.wrangler.r2_buckets = [
      null,
      { binding: "PHOTOS", bucket_name: "spoonjoy-photos" },
    ];

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).not.toContain("D1 binding");
    expect(result.errors.map((item) => item.name)).not.toContain("R2 photos binding");
  });

  it("requires deploy:auto in REQUIRED_PACKAGE_SCRIPTS", () => {
    const inputs = validInputs();
    delete (inputs.packageJson.scripts as Record<string, string>)["deploy:auto"];

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("package scripts");
  });

  it("flags missing package scripts when package.json has no scripts object", () => {
    const inputs = validInputs();
    inputs.packageJson = {};

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

  it("requires the production deploy workflow to run on pushes to main", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - run: pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("rejects production deploy workflows without an on block", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - run: pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("requires production push workflows to name the main branch explicitly", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - run: pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("rejects production deploy workflows without jobs", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("does not accept commented or misplaced push-to-main workflow text", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "name: Production Deploy",
      "on:",
      "  workflow_dispatch:",
      "# push:",
      "#   branches:",
      "#     - main",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - name: comment mentioning branches main",
      "        run: echo push branches main && pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("does not accept inline branch names that merely contain main", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches: [not-main, feature/main]",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - run: pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("does not accept multiline branch names that merely contain main", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches:",
      "      - not-main",
      "      - feature/main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - run: pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("accepts deploy:auto from a block-style production workflow run step", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - name: Deploy",
      "        run: |",
      "          pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).not.toContain("production deploy workflow");
  });

  it("rejects a block-style production workflow run step that does not deploy", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - name: Deploy",
      "        run: |",
      "          echo not deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("requires deploy:auto and Cloudflare credentials on a real deploy step", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "name: Production Deploy",
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: pnpm run deploy:auto CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID",
      "        run: echo pnpm run deploy:auto",
      "        env:",
      "          NOT_CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "      - name: mentions the other credential",
      "        run: echo CLOUDFLARE_ACCOUNT_ID",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("rejects a production deploy workflow whose deploy job has no steps", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
  });

  it("ignores nested or malformed env lines when checking production deploy credentials", () => {
    const inputs = validInputs();
    inputs.productionDeployWorkflow = [
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "  workflow_dispatch:",
      "jobs:",
      "  deploy:",
      "    steps:",
      "      - run: pnpm run deploy:auto",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          nested:",
      "            CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "          - malformed-env-line",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("production deploy workflow");
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

  it("flags a missing isolated QA Wrangler environment and QA scripts", () => {
    const inputs = validInputs();
    delete inputs.wrangler.env;
    for (const script of ["qa:preflight", "qa:migrate", "qa:seed", "deploy:qa", "smoke:qa", "smoke:qa:image-cover"]) {
      delete (inputs.packageJson.scripts as Record<string, string>)[script];
    }

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["QA environment", "QA resource isolation", "QA package scripts"]),
    );
  });

  it("requires the QA image-cover smoke package script", () => {
    const inputs = validInputs();
    delete (inputs.packageJson.scripts as Record<string, string>)["smoke:qa:image-cover"];

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA package scripts");
  });

  it("requires a credential-gated scheduled QA image-cover smoke workflow in preflight", () => {
    const result = validateDeploymentConfig(validInputs());

    expect(result.checks.map((item) => item.name)).toContain("QA image-cover smoke workflow");
    expect(result.errors.map((item) => item.name)).not.toContain("QA image-cover smoke workflow");
  });

  it("accepts QA image-cover block run steps followed by additional step properties", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"\n      - uses: actions/checkout@v6",
      "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"\n        shell: bash\n      - uses: actions/checkout@v6",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).not.toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows with mutation triggers or deploy commands", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = [
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 10 * * *\"",
      "  push:",
      "    branches: [main]",
      "jobs:",
      "  smoke:",
      "    steps:",
      "      - run: pnpm run smoke:qa:image-cover && pnpm exec wrangler deploy",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "      - run: wrangler secret list --env qa && echo OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY",
      "      - run: echo spoonjoy-v2-qa.mendelow-studio.workers.dev --target-env qa pnpm install --frozen-lockfile pnpm prisma:generate",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows with deploy commands even when triggers are allowed", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      "pnpm run smoke:qa:image-cover",
      "pnpm exec wrangler deploy",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows missing credential and provider secret gates", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = [
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 10 * * *\"",
      "jobs:",
      "  smoke:",
      "    steps:",
      "      - run: pnpm install --frozen-lockfile",
      "      - run: pnpm prisma:generate",
      "      - run: pnpm run smoke:qa:image-cover",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows without job steps", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = [
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 10 * * *\"",
      "jobs:",
      "  smoke:",
      "    runs-on: ubuntu-latest",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows that only echo required provider words", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = [
      "name: QA Image Cover Smoke",
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 10 * * *\"",
      "jobs:",
      "  smoke:",
      "    steps:",
      "      - name: Check GitHub Cloudflare credentials",
      "        id: cloudflare",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "        run: echo ready=false ready=true",
      "      - uses: actions/checkout@v6",
      "        if: steps.cloudflare.outputs.ready == 'true'",
      "      - run: pnpm install --frozen-lockfile",
      "        if: steps.cloudflare.outputs.ready == 'true'",
      "      - run: pnpm prisma:generate",
      "        if: steps.cloudflare.outputs.ready == 'true'",
      "      - name: Check QA image-provider secrets",
      "        id: qa-secrets",
      "        if: steps.cloudflare.outputs.ready == 'true'",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "        run: echo wrangler secret list --env qa OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY ready=false ready=true",
      "      - name: Run QA image-cover smoke",
      "        if: steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
      "        env:",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      "          SPOONJOY_QA_SMOKE_BASE_URL: https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "          SPOONJOY_QA_SMOKE_TARGET: --target-env qa",
      "        run: pnpm run smoke:qa:image-cover",
      "      - name: Upload QA image-cover smoke artifacts",
      "        if: always() && steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
      "        uses: actions/upload-artifact@v7",
      "        with:",
      "          path: qa-image-cover-smoke-artifacts/",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows without an on block", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = [
      "name: QA Image Cover Smoke",
      "jobs:",
      "  smoke:",
      "    steps:",
      "      - run: pnpm run smoke:qa:image-cover",
    ].join("\n");

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows with unsupported triggers beyond dispatch and schedule", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      "  schedule:\n    - cron: \"17 10 * * *\"",
      [
        "  schedule:",
        "    - cron: \"17 10 * * *\"",
        "  workflow_run:",
        "    workflows:",
        "      - CI",
        "    types:",
        "      - completed",
      ].join("\n"),
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("ignores non-key trigger lines in QA image-cover workflow trigger parsing", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      "  workflow_dispatch:",
      "  - malformed-trigger\n  workflow_dispatch:",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).not.toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows with duplicate allowed triggers but missing workflow dispatch", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      "  workflow_dispatch:\n  schedule:",
      "  schedule:\n  schedule:",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows with echo-only Cloudflare gates", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      [
        "        run: |",
        "          if [ -z \"${CLOUDFLARE_API_TOKEN:-}\" ] || [ -z \"${CLOUDFLARE_ACCOUNT_ID:-}\" ]; then",
        "            echo \"ready=false\" >> \"$GITHUB_OUTPUT\"",
        "            echo \"Skipping QA image-cover smoke because Cloudflare GitHub secrets are not configured.\"",
        "            exit 0",
        "          fi",
        "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"",
      ].join("\n"),
      [
        "        run: |",
        "          echo \"ready=false\" >> \"$GITHUB_OUTPUT\"",
        "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"",
      ].join("\n"),
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows that echo exit commands instead of executing them", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replaceAll(
      "            exit 0",
      "            echo \"exit 0\"",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows that echo provider gate commands instead of executing them", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow()
      .replace(
        '          secrets_json="$(pnpm exec wrangler secret list --env qa)"',
        '          echo "secrets_json=\\"$(pnpm exec wrangler secret list --env qa)\\""',
      )
      .replace(
        "          if ! printf '%s' \"$secrets_json\" | grep -Eq '\"(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\"'; then",
        "          echo \"if ! printf '%s' \\\"$secrets_json\\\" | grep -Eq '\\\"(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\\\"'; then\"",
      );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows that hide provider gate commands in a heredoc", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      [
        "        run: |",
        '          secrets_json="$(pnpm exec wrangler secret list --env qa)"',
        '          echo "$secrets_json"',
        "          if ! printf '%s' \"$secrets_json\" | grep -Eq '\"(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\"'; then",
        "            echo \"ready=false\" >> \"$GITHUB_OUTPUT\"",
        "            echo \"Skipping QA image-cover smoke because no QA image-provider secret is configured.\"",
        "            exit 0",
        "          fi",
        "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"",
      ].join("\n"),
      [
        "        run: |",
        "          cat <<'EOF'",
        '          secrets_json="$(pnpm exec wrangler secret list --env qa)"',
        '          echo "$secrets_json"',
        "          if ! printf '%s' \"$secrets_json\" | grep -Eq '\"(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\"'; then",
        "          echo \"ready=false\" >> \"$GITHUB_OUTPUT\"",
        "          echo \"Skipping QA image-cover smoke because no QA image-provider secret is configured.\"",
        "          exit 0",
        "          fi",
        "          echo \"ready=true\" >> \"$GITHUB_OUTPUT\"",
        "          EOF",
      ].join("\n"),
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows that set provider ready true after skip branches", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replaceAll(
      "            exit 0\n",
      "",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows with disjunctive mutation or artifact gates", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow()
      .replace(
        "        if: steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
        "        if: always() || steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
      )
      .replace(
        "        if: always() && steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
        "        if: always() || steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'",
      );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows whose artifact step omits the smoke artifact path", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      "          path: qa-image-cover-smoke-artifacts/",
      "          path: wrong-artifacts/",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("rejects QA image-cover workflows whose artifact step has no with block", () => {
    const inputs = validInputs();
    inputs.qaImageCoverSmokeWorkflow = validQaImageCoverSmokeWorkflow().replace(
      [
        "        with:",
        "          path: qa-image-cover-smoke-artifacts/",
      ].join("\n"),
      "        name: missing-with-block",
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toContain("QA image-cover smoke workflow");
  });

  it("flags QA resources that alias production resources", () => {
    const inputs = validInputs();
    inputs.wrangler.env = {
      qa: {
        d1_databases: [{ binding: "DB", database_name: "spoonjoy", database_id: "database-id" }],
        r2_buckets: [{ binding: "PHOTOS", bucket_name: "spoonjoy-photos" }],
        ratelimits: [
          {
            name: "API_TOKEN_RATE_LIMITER",
            namespace_id: "1001",
            simple: { limit: 120, period: 60 },
          },
        ],
        vars: { NODE_ENV: "production", SPOONJOY_BASE_URL: "https://spoonjoy.app" },
      },
    };

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["QA environment", "QA resource isolation"]),
    );
  });

  it("flags misnamed or duplicated QA rate-limit bindings", () => {
    const inputs = validInputs();
    const env = inputs.wrangler.env as Record<string, { ratelimits?: Array<Record<string, string>> }>;
    env.qa.ratelimits = [
      { name: "API_TOKEN_RATE_LIMITER", namespace_id: "2001" },
      { name: "API_TOKEN_RATE_LIMITER", namespace_id: "2001" },
      { name: "TYPO_AUTH_LIMITER", namespace_id: "2003" },
    ];

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["QA environment", "QA resource isolation"]),
    );
  });

  it("flags non-array and malformed QA rate-limit bindings", () => {
    const nonArrayInputs = validInputs();
    const malformedInputs = validInputs();
    const nonArrayEnv = nonArrayInputs.wrangler.env as Record<string, { ratelimits?: unknown }>;
    const malformedEnv = malformedInputs.wrangler.env as Record<string, { ratelimits?: unknown[] }>;
    nonArrayEnv.qa.ratelimits = "not-rate-limits";
    malformedEnv.qa.ratelimits = [
      null,
      "bad-entry",
      { name: "API_TOKEN_RATE_LIMITER", namespace_id: "2001" },
    ];

    const nonArrayResult = validateDeploymentConfig(nonArrayInputs);
    const malformedResult = validateDeploymentConfig(malformedInputs);

    expect(nonArrayResult.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["QA environment", "QA resource isolation"]),
    );
    expect(malformedResult.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining(["QA environment", "QA resource isolation"]),
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

  it("FAILS with a parse-error message when wrangler emits malformed JSON", async () => {
    const runWrangler = vi.fn(async () => ({ stdout: "[malformed json", stderr: "", exitCode: 0 }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("Could not parse wrangler JSON output");
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

  it("FAILS with stdout text when wrangler exits non-zero without stderr", async () => {
    const runWrangler = vi.fn(async () => ({
      stdout: "database unavailable on stdout",
      stderr: "",
      exitCode: 2,
    }));

    const check = await checkRemoteMigrations({ runWrangler, env: {} });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("database unavailable on stdout");
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

  it("documents the QA environment setup and safe verification flow", async () => {
    const [readme, deployDoc, deploymentDoc] = await Promise.all([
      readFile(`${process.cwd()}/README.md`, "utf8"),
      readFile(`${process.cwd()}/DEPLOY.md`, "utf8"),
      readFile(`${process.cwd()}/docs/deployment.md`, "utf8"),
    ]);
    const docs = `${readme}\n${deployDoc}\n${deploymentDoc}`;

    for (const term of [
      "spoonjoy-qa",
      "spoonjoy-photos-qa",
      "spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "pnpm run qa:preflight",
      "pnpm run qa:migrate",
      "pnpm run qa:seed",
      "pnpm run deploy:qa",
      "pnpm run smoke:qa",
      "CLOUDFLARE_ENV=qa",
      "SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG",
      "wrangler secret list --env qa",
      "wrangler secret put SESSION_SECRET --env qa",
      "POSTHOG_DISABLED=true",
      "IMAGE_PROVIDER_PRIMARY=gemini",
      "OAuth callback",
      "WebAuthn",
      "sj-qa-demo",
      "codex-smoke-",
      "--target-env qa",
      "Do not run broad production cleanup",
    ]) {
      expect(docs).toContain(term);
    }
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

  it("exposes QA preflight, migration, seed, deploy, and smoke scripts", async () => {
    const pkgRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/package.json`, "utf8"),
    );
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };

    expect(pkg.scripts["qa:preflight"]).toBe("tsx scripts/qa-preflight.ts");
    expect(pkg.scripts["qa:migrate"]).toBe("pnpm exec wrangler d1 migrations apply DB --remote --env qa");
    expect(pkg.scripts["qa:seed"]).toBe("node scripts/seed-qa.mjs --target-env qa");
    expect(pkg.scripts["deploy:qa"]).toBe(
      "SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run qa:preflight && CLOUDFLARE_ENV=qa pnpm run build && pnpm run qa:migrate && SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1 pnpm run qa:preflight && pnpm exec wrangler deploy --env qa",
    );
    expect(pkg.scripts["smoke:qa"]).toBe(
      "node scripts/smoke-live.mjs --target-env qa --base-url https://spoonjoy-v2-qa.mendelow-studio.workers.dev --out qa-live-smoke-artifacts",
    );
    expect(pkg.scripts["smoke:qa:image-cover"]).toBe(
      "node scripts/smoke-live.mjs --target-env qa --base-url https://spoonjoy-v2-qa.mendelow-studio.workers.dev --out qa-image-cover-smoke-artifacts --include-image-cover-smoke",
    );
  });

  it("includes live-smoke script helpers in coverage instrumentation", async () => {
    const configRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/vitest.config.ts`, "utf8"),
    );

    expect(configRaw).toContain("scripts/smoke-live-helpers.mjs");
    expect(configRaw).toContain("scripts/smoke-image-cover-live.mjs");
  });

  it("runs image-cover smoke after UI screenshot checks so R2 cleanup cannot break later page loads", async () => {
    const smokeRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/scripts/smoke-live.mjs`, "utf8"),
    );

    const accountSettingsScreenshotIndex = smokeRaw.indexOf("'05-account-settings'");
    const pushProbeIndex = smokeRaw.indexOf("report.pushPublicKeyStatus = pushResponse.status()");
    const imageCoverSmokeIndex = smokeRaw.indexOf("report.imageCoverSmoke = await runImageCoverSmokeFlow");

    expect(accountSettingsScreenshotIndex).toBeGreaterThan(-1);
    expect(pushProbeIndex).toBeGreaterThan(accountSettingsScreenshotIndex);
    expect(imageCoverSmokeIndex).toBeGreaterThan(pushProbeIndex);
  });
});

describe("QA image-cover smoke workflow", () => {
  it("runs only on manual dispatch and schedule with credential and QA secret gates", async () => {
    const workflow = await readFile(`${process.cwd()}/.github/workflows/qa-image-cover-smoke.yml`, "utf8");
    const result = validateDeploymentConfig({
      ...validInputs(),
      qaImageCoverSmokeWorkflow: workflow,
    });

    expect(result.errors.map((item) => item.name)).not.toContain("QA image-cover smoke workflow");
    expect(result.checks.find((item) => item.name === "QA image-cover smoke workflow")?.ok).toBe(true);
  });
});

describe("Storybook deploy warning cleanup", () => {
  it("accepts a single-job warning-clean Storybook deploy workflow", () => {
    const result = validateDeploymentConfig(inputsWithStorybookWorkflow(validStorybookWorkflow()));

    expect(result.errors.map((item) => item.name)).not.toContain("Storybook deploy workflow");
    expect(result.errors.map((item) => item.name)).not.toContain("Storybook generated deploy ignore");
    expect(result.errors.map((item) => item.name)).not.toContain("pnpm build script policy");
    expect(result.checks.find((item) => item.name === "Storybook deploy workflow")?.ok).toBe(true);
  });

  it("rejects deprecated Pages action, artifact actions, or a separate deploy job", () => {
    const pagesAction = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("cloudflare/wrangler-action@v4", "cloudflare/pages-action@v1")),
    );
    const mixedCasePagesAction = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("cloudflare/wrangler-action@v4", "Cloudflare/pages-action@v1")),
    );
    const uploadArtifact = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Prepare Cloudflare Pages deploy directory",
          [
            "      - uses: actions/upload-artifact@v7",
            "        if: github.ref == 'refs/heads/main'",
            "        with:",
            "          name: storybook-static",
            "          path: storybook-static",
            "      - name: Prepare Cloudflare Pages deploy directory",
          ].join("\n"),
        ),
      ),
    );
    const mixedCaseUploadArtifact = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Prepare Cloudflare Pages deploy directory",
          [
            "      - uses: Actions/upload-artifact@v7",
            "        if: github.ref == 'refs/heads/main'",
            "        with:",
            "          name: storybook-static",
            "          path: storybook-static",
            "      - name: Prepare Cloudflare Pages deploy directory",
          ].join("\n"),
        ),
      ),
    );
    const downloadArtifact = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          [
            "      - uses: actions/download-artifact@v8",
            "        if: github.ref == 'refs/heads/main'",
            "        with:",
            "          name: storybook-static",
            "          path: storybook-static",
            "      - name: Deploy to Cloudflare Pages",
          ].join("\n"),
        ),
      ),
    );
    const mixedCaseDownloadArtifact = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          [
            "      - uses: Actions/download-artifact@v8",
            "        if: github.ref == 'refs/heads/main'",
            "        with:",
            "          name: storybook-static",
            "          path: storybook-static",
            "      - name: Deploy to Cloudflare Pages",
          ].join("\n"),
        ),
      ),
    );
    const separateDeployJob = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow() + "\n  deploy-storybook:\n    if: github.ref == 'refs/heads/main'\n    needs: build-storybook\n    steps:\n      - run: echo deploy",
      ),
    );
    const renamedDeployJob = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow() +
          [
            "",
            "  other-deploy:",
            "    if: github.ref == 'refs/heads/main'",
            "    needs: build-storybook",
            "    steps:",
            "      - uses: cloudflare/wrangler-action@v4",
            "        with:",
            "          command: pages deploy storybook-static --project-name=spoonjoy-storybook",
          ].join("\n"),
      ),
    );
    const quotedRenamedDeployJob = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow() +
          [
            "",
            '  "other-deploy":',
            "    if: github.ref == 'refs/heads/main'",
            "    needs: build-storybook",
            "    steps:",
            "      - uses: cloudflare/wrangler-action@v4",
          ].join("\n"),
      ),
    );
    const singleQuotedRenamedDeployJob = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow() +
          [
            "",
            "  'other-deploy':",
            "    if: github.ref == 'refs/heads/main'",
            "    needs: build-storybook",
            "    steps:",
            "      - uses: cloudflare/wrangler-action@v4",
          ].join("\n"),
      ),
    );

    for (const result of [
      pagesAction,
      mixedCasePagesAction,
      uploadArtifact,
      mixedCaseUploadArtifact,
      downloadArtifact,
      mixedCaseDownloadArtifact,
      separateDeployJob,
      renamedDeployJob,
      quotedRenamedDeployJob,
      singleQuotedRenamedDeployJob,
    ]) {
      expect(result.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    }
  });

  it("requires deployment permissions, main-only deploy steps, and the GitHub deployment token", () => {
    const missingDeployPermission = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("      deployments: write\n", "")),
    );
    const missingPrepareGuard = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Prepare Cloudflare Pages deploy directory\n        if: github.ref == 'refs/heads/main'",
          "      - name: Prepare Cloudflare Pages deploy directory",
        ),
      ),
    );
    const missingDeployGuard = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages\n        if: github.ref == 'refs/heads/main'",
          "      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );
    const missingToken = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("          gitHubToken: ${{ secrets.GITHUB_TOKEN }}", "")),
    );

    expect(missingDeployPermission.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(missingPrepareGuard.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(missingDeployGuard.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(missingToken.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
  });

  it("requires push-to-main trigger and workflow-level Git default-branch config", () => {
    const missingOnBlock = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n  workflow_dispatch:\n", "")),
    );
    const missingPushMain = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("  push:\n    branches: [main]\n", "")),
    );
    const missingPullRequestMain = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("  pull_request:\n    branches: [main]\n", "")),
    );
    const extraPullRequestTarget = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "  workflow_dispatch:\n",
          "  pull_request_target:\n    branches: [main]\n  workflow_dispatch:\n",
        ),
      ),
    );
    const quotedExtraPullRequestTarget = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "  workflow_dispatch:\n",
          "  \"pull_request_target\":\n    branches: [main]\n  workflow_dispatch:\n",
        ),
      ),
    );
    const singleQuotedExtraPullRequestTarget = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "  workflow_dispatch:\n",
          "  'pull_request_target':\n    branches: [main]\n  workflow_dispatch:\n",
        ),
      ),
    );
    const missingGitConfig = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "env:\n  GIT_CONFIG_COUNT: '1'\n  GIT_CONFIG_KEY_0: init.defaultBranch\n  GIT_CONFIG_VALUE_0: main\n",
          "",
        ),
      ),
    );

    expect(missingOnBlock.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(missingPushMain.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(missingPullRequestMain.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(extraPullRequestTarget.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(quotedExtraPullRequestTarget.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(singleQuotedExtraPullRequestTarget.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    expect(missingGitConfig.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
  });

  it("rejects missing Storybook build job, steps, or build command", () => {
    const missingJob = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("  build-storybook:", "  compile-storybook:")),
    );
    const missingSteps = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "    steps:\n      - uses: actions/checkout@v6",
          "    no_steps:\n      - uses: actions/checkout@v6",
        ),
      ),
    );
    const missingBuildCommand = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("      - run: pnpm build-storybook\n", "")),
    );

    for (const result of [missingJob, missingSteps, missingBuildCommand]) {
      expect(result.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    }
  });

  it("requires clean deploy directory preparation and generated Pages wrangler config", () => {
    const missingPrepareStep = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          [
            "      - name: Prepare Cloudflare Pages deploy directory",
            "        if: github.ref == 'refs/heads/main'",
            "        run: |",
            "          rm -rf storybook-pages-deploy",
            "          mkdir -p storybook-pages-deploy",
            "          mv storybook-static storybook-pages-deploy/storybook-static",
            "          printf '%s\\n' '{' '  \"name\": \"spoonjoy-storybook\",' '  \"pages_build_output_dir\": \"storybook-static\"' '}' > storybook-pages-deploy/wrangler.json",
          ].join("\n"),
          "",
        ),
      ),
    );
    const missingWranglerJson = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "          printf '%s\\n' '{' '  \"name\": \"spoonjoy-storybook\",' '  \"pages_build_output_dir\": \"storybook-static\"' '}' > storybook-pages-deploy/wrangler.json\n",
          "",
        ),
      ),
    );
    const wrongOutputDir = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("\"pages_build_output_dir\": \"storybook-static\"", "\"pages_build_output_dir\": \"build/client\"")),
    );
    const missingPagesProjectName = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "          printf '%s\\n' '{' '  \"name\": \"spoonjoy-storybook\",' '  \"pages_build_output_dir\": \"storybook-static\"' '}' > storybook-pages-deploy/wrangler.json",
          "          printf '%s\\n' '{' '  \"pages_build_output_dir\": \"storybook-static\"' '}' > storybook-pages-deploy/wrangler.json",
        ),
      ),
    );

    for (const result of [missingPrepareStep, missingWranglerJson, wrongOutputDir]) {
      expect(result.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    }
    expect(missingPagesProjectName.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
  });

  it("rejects repo-root deploys and non-npm Wrangler action installs", () => {
    const missingWorkingDirectory = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("          workingDirectory: storybook-pages-deploy\n", "")),
    );
    const wrongWorkingDirectory = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("workingDirectory: storybook-pages-deploy", "workingDirectory: .")),
    );
    const wrongPackageManager = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("packageManager: npm", "packageManager: pnpm")),
    );
    const misleadingWranglerActionVersion = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("cloudflare/wrangler-action@v4", "cloudflare/wrangler-action@v40")),
    );
    const extraRepoRootDeployStep = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
          [
            "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
            "      - name: Legacy repo-root deploy",
            "        if: github.ref == 'refs/heads/main'",
            "        uses: cloudflare/wrangler-action@v4",
            "        with:",
            "          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
            "          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
            "          command: pages deploy storybook-static --project-name=spoonjoy-storybook",
          ].join("\n"),
        ),
      ),
    );
    const extraLegacyWranglerActionVersion = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
          [
            "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
            "      - name: Legacy repo-root deploy",
            "        if: github.ref == 'refs/heads/main'",
            "        uses: cloudflare/wrangler-action@v3",
            "        with:",
            "          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
            "          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
            "          command: pages deploy storybook-static --project-name=spoonjoy-storybook",
          ].join("\n"),
        ),
      ),
    );
    const extraQuotedLegacyWranglerActionVersion = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
          [
            "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
            "      - name: Legacy repo-root deploy",
            "        if: github.ref == 'refs/heads/main'",
            "        uses: \"cloudflare/wrangler-action@v3\"",
            "        with:",
            "          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
            "          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
            "          command: pages deploy storybook-static --project-name=spoonjoy-storybook",
          ].join("\n"),
        ),
      ),
    );
    const duplicateCleanDeployStep = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          "      - name: Deploy to Cloudflare Pages again\n        if: github.ref == 'refs/heads/main'\n        uses: cloudflare/wrangler-action@v4\n        with:\n          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}\n          workingDirectory: storybook-pages-deploy\n          packageManager: npm\n          command: pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true\n          gitHubToken: ${{ secrets.GITHUB_TOKEN }}\n      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );
    const extraRunDeployStep = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          "      - name: Legacy shell deploy\n        if: github.ref == 'refs/heads/main'\n        run: pnpm exec wrangler pages deploy storybook-static --project-name=spoonjoy-storybook\n      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );
    const extraRunDeployStepWithShellWhitespace = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          "      - name: Legacy shell deploy\n        if: github.ref == 'refs/heads/main'\n        run: pnpm exec wrangler pages  deploy storybook-static --project-name=spoonjoy-storybook\n      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );
    const extraRunDeployStepWithQuotedShellTokens = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          "      - name: Legacy shell deploy\n        if: github.ref == 'refs/heads/main'\n        run: pnpm exec wrangler \"pages\" 'deploy' storybook-static --project-name=spoonjoy-storybook\n      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );
    const extraRunDeployStepWithLineContinuation = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          "      - name: Legacy shell deploy\n        if: github.ref == 'refs/heads/main'\n        run: |\n          pnpm exec wrangler pages \\\n            deploy storybook-static --project-name=spoonjoy-storybook\n      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );
    const extraRunDeployStepWithFoldedScalar = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          "      - name: Deploy to Cloudflare Pages",
          "      - name: Legacy shell deploy\n        if: github.ref == 'refs/heads/main'\n        run: >\n          pnpm exec wrangler pages\n          deploy storybook-static --project-name=spoonjoy-storybook\n      - name: Deploy to Cloudflare Pages",
        ),
      ),
    );

    for (const result of [
      missingWorkingDirectory,
      wrongWorkingDirectory,
      wrongPackageManager,
      misleadingWranglerActionVersion,
      extraRepoRootDeployStep,
      extraLegacyWranglerActionVersion,
      extraQuotedLegacyWranglerActionVersion,
      duplicateCleanDeployStep,
      extraRunDeployStep,
      extraRunDeployStepWithShellWhitespace,
      extraRunDeployStepWithQuotedShellTokens,
      extraRunDeployStepWithLineContinuation,
      extraRunDeployStepWithFoldedScalar,
    ]) {
      expect(result.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    }
  });

  it("rejects a Storybook Wrangler deploy action without a with block", () => {
    const missingWith = validateDeploymentConfig(
      inputsWithStorybookWorkflow(
        validStorybookWorkflow().replace(
          [
            "        with:",
            "          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
            "          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
            "          workingDirectory: storybook-pages-deploy",
            "          packageManager: npm",
            "          command: pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true",
            "          gitHubToken: ${{ secrets.GITHUB_TOKEN }}",
          ].join("\n"),
          "",
        ),
      ),
    );

    expect(missingWith.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
  });

  it("requires explicit Pages commit metadata and dirty-state intent", () => {
    const missingBranch = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace(" --branch=${{ github.ref_name }}", "")),
    );
    const missingCommitHash = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace(" --commit-hash=${{ github.sha }}", "")),
    );
    const missingDirtyFlag = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace(" --commit-dirty=true", "")),
    );
    const dirtyFalse = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow().replace("--commit-dirty=true", "--commit-dirty=false")),
    );

    for (const result of [missingBranch, missingCommitHash, missingDirtyFlag, dirtyFalse]) {
      expect(result.errors.map((item) => item.name)).toContain("Storybook deploy workflow");
    }
  });

  it("requires .gitignore coverage for the generated Storybook Pages deploy directory", () => {
    const missingIgnore = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow(), { gitignore: "node_modules\nstorybook-static\n" }),
    );

    expect(missingIgnore.errors.map((item) => item.name)).toContain("Storybook generated deploy ignore");
  });

  it("requires root pnpm-workspace allowBuilds false entries for all ignored build-script packages", () => {
    const missingWorkspace = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow(), { pnpmWorkspace: "" }),
    );
    const missingPackage = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow(), {
        pnpmWorkspace: validPnpmWorkspace().replace("  protobufjs: false\n", ""),
      }),
    );
    const truePackage = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow(), {
        pnpmWorkspace: validPnpmWorkspace().replace("  sharp: false", "  sharp: true"),
      }),
    );

    for (const result of [missingWorkspace, missingPackage, truePackage]) {
      expect(result.errors.map((item) => item.name)).toContain("pnpm build script policy");
    }
  });

  it("ignores malformed and nested pnpm-workspace allowBuilds noise around required package entries", () => {
    const noisyWorkspace = validPnpmWorkspace().replace(
      "  core-js: false",
      "  malformed-entry\n  core-js: false\n    nested: false",
    );

    const result = validateDeploymentConfig(
      inputsWithStorybookWorkflow(validStorybookWorkflow(), { pnpmWorkspace: noisyWorkspace }),
    );

    expect(result.errors.map((item) => item.name)).not.toContain("pnpm build script policy");
  });

  it("accepts quoted Storybook workflow scalar values and nested with-block entries", () => {
    const inputs = inputsWithStorybookWorkflow(
      validStorybookWorkflow()
        .replaceAll("workingDirectory: storybook-pages-deploy", "workingDirectory: 'storybook-pages-deploy'")
        .replaceAll("packageManager: npm", 'packageManager: "npm"')
        .replace("apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}", "apiToken: '${{ secrets.CLOUDFLARE_API_TOKEN }}'")
        .replace("accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}", "accountId: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}'")
        .replace(
          "command: pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true",
          'command: "pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true"',
        )
        .replace("gitHubToken: ${{ secrets.GITHUB_TOKEN }}", "gitHubToken: '${{ secrets.GITHUB_TOKEN }}'")
        .replace(
          "          workingDirectory: 'storybook-pages-deploy'",
          "          metadata:\n            ignored: true\n          workingDirectory: 'storybook-pages-deploy'",
        ),
    );

    const result = validateDeploymentConfig(inputs);

    expect(result.errors.map((item) => item.name)).not.toContain("Storybook deploy workflow");
    expect(result.errors.map((item) => item.name)).not.toContain("Storybook generated deploy ignore");
    expect(result.errors.map((item) => item.name)).not.toContain("pnpm build script policy");
  });

  it("checks the current repository Storybook warning cleanup contract", async () => {
    const [workflow, gitignore, pnpmWorkspace] = await Promise.all([
      readFile(process.cwd() + "/.github/workflows/storybook.yml", "utf8"),
      readFile(process.cwd() + "/.gitignore", "utf8"),
      readFile(process.cwd() + "/pnpm-workspace.yaml", "utf8"),
    ]);
    const result = validateDeploymentConfig(inputsWithStorybookWorkflow(workflow, { gitignore, pnpmWorkspace }));

    expect(result.errors.map((item) => item.name)).not.toContain("Storybook deploy workflow");
    expect(result.errors.map((item) => item.name)).not.toContain("Storybook generated deploy ignore");
    expect(result.errors.map((item) => item.name)).not.toContain("pnpm build script policy");
    expect(result.checks.find((item) => item.name === "Storybook deploy workflow")?.ok).toBe(true);
  });
});

describe("wrangler QA environment", () => {
  it("defines an isolated Cloudflare QA environment", async () => {
    const wranglerRaw = await import("node:fs/promises").then((mod) =>
      mod.readFile(`${process.cwd()}/wrangler.json`, "utf8"),
    );
    const wrangler = JSON.parse(wranglerRaw) as {
      d1_databases: Array<{ binding: string; database_name: string; database_id: string }>;
      r2_buckets: Array<{ binding: string; bucket_name: string }>;
      ratelimits: Array<{ name: string; namespace_id: string }>;
      env?: Record<string, {
        d1_databases?: Array<{ binding: string; database_name: string; database_id: string }>;
        r2_buckets?: Array<{ binding: string; bucket_name: string }>;
        ratelimits?: Array<{ name: string; namespace_id: string }>;
        vars?: Record<string, string>;
      }>;
    };

    const qa = wrangler.env?.qa;
    expect(qa).toBeDefined();
    expect(qa?.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "spoonjoy-qa",
        database_id: "c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34",
      },
    ]);
    expect(qa?.r2_buckets).toEqual([{ binding: "PHOTOS", bucket_name: "spoonjoy-photos-qa" }]);
    expect(qa?.vars?.SPOONJOY_BASE_URL).toBe("https://spoonjoy-v2-qa.mendelow-studio.workers.dev");

    const productionRateLimits = new Set(wrangler.ratelimits.map((limiter) => limiter.namespace_id));
    expect(qa?.ratelimits?.map((limiter) => limiter.namespace_id)).toEqual(["2001", "2002", "2003"]);
    for (const limiter of qa?.ratelimits ?? []) {
      expect(productionRateLimits.has(limiter.namespace_id)).toBe(false);
    }

    expect(qa?.d1_databases?.[0]?.database_id).not.toBe(wrangler.d1_databases[0]?.database_id);
    expect(qa?.r2_buckets?.[0]?.bucket_name).not.toBe(wrangler.r2_buckets[0]?.bucket_name);
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
