import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIRECTORY = ".github/workflows";

function workflowSource(name: string): string {
  return readFileSync(`${WORKFLOW_DIRECTORY}/${name}`, "utf8");
}

describe("GitHub Actions supply-chain policy", () => {
  it("pins every action to an immutable commit with a readable version comment", () => {
    const mutableReferences: string[] = [];

    for (const file of readdirSync(WORKFLOW_DIRECTORY).filter((name) => name.endsWith(".yml"))) {
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
    expect(production).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(production).toContain("github.event.workflow_run.event == 'push'");
    expect(production).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it("checks out, validates, deploys, and records the same source SHA", () => {
    expect(production).toContain(
      "SOURCE_SHA: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.source_sha }}",
    );
    expect(production).toContain("ref: ${{ env.SOURCE_SHA }}");
    expect(production).toContain("grep -Eq '^[0-9a-f]{40}$'");
    expect(production).toContain('git merge-base --is-ancestor "$SOURCE_SHA" origin/main');
    expect(production).toContain('gh run list --workflow CI --branch main --commit "$SOURCE_SHA"');
    expect(production).toContain("--event push --status success");
    expect(production).toContain('pnpm run deploy:auto');
    expect(production).toContain('Source SHA: `%s`');

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
