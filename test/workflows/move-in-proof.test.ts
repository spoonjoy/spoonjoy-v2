import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { SOURCE_VERSIONS } from "../../scripts/move-in-proof/adapters/mealie/profile.mjs";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  strategy?: { matrix: Record<string, unknown> };
  steps: Step[];
};
type Workflow = {
  on: Record<string, { paths?: string[]; branches?: string[] } | Array<{ cron: string }> | null>;
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
};

const SOURCE = readFileSync(".github/workflows/move-in-proof.yml", "utf8");
const workflow = parseDocument(SOURCE).toJS() as Workflow;

describe("Move-in Proof workflow", () => {
  it("runs by hand, weekly, and only on pull requests that change the harness", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "schedule", "workflow_dispatch"]);
    expect(workflow.on.schedule).toEqual([{ cron: "41 5 * * 1" }]);
    expect((workflow.on.pull_request as { paths: string[] }).paths).toEqual([
      "scripts/move-in-proof/**",
      ".github/workflows/move-in-proof.yml",
    ]);
  });

  it("seeds every source version the adapter knows, in each chosen size", () => {
    expect(workflow.jobs.seed.strategy?.matrix.source).toEqual(SOURCE_VERSIONS.map((source) => source.version));
    expect(workflow.jobs.seed.strategy?.matrix.size).toBe("${{ fromJSON(needs.plan.outputs.sizes) }}");
    expect(workflow.env.SIZES).toBe("${{ inputs.sizes || 'small,large' }}");
  });

  it("reads the repository everywhere and writes only the release, from main, never for a pull request", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "publish") expect(job.permissions).toBeUndefined();
    }
    expect(workflow.jobs.publish.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.publish.if).toContain("github.event_name != 'pull_request' && github.ref == 'refs/heads/main'");
    expect(SOURCE).not.toContain("secrets.");
  });

  it("proves the manifest is the same on two writes before it checks and publishes the fixtures", () => {
    const runs = workflow.jobs.manifest.steps.map((step) => step.run ?? "");
    const twice = runs.findIndex((run) => run.includes("cmp manifest-a.json manifest-b.json"));
    const check = runs.findIndex((run) => run.includes("manifest-cli.mjs check move-in-proof"));
    expect(twice).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(twice);
    expect(workflow.jobs.publish.needs).toBe("manifest");
  });
});
