import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; env?: Record<string, string>; run?: string; uses?: string; with?: Record<string, unknown> };
type Job = { needs?: string; environment?: string; steps: Step[] };
type Workflow = { on: Record<string, unknown>; concurrency: { group: string; "cancel-in-progress": boolean }; jobs: Record<string, Job> };

const workflow = parseDocument(readFileSync(".github/workflows/production-push-relay-key.yml", "utf8")).toJS() as Workflow;
const job = workflow.jobs["relay-key"];

describe("Production Push Relay Key workflow", () => {
  it("runs only by hand, and only from main's code, in the production environment", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(job.needs).toBe("guard");
    expect(workflow.jobs.guard.steps[0].run).toContain('"$GITHUB_REF" != "refs/heads/main"');
    expect(job.environment).toBe("production");
  });

  it("never runs beside another workflow that makes production Worker versions", () => {
    expect(workflow.concurrency).toEqual({ group: "production-image-key", "cancel-in-progress": false });
  });

  it("checks out without credentials, installs without scripts, and pins each action to a commit", () => {
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({ "persist-credentials": false });
    expect(job.steps.map((step) => step.run ?? "")).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    for (const step of job.steps.filter((s) => s.uses)) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
  });

  it("gives only the Cloudflare credentials to the one step that stores the key, after any Production Deploy", () => {
    const withSecrets = job.steps.filter((step) => JSON.stringify(step.env ?? {}).includes("secrets."));
    expect(withSecrets).toEqual([
      expect.objectContaining({
        name: "Register production and store its key",
        env: {
          CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
          CLOUDFLARE_WORKERS_API_TOKEN: "${{ secrets.CLOUDFLARE_WORKERS_API_TOKEN }}",
        },
        run: "pnpm exec tsx scripts/production-push-relay-key.ts",
      }),
    ]);
    const names = job.steps.map((step) => step.name);
    expect(names.indexOf("Wait for any in-flight Production Deploy")).toBeLessThan(names.indexOf("Register production and store its key"));
  });
});
