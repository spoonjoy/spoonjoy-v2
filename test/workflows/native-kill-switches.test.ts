import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; if?: string; env?: Record<string, string>; run?: string; uses?: string };
type Job = { needs?: string; if?: string; environment?: string; concurrency?: { group: string; "cancel-in-progress"?: boolean }; steps: Step[] };
type Workflow = {
  on: Record<string, { inputs?: Record<string, { default?: string }> }>;
  concurrency?: { group: string };
  jobs: Record<string, Job>;
};

const workflow = parseDocument(readFileSync(".github/workflows/native-kill-switches.yml", "utf8")).toJS() as Workflow;
const imageKey = parseDocument(readFileSync(".github/workflows/production-image-key.yml", "utf8")).toJS() as Workflow;
const job = workflow.jobs.set;
const reportJob = workflow.jobs.report;

describe("Native Kill Switches workflow", () => {
  it("runs only by hand, defaults to the read-only report, and only from main's code", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs?.mode.default).toBe("report");
    expect(workflow.on.workflow_dispatch.inputs?.switches.default).toBe("none");
    expect(job.needs).toBe("guard");
    expect(reportJob.needs).toBe("guard");
    expect(workflow.jobs.guard.steps[0].run).toContain('"$GITHUB_REF" != "refs/heads/main"');
    expect(Object.keys(workflow.jobs)).toEqual(["guard", "report", "set"]);
    expect(reportJob.if).toBe("inputs.mode == 'report'");
    expect(job.if).toBe("inputs.mode == 'set'");
  });

  it("gives only set the production environment, and never runs it beside Production Image Key", () => {
    expect(job.environment).toBe("production");
    expect(job.concurrency).toEqual({ group: imageKey.concurrency!.group, "cancel-in-progress": false });
  });

  it("keeps report out of production's environment and its concurrency group, so a queued report never displaces a waiting set", () => {
    expect(workflow.concurrency).toBeUndefined();
    expect(reportJob.environment).toBeUndefined();
    expect(reportJob.concurrency).toBeUndefined();
    expect(reportJob.steps.some((step) => step.env !== undefined)).toBe(false);
    expect(reportJob.steps.at(-1)?.run).toBe("pnpm exec tsx scripts/native-kill-switches.ts report");
  });

  it("passes the switches input to the set step through its environment, never into a script", () => {
    const withSwitches = job.steps.filter((step) => step.env?.NATIVE_KILL_SWITCHES !== undefined);
    expect(withSwitches).toHaveLength(1);
    expect(withSwitches[0]).toMatchObject({
      env: { NATIVE_KILL_SWITCHES: "${{ inputs.switches }}" },
      run: "pnpm exec tsx scripts/native-kill-switches.ts set",
    });
    for (const step of [...job.steps, ...reportJob.steps]) {
      expect(step.run ?? "").not.toContain("inputs.switches");
    }
  });

  it("gives Cloudflare credentials only to the set step", () => {
    const withToken = job.steps.filter((step) => step.env?.CLOUDFLARE_WORKERS_API_TOKEN !== undefined);
    expect(withToken.map((step) => step.name)).toEqual(["Store the switches in production"]);
  });

  it("waits out a running Production Deploy before it makes a version", () => {
    const names = job.steps.map((step) => step.name);
    expect(names.indexOf("Wait for any in-flight Production Deploy")).toBeLessThan(names.indexOf("Store the switches in production"));
  });
});
