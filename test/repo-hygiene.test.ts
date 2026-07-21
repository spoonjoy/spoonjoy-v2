import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const GENERATED_ARTIFACT_PATHS = [
  "coverage/",
  "build/",
  "playwright-report/",
  "test-results/",
  "storybook-static/",
  ".react-router/",
];

function gitLines(args: string[]) {
  const output = execFileSync("git", args, { encoding: "utf8" }).trim();
  return output ? output.split("\n") : [];
}

describe("generated artifact hygiene", () => {
  it("does not track generated local artifact directories", () => {
    expect(gitLines(["ls-files", ...GENERATED_ARTIFACT_PATHS])).toEqual([]);
  });

  it("keeps generated local artifact directories ignored", () => {
    for (const artifactPath of GENERATED_ARTIFACT_PATHS) {
      expect(() => execFileSync("git", ["check-ignore", "-q", artifactPath])).not.toThrow();
    }
  });

  it("does not track local SQLite databases and ignores nested Prisma databases", () => {
    expect(gitLines(["ls-files", "*.db", "*.sqlite", "*.sqlite3"])).toEqual([]);
    expect(() => execFileSync("git", ["check-ignore", "-q", "prisma/prisma/dev.db"])).not.toThrow();
  });
});

describe("pre-install workflow bootstrap", () => {
  it("keeps the warning gate limited to Node built-ins before dependencies are installed", () => {
    const warningGate = readFileSync("scripts/warning-gate.ts", "utf8");
    const importSpecifiers = Array.from(
      warningGate.matchAll(/^import(?:\s+type)?[\s\S]*?\sfrom\s+["']([^"']+)["'];?$/gm),
      (match) => match[1],
    );

    expect(importSpecifiers).not.toEqual([]);
    expect(importSpecifiers.every((specifier) => specifier.startsWith("node:"))).toBe(true);
  });
});

describe("UI audit tooling", () => {
  it("keeps the UI audit inventory and crawl scripts in the repo", () => {
    expect(existsSync("scripts/inventory-ui.mjs")).toBe(true);
    expect(existsSync("scripts/crawl-ui.mjs")).toBe(true);
    expect(existsSync("scripts/smoke-live.mjs")).toBe(true);
    expect(existsSync("scripts/smoke-mcp-oauth-live.mjs")).toBe(true);
    expect(existsSync("scripts/report-mcp-oauth-canary.mjs")).toBe(true);
    expect(existsSync("scripts/audit-mcp-oauth-d1.mjs")).toBe(true);
    expect(existsSync("scripts/cleanup-local-qa-data.mjs")).toBe(true);
    expect(existsSync("scripts/seed-demo-kitchen.mjs")).toBe(false);
  });

  it("keeps MCP OAuth canary package and workflow wiring in place", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const productionDeploy = readFileSync(".github/workflows/production-deploy.yml", "utf8");
    const productionRelease = readFileSync("scripts/deploy-production-canary.ts", "utf8");
    const canaryWorkflow = readFileSync(".github/workflows/mcp-oauth-canary.yml", "utf8");
    const auditWorkflow = readFileSync(".github/workflows/mcp-oauth-d1-audit.yml", "utf8");
    const parsedProductionDeploy = parseDocument(productionDeploy).toJS() as {
      jobs: { deploy: { steps: Array<{ run?: string }> } };
    };

    expect(packageJson.scripts?.["smoke:mcp:oauth"]).toBe(
      "node scripts/smoke-mcp-oauth-live.mjs --target-env production --base-url https://spoonjoy.app",
    );
    expect(packageJson.scripts?.["audit:mcp:oauth"]).toBe(
      "node scripts/audit-mcp-oauth-d1.mjs --target-env production --base-url https://spoonjoy.app",
    );
    expect(parsedProductionDeploy.jobs.deploy.steps).toContainEqual(
      expect.objectContaining({ run: "node scripts/workflow-security.mjs run-production-deploy" }),
    );
    expect(productionRelease).toContain('"run", "smoke:mcp:oauth"');
    expect(productionDeploy).toContain("node scripts/report-mcp-oauth-canary.mjs");
    expect(productionDeploy).toContain("issues: write");
    expect(productionDeploy).toContain("path: mcp-oauth-canary-artifacts/");
    expect(canaryWorkflow).toContain("schedule:");
    expect(canaryWorkflow).toContain("pnpm run smoke:mcp:oauth -- --out mcp-oauth-canary-artifacts");
    expect(canaryWorkflow).toContain("--manage-issue");
    expect(canaryWorkflow).toContain("issues: write");
    expect(canaryWorkflow).toContain("path: mcp-oauth-canary-artifacts/");
    expect(auditWorkflow).toContain("schedule:");
    expect(auditWorkflow).toContain("pnpm run audit:mcp:oauth -- --out mcp-oauth-d1-audit-artifacts");
    expect(auditWorkflow).toContain("path: mcp-oauth-d1-audit-artifacts/");
  });

  it("documents MCP OAuth operations and real-Claude verification", () => {
    const ops = readFileSync("docs/mcp-oauth-ops.md", "utf8");

    expect(ops).toContain("MCP OAuth Operations");
    expect(ops).toContain("MCP OAuth canary failing");
    expect(ops).toContain("ofid_");
    expect(ops).toContain("mcp-oauth-d1-audit-results.json");
    expect(ops).toContain("Real-Claude Manual Smoke");
    expect(ops).toContain("PostHog");
  });

  it("documents repo-local UI audit commands instead of local skill paths", () => {
    const report = readFileSync("docs/ui-systems-audit-report.md", "utf8");

    expect(report).toContain("node scripts/inventory-ui.mjs");
    expect(report).toContain("node scripts/crawl-ui.mjs");
    expect(report).not.toContain("/Users/arimendelow/.codex/skills/ui-systems-audit/scripts");
  });

  it("fails crawls for skipped auth, failing HTTP, console errors, and visual defects", async () => {
    const { summarizeCrawlFailures } = await import("../scripts/crawl-ui.mjs");
    const route = { name: "recipe", path: "/recipes/r1" };

    expect(
      summarizeCrawlFailures([
        { route, viewport: "mobile", skipped: "auth-not-available" },
        { route, viewport: "desktop", httpStatus: 404 },
        { route, viewport: "tablet", consoleErrors: ["boom"], pageErrors: ["kaboom"] },
        {
          route,
          viewport: "mobile",
          audit: {
            horizontalOverflow: true,
            scrollWidth: 391,
            viewportWidth: 390,
            smallTargets: [{ label: "x" }],
            clippedText: [{ text: "y" }],
          },
        },
      ])
    ).toEqual([
      "mobile:recipe skipped (auth-not-available)",
      "desktop:recipe returned HTTP 404",
      "tablet:recipe logged 1 console error(s)",
      "tablet:recipe raised 1 page error(s)",
      "mobile:recipe has horizontal overflow (391px > 390px)",
      "mobile:recipe has 1 undersized target(s)",
      "mobile:recipe has 1 clipped text node(s)",
    ]);
  });

  it("allows auth skips only when explicitly requested", async () => {
    const { summarizeCrawlFailures } = await import("../scripts/crawl-ui.mjs");

    expect(
      summarizeCrawlFailures(
        [{ route: { name: "settings", path: "/account/settings" }, viewport: "mobile", skipped: "auth-not-available" }],
        { allowAuthSkips: true }
      )
    ).toEqual([]);
  });
});
