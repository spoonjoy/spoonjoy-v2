import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { SOURCE_VERSIONS } from "../../scripts/move-in-proof/adapters/mealie/profile.mjs";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  strategy?: { matrix: Record<string, unknown> };
  steps: Step[];
};
type Workflow = {
  on: Record<string, { paths?: string[]; branches?: string[] } | Array<{ cron: string }> | null>;
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
};

const SOURCE = readFileSync(".github/workflows/move-in-proof.yml", "utf8");
const workflow = parseDocument(SOURCE).toJS() as Workflow;

describe("Move-in Proof workflow", () => {
  it("runs by hand, weekly, and only on pull requests that change the harness", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "schedule", "workflow_dispatch"]);
    expect(workflow.on.schedule).toEqual([{ cron: "41 5 * * 1" }]);
    expect((workflow.on.pull_request as { paths: string[] }).paths).toEqual([
      "scripts/move-in-proof/**",
      ".github/workflows/move-in-proof.yml",
    ]);
  });

  it("seeds every source version the adapter knows, in each chosen size", () => {
    expect(workflow.jobs.seed.strategy?.matrix.source).toEqual(SOURCE_VERSIONS.map((source) => source.version));
    expect(workflow.jobs.seed.strategy?.matrix.size).toBe("${{ fromJSON(needs.plan.outputs.sizes) }}");
    expect(workflow.env.SIZES).toBe("${{ inputs.sizes || 'small,large' }}");
  });

  it("reads the repository everywhere and writes only the release, from main, never for a pull request", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "publish") expect(job.permissions).toBeUndefined();
    }
    expect(workflow.jobs.publish.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.publish.if).toContain("github.event_name != 'pull_request' && github.ref == 'refs/heads/main'");
    expect(SOURCE).not.toContain("secrets.");
  });

  it("proves the manifest is the same on two writes before it checks and publishes the fixtures", () => {
    const runs = workflow.jobs.manifest.steps.map((step) => step.run ?? "");
    const twice = runs.findIndex((run) => run.includes("cmp manifest-a.json manifest-b.json"));
    const check = runs.findIndex((run) => run.includes("manifest-cli.mjs check move-in-proof"));
    expect(twice).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(twice);
    expect(workflow.jobs.publish.needs).toBe("manifest");
  });

  describe("its publish step", () => {
    const publish = workflow.jobs.publish.steps.find((step) => step.name === "Publish to the release")?.run ?? "";
    const MANIFEST = '{"kitchens":1}\n';
    const HARNESS = "scripts/move-in-proof tree-1\n.github/workflows/move-in-proof.yml blob-1\n";
    const UPLOAD =
      "release upload move-in-proof-fixtures-v1 --clobber fixtures/move-in-proof-fixtures.zip fixtures/move-in-proof/manifest.json fixtures/move-in-proof-harness.txt";

    /**
     * Runs the step in a folder holding a fresh manifest, with a gh whose release holds `released`
     * (asset name to contents) and whose API gives the harness the git object ids tree-1 and blob-1.
     */
    function run(released: Record<string, string>) {
      const dir = mkdtempSync(join(tmpdir(), "move-in-proof-publish-"));
      try {
        mkdirSync(join(dir, "fixtures/move-in-proof"), { recursive: true });
        writeFileSync(join(dir, "fixtures/move-in-proof/manifest.json"), MANIFEST);
        writeFileSync(join(dir, "fixtures/move-in-proof-fixtures.zip"), "zip");
        mkdirSync(join(dir, "released"));
        for (const [name, contents] of Object.entries(released)) writeFileSync(join(dir, "released", name), contents);
        mkdirSync(join(dir, "bin"));
        writeFileSync(
          join(dir, "bin/gh"),
          `#!/bin/bash
echo "$*" >> "${dir}/gh.log"
case "$1 $2" in
  "api repos/"*) case "$2" in *contents/scripts*) echo tree-1 ;; *) echo blob-1 ;; esac ;;
  "release view") [ "$4" = "--json" ] && ls "${dir}/released" ;;
  "release download")
    while [ $# -gt 0 ]; do case "$1" in --pattern) name="$2" ;; --dir) out="$2" ;; esac; shift; done
    [ -f "${dir}/released/$name" ] || exit 1
    cp "${dir}/released/$name" "$out/$name" ;;
esac
exit 0
`,
        );
        chmodSync(join(dir, "bin/gh"), 0o755);
        const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", publish], {
          cwd: dir,
          env: {
            ...process.env,
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            RELEASE_TAG: "move-in-proof-fixtures-v1",
            GH_REPO: "spoonjoy/spoonjoy-v2",
            GITHUB_SHA: "abc123",
          },
          encoding: "utf8",
        });
        const calls = readFileSync(join(dir, "gh.log"), "utf8").trim().split("\n");
        const harness = readFileSync(join(dir, "fixtures/move-in-proof-harness.txt"), "utf8");
        return {
          status: result.status,
          stdout: result.stdout,
          harness,
          api: calls.filter((call) => call.startsWith("api ")),
          uploads: calls.filter((call) => call.startsWith("release upload")),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const published = { "move-in-proof-fixtures.zip": "old zip", "manifest.json": MANIFEST, "move-in-proof-harness.txt": HARNESS };

    it("leaves the release's fixtures as they are when the manifest and harness match and the zip is there", () => {
      const { status, stdout, uploads, harness, api } = run(published);
      expect(status).toBe(0);
      expect(api).toEqual([
        'api repos/spoonjoy/spoonjoy-v2/contents/scripts?ref=abc123 --jq .[] | select(.name == "move-in-proof") | .sha',
        "api repos/spoonjoy/spoonjoy-v2/contents/.github/workflows/move-in-proof.yml?ref=abc123 --jq .sha",
      ]);
      expect(harness).toBe(HARNESS);
      expect(uploads).toEqual([]);
      expect(stdout).toContain("the release keeps its fixtures");
    });

    it("replaces the fixtures when the manifest or harness changed, or the release lacks one of its assets", () => {
      const cases: Array<Record<string, string>> = [
        { ...published, "manifest.json": '{"kitchens":0}\n' },
        { ...published, "move-in-proof-harness.txt": "scripts/move-in-proof tree-0\n.github/workflows/move-in-proof.yml blob-1\n" },
        { "manifest.json": MANIFEST, "move-in-proof-harness.txt": HARNESS },
        { "move-in-proof-fixtures.zip": "old zip", "move-in-proof-harness.txt": HARNESS },
        { "move-in-proof-fixtures.zip": "old zip", "manifest.json": MANIFEST },
        {},
      ];
      for (const released of cases) {
        const { status, uploads } = run(released);
        expect(status).toBe(0);
        expect(uploads).toEqual([UPLOAD]);
      }
    });
  });
});
