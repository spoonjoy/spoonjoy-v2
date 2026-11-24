import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

type Step = { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> };
const workflow = parseDocument(readFileSync(".github/workflows/journeys.yml", "utf8")).toJS();
const steps: Step[] = Object.values(workflow.jobs as Record<string, { steps?: Step[] }>).flatMap((job) => job.steps ?? []);
const cleanupStep = steps.find((step) => step.id === "cleanup-qa-data")!;
const CLEANUP = "node scripts/warning-gate.ts -- pnpm run cleanup:remote:qa:apply";

// Runs the step's script in the shell Actions uses, with the cleanup command replaced by one that
// exits with `status`.
function runStep(status: number, suiteOutcome: string) {
  const script = cleanupStep.run!.replace(CLEANUP, `(exit ${status})`);
  const dir = mkdtempSync(join(tmpdir(), "journeys-qa-cleanup-"));
  const outputFile = join(dir, "output");
  writeFileSync(outputFile, "");
  try {
    const stdout = execFileSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
      env: { PATH: process.env.PATH, SUITE_OUTCOME: suiteOutcome, GITHUB_OUTPUT: outputFile },
      encoding: "utf8",
    });
    return { code: 0, stdout, output: readFileSync(outputFile, "utf8") };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { code: failed.status, stdout: failed.stdout, output: readFileSync(outputFile, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Journeys' QA cleanup step", () => {
  it("runs the cleanup through the warning gate and reads the suite's outcome", () => {
    expect(cleanupStep.run).toContain(CLEANUP);
    expect(cleanupStep.env?.SUITE_OUTCOME).toBe("${{ steps.suite.outcome }}");
  });

  it("passes with a job-log warning when only Cloudflare's API failed it and every journey passed", () => {
    const result = runStep(75, "success");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^::warning title=QA cleanup incomplete::Cloudflare's API kept failing/m);
    expect(result.output).toBe("");
  });

  it("still uploads the reports after a warned pass, since they gate only on the step passing", () => {
    const uploads = steps.filter((step) => step.if?.includes("steps.cleanup-qa-data"));
    expect(uploads.map((step) => step.name)).toEqual(["Upload journeys report", "Upload parity shots", "Upload explore report"]);
    for (const step of uploads) {
      expect(step.if).toContain("steps.cleanup-qa-data.outcome == 'success'");
      expect(step.if).not.toContain("steps.cleanup-qa-data.outputs");
    }
  });

  it("retries Cloudflare's own failures in the QA database setup and password rotation", () => {
    const run = (name: string) => steps.find((step) => step.name === name)?.run ?? "";
    expect(run("Migrate this run's QA database")).toBe("node scripts/retry-cloudflare.mjs -- pnpm run qa:migrate");
    expect(run("Rotate persona passwords")).toBe("node scripts/retry-cloudflare.mjs -- pnpm run seed:qa:kitchen -- --rotate");
    const seeds = steps.filter((step) => step.run?.includes("seed:qa:kitchen -- --credentials-out"));
    expect(seeds).toHaveLength(1);
    expect(seeds[0].run).toContain('node scripts/retry-cloudflare.mjs -- pnpm run seed:qa:kitchen -- --credentials-out "$SPOONJOY_QA_CREDENTIALS"');
  });

  it("fails as before on any other failure, or when the journeys did not pass", () => {
    expect(runStep(0, "success")).toEqual({ code: 0, stdout: "", output: "" });
    expect(runStep(1, "success").code).toBe(1);
    expect(runStep(75, "failure").code).toBe(75);
    expect(runStep(75, "skipped").code).toBe(75);
  });
});
