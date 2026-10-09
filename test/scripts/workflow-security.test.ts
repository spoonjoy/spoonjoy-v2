import path from "node:path";
import { pathToFileURL } from "node:url";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  CSP_REPORT_ONLY_BREAK_GLASS_ACK,
  chooseReleaseTarget,
  isCliEntry,
  main,
  reportQueueTested,
  runCliIfEntry,
  runInheritedWorkflowCommand,
  runProductionDeploy,
  runWorkflowCommand,
  sleepMilliseconds,
  validateCiInvocation,
  validateProductionDeploySource,
} from "../../scripts/workflow-security.mjs";

const SOURCE_SHA = "a".repeat(40);
const ROLLBACK_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const CANONICAL_CI_JOB_NAMES = ["coverage", "workers-coverage", "e2e", "advisory"] as const;
const REPORT_ONLY_CI_JOB_NAMES = [
  "report-only-coverage",
  "report-only-workers-coverage",
  "report-only-e2e",
  "report-only-advisory",
] as const;

function ciEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: SOURCE_SHA,
    GITHUB_ACTOR: "ari",
    GITHUB_REF: "refs/heads/worker/report-only-csp",
    GITHUB_RUN_ID: "1234",
    GITHUB_REPOSITORY: "spoonjoy/spoonjoy-v2",
    CI_SOURCE_SHA: SOURCE_SHA,
    SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: "",
    ...overrides,
  };
}

function productionEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTOR: "ari",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "spoonjoy/spoonjoy-v2",
    GITHUB_RUN_ID: "5678",
    ROLLBACK_VERSION_ID: "",
    SOURCE_SHA,
    SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: "",
    WORKFLOW_RUN_CONCLUSION: "",
    WORKFLOW_RUN_EVENT: "",
    WORKFLOW_RUN_HEAD_BRANCH: "",
    WORKFLOW_RUN_HEAD_SHA: "",
    WORKFLOW_RUN_PATH: "",
    ...overrides,
  };
}

type WorkflowCommandRunner = (file: string, args: readonly string[]) => Promise<string>;

function successfulRunner(
  ciJobNames: readonly string[] = CANONICAL_CI_JOB_NAMES,
): WorkflowCommandRunner & ReturnType<typeof vi.fn> {
  return vi.fn(async (file: string, args: readonly string[]) => {
    const command = [file, ...args].join(" ");
    if (command === "git rev-parse HEAD" || command === "git rev-parse origin/main") {
      return `${SOURCE_SHA}\n`;
    }
    if (command.startsWith("git fetch ") || command.startsWith("git merge-base ")) {
      return "";
    }
    if (command.includes("gh run list --workflow .github/workflows/ci.yml")) {
      const event = command.includes("--event workflow_dispatch") ? "workflow_dispatch" : "push";
      return JSON.stringify([{ databaseId: 11, headSha: SOURCE_SHA, event }]);
    }
    if (command === "gh api repos/spoonjoy/spoonjoy-v2/actions/runs/11") {
      return JSON.stringify({
        actor: { login: "ari" },
        conclusion: "success",
        event: "workflow_dispatch",
        head_branch: "main",
        head_sha: SOURCE_SHA,
      });
    }
    if (command === "gh run view 11 --json jobs") {
      return JSON.stringify({
        jobs: ciJobNames.map((name) => ({ name, conclusion: "success" })),
      });
    }
    if (command.includes("gh run list --workflow .github/workflows/storybook.yml")) {
      return JSON.stringify([{ databaseId: 12, headSha: SOURCE_SHA, event: "push" }]);
    }
    if (command === "gh run view 12 --json jobs") {
      return JSON.stringify({ jobs: [{ name: "build-storybook", conclusion: "success" }] });
    }
    if (command.startsWith("gh api --method GET repos/spoonjoy/spoonjoy-v2/actions/workflows/")) {
      return JSON.stringify({ workflow_runs: [] });
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

const REPOSITORY = "spoonjoy/spoonjoy-v2";

// A merge-queue run as GitHub's REST API returns it: of this workflow, for this commit, in and from
// this repository, on the queue's branch for main, completed and successful.
function queueRun(overrides: Record<string, unknown> = {}, workflowPath = ".github/workflows/ci.yml") {
  return {
    id: 21,
    event: "merge_group",
    head_sha: SOURCE_SHA,
    head_branch: `gh-readonly-queue/main/pr-421-${"c".repeat(40)}`,
    status: "completed",
    conclusion: "success",
    path: workflowPath,
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    ...overrides,
  };
}

function jobsOutput(names: readonly string[], conclusion: string | null = "success") {
  return JSON.stringify({ jobs: names.map((name) => ({ name, conclusion })) });
}

// After a queue merge: main's push CI and Storybook runs exist but their jobs skipped (CI) or have
// not finished (Storybook); the queue's runs of the same commit passed. Overrides replace the CI
// queue run list or a run's job list.
function queueMergedRunner({
  ciQueueRuns = [queueRun()] as unknown[],
  ciQueueJobs = jobsOutput(CANONICAL_CI_JOB_NAMES),
  storybookQueueRuns = [queueRun({ id: 22 }, ".github/workflows/storybook.yml")] as unknown[],
} = {}) {
  return vi.fn(async (file: string, args: readonly string[]) => {
    const command = [file, ...args].join(" ");
    if (command === "git rev-parse HEAD" || command === "git rev-parse origin/main") return `${SOURCE_SHA}\n`;
    if (command.startsWith("git fetch ") || command.startsWith("git merge-base ")) return "";
    if (command.includes("gh run list --workflow .github/workflows/ci.yml")) {
      return JSON.stringify([{ databaseId: 11, headSha: SOURCE_SHA, event: "push" }]);
    }
    if (command === "gh run view 11 --json jobs") return jobsOutput(CANONICAL_CI_JOB_NAMES, "skipped");
    if (command.includes("gh run list --workflow .github/workflows/storybook.yml")) return "[]";
    if (command === `gh api --method GET repos/${REPOSITORY}/actions/workflows/ci.yml/runs -f event=merge_group -f head_sha=${SOURCE_SHA} -f status=success -f per_page=100`) {
      return JSON.stringify({ workflow_runs: ciQueueRuns });
    }
    if (command === `gh api --method GET repos/${REPOSITORY}/actions/workflows/storybook.yml/runs -f event=merge_group -f head_sha=${SOURCE_SHA} -f status=success -f per_page=100`) {
      return JSON.stringify({ workflow_runs: storybookQueueRuns });
    }
    if (command === "gh run view 21 --json jobs") return ciQueueJobs;
    if (command === "gh run view 22 --json jobs") return jobsOutput(["build-storybook"]);
    throw new Error(`Unexpected command: ${command}`);
  });
}

function runnerWithOverride(
  matches: (command: string) => boolean,
  result: string | Error,
): WorkflowCommandRunner & ReturnType<typeof vi.fn> {
  const fallback = successfulRunner();
  return vi.fn(async (file: string, args: readonly string[]) => {
    const command = [file, ...args].join(" ");
    if (matches(command)) {
      if (result instanceof Error) throw result;
      return result;
    }
    return fallback(file, args);
  });
}

describe("validateCiInvocation", () => {
  it("keeps ordinary push and pull-request CI strict", async () => {
    await expect(validateCiInvocation({ env: ciEnv(), run: successfulRunner() })).resolves.toBeUndefined();
    await expect(validateCiInvocation({
      env: ciEnv({ SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK }),
      run: successfulRunner(),
    })).rejects.toThrow(/ordinary CI.*break-glass/i);
  });

  it("treats a merge-queue run as ordinary CI on the exact queued commit", async () => {
    const env = ciEnv({ GITHUB_EVENT_NAME: "merge_group", GITHUB_REF: "refs/heads/gh-readonly-queue/main/pr-1-abc" });
    await expect(validateCiInvocation({ env, run: successfulRunner() })).resolves.toBeUndefined();
    await expect(validateCiInvocation({
      env: { ...env, SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK },
      run: successfulRunner(),
    })).rejects.toThrow(/ordinary CI.*break-glass/i);
    await expect(validateCiInvocation({
      env: { ...env, CI_SOURCE_SHA: "b".repeat(40) },
      run: successfulRunner(),
    })).rejects.toThrow();
  });

  it("accepts only an authenticated dispatch bound to the exact checked-out SHA", async () => {
    const env = ciEnv({
      GITHUB_EVENT_NAME: "workflow_dispatch",
      SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK,
    });
    await expect(validateCiInvocation({ env, run: successfulRunner() })).resolves.toBeUndefined();

    for (const overrides of [
      { SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: "" },
      { SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: "wrong" },
      { CI_SOURCE_SHA: "b".repeat(40) },
      { GITHUB_ACTOR: "" },
      { GITHUB_RUN_ID: "not-a-run" },
      { GITHUB_REPOSITORY: "" },
      { GITHUB_REF: "refs/tags/report-only" },
    ]) {
      await expect(validateCiInvocation({
        env: { ...env, ...overrides },
        run: successfulRunner(),
      })).rejects.toThrow();
    }
  });

  it("rejects unsupported events, malformed SHAs, source mismatches, and checkout drift", async () => {
    for (const overrides of [
      { GITHUB_EVENT_NAME: "schedule" },
      { GITHUB_SHA: "ABC" },
      { CI_SOURCE_SHA: "ABC" },
      { CI_SOURCE_SHA: "b".repeat(40) },
    ]) {
      await expect(validateCiInvocation({
        env: ciEnv(overrides),
        run: successfulRunner(),
      })).rejects.toThrow();
    }

    await expect(validateCiInvocation({
      env: ciEnv(),
      run: runnerWithOverride((command) => command === "git rev-parse HEAD", `${"b".repeat(40)}\n`),
    })).rejects.toThrow(/checked-out CI source/);
  });

  it("supports pull-request CI with an omitted acknowledgement", async () => {
    const env = ciEnv();
    delete env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS;
    await expect(validateCiInvocation({ env, run: successfulRunner() })).resolves.toBeUndefined();
  });
});

describe("validateProductionDeploySource", () => {
  it("uses ordinary successful push CI for normal and historical rollback releases", async () => {
    const normalRun = successfulRunner();
    await validateProductionDeploySource({ env: productionEnv(), run: normalRun, sleep: vi.fn() });
    expect(normalRun.mock.calls.some(([file, args]) =>
      [file, ...args].join(" ").includes("--event push")
    )).toBe(true);

    const rollbackRun = successfulRunner();
    await validateProductionDeploySource({
      env: productionEnv({
        ROLLBACK_VERSION_ID,
        SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK,
      }),
      run: rollbackRun,
      sleep: vi.fn(),
    });
    expect(rollbackRun.mock.calls.some(([file, args]) =>
      [file, ...args].join(" ").includes("--event push")
    )).toBe(true);
  });

  it("requires the audited workflow-dispatch CI run for a report-only source release", async () => {
    const run = successfulRunner(REPORT_ONLY_CI_JOB_NAMES);
    await validateProductionDeploySource({
      env: productionEnv({
        SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK,
      }),
      run,
      sleep: vi.fn(),
    });

    expect(run.mock.calls.some(([file, args]) =>
      [file, ...args].join(" ").includes("--event workflow_dispatch")
    )).toBe(true);
    expect(run).toHaveBeenCalledWith("gh", [
      "api",
      "repos/spoonjoy/spoonjoy-v2/actions/runs/11",
    ]);
  });

  it("keeps canonical and report-only CI evidence in disjoint job contexts", async () => {
    await expect(validateProductionDeploySource({
      env: productionEnv({
        SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK,
      }),
      run: successfulRunner(CANONICAL_CI_JOB_NAMES),
      sleep: vi.fn(),
    })).rejects.toThrow(/report-only-coverage/);

    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: successfulRunner(REPORT_ONLY_CI_JOB_NAMES),
      sleep: vi.fn(),
    })).rejects.toThrow(/coverage/);
  });

  it("rejects malformed release inputs before querying GitHub", async () => {
    for (const overrides of [
      { SOURCE_SHA: "ABC" },
      { ROLLBACK_VERSION_ID: "not-a-version" },
      { SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: "wrong" },
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_ACTOR: "" },
      { GITHUB_REPOSITORY: "" },
      { GITHUB_RUN_ID: "not-a-run" },
    ]) {
      await expect(validateProductionDeploySource({
        env: productionEnv(overrides),
        run: successfulRunner(),
        sleep: vi.fn(),
      })).rejects.toThrow();
    }
  });

  it("accepts an automatic release only when every workflow_run field binds to main", async () => {
    const valid = productionEnv({
      GITHUB_EVENT_NAME: "workflow_run",
      WORKFLOW_RUN_CONCLUSION: "success",
      WORKFLOW_RUN_EVENT: "push",
      WORKFLOW_RUN_HEAD_BRANCH: "main",
      WORKFLOW_RUN_HEAD_SHA: SOURCE_SHA,
      WORKFLOW_RUN_PATH: ".github/workflows/ci.yml",
    });
    await expect(validateProductionDeploySource({
      env: valid,
      run: successfulRunner(),
      sleep: vi.fn(),
    })).resolves.toBeUndefined();

    for (const overrides of [
      { ROLLBACK_VERSION_ID },
      { SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK },
      { WORKFLOW_RUN_CONCLUSION: "failure" },
      { WORKFLOW_RUN_EVENT: "pull_request" },
      { WORKFLOW_RUN_HEAD_BRANCH: "feature" },
      { WORKFLOW_RUN_HEAD_SHA: "" },
      { WORKFLOW_RUN_HEAD_SHA: "B".repeat(40) },
      { WORKFLOW_RUN_PATH: ".github/workflows/fake.yml" },
    ]) {
      await expect(validateProductionDeploySource({
        env: { ...valid, ...overrides },
        run: successfulRunner(),
        sleep: vi.fn(),
      })).rejects.toThrow(/automatic production release/i);
    }

    await expect(validateProductionDeploySource({
      env: valid,
      run: runnerWithOverride((command) => command === "git rev-parse HEAD", `${"b".repeat(40)}\n`),
      sleep: vi.fn(),
    })).rejects.toThrow(/automatic production release/i);

    // The release target may be behind main's tip (main moved while the deploy waited), and may be
    // newer than the commit whose CI triggered the run, but never older than it or off its line.
    const trigger = "c".repeat(40);
    await expect(validateProductionDeploySource({
      env: { ...valid, WORKFLOW_RUN_HEAD_SHA: trigger },
      run: runnerWithOverride((command) => command === "git rev-parse origin/main", `${"b".repeat(40)}\n`),
      sleep: vi.fn(),
    })).resolves.toBeUndefined();
    const triggerNotAncestor = runnerWithOverride(
      (command) => command === `git merge-base --is-ancestor ${trigger} ${SOURCE_SHA}`,
      new Error("not an ancestor"),
    );
    await expect(validateProductionDeploySource({
      env: { ...valid, WORKFLOW_RUN_HEAD_SHA: trigger },
      run: triggerNotAncestor,
      sleep: vi.fn(),
    })).rejects.toThrow(/automatic production release/i);
    expect(triggerNotAncestor).toHaveBeenCalledWith("git", ["merge-base", "--is-ancestor", trigger, SOURCE_SHA]);
  });

  it("rejects unsupported release events and checkout drift", async () => {
    await expect(validateProductionDeploySource({
      env: productionEnv({ GITHUB_EVENT_NAME: "push" }),
      run: successfulRunner(),
      sleep: vi.fn(),
    })).rejects.toThrow(/unsupported production release event/i);
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: runnerWithOverride((command) => command === "git rev-parse HEAD", `${"b".repeat(40)}\n`),
      sleep: vi.fn(),
    })).rejects.toThrow(/tooling must match current origin\/main/i);
    const mismatchedMain = runnerWithOverride(
      (command) => command === "git rev-parse HEAD" || command === "git rev-parse origin/main",
      `${"b".repeat(40)}\n`,
    );
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: mismatchedMain,
      sleep: vi.fn(),
    })).rejects.toThrow(/normal production dispatch/i);
  });

  it("fails closed for malformed or missing canonical CI evidence", async () => {
    const ciList = (command: string) => command.includes(
      "gh run list --workflow .github/workflows/ci.yml",
    );
    for (const output of [
      "not-json",
      "{}",
      JSON.stringify([null, "bad", {}, { databaseId: "11", headSha: SOURCE_SHA, event: "push" }]),
      JSON.stringify([{ databaseId: 11, headSha: "b".repeat(40), event: "push" }]),
      JSON.stringify([{ databaseId: 11, headSha: SOURCE_SHA, event: "workflow_dispatch" }]),
    ]) {
      await expect(validateProductionDeploySource({
        env: productionEnv(),
        run: runnerWithOverride(ciList, output),
        sleep: vi.fn(),
      })).rejects.toThrow();
    }

    const invalidJobs = (command: string) => command === "gh run view 11 --json jobs";
    for (const output of [
      "not-json",
      "null",
      JSON.stringify({ jobs: null }),
      JSON.stringify({ jobs: [null, "bad", { name: "coverage", conclusion: "failure" }] }),
      JSON.stringify({
        jobs: [
          { name: "coverage", conclusion: "success" },
          { name: "coverage", conclusion: "success" },
          { name: "e2e", conclusion: "success" },
          { name: "advisory", conclusion: "success" },
        ],
      }),
    ]) {
      await expect(validateProductionDeploySource({
        env: productionEnv(),
        run: runnerWithOverride(invalidJobs, output),
        sleep: vi.fn(),
      })).rejects.toThrow();
    }
  });

  it("fails closed for a malformed or missing report-only dispatch CI run", async () => {
    for (const output of [
      "{}",
      JSON.stringify([null, "bad", { databaseId: "11", headSha: SOURCE_SHA, event: "workflow_dispatch" }]),
      JSON.stringify([{ databaseId: 11, headSha: SOURCE_SHA, event: "push" }]),
    ]) {
      await expect(validateProductionDeploySource({
        env: productionEnv({ SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK }),
        run: runnerWithOverride((command) => command.includes("--event workflow_dispatch"), output),
        sleep: vi.fn(),
      })).rejects.toThrow(/Canonical CI workflow/);
    }
  });

  it("fails closed for every malformed dispatch audit field", async () => {
    const baseAudit = {
      actor: { login: "ari" },
      conclusion: "success",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: SOURCE_SHA,
    };
    const invalidAudits: unknown[] = [
      null,
      "bad",
      { ...baseAudit, event: "push" },
      { ...baseAudit, head_sha: "b".repeat(40) },
      { ...baseAudit, head_branch: "feature" },
      { ...baseAudit, conclusion: "failure" },
      { ...baseAudit, actor: null },
      { ...baseAudit, actor: "ari" },
      { ...baseAudit, actor: { login: 42 } },
      { ...baseAudit, actor: { login: "" } },
    ];

    for (const audit of invalidAudits) {
      await expect(validateProductionDeploySource({
        env: productionEnv({
          SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: CSP_REPORT_ONLY_BREAK_GLASS_ACK,
        }),
        run: runnerWithOverride(
          (command) => command === "gh api repos/spoonjoy/spoonjoy-v2/actions/runs/11",
          JSON.stringify(audit),
        ),
        sleep: vi.fn(),
      })).rejects.toThrow(/authenticated successful main-branch dispatch/i);
    }
  });

  it("retries Storybook evidence and fails after the configured attempt budget", async () => {
    let storybookCalls = 0;
    const fallback = successfulRunner();
    const retrying = vi.fn(async (file: string, args: readonly string[]) => {
      const command = [file, ...args].join(" ");
      if (command.includes("gh run list --workflow .github/workflows/storybook.yml")) {
        storybookCalls += 1;
        if (storybookCalls === 1) return "[]";
      }
      return fallback(file, args);
    });
    const sleep = vi.fn(async () => undefined);
    await validateProductionDeploySource({
      env: productionEnv(),
      run: retrying,
      sleep,
      storybookAttempts: 2,
    });
    expect(sleep).toHaveBeenCalledWith(10_000);

    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: runnerWithOverride(
        (command) => command.includes("gh run list --workflow .github/workflows/storybook.yml"),
        "[]",
      ),
      sleep,
      storybookAttempts: 1,
    })).rejects.toThrow(/Canonical Storybook workflow/);
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: successfulRunner(),
      sleep,
      storybookAttempts: 0,
    })).rejects.toThrow(/lookup exhausted/);
  });

  it("accepts the merge queue's run of the same commit when main's push run skipped the canonical jobs", async () => {
    const run = queueMergedRunner();
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run,
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledWith("gh", ["run", "view", "21", "--json", "jobs"]);
    expect(run).toHaveBeenCalledWith("gh", ["run", "view", "22", "--json", "jobs"]);
  });

  it("does not count a push run whose canonical jobs skipped as evidence", async () => {
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: queueMergedRunner({ ciQueueRuns: [] }),
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).rejects.toThrow(/no successful push or merge-queue run with every canonical job \(coverage/);
  });

  it.each([
    ["from a fork", { head_repository: { full_name: "attacker/spoonjoy-v2" } }],
    ["with no head repository", { head_repository: null }],
    ["in another repository", { repository: { full_name: "attacker/spoonjoy-v2" } }],
    ["that failed", { conclusion: "failure" }],
    ["that is still running, as a rerun is", { status: "in_progress", conclusion: null }],
    ["for another commit", { head_sha: "b".repeat(40) }],
    ["of another workflow file", { path: ".github/workflows/storybook.yml" }],
    ["of a workflow file only named like CI", { path: ".github/workflows/ci.yml@refs/heads/evil" }],
    ["off the queue's branch for main", { head_branch: "main" }],
    ["on a queue branch for another base", { head_branch: "gh-readonly-queue/release/pr-1-abc" }],
    ["on a branch only prefixed like the queue's", { head_branch: "gh-readonly-queue/main/evil" }],
    ["on a queue-like branch without a full base SHA", { head_branch: "gh-readonly-queue/main/pr-1-abc" }],
    ["on a queue-like branch with a suffix", { head_branch: `gh-readonly-queue/main/pr-1-${"c".repeat(40)}-x` }],
    ["from a push event", { event: "push" }],
    ["with a malformed id", { id: "21" }],
  ])("rejects a merge-queue CI run %s", async (_name, overrides) => {
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: queueMergedRunner({ ciQueueRuns: [null, "bad", queueRun(overrides)] }),
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).rejects.toThrow(/no successful push or merge-queue run/);
  });

  it.each([
    ["a skipped canonical job", jobsOutput(["coverage", "workers-coverage", "e2e"]).replace("]}", ',{"name":"advisory","conclusion":"skipped"}]}')],
    ["a failed canonical job", jobsOutput(["coverage", "workers-coverage", "e2e"]).replace("]}", ',{"name":"advisory","conclusion":"failure"}]}')],
    ["a rerun still in progress", jobsOutput(CANONICAL_CI_JOB_NAMES, null)],
    ["a missing canonical job", jobsOutput(["coverage", "workers-coverage", "e2e"])],
    ["a duplicated canonical job", jobsOutput([...CANONICAL_CI_JOB_NAMES, "coverage"])],
    ["an unreadable job list", "rate limited"],
  ])("rejects a merge-queue CI run with %s", async (_name, ciQueueJobs) => {
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: queueMergedRunner({ ciQueueJobs }),
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).rejects.toThrow(/no successful push or merge-queue run/);
  });

  it.each([
    ["not JSON", "rate limited", /did not return valid JSON/],
    ["not a run list", "{}", /did not return a run list/],
  ])("fails closed when the merge-queue run lookup is %s", async (_name, output, error) => {
    const fallback = queueMergedRunner();
    const run = vi.fn(async (file: string, args: readonly string[]) =>
      [file, ...args].join(" ").includes("/actions/workflows/ci.yml/runs") ? output : fallback(file, args));
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run,
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).rejects.toThrow(error);
  });

  it("rejects merge-queue evidence for a commit that is not on main", async () => {
    const fallback = queueMergedRunner();
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if ([file, ...args].join(" ") === `git merge-base --is-ancestor ${SOURCE_SHA} origin/main`) {
        throw new Error("not an ancestor");
      }
      return fallback(file, args);
    });
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run,
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).rejects.toThrow("not an ancestor");
    expect(run).not.toHaveBeenCalledWith("gh", expect.arrayContaining(["run", "view"]));
  });

  it("rejects Storybook evidence only from a merge-queue run that fails the same checks", async () => {
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: queueMergedRunner({
        storybookQueueRuns: [queueRun({ id: 22, head_repository: { full_name: "attacker/spoonjoy-v2" } }, ".github/workflows/storybook.yml")],
      }),
      sleep: vi.fn(),
      storybookAttempts: 1,
    })).rejects.toThrow(/Canonical Storybook workflow has no successful push or merge-queue run/);
  });

  it("uses default dependency values without weakening validation", async () => {
    await expect(validateProductionDeploySource({
      env: productionEnv(),
      run: successfulRunner(),
    })).resolves.toBeUndefined();
    await expect(validateProductionDeploySource()).rejects.toThrow();
    vi.stubEnv("GITHUB_EVENT_NAME", "");
    try {
      await expect(validateCiInvocation()).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }

    const omittedOptionalInputs = productionEnv();
    delete omittedOptionalInputs.ROLLBACK_VERSION_ID;
    delete omittedOptionalInputs.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS;
    await expect(validateProductionDeploySource({
      env: omittedOptionalInputs,
      run: successfulRunner(),
      sleep: vi.fn(),
    })).resolves.toBeUndefined();
  });
});

describe("workflow-security CLI", () => {
  it("runs a real child command", async () => {
    await expect(runWorkflowCommand(process.execPath, ["-e", "process.stdout.write('ok')"]))
      .resolves.toBe("ok");
  });

  it("runs production deploys through one exact pnpm invocation", async () => {
    const run = vi.fn(async () => undefined);
    await runProductionDeploy({ env: {}, run });
    expect(run).toHaveBeenCalledWith("pnpm", ["run", "deploy:auto"]);

    run.mockClear();
    await runProductionDeploy({ env: { ROLLBACK_VERSION_ID }, run });
    expect(run).toHaveBeenCalledWith("pnpm", [
      "run",
      "deploy:auto",
      "--",
      "--rollback-version-id",
      ROLLBACK_VERSION_ID,
    ]);
    await expect(runProductionDeploy({
      env: { ROLLBACK_VERSION_ID: "not-a-version" },
      run,
    })).rejects.toThrow(/exact Worker version UUID/);
  });

  it("uses the inherited production deploy runner by default", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-workflow-security-"));
    const previousPath = process.env.PATH;
    const previousRollback = process.env.ROLLBACK_VERSION_ID;
    try {
      const fakePnpm = path.join(root, "pnpm");
      await writeFile(fakePnpm, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(fakePnpm, 0o755);
      process.env.PATH = `${root}:${previousPath ?? ""}`;
      delete process.env.ROLLBACK_VERSION_ID;
      await expect(runProductionDeploy()).resolves.toBeUndefined();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRollback === undefined) delete process.env.ROLLBACK_VERSION_ID;
      else process.env.ROLLBACK_VERSION_ID = previousRollback;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inherits output and fails for child errors, exit codes, and signals", async () => {
    await expect(runInheritedWorkflowCommand(process.execPath, ["-e", "process.exit(0)"]))
      .resolves.toBeUndefined();
    await expect(runInheritedWorkflowCommand(process.execPath, ["-e", "process.exit(7)"]))
      .rejects.toThrow(/code 7/);
    await expect(runInheritedWorkflowCommand(process.execPath, [
      "-e",
      "process.kill(process.pid, 'SIGTERM')",
    ])).rejects.toThrow(/SIGTERM/);
    await expect(runInheritedWorkflowCommand("missing-spoonjoy-workflow-command", []))
      .rejects.toThrow();
  });

  it("waits through the default timer helper", async () => {
    vi.useFakeTimers();
    try {
      const pending = sleepMilliseconds(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches exact CLI modes and rejects malformed modes", async () => {
    await expect(main(["validate-ci-invocation"], {
      env: ciEnv(),
      run: successfulRunner(),
    })).resolves.toBeUndefined();
    await expect(main(["validate-production-deploy-source"], {
      env: productionEnv(),
      run: successfulRunner(),
      sleep: vi.fn(),
    })).resolves.toBeUndefined();
    const deploy = vi.fn(async () => undefined);
    await expect(main(["run-production-deploy"], { env: {}, run: deploy }))
      .resolves.toBeUndefined();
    expect(deploy).toHaveBeenCalledWith("pnpm", ["run", "deploy:auto"]);
    await expect(main([])).rejects.toThrow(/exactly one/);
    await expect(main(["unknown"])).rejects.toThrow(/unknown/i);
    await expect(main()).rejects.toThrow();
  });

  it("identifies and runs CLI entrypoints with injected and default error handlers", async () => {
    const modulePath = path.join(process.cwd(), "scripts/workflow-security.mjs");
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isCliEntry(undefined, moduleUrl)).toBe(false);
    expect(isCliEntry("/tmp/not-workflow-security.mjs", moduleUrl)).toBe(false);
    expect(isCliEntry(modulePath, moduleUrl)).toBe(true);
    expect(runCliIfEntry()).toBe(false);

    const runMain = vi.fn(async () => undefined);
    expect(runCliIfEntry({ argv1: "/tmp/not-workflow-security.mjs", moduleUrl, runMain })).toBe(false);
    expect(runCliIfEntry({ argv1: modulePath, moduleUrl, runMain })).toBe(true);
    await vi.waitFor(() => expect(runMain).toHaveBeenCalledTimes(1));

    const onError = vi.fn();
    expect(runCliIfEntry({
      argv1: modulePath,
      moduleUrl,
      runMain: async () => { throw new Error("boom"); },
      onError,
    })).toBe(true);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    try {
      runCliIfEntry({
        argv1: modulePath,
        moduleUrl,
        runMain: async () => { throw new Error("default boom"); },
      });
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith("default boom\n"));
      runCliIfEntry({
        argv1: modulePath,
        moduleUrl,
        runMain: async () => { throw "string boom"; },
      });
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith("string boom\n"));
      runCliIfEntry({ argv1: modulePath, moduleUrl });
      await vi.waitFor(() => expect(process.exitCode).toBe(1));
    } finally {
      process.exitCode = previousExitCode;
      stderr.mockRestore();
    }
  });
});

describe("chooseReleaseTarget", () => {
  const TRIGGER = "1".repeat(40);
  const MIDDLE = "2".repeat(40);
  const TIP = "3".repeat(40);
  const OUTPUT = "/tmp/github-output";
  const SUMMARY = "/tmp/github-step-summary";

  function targetEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      GITHUB_EVENT_NAME: "workflow_run",
      GITHUB_REPOSITORY: REPOSITORY,
      SOURCE_SHA: TRIGGER,
      GITHUB_OUTPUT: OUTPUT,
      GITHUB_STEP_SUMMARY: SUMMARY,
      ...overrides,
    };
  }

  // main is TRIGGER <- MIDDLE <- TIP. `green` lists the commits whose push CI run passed every
  // canonical job; `queueGreen` lists those whose push run skipped them because the merge queue's
  // run of the same commit passed them.
  function mainRunner({
    green = [TRIGGER] as string[],
    queueGreen = [] as string[],
    newer = [TIP, MIDDLE] as string[],
    onMain = true,
    runList = undefined as string | undefined,
  } = {}) {
    const runIds = new Map([TRIGGER, MIDDLE, TIP, "9".repeat(40)].map((sha, index) => [sha, index + 1]));
    return vi.fn(async (file: string, args: readonly string[]) => {
      const command = [file, ...args].join(" ");
      if (command === "git fetch --no-tags origin main:refs/remotes/origin/main") return "";
      if (command === `git merge-base --is-ancestor ${TRIGGER} origin/main`) {
        if (!onMain) throw new Error("not an ancestor");
        return "";
      }
      if (command === `git rev-list --first-parent --ancestry-path ${TRIGGER}..origin/main`) return newer.map((sha) => `${sha}\n`).join("");
      const perCommit = /^gh run list --workflow \.github\/workflows\/ci\.yml --branch main --commit ([0-9a-f]{40}) --event push --status success --limit 100 --json databaseId,headSha,event$/.exec(command);
      if (perCommit) {
        const sha = perCommit[1];
        if (runList !== undefined) return runList;
        return JSON.stringify(green.includes(sha) || queueGreen.includes(sha)
          ? [{ databaseId: runIds.get(sha), headSha: sha, event: "push" }]
          : []);
      }
      const pushJobs = /^gh run view (\d) --json jobs$/.exec(command);
      if (pushJobs) {
        const sha = [...runIds].find(([, id]) => id === Number(pushJobs[1]))![0];
        return jobsOutput(CANONICAL_CI_JOB_NAMES, green.includes(sha) ? "success" : "skipped");
      }
      const queue = /^gh api --method GET repos\/spoonjoy\/spoonjoy-v2\/actions\/workflows\/ci\.yml\/runs -f event=merge_group -f head_sha=([0-9a-f]{40}) -f status=success -f per_page=100$/.exec(command);
      if (queue) {
        const sha = queue[1];
        return JSON.stringify({
          workflow_runs: queueGreen.includes(sha) ? [queueRun({ id: 100 + runIds.get(sha)!, head_sha: sha })] : [],
        });
      }
      if (/^gh run view 10\d --json jobs$/.test(command)) return jobsOutput(CANONICAL_CI_JOB_NAMES);
      throw new Error(`Unexpected command: ${command}`);
    });
  }

  async function choose(env: NodeJS.ProcessEnv, run: ReturnType<typeof mainRunner>) {
    const appendFile = vi.fn();
    const target = await chooseReleaseTarget({ env, run, appendFile });
    return { target, appendFile, summary: appendFile.mock.calls.find(([file]) => file === SUMMARY)?.[1] as string };
  }

  it("releases the newest green main commit when main moved on while the deploy waited", async () => {
    const { target, appendFile, summary } = await choose(targetEnv(), mainRunner({ green: [MIDDLE, TRIGGER] }));
    expect(target).toBe(MIDDLE);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, `source_sha=${MIDDLE}\n`);
    expect(summary).toContain(`- Requested commit: \`${TRIGGER}\``);
    expect(summary).toContain(`- Releasing: \`${MIDDLE}\``);
    expect(summary).toContain("Main moved on");
  });

  it("never releases an older commit than a newer green one, so production cannot move backwards", async () => {
    // TIP's CI finished first and its deploy may already have run; this late run releases TIP too.
    const { target } = await choose(targetEnv(), mainRunner({ green: [TRIGGER, TIP] }));
    expect(target).toBe(TIP);
  });

  it("asks about each commit newest first and stops at the first green one", async () => {
    // Per-commit queries: however many other green runs landed meanwhile, TIP cannot be missed.
    const run = mainRunner({ green: [TIP, TRIGGER] });
    const { target } = await choose(targetEnv(), run);
    expect(target).toBe(TIP);
    const ciQueries = run.mock.calls.map(([, args]) => args).filter((args) => args.includes("--commit"));
    expect(ciQueries.map((args) => args[args.indexOf("--commit") + 1])).toEqual([TIP]);
  });

  it("releases the triggering commit when it is the tip or nothing newer is green yet", async () => {
    const atTip = await choose(targetEnv(), mainRunner({ newer: [] }));
    expect(atTip.target).toBe(TRIGGER);
    expect(atTip.summary).toContain("main's tip");
    const newerPending = await choose(targetEnv(), mainRunner({ green: [TRIGGER, "9".repeat(40)] }));
    expect(newerPending.target).toBe(TRIGGER);
    expect(newerPending.summary).toContain("2 newer commit(s) have no green canonical CI yet");
  });

  it("releases a commit the merge queue tested, whose push run skipped the canonical jobs", async () => {
    const { target, summary } = await choose(targetEnv(), mainRunner({ green: [TRIGGER], queueGreen: [TIP] }));
    expect(target).toBe(TIP);
    expect(summary).toContain("newest main commit with green canonical CI");
  });

  it("does not release a commit whose push run skipped its jobs without a green queue run", async () => {
    // MIDDLE's and TIP's push runs exist and GitHub calls them successful, but their canonical jobs
    // skipped and no merge-queue run proves them, so the trigger is still the newest green commit.
    const fallback = mainRunner({ green: [TRIGGER], queueGreen: [] });
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      const command = [file, ...args].join(" ");
      if (command.includes(`--commit ${TIP}`) || command.includes(`--commit ${MIDDLE}`)) {
        const sha = command.includes(TIP) ? TIP : MIDDLE;
        return JSON.stringify([{ databaseId: sha === TIP ? 3 : 2, headSha: sha, event: "push" }]);
      }
      return fallback(file, args);
    });
    const { target } = await choose(targetEnv(), run);
    expect(target).toBe(TRIGGER);
    expect(run).toHaveBeenCalledWith("gh", ["run", "view", "3", "--json", "jobs"]);
  });

  it("passes a dispatch's exact source_sha through", async () => {
    const run = mainRunner();
    const { target, appendFile, summary } = await choose(targetEnv({ GITHUB_EVENT_NAME: "workflow_dispatch", SOURCE_SHA: TIP }), run);
    expect(target).toBe(TIP);
    expect(run).not.toHaveBeenCalled();
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, `source_sha=${TIP}\n`);
    expect(summary).toContain("Manual dispatch");
  });

  it.each([
    ["the trigger is not on main", targetEnv(), mainRunner({ onMain: false }), /not on main/],
    ["no commit in range has green canonical CI", targetEnv(), mainRunner({ green: ["9".repeat(40)] }), /no commit from .* has green canonical CI/i],
    ["GITHUB_REPOSITORY is missing", targetEnv({ GITHUB_REPOSITORY: "" }), mainRunner(), /GITHUB_REPOSITORY is required/],
    ["only non-push runs are green", targetEnv(), mainRunner({ runList: JSON.stringify([{ databaseId: 1, headSha: TRIGGER, event: "workflow_dispatch" }, null, { headSha: "bad" }]) }), /no commit from/i],
    ["the run list is not JSON", targetEnv(), mainRunner({ runList: "rate limited" }), /did not return valid JSON/],
    ["the run list is not a list", targetEnv(), mainRunner({ runList: "{}" }), /did not return a run list/],
    ["git returns a malformed commit", targetEnv(), mainRunner({ newer: ["not-a-sha"] }), /malformed commit/],
    ["the requested commit is malformed", targetEnv({ SOURCE_SHA: "abc\nsource_sha=evil" }), mainRunner(), /exact 40-character/],
    ["the event is unsupported", targetEnv({ GITHUB_EVENT_NAME: "push" }), mainRunner(), /unsupported production release event/i],
    ["GITHUB_OUTPUT is missing", targetEnv({ GITHUB_OUTPUT: "" }), mainRunner(), /GITHUB_OUTPUT is required/],
  ])("fails closed, writing no output, when %s", async (_name, env, run, error) => {
    const appendFile = vi.fn();
    await expect(chooseReleaseTarget({ env, run, appendFile })).rejects.toThrow(error);
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("fails closed when a GitHub or git call fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("HTTP 502");
    });
    const appendFile = vi.fn();
    await expect(chooseReleaseTarget({ env: targetEnv(), run: failing, appendFile })).rejects.toThrow("HTTP 502");
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("reads the process environment by default", async () => {
    vi.stubEnv("GITHUB_EVENT_NAME", "");
    try {
      await expect(chooseReleaseTarget()).rejects.toThrow("GITHUB_EVENT_NAME is required.");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is reachable from the CLI", async () => {
    const appendFile = vi.fn();
    await main(["choose-release-target"], { env: targetEnv(), run: mainRunner({ newer: [] }), appendFile });
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, `source_sha=${TRIGGER}\n`);
  });
});

describe("reportQueueTested", () => {
  const OUTPUT = "/tmp/github-output";
  const SUMMARY = "/tmp/github-step-summary";

  function pushEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: SOURCE_SHA,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_OUTPUT: OUTPUT,
      GITHUB_STEP_SUMMARY: SUMMARY,
      ...overrides,
    };
  }

  function queueRunner({
    workflowFile = "ci.yml",
    runs = [queueRun()] as unknown[],
    jobs = jobsOutput(CANONICAL_CI_JOB_NAMES),
  } = {}) {
    return vi.fn(async (file: string, args: readonly string[]) => {
      const command = [file, ...args].join(" ");
      if (command === `gh api --method GET repos/${REPOSITORY}/actions/workflows/${workflowFile}/runs -f event=merge_group -f head_sha=${SOURCE_SHA} -f status=success -f per_page=100`) {
        return JSON.stringify({ workflow_runs: runs });
      }
      if (command === "gh run view 21 --json jobs") return jobs;
      throw new Error(`Unexpected command: ${command}`);
    });
  }

  async function report(mode: string, env: NodeJS.ProcessEnv, run: ReturnType<typeof queueRunner>) {
    const appendFile = vi.fn();
    const tested = await reportQueueTested({ mode, env, run, appendFile });
    const summary = appendFile.mock.calls.find(([file]) => file === SUMMARY)?.[1] as string;
    return { tested, appendFile, summary };
  }

  it("lets main's push skip CI's canonical jobs when the queue's run of this commit passed them all", async () => {
    const { tested, appendFile, summary } = await report("queue-tested-ci", pushEnv(), queueRunner());
    expect(tested).toBe(true);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "tested=true\n");
    expect(summary).toContain("Merge-queue run 21 already passed coverage, workers-coverage, e2e, advisory");
  });

  it("checks Journeys against the queue's Journeys run and its journeys job", async () => {
    const run = queueRunner({
      workflowFile: "journeys.yml",
      runs: [queueRun({}, ".github/workflows/journeys.yml")],
      jobs: jobsOutput(["journeys"]),
    });
    expect((await report("queue-tested-journeys", pushEnv(), run)).tested).toBe(true);
    // A CI run for the same commit is not Journeys evidence.
    const ciRun = queueRunner({ workflowFile: "journeys.yml", runs: [queueRun()], jobs: jobsOutput(["journeys"]) });
    expect((await report("queue-tested-journeys", pushEnv(), ciRun)).tested).toBe(false);
  });

  it.each([
    ["a pull request", pushEnv({ GITHUB_EVENT_NAME: "pull_request" }), queueRunner(), "not a push to main"],
    ["a merge-queue group", pushEnv({ GITHUB_EVENT_NAME: "merge_group" }), queueRunner(), "not a push to main"],
    ["a push to another branch", pushEnv({ GITHUB_REF: "refs/heads/feature" }), queueRunner(), "not a push to main"],
    ["a push that bypassed the queue", pushEnv(), queueRunner({ runs: [] }), "No successful merge-queue run"],
    ["a queue run from another repository", pushEnv(), queueRunner({ runs: [queueRun({ head_repository: { full_name: "attacker/spoonjoy-v2" } })] }), "No successful merge-queue run"],
    ["a failed queue run", pushEnv(), queueRunner({ runs: [queueRun({ conclusion: "failure" })] }), "No successful merge-queue run"],
    ["a queue run with a skipped job", pushEnv(), queueRunner({ jobs: jobsOutput(CANONICAL_CI_JOB_NAMES, "skipped") }), "No successful merge-queue run"],
    ["a lookup error", pushEnv(), vi.fn(async () => { throw new Error("HTTP 502"); }), "lookup failed (HTTP 502)"],
    ["a lookup error that is not an Error", pushEnv(), vi.fn(async () => { throw "boom"; }), "lookup failed (boom)"],
    ["a malformed commit", pushEnv({ GITHUB_SHA: "abc" }), queueRunner(), "exact 40-character"],
    ["a missing repository", pushEnv({ GITHUB_REPOSITORY: "" }), queueRunner(), "GITHUB_REPOSITORY is required"],
  ])("runs the full jobs for %s", async (_name, env, run, why) => {
    const { tested, appendFile, summary } = await report("queue-tested-ci", env, run as ReturnType<typeof queueRunner>);
    expect(tested).toBe(false);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "tested=false\n");
    expect(summary).toContain(why);
  });

  it("fails, so the jobs run, without somewhere to write its answer or with an unknown mode", async () => {
    await expect(reportQueueTested({ mode: "queue-tested-ci", env: pushEnv({ GITHUB_OUTPUT: "" }), run: queueRunner(), appendFile: vi.fn() }))
      .rejects.toThrow("GITHUB_OUTPUT is required.");
    await expect(reportQueueTested({ mode: "queue-tested-storybook", env: pushEnv(), run: queueRunner(), appendFile: vi.fn() }))
      .rejects.toThrow("Unknown queue-tested mode: queue-tested-storybook.");
    await expect(reportQueueTested()).rejects.toThrow("Unknown queue-tested mode: undefined.");
  });

  it("uses the process environment by default", async () => {
    vi.stubEnv("GITHUB_OUTPUT", "");
    try {
      await expect(reportQueueTested({ mode: "queue-tested-ci" })).rejects.toThrow("GITHUB_OUTPUT is required.");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is reachable from the CLI for each mode", async () => {
    const appendFile = vi.fn();
    await main(["queue-tested-ci"], { env: pushEnv(), run: queueRunner(), appendFile });
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "tested=true\n");
  });
});
