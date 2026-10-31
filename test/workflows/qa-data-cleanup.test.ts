import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
type Workflow = {
  on: {
    schedule?: Array<{ cron: string }>;
    workflow_dispatch?: { inputs?: Record<string, { default?: string; type?: string }> };
  };
  permissions: Record<string, string>;
  env: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { if?: string; steps: Step[] }>;
};

const SOURCE = readFileSync(".github/workflows/qa-data-cleanup.yml", "utf8");
const read = (path: string) => parseDocument(readFileSync(path, "utf8")).toJS() as Workflow;
const workflow = parseDocument(SOURCE).toJS() as Workflow;
const smoke = read(".github/workflows/qa-image-cover-smoke.yml");
const steps = workflow.jobs.cleanup.steps;
const runs = steps.map((step) => step.run ?? "");
const CUTOFF = '--older-than-hours "$OLDER_THAN_HOURS" --as-of "$CLEANUP_AS_OF"';

describe("QA Data Cleanup workflow", () => {
  it("runs daily at a quiet hour and by hand, only on main, reading the repository and nothing else", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(workflow.on.schedule).toEqual([{ cron: "23 7 * * *" }]);
    expect(workflow.jobs.cleanup.if).toBe("github.repository == 'spoonjoy/spoonjoy-v2' && github.ref == 'refs/heads/main'");
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("never runs while the image-cover smoke is using its account", () => {
    expect(workflow.concurrency).toEqual(smoke.concurrency);
    const smokeHour = Number(smoke.on.schedule![0]!.cron.split(" ")[1]);
    expect(smokeHour).not.toBe(7);
  });

  it("gives scheduled and manual runs the same 6-hour cutoff, and the manual run can change it", () => {
    expect(workflow.on.workflow_dispatch?.inputs?.older_than_hours).toMatchObject({ type: "string", default: "6" });
    expect(workflow.env.OLDER_THAN_HOURS).toBe("${{ inputs.older_than_hours || '6' }}");
    // The input reaches the shell only as an environment variable, and is checked before use.
    expect(SOURCE.match(/\$\{\{\s*inputs\./g)).toHaveLength(1);
    expect(runs[0]).toContain('[[ "$OLDER_THAN_HOURS" =~ ^[1-9][0-9]*$ ]]');
  });

  it("fixes the moment the cutoff counts back from once, at the start, so every step chooses the same accounts", () => {
    expect(runs[0]).toContain('echo "CLEANUP_AS_OF=$(date +%s)" >> "$GITHUB_ENV"');
    expect(SOURCE.match(/CLEANUP_AS_OF=/g)).toHaveLength(1);
  });

  it("previews, applies, then confirms nothing older than the cutoff is left, every time with the cutoff", () => {
    const preview = runs.indexOf(`node scripts/cleanup-local-qa-data.mjs --target-env qa ${CUTOFF}`);
    const apply = runs.indexOf(`node scripts/cleanup-local-qa-data.mjs --target-env qa --apply ${CUTOFF}`);
    const confirm = runs.findIndex((run) => run.includes('test "$remaining" = "0"'));
    expect(preview).toBeGreaterThan(0);
    expect(apply).toBeGreaterThan(preview);
    expect(confirm).toBeGreaterThan(apply);
    expect(runs[confirm]).toContain("set -o pipefail");
    for (const run of runs.filter((text) => text.includes("cleanup-local-qa-data.mjs"))) {
      expect(run).toContain(CUTOFF);
    }
  });

  it("gives the Cloudflare token only to the steps that call Cloudflare", () => {
    for (const step of steps) {
      const callsCloudflare = /cleanup-local-qa-data|wrangler/.test(step.run ?? "");
      expect(step.env?.CLOUDFLARE_API_TOKEN !== undefined, step.name ?? step.uses).toBe(callsCloudflare);
    }
  });
});
