import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { if?: string; steps: Step[] }>;
};

const read = (path: string) => parseDocument(readFileSync(path, "utf8")).toJS() as Workflow;
const workflow = read(".github/workflows/qa-data-cleanup.yml");
const smoke = read(".github/workflows/qa-image-cover-smoke.yml");
const steps = workflow.jobs.cleanup.steps;

describe("QA Data Cleanup workflow", () => {
  it("runs only when dispatched by hand on main, reading the repository and nothing else", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.jobs.cleanup.if).toBe("github.repository == 'spoonjoy/spoonjoy-v2' && github.ref == 'refs/heads/main'");
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("never runs while the image-cover smoke is using its account", () => {
    expect(workflow.concurrency).toEqual(smoke.concurrency);
  });

  it("previews, applies, then confirms no smoke account is left", () => {
    const runs = steps.map((step) => step.run ?? "");
    const preview = runs.indexOf("pnpm run cleanup:remote:qa");
    const apply = runs.indexOf("pnpm run cleanup:remote:qa:apply");
    const confirm = runs.findIndex((run) => run.includes("email LIKE 'codex-smoke-%'"));
    expect(preview).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(preview);
    expect(confirm).toBeGreaterThan(apply);
    expect(runs[confirm]).toContain('test "$remaining" = "0"');
  });

  it("gives the Cloudflare token only to the steps that call Cloudflare", () => {
    for (const step of steps) {
      const callsCloudflare = /cleanup:remote:qa|wrangler/.test(step.run ?? "");
      expect(step.env?.CLOUDFLARE_API_TOKEN !== undefined, step.name ?? step.uses).toBe(callsCloudflare);
    }
  });
});
