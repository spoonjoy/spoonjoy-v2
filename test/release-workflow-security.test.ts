import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIRECTORY = ".github/workflows";

function workflowSource(name: string): string {
  return readFileSync(`${WORKFLOW_DIRECTORY}/${name}`, "utf8");
}

describe("GitHub Actions supply-chain policy", () => {
  it("pins every action to an immutable commit with a readable version comment", () => {
    const mutableReferences: string[] = [];

    for (const file of readdirSync(WORKFLOW_DIRECTORY).filter((name) => /\.ya?ml$/.test(name))) {
      const lines = workflowSource(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/^\s*(?:-\s*)?uses:/.test(line)) return;
        if (!/uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\s+#\s+v\d+\s*$/.test(line)) {
          mutableReferences.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(mutableReferences).toEqual([]);
  });

  it("recognizes both supported workflow file extensions", () => {
    expect(["ci.yml", "release.yaml", "notes.md"].filter((name) => /\.ya?ml$/.test(name))).toEqual([
      "ci.yml",
      "release.yaml",
    ]);
  });
});

describe("production release provenance", () => {
  const production = workflowSource("production-deploy.yml");

  it("runs only after successful main-branch CI or an explicit exact-SHA dispatch", () => {
    expect(production).not.toMatch(/^\s{2}push:/m);
    expect(production).toContain("  workflow_run:");
    expect(production).toContain("    workflows: [CI]");
    expect(production).toContain("    branches: [main]");
    expect(production).toContain("    types: [completed]");
    expect(production).toContain("      source_sha:");
    expect(production).toContain("        required: true");
    expect(production).toContain("      rollback_version_id:");
    expect(production).not.toContain("      allow_rollback:");
    expect(production).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(production).toContain("github.event.workflow_run.event == 'push'");
    expect(production).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(production).toContain("github.event.workflow_run.path == '.github/workflows/ci.yml'");
    expect(production).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(production).toContain("environment: production");
  });

  it("checks out, validates, deploys, and records the same source SHA", () => {
    expect(production).toContain(
      "SOURCE_SHA: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.source_sha }}",
    );
    expect(production).toContain("ref: ${{ env.SOURCE_SHA }}");
    expect(production).toContain("persist-credentials: false");
    expect(production).toContain("grep -Eq '^[0-9a-f]{40}$'");
    expect(production).toContain('git merge-base --is-ancestor "$SOURCE_SHA" origin/main');
    expect(production).toContain('gh run list --workflow .github/workflows/ci.yml --branch main --commit "$SOURCE_SHA"');
    expect(production).toContain("--event push --status success");
    expect(production).toContain('test "$(git rev-parse origin/main)" = "$SOURCE_SHA"');
    expect(production).toContain("ROLLBACK_VERSION_ID: ${{ github.event_name == 'workflow_dispatch' && inputs.rollback_version_id || '' }}");
    expect(production).toContain('pnpm run deploy:auto -- --rollback-version-id "$ROLLBACK_VERSION_ID"');
    expect(production).not.toContain("ALLOW_ROLLBACK");
    expect(production).toContain('pnpm run deploy:auto');
    expect(production).not.toMatch(/^\s{2}VITE_POSTHOG_HOST:/m);
    expect(production).toContain('Source SHA: `%s`');
    expect(production).not.toMatch(/^\s{2}issues:\s+write$/m);
    expect(production).toMatch(/report-canary:[\s\S]*permissions:[\s\S]*issues: write/);

    const checkout = production.indexOf("ref: ${{ env.SOURCE_SHA }}");
    const validation = production.indexOf("name: Validate release source");
    const setup = production.indexOf("name: Setup Node.js");
    const deploy = production.indexOf("pnpm run deploy:auto");
    const record = production.indexOf('Source SHA: `%s`');
    expect(checkout).toBeGreaterThan(-1);
    expect(checkout).toBeLessThan(validation);
    expect(validation).toBeLessThan(setup);
    expect(setup).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(record);
  });
});

describe("web dependency advisory gate", () => {
  const ci = workflowSource("ci.yml");

  it("runs a fail-closed OSV-compatible pnpm-lock advisory scan in canonical CI", () => {
    const advisoryScan = readFileSync("scripts/advisory-scan.ts", "utf8");

    expect(ci).toContain("advisory");
    expect(ci).toContain("pnpm run advisory:scan");
    expect(advisoryScan).toContain('"--lockfile=pnpm-lock.yaml"');
    expect(ci).toContain("osv-scanner_linux_amd64");
    expect(ci).toContain("bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc");
    expect(ci).toContain("https://api.github.com/repos/google/osv-scanner/git/ref/tags/${OSV_SCANNER_VERSION}");
    expect(ci).toContain(
      "node scripts/warning-gate.ts -- jq -e --arg expected \"$OSV_SCANNER_TAG_SHA\" '.object | select(.type == \"commit\" and .sha == $expected)' .cache/osv-scanner/tag.json",
    );
    expect(ci).toContain("pnpm install --frozen-lockfile --ignore-scripts");

    const tagVerification = ci.indexOf("jq -e --arg expected");
    const binaryDownload = ci.indexOf("osv-scanner_linux_amd64");
    const dependencyInstall = ci.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
    const advisoryRun = ci.indexOf("pnpm run advisory:scan");
    expect(tagVerification).toBeGreaterThan(-1);
    expect(binaryDownload).toBeGreaterThan(tagVerification);
    expect(dependencyInstall).toBeGreaterThan(binaryDownload);
    expect(advisoryRun).toBeGreaterThan(dependencyInstall);
  });

  it("requires the advisory job before production deploy can release an exact SHA", () => {
    const production = workflowSource("production-deploy.yml");

    expect(production).toContain("required_job=advisory");
  });
});

describe("CI warning suppression at source", () => {
  const ci = workflowSource("ci.yml");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  it("hides only Prisma's supported update message before every gated client generation", () => {
    const envIndex = ci.indexOf('  PRISMA_HIDE_UPDATE_MESSAGE: "1"');
    const jobsIndex = ci.indexOf("\njobs:");
    const generateCommands = Array.from(
      ci.matchAll(/node scripts\/warning-gate\.ts -- pnpm prisma:generate/g),
      (match) => match.index,
    );

    expect(envIndex).toBeGreaterThan(-1);
    expect(envIndex).toBeLessThan(jobsIndex);
    expect(generateCommands).toHaveLength(2);
    expect(generateCommands.every((index) => index > envIndex)).toBe(true);
    expect(packageJson.scripts.postinstall).toBe(
      "PRISMA_HIDE_UPDATE_MESSAGE=1 prisma generate",
    );
    expect(packageJson.scripts["prisma:generate"]).toBe(
      "PRISMA_HIDE_UPDATE_MESSAGE=1 prisma generate",
    );
  });

  it("does not add a Prisma update-banner allowance to the warning gate", () => {
    const warningGate = readFileSync("scripts/warning-gate.ts", "utf8");

    expect(warningGate).not.toContain("PRISMA_HIDE_UPDATE_MESSAGE");
    expect(warningGate).not.toContain("Update available 6.19.2 -> 7.8.0");
  });

  it("disables only the ephemeral runner's needrestart hook during gated Playwright setup", () => {
    expect(ci).toContain([
      "      - name: 🎭 Install Playwright Browsers",
      "        run: |",
      "          node scripts/warning-gate.ts -- pnpm exec playwright install-deps --dry-run chromium",
      "          node scripts/warning-gate.ts -- sudo apt-get update",
      "          node scripts/warning-gate.ts -- sudo env NEEDRESTART_SUSPEND=1 apt-get install -y --no-install-recommends xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2",
      "          node scripts/warning-gate.ts -- pnpm exec playwright install chromium",
    ].join("\n"));
    expect(ci.match(/NEEDRESTART_SUSPEND=1/g)).toHaveLength(1);
    expect(ci).not.toMatch(/^\s*NEEDRESTART_SUSPEND:/m);
    expect(ci).not.toMatch(/sudo[^\n]*(?:node|pnpm|corepack|node_modules|\.js)/);
  });

  it("warning-gates every Corepack command in canonical CI", () => {
    expect(ci.match(/node scripts\/warning-gate\.ts -- corepack enable/g)).toHaveLength(3);
    expect(ci).not.toMatch(/^\s*corepack\s/m);
  });
});
