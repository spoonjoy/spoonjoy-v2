import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const WORKFLOW_PATH = ".github/workflows/qa-image-cover-smoke.yml";
const RUN_URL = "https://github.com/spoonjoy/spoonjoy-v2/actions/runs/123";

type Step = { name: string; env: Record<string, string>; run: string; uses?: string };
type Job = {
  needs?: string;
  if?: string;
  "runs-on"?: string;
  container?: unknown;
  permissions?: Record<string, string>;
  steps: Step[];
};
type Workflow = { jobs: Record<string, Job> };

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
  it("reports every main run after the smoke, with only issue write access, outside the browser image", () => {
    const report = workflow().jobs.report;
    expect(report.needs).toBe("smoke");
    expect(report.if).toBe("always() && github.ref == 'refs/heads/main'");
    expect(report.permissions).toEqual({ issues: "write" });
    expect(report.container).toBeUndefined();
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].uses).toBeUndefined();
    expect(report.steps[0].env.SMOKE_RESULT).toBe("${{ needs.smoke.result }}");
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

  it("treats a cancelled or timed-out smoke as a failure", () => {
    const calls = runReport({ result: "cancelled", openIssue: "42" });
    expect(calls[2]).toBe(`issue comment 42 --body Failed again (cancelled): ${RUN_URL}`);
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
