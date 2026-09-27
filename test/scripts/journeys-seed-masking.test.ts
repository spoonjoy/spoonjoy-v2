// @vitest-environment node
// Runs the Journeys workflow's own "Seed the QA kitchen" step (with the seed itself stubbed out)
// against a credentials file written by scripts/seed-qa-kitchen.mjs's main(), and checks that the
// step masks every password in it: the three personas and all twelve scratch accounts (each
// scratch index's base account and its desktop twin). An unmasked password would be printed in
// clear in the CI log.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SCRATCH_ACCOUNT_COUNT, SCRATCH_USER_COUNT, main } from "../../scripts/seed-qa-kitchen.mjs";

const WORKFLOW = resolve(__dirname, "../../.github/workflows/journeys.yml");

function seedStepScript(): string {
  const workflow = parse(readFileSync(WORKFLOW, "utf8"));
  const steps: Array<{ name?: string; run?: string }> = workflow.jobs.journeys.steps;
  const seed = steps.find((step) => step.name === "Seed the QA kitchen");
  if (!seed?.run) throw new Error("Missing workflow step: Seed the QA kitchen");
  return seed.run;
}

// The credentials JSON a real seed run writes, captured through main()'s injected writeFile.
function seededCredentials(): string {
  let credentials = "";
  main(["--target-env", "qa", "--credentials-out", "creds.json"], {
    execFile: () => undefined,
    mkdtemp: () => "/tmp/unused",
    rm: () => undefined,
    chmod: () => undefined,
    writeFile: (path: string, contents: string) => {
      if (path === "creds.json") credentials = contents;
    },
    io: { log: () => undefined },
  });
  return credentials;
}

describe("Journeys workflow: seed step masks every seeded password", () => {
  it("masks the 3 persona passwords and all 12 scratch passwords, desktop twins included", () => {
    const script = seedStepScript();
    expect(script).toContain("pnpm run seed:qa:kitchen");

    const credentials = seededCredentials();
    const parsed = JSON.parse(credentials) as Record<string, unknown> & {
      scratch: Array<{ password: string }>;
      scratchDesktop: Array<{ password: string }>;
    };
    expect(parsed.scratch).toHaveLength(SCRATCH_USER_COUNT);
    expect(parsed.scratchDesktop).toHaveLength(SCRATCH_USER_COUNT);
    const scratchPasswords = [...parsed.scratch, ...parsed.scratchDesktop].map((entry) => entry.password);
    expect(new Set(scratchPasswords).size).toBe(SCRATCH_ACCOUNT_COUNT);

    const directory = mkdtempSync(join(tmpdir(), "journeys-seed-masking-"));
    try {
      const credentialsPath = join(directory, "credentials.json");
      writeFileSync(credentialsPath, credentials);
      // The seed has already "run": pnpm is a no-op, so only the step's masking lines act.
      const output = execFileSync("bash", ["-euo", "pipefail", "-c", `pnpm() { :; }\n${script}`], {
        cwd: directory,
        env: { ...process.env, SPOONJOY_QA_CREDENTIALS: credentialsPath },
        encoding: "utf8",
      });

      const masked = output
        .split("\n")
        .filter((line) => line.startsWith("::add-mask::"))
        .map((line) => line.slice("::add-mask::".length));
      const personaPasswords = (["chef", "friend", "newbie"] as const).map(
        (name) => (parsed[name] as { password: string }).password,
      );
      expect(masked.sort()).toEqual([...personaPasswords, ...scratchPasswords].sort());
      expect(masked).toHaveLength(3 + SCRATCH_ACCOUNT_COUNT);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
