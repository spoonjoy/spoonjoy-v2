import { describe, expect, it } from "vitest";
import { runDeploymentPreflight, validateDeploymentConfig, type DeploymentPreflightInputs } from "../../scripts/deployment-preflight";

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
        deploy: "pnpm build && npx -p wrangler@4.55.0 wrangler deploy",
        "deploy:preflight": "tsx scripts/deployment-preflight.ts",
        typecheck: "react-router typegen && tsc",
        "test:coverage": "vitest run --coverage",
        "test:e2e": "playwright test",
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
    const result = await runDeploymentPreflight();

    expect(result.errors).toEqual([]);
    expect(result.checks.every((item) => item.ok || item.severity === "warning")).toBe(true);
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

  it("reports NODE_ENV as a warning instead of a hard failure", () => {
    const inputs = validInputs();
    inputs.wrangler.vars = { NODE_ENV: "development" };

    const result = validateDeploymentConfig(inputs);

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((item) => item.name)).toContain("production node env");
  });
});
