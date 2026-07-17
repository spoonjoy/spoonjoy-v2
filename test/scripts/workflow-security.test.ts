import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CSP_REPORT_ONLY_BREAK_GLASS_ACK,
  isCliEntry,
  main,
  runCliIfEntry,
  runWorkflowCommand,
  sleepMilliseconds,
  validateCiInvocation,
  validateProductionDeploySource,
} from "../../scripts/workflow-security.mjs";

const SOURCE_SHA = "a".repeat(40);
const ROLLBACK_VERSION_ID = "22222222-2222-4222-8222-222222222222";

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

function successfulRunner(): WorkflowCommandRunner & ReturnType<typeof vi.fn> {
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
        jobs: [
          { name: "coverage", conclusion: "success" },
          { name: "e2e", conclusion: "success" },
          { name: "advisory", conclusion: "success" },
        ],
      });
    }
    if (command.includes("gh run list --workflow .github/workflows/storybook.yml")) {
      return JSON.stringify([{ databaseId: 12, headSha: SOURCE_SHA, event: "push" }]);
    }
    if (command === "gh run view 12 --json jobs") {
      return JSON.stringify({ jobs: [{ name: "build-storybook", conclusion: "success" }] });
    }
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
    const run = successfulRunner();
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
      { WORKFLOW_RUN_HEAD_SHA: "b".repeat(40) },
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
    await expect(validateProductionDeploySource({
      env: valid,
      run: runnerWithOverride((command) => command === "git rev-parse origin/main", `${"b".repeat(40)}\n`),
      sleep: vi.fn(),
    })).rejects.toThrow(/automatic production release/i);
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
