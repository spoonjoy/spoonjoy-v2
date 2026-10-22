// Every job that runs a browser runs in Playwright's image, so it installs nothing from Ubuntu's
// mirror, whose downloads can stall for a whole job. The image is pinned by digest, at the version
// package.json pins for Playwright, on the runner whose Ubuntu matches it.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PLAYWRIGHT_CONTAINER, PLAYWRIGHT_RUNNER } from "../../scripts/deployment-preflight";

const ROOT = resolve(__dirname, "../..");
const WORKFLOWS = join(ROOT, ".github/workflows");
const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { "runs-on"?: string; container?: { image?: string; options?: string }; steps?: Step[] };

const workflows = readdirSync(WORKFLOWS)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    return { file, text, jobs: (parse(text) as { jobs: Record<string, Job> }).jobs };
  });

// The jobs that launch Chromium or WebKit.
const BROWSER_JOBS = [
  ["ci.yml", "e2e"],
  ["journeys.yml", "journeys"],
  ["storybook.yml", "build-storybook"],
  ["production-deploy.yml", "deploy"],
  ["mcp-oauth-canary.yml", "canary"],
  ["qa-image-cover-smoke.yml", "smoke"],
] as const;

function job(file: string, name: string): Job {
  const found = workflows.find((workflow) => workflow.file === file)?.jobs[name];
  if (!found) throw new Error(`Missing job ${file} ${name}`);
  return found;
}

function pinnedPlaywrightVersion(): string {
  const all = { ...packageJson.dependencies, ...packageJson.devDependencies };
  expect(all.playwright).toMatch(/^\d+\.\d+\.\d+$/);
  expect(all["@playwright/test"]).toBe(all.playwright);
  return all.playwright!;
}

describe("Playwright's image for every browser job", () => {
  it("is pinned by digest, at the Playwright version package.json pins", () => {
    expect(PLAYWRIGHT_CONTAINER.image).toMatch(/^mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}$/);
    expect(PLAYWRIGHT_RUNNER).toBe("ubuntu-24.04");
    const tag = `v${pinnedPlaywrightVersion()}-noble`;
    for (const [file] of BROWSER_JOBS) {
      const { text } = workflows.find((workflow) => workflow.file === file)!;
      const imageLines = text.split("\n").filter((line) => line.includes("mcr.microsoft.com/playwright"));
      expect(imageLines.length, file).toBeGreaterThan(0);
      for (const line of imageLines) {
        // The digest is what runs; the tag beside it says which release it is, and must follow
        // package.json.
        expect(line.trim(), file).toBe(`image: ${PLAYWRIGHT_CONTAINER.image} # ${tag}`);
      }
    }
  });

  it.each(BROWSER_JOBS)("runs %s %s in it, on its Ubuntu, with the runner's zstd", (file, name) => {
    const browserJob = job(file, name);
    expect(browserJob["runs-on"]).toBe(PLAYWRIGHT_RUNNER);
    expect(browserJob.container).toEqual(PLAYWRIGHT_CONTAINER);
  });

  it.each(BROWSER_JOBS)("installs no system package or browser in %s %s, and keeps setup-node's cache off", (file, name) => {
    const steps = job(file, name).steps ?? [];
    for (const step of steps) {
      expect(step.run ?? "", step.name).not.toMatch(/\bapt(?:-get)?\b|\bsudo\b|\bdpkg\b|playwright install/);
      if (step.uses?.startsWith("actions/setup-node@")) expect(step.with?.cache, step.name).toBe("");
    }
  });

  // The image has no make or C++ compiler, which better-sqlite3's build needs (only the unit
  // tests use it), so install scripts are off; the root postinstall's prisma generate runs as its
  // own step after the install.
  it.each(BROWSER_JOBS)("installs %s %s's packages without install scripts, then generates the Prisma client", (file, name) => {
    const runs = (job(file, name).steps ?? []).map((step) => step.run ?? "");
    const installs = runs.map((run, index) => [run, index] as const).filter(([run]) => /\bpnpm install\b/.test(run));
    expect(installs).toHaveLength(1);
    const [install, at] = installs[0];
    expect(install).toMatch(/pnpm install --frozen-lockfile --ignore-scripts$/);
    expect(runs.slice(at + 1).some((run) => /^(?:node scripts\/warning-gate\.ts -- )?pnpm prisma:generate$/.test(run.trim()))).toBe(true);
  });

  it.each(BROWSER_JOBS)("names no runner path in %s %s, which the container does not have", (file, name) => {
    const text = JSON.stringify(job(file, name));
    expect(text).not.toMatch(/\$\{\{\s*(?:github\.workspace|runner\.temp|runner\.tool_cache)\s*\}\}/);
  });

  it("is the only image, and only browser jobs use it", () => {
    const containerJobs = workflows.flatMap(({ file, jobs }) =>
      Object.entries(jobs).filter(([, candidate]) => candidate.container).map(([name]) => `${file} ${name}`));
    expect(containerJobs.sort()).toEqual(BROWSER_JOBS.map(([file, name]) => `${file} ${name}`).sort());
  });

  it("leaves no job anywhere installing a browser or a system package", () => {
    for (const { file, jobs } of workflows) {
      for (const [name, candidate] of Object.entries(jobs)) {
        for (const step of candidate.steps ?? []) {
          expect(step.run ?? "", `${file} ${name} ${step.name ?? ""}`).not.toMatch(/\bapt(?:-get)?\s+install\b|playwright install/);
        }
      }
    }
  });
});
