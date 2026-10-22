import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// A stalled Ubuntu mirror once held a Playwright system-package install until its job ran out of
// time. Every job that installs packages with apt (directly, or through Playwright's --with-deps)
// bounds apt's waits first, by writing this file.
const BOUND = "/etc/apt/apt.conf.d/99spoonjoy-timeouts";
const INSTALLS_WITH_APT = /\bapt-get\b|--with-deps\b/;

const workflowsDir = join(process.cwd(), ".github/workflows");

type Step = { name?: string; run?: string };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

function unboundedAptSteps(workflow: Workflow): string[] {
  const offenders: string[] = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    let bounded = false;
    for (const step of job.steps ?? []) {
      const run = step.run ?? "";
      const installAt = run.search(INSTALLS_WITH_APT);
      const boundAt = run.indexOf(BOUND);
      if (installAt !== -1 && !bounded && (boundAt === -1 || boundAt > installAt)) {
        offenders.push(`${jobName}: ${step.name ?? run.split("\n")[0]}`);
      }
      if (boundAt !== -1) bounded = true;
    }
  }
  return offenders;
}

describe("apt network bounds in workflows", () => {
  it("bounds apt's waits before every apt or Playwright --with-deps install, in every workflow", () => {
    const offenders = readdirSync(workflowsDir)
      .filter((file) => /\.ya?ml$/.test(file))
      .flatMap((file) => unboundedAptSteps(parse(readFileSync(join(workflowsDir, file), "utf8")) as Workflow)
        .map((offender) => `${file} ${offender}`));
    expect(offenders).toEqual([]);
  });

  it("flags an install that comes before the bound, and passes one that comes after", () => {
    const install = { name: "Install", run: "pnpm exec playwright install --with-deps chromium" };
    const bound = { name: "Bound", run: `printf 'Acquire::Retries "3";\\n' | sudo tee ${BOUND}` };
    expect(unboundedAptSteps({ jobs: { a: { steps: [install, bound] } } })).toEqual(["a: Install"]);
    expect(unboundedAptSteps({ jobs: { a: { steps: [bound, install] } } })).toEqual([]);
    expect(unboundedAptSteps({ jobs: { a: { steps: [{ name: "Both", run: `sudo sh -c 'x > ${BOUND}'\nsudo apt-get update` }] } } })).toEqual([]);
  });
});
