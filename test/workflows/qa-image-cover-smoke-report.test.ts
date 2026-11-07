import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const WORKFLOW_PATH = ".github/workflows/qa-image-cover-smoke-report.yml";
const RUN_URL = "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/123";

type Step = { name: string; env: Record<string, string>; run: string; uses?: string };
type Job = { if?: string; container?: unknown; steps: Step[] };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };

function workflow(): Workflow {
  return parseDocument(readFileSync(WORKFLOW_PATH, "utf8")).toJS() as Workflow;
}

// Runs the report step with a fake gh that logs each call and answers `issue list` with
// FAKE_OPEN_ISSUE (empty when no issue is open).
function runReport(options: { result: string; openIssue?: string }) {
  const step = workflow().jobs.report.steps[0];
  const bin = mkdtempSync(path.join(tmpdir(), "qa-image-cover-report-"));
  const log = path.join(bin, "gh.log");
  writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
if [ "$1 $2" = "issue list" ]; then printf '%s' "$FAKE_OPEN_ISSUE"; fi
`,
  );
  chmodSync(path.join(bin, "gh"), 0o755);
  writeFileSync(log, "");
  execFileSync("bash", ["-e", "-c", step.run], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      SMOKE_RESULT: options.result,
      RUN_URL,
      FAKE_OPEN_ISSUE: options.openIssue ?? "",
    },
    encoding: "utf8",
  });
  return readFileSync(log, "utf8").trim().split("\n");
}

describe("QA image-cover smoke failure reporting", () => {
  it("reports each finished smoke run on main, with only issue write access", () => {
    const parsed = workflow();
    expect(parsed.on).toEqual({
      workflow_run: { workflows: ["QA Image Cover Smoke"], types: ["completed"], branches: ["main"] },
    });
    expect(parsed.permissions).toEqual({ issues: "write" });
    expect(Object.keys(parsed.jobs)).toEqual(["report"]);
    const report = parsed.jobs.report;
    expect(report.if).toBe(
      "github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.path == '.github/workflows/qa-image-cover-smoke.yml'",
    );
    expect(report.container).toBeUndefined();
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].uses).toBeUndefined();
    expect(report.steps[0].env.SMOKE_RESULT).toBe("${{ github.event.workflow_run.conclusion }}");
  });

  it("opens one labelled issue on a failure when none is open", () => {
    const calls = runReport({ result: "failure" });
    expect(calls[0]).toMatch(/^label create qa-image-cover-smoke --force/);
    expect(calls[1]).toMatch(/^issue list --state open --label qa-image-cover-smoke/);
    expect(calls[2]).toMatch(/^issue create --title QA image-cover smoke failing --label qa-image-cover-smoke --body .*failed \(failure\)/);
    expect(calls[2]).toContain(RUN_URL);
    expect(calls).toHaveLength(3);
  });

  it("comments on the open issue when the smoke fails again", () => {
    const calls = runReport({ result: "failure", openIssue: "42" });
    expect(calls[2]).toBe(`issue comment 42 --body Failed again (failure): ${RUN_URL}`);
    expect(calls).toHaveLength(3);
  });

  it("treats a cancelled or timed-out smoke run as a failure", () => {
    const calls = runReport({ result: "timed_out", openIssue: "42" });
    expect(calls[2]).toBe(`issue comment 42 --body Failed again (timed_out): ${RUN_URL}`);
  });

  it("closes the open issue when the smoke passes", () => {
    const calls = runReport({ result: "success", openIssue: "42" });
    expect(calls[2]).toBe(`issue close 42 --reason completed --comment Passed again: ${RUN_URL}`);
    expect(calls).toHaveLength(3);
  });

  it("does nothing more on a pass when no issue is open", () => {
    const calls = runReport({ result: "success" });
    expect(calls).toHaveLength(2);
  });
});
