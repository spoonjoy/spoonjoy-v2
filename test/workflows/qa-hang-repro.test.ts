import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const WORKFLOW_PATH = ".github/workflows/qa-hang-repro.yml";
const SOURCE = readFileSync(WORKFLOW_PATH, "utf8");

type Step = { name?: string; id?: string; if?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; "timeout-minutes"?: number };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  env: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { if?: string; permissions?: unknown; env?: unknown; "timeout-minutes": number; steps: Step[] }>;
};

const workflow = parseDocument(SOURCE).toJS() as Workflow;
const job = workflow.jobs.repro;
const steps = job.steps;
const step = (name: string) => {
  const found = steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`no step named ${name}`);
  return found;
};
const indexOf = (name: string) => steps.findIndex((entry) => entry.name === name);

describe("QA Hang Repro workflow", () => {
  it("runs only when dispatched by hand, never on a push, pull request or schedule", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    const inputs = (workflow.on.workflow_dispatch as { inputs: Record<string, { default?: string }> }).inputs;
    expect(Object.keys(inputs).sort()).toEqual(
      ["abort_share", "abort_window_ms", "aborts", "baseline_ref", "duration_seconds", "loops", "variant_refs", "write_share"].sort(),
    );
    expect(inputs.baseline_ref.default).toBe("main");
    expect(inputs.aborts.default).toBe("both");
    expect(workflow.jobs.repro.if).toBe("github.repository == 'spoonjoy/spoonjoy-v2'");
    expect(workflow.concurrency).toEqual({ group: "qa-hang-repro", "cancel-in-progress": false });
  });

  it("reads the repository and nothing else, with no job widening it", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual(["repro"]);
    expect(job.permissions).toBeUndefined();
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(90);
  });

  it("gives the Cloudflare token only to the steps that call Cloudflare, never to installs or builds", () => {
    expect(JSON.stringify(workflow.env)).not.toContain("secrets.");
    expect(job.env).toBeUndefined();
    const withToken = steps.filter((entry) => JSON.stringify(entry).includes("secrets.CLOUDFLARE_API_TOKEN")).map((entry) => entry.name);
    expect(withToken).toEqual(["Require Cloudflare credentials", "Create, deploy and seed every stack", "Start the Worker tails", "Delete every stack"]);
    expect(step("Fetch and build every ref for QA").run).toContain("pnpm install --frozen-lockfile");
    expect(step("Fetch and build every ref for QA").env).toBeUndefined();
    expect(SOURCE.match(/secrets\.[A-Z_]+/g)!.every((name) => ["secrets.CLOUDFLARE_API_TOKEN", "secrets.CLOUDFLARE_ACCOUNT_ID"].includes(name))).toBe(true);
  });

  it("passes inputs to the shell only through environment variables", () => {
    for (const entry of steps) {
      expect(entry.run ?? "").not.toContain("${{");
    }
    const check = step("Check the inputs");
    expect(check.env).toMatchObject({ BASELINE_REF: "${{ inputs.baseline_ref }}", VARIANT_REFS: "${{ inputs.variant_refs }}" });
  });

  it("names every stack with a per-run scope the QA Run Sweep deletes, for create and delete alike", () => {
    const scope = 'GITHUB_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT}${index}"';
    const create = step("Create, deploy and seed every stack").run!;
    const teardown = step("Delete every stack").run!;
    expect(create).toContain(`export ${scope}`);
    expect(create).toContain("node scripts/qa-run-scope.mjs prepare");
    expect(create).toContain("node scripts/qa-run-scope.mjs deploy");
    expect(create).toContain("node scripts/qa-run-scope.mjs verify");
    expect(create).toContain("pnpm run qa:migrate");
    expect(create).toContain('pnpm run seed:qa:kitchen -- --credentials-out "$credentials"');
    expect(create).toContain("::add-mask::");
    expect(teardown).toContain(`${scope} env -u GITHUB_ENV node scripts/qa-run-scope.mjs teardown`);
    // The scope names come from variants.tsv, written by the first check, so teardown covers
    // every ref even when a build or deploy failed.
    expect(step("Check the inputs").run).toContain('"$REPRO_RESULTS/variants.tsv"');
    expect(teardown).toContain('done 3< "$REPRO_RESULTS/variants.tsv"');
  });

  it("loads every stack at the same time, between starting and stopping the tails", () => {
    const order = ["Start the Worker tails", "Run the load phases", "Stop the Worker tails and summarise them", "Delete every stack"].map(indexOf);
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const load = step("Run the load phases").run!;
    expect(load).toContain("node scripts/qa-hang-repro-load.mjs");
    expect(load).toMatch(/&\n\s+pids\+=\("\$!"\)/);
    expect(load).toContain('for pid in "${pids[@]}"; do wait "$pid"');
  });

  it("stops the tails and deletes every stack in always() steps with time limits, tails first", () => {
    for (const name of ["Stop the Worker tails and summarise them", "Remove credentials and raw tails", "Upload the results", "Delete every stack"]) {
      expect(step(name).if).toBe("always()");
    }
    for (const name of ["Stop the Worker tails and summarise them", "Delete every stack"]) {
      expect(step(name)["timeout-minutes"]).toBeGreaterThan(0);
    }
    expect(step("Start the Worker tails").run).toContain("setsid ./node_modules/.bin/wrangler tail");
    expect(step("Start the Worker tails").run).toContain('echo $! >> "$REPRO_PRIVATE/tail-pgids"');
    expect(step("Stop the Worker tails and summarise them").run).toContain('kill -TERM -- "-$pgid"');
    const teardown = step("Delete every stack").run!;
    expect(teardown.indexOf('kill -KILL -- "-$pgid"')).toBeGreaterThanOrEqual(0);
    expect(teardown.indexOf('kill -KILL -- "-$pgid"')).toBeLessThan(teardown.indexOf("qa-run-scope.mjs teardown"));
    expect(indexOf("Delete every stack")).toBe(steps.length - 2);
  });

  it("never uploads a raw tail or a credential: both live outside the workspace and are deleted before upload", () => {
    expect(workflow.env.REPRO_PRIVATE).toBe("${{ github.workspace }}/../qa-hang-repro-private");
    expect(workflow.env.REPRO_RESULTS).toBe("${{ github.workspace }}/qa-hang-repro-results");
    const uploads = steps.filter((entry) => entry.uses?.startsWith("actions/upload-artifact@"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].with).toMatchObject({ path: "qa-hang-repro-results/", "include-hidden-files": false });
    expect(indexOf("Remove credentials and raw tails")).toBeLessThan(indexOf("Upload the results"));
    expect(step("Remove credentials and raw tails").run).toBe('rm -rf "$REPRO_PRIVATE/credentials" "$REPRO_PRIVATE/tails"');
    for (const entry of steps) {
      const run = entry.run ?? "";
      for (const match of run.matchAll(/"([^"\s]*\/(tails|credentials)\/[^"\s]*)"/g)) {
        expect(match[1].startsWith("$REPRO_PRIVATE/")).toBe(true);
      }
      expect(run).not.toMatch(/\$REPRO_RESULTS\/(tails|credentials)/);
      expect(run).not.toMatch(/--credentials-out "\$REPRO_RESULTS/);
    }
    // The tail is reduced only by the two allowlisting reducers.
    const stop = step("Stop the Worker tails and summarise them").run!;
    expect(stop).toContain("-f scripts/summarize-worker-tail.jq");
    expect(stop).toContain("node scripts/qa-hang-repro-analyze.mjs analyze");
  });

  it("pins every action to a commit", () => {
    for (const entry of steps.filter((candidate) => candidate.uses)) {
      expect(entry.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe("per-variant loops", () => {
  it("read their list from file descriptor 3, so a command that reads stdin cannot swallow the rest of the list", () => {
    for (const entry of steps) {
      for (const loop of (entry.run ?? "").matchAll(/while IFS=\$'\\t' read -r [^\n]*/g)) {
        expect(loop[0], entry.name).toMatch(/<&[34]; do$/);
      }
      expect(entry.run ?? "", entry.name).not.toMatch(/done < "\$REPRO_(RESULTS|PRIVATE)\/(variants|targets|phases)\.tsv"/);
    }
  });

  it("build every ref even when pnpm drains stdin", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-hang-repro-build-"));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "pnpm"), "#!/usr/bin/env bash\ncat > /dev/null\necho \"pnpm $*\" >> \"$FAKE_LOG\"\n");
    writeFileSync(
      path.join(bin, "git"),
      `#!/usr/bin/env bash
case "$1" in
  fetch) exit 0 ;;
  worktree) mkdir -p "$4" ;;
  -C) echo "sha-of-$(basename "$2")" ;;
esac
`,
    );
    chmodSync(path.join(bin, "pnpm"), 0o755);
    chmodSync(path.join(bin, "git"), 0o755);
    const results = path.join(root, "results");
    mkdirSync(results);
    mkdirSync(path.join(root, "private"));
    writeFileSync(path.join(results, "variants.tsv"), "0\t0-main\tmain\n1\t1-a\tclaude/a\n2\t2-b\tclaude/b\n");
    execFileSync("bash", ["-c", step("Fetch and build every ref for QA").run!], {
      env: { PATH: `${bin}:${process.env.PATH}`, REPRO_PRIVATE: path.join(root, "private"), REPRO_RESULTS: results, FAKE_LOG: path.join(root, "log") },
      stdio: ["pipe", "ignore", "ignore"],
    });
    expect(readFileSync(path.join(results, "variants.tsv"), "utf8")).toBe(
      "0\t0-main\tmain\tsha-of-0\n1\t1-a\tclaude/a\tsha-of-1\n2\t2-b\tclaude/b\tsha-of-2\n",
    );
    expect(readFileSync(path.join(root, "log"), "utf8").match(/pnpm install --frozen-lockfile/g)).toHaveLength(3);
  });
});

describe("the input check", () => {
  function check(env: Record<string, string>) {
    const workspace = mkdtempSync(path.join(tmpdir(), "qa-hang-repro-"));
    const githubEnv = path.join(workspace, "github-env");
    try {
      const stdout = execFileSync("bash", ["-c", step("Check the inputs").run!], {
        env: {
          PATH: process.env.PATH,
          GITHUB_ENV: githubEnv,
          REPRO_PRIVATE: path.join(workspace, "private"),
          REPRO_RESULTS: path.join(workspace, "results"),
          BASELINE_REF: "main",
          VARIANT_REFS: "claude/qa-throughput-prisma7 claude/qa-throughput-prisma7-request-scope",
          ABORTS: "both",
          LOOPS: "24",
          DURATION_SECONDS: "300",
          ABORT_SHARE: "0.4",
          ABORT_WINDOW_MS: "150",
          WRITE_SHARE: "0.15",
          ...env,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, stdout, variants: readFileSync(path.join(workspace, "results", "variants.tsv"), "utf8"), githubEnv: readFileSync(githubEnv, "utf8") };
    } catch (error) {
      return { ok: false, stdout: String((error as { stdout?: string }).stdout ?? "") };
    }
  }

  it("names the baseline and each variant with an index and a label", () => {
    const result = check({});
    expect(result.ok).toBe(true);
    expect(result.variants).toBe(
      "0\t0-main\tmain\n1\t1-qa-throughput-prisma7\tclaude/qa-throughput-prisma7\n2\t2-qa-throughput-prisma7-request-scope\tclaude/qa-throughput-prisma7-request-scope\n",
    );
    expect(result.githubEnv).toContain("REPRO_PHASES=with-aborts without-aborts\n");
    expect(check({ ABORTS: "without-aborts" }).githubEnv).toContain("REPRO_PHASES=without-aborts\n");
  });

  it("refuses refs that are not plain git refs, and out-of-range settings", () => {
    for (const env of [
      { VARIANT_REFS: "" },
      { VARIANT_REFS: "a b c d" },
      { BASELINE_REF: "main;id" },
      { BASELINE_REF: "$(id)" },
      { VARIANT_REFS: "../x" },
      { VARIANT_REFS: "a..b" },
      { VARIANT_REFS: "-x" },
      { LOOPS: "0" },
      { LOOPS: "65" },
      { DURATION_SECONDS: "10" },
      { DURATION_SECONDS: "901" },
      { ABORT_SHARE: "1.5" },
      { WRITE_SHARE: "-0.1" },
      { ABORT_WINDOW_MS: "0" },
      { ABORTS: "sometimes" },
    ]) {
      const result = check(env);
      expect(result.ok, JSON.stringify(env)).toBe(false);
      expect(result.stdout).toContain("::error::");
    }
  });
});
