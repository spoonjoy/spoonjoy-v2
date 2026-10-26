import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; if?: string; env?: Record<string, string>; run?: string; uses?: string };
type Job = { needs?: string; environment?: string; steps: Step[] };
type Workflow = { on: Record<string, { inputs?: Record<string, { default?: string }> }>; jobs: Record<string, Job> };

const workflow = parseDocument(readFileSync(".github/workflows/production-image-key.yml", "utf8")).toJS() as Workflow;
const job = workflow.jobs["image-key"];

describe("Production Image Key workflow", () => {
  it("runs only by hand, defaults to the read-only report, and only from main's code", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs?.mode.default).toBe("report");
    expect(job.needs).toBe("guard");
    expect(workflow.jobs.guard.steps[0].run).toContain('"$GITHUB_REF" != "refs/heads/main"');
    expect(job.environment).toBe("production");
  });

  it("gives the OpenAI key only to the set-key step, through its environment", () => {
    const withKey = job.steps.filter((step) => step.env?.OPENAI_API_KEY !== undefined);
    expect(withKey).toHaveLength(1);
    expect(withKey[0]).toMatchObject({
      if: "inputs.mode == 'set-key'",
      env: { OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}" },
      run: "pnpm exec tsx scripts/production-image-key.ts set-key",
    });
    for (const step of job.steps) {
      expect(step.run ?? "").not.toContain("OPENAI_API_KEY");
    }
  });

  it("waits out a running Production Deploy before it makes a version", () => {
    const names = job.steps.map((step) => step.name);
    expect(names.indexOf("Wait for any in-flight Production Deploy")).toBeLessThan(names.indexOf("Store the key in production"));
  });
});
