import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; env?: Record<string, string>; run?: string };
type Job = { needs?: string; environment?: string; steps: Step[] };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };

const workflow = parseDocument(readFileSync(".github/workflows/account-activity.yml", "utf8")).toJS() as Workflow;
const lookup = workflow.jobs.lookup;

describe("Account Activity workflow", () => {
  it("runs only by hand and only from main's code", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.jobs)).toEqual(["guard", "lookup"]);
    expect(lookup.needs).toBe("guard");
    expect(workflow.jobs.guard.steps[0].run).toContain('"$GITHUB_REF" != "refs/heads/main"');
  });

  it("runs only the read-only lookup script with the D1 credentials", () => {
    const withToken = lookup.steps.filter((step) => step.env?.CLOUDFLARE_D1_API_TOKEN !== undefined);
    expect(withToken).toHaveLength(1);
    expect(withToken[0].run).toBe('pnpm exec tsx scripts/account-activity.ts "$ACCOUNT"');
    expect(lookup.environment).toBe("production");
  });

  it("passes the account input through the environment, never into a script", () => {
    expect(lookup.steps.at(-1)?.env?.ACCOUNT).toBe("${{ inputs.account }}");
    for (const step of lookup.steps) expect(step.run ?? "").not.toContain("inputs.account");
  });
});
