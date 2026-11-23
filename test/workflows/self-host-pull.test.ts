// The Self-host Pull workflow checks what a self-hoster gets: ghcr.io/spoonjoy/spoonjoy:latest
// pulled with no login on amd64 and arm64, booted on an empty volume, healthy and serving pages.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; run?: string; uses?: string };
type Job = {
  "runs-on": string;
  if?: string;
  permissions?: Record<string, string>;
  strategy?: { matrix: { include: { arch: string; runner: string }[] } };
  steps: Step[];
};
type Workflow = {
  on: { workflow_run?: { workflows: string[]; types: string[]; branches: string[] }; workflow_dispatch?: unknown };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

const workflow = parse(readFileSync(".github/workflows/self-host-pull.yml", "utf8")) as Workflow;
const pull = workflow.jobs.pull;
const runs = pull.steps.map((step) => step.run ?? "").join("\n");

describe("Self-host Pull workflow", () => {
  it("runs after each Self-host Image run on main finishes green, and by hand", () => {
    expect(workflow.on.workflow_run).toEqual({ workflows: ["Self-host Image"], types: ["completed"], branches: ["main"] });
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(pull.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(pull.if).toContain("github.event_name == 'workflow_dispatch'");
  });

  it("pulls on an amd64 and an arm64 runner, with no package access and no login", () => {
    expect(pull.strategy?.matrix.include).toEqual([
      { arch: "amd64", runner: "ubuntu-24.04" },
      { arch: "arm64", runner: "ubuntu-24.04-arm" },
    ]);
    expect(pull["runs-on"]).toBe("${{ matrix.runner }}");
    expect(workflow.permissions).toEqual({});
    expect(pull.permissions).toBeUndefined();
    expect(runs).not.toMatch(/docker login/);
    expect(runs).toContain("docker logout ghcr.io");
    expect(runs).toContain('docker pull "$IMAGE:latest"');
  });

  it("asks GHCR for an anonymous pull token first, so a private package fails with a plain message", () => {
    expect(runs).toContain("https://ghcr.io/token?scope=repository:spoonjoy/spoonjoy:pull");
    expect(runs).toMatch(/not public/);
  });

  it("checks the pulled image is this arch, boots it on an empty volume and waits for its health check", () => {
    expect(runs).toContain("{{.Architecture}}");
    expect(runs).toContain('"$ARCH"');
    expect(runs).toMatch(/docker run -d --name sj -p 8080:8080 -v sj-data:\/data "\$IMAGE:latest"/);
    expect(runs).toContain(".State.Health.Status");
    expect(runs).toContain("curl -sf http://localhost:8080/health/ready");
    expect(runs).toMatch(/curl -sf http:\/\/localhost:8080\/ /);
  });

  it("pins every action to a commit", () => {
    for (const step of pull.steps) if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
  });
});
