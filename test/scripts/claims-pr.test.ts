import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectConsoleError } from "../warning-policy";
import { CHECKER, defaultDeps, isCliEntry, main, pullRequestText, runCliIfEntry, STEPS } from "../../scripts/claims-pr.mjs";

const event = { pull_request: { title: "Adopt Ouro HX v1.2.0", body: "It installs 3 items.[^n]" } };

function setup(overrides: Record<string, unknown> = {}) {
  const io = { error: vi.fn() };
  const run = vi.fn().mockReturnValue({ status: 0 });
  const readFile = vi.fn().mockReturnValue(JSON.stringify(event));
  const revParse = vi.fn().mockReturnValue({ status: 0, stdout: "abc123\n", stderr: "" });
  const env = { GITHUB_EVENT_PATH: "/event.json", PATH: "/bin" };
  return { io, run, readFile, revParse, env, ...overrides };
}

describe("pullRequestText", () => {
  it("reads the title and body of a pull_request event, and empty text when they are missing", () => {
    expect(pullRequestText(event)).toEqual({ title: "Adopt Ouro HX v1.2.0", body: "It installs 3 items.[^n]" });
    expect(pullRequestText({ pull_request: {} })).toEqual({ title: "", body: "" });
  });

  it("refuses an event that is not a pull request's", () => {
    expect(() => pullRequestText({ merge_group: {} })).toThrow("holds no pull_request event");
    expect(() => pullRequestText(null)).toThrow("holds no pull_request event");
  });
});

describe("main", () => {
  it("runs the ratchet, the title and body lint and the full check against the base commit", () => {
    const deps = setup();
    expect(main(deps)).toBe(0);
    expect(deps.readFile).toHaveBeenCalledWith("/event.json");
    expect(deps.run.mock.calls.map(([command, args]) => [command, args])).toEqual(
      STEPS.map((step) => [process.execPath, [CHECKER, ...step]]),
    );
    for (const [, , options] of deps.run.mock.calls) {
      expect(options.env).toEqual({
        GITHUB_EVENT_PATH: "/event.json",
        PATH: "/bin",
        CLAIMS_BASE_REF: "abc123",
        PR_TITLE: "Adopt Ouro HX v1.2.0",
        PR_BODY: "It installs 3 items.[^n]",
      });
    }
  });

  it("runs every step, and fails when any of them fails", () => {
    const deps = setup({ run: vi.fn().mockReturnValueOnce({ status: 1 }).mockReturnValue({ status: 0 }) });
    expect(main(deps)).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(STEPS.length);
  });

  it("needs the event file", () => {
    const deps = setup({ env: {} });
    expect(main(deps)).toBe(2);
    expect(deps.io.error).toHaveBeenCalledWith("claims-pr: GITHUB_EVENT_PATH is not set; run it in a pull_request workflow.");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("needs the base commit", () => {
    const deps = setup({ revParse: vi.fn().mockReturnValue({ status: 128, stdout: "", stderr: "fatal: no HEAD^1\n" }) });
    expect(main(deps)).toBe(2);
    expect(deps.io.error).toHaveBeenCalledWith("claims-pr: cannot read the base commit (HEAD^1): fatal: no HEAD^1");
    const silent = setup({ revParse: vi.fn().mockReturnValue({ status: 128, stdout: "" }) });
    expect(main(silent)).toBe(2);
    expect(silent.io.error).toHaveBeenCalledWith("claims-pr: cannot read the base commit (HEAD^1):");
  });
});

describe("defaults", () => {
  it("reads files, runs commands, reads the base commit and reports to the console", () => {
    const dir = mkdtempSync(join(tmpdir(), "claims-pr-"));
    writeFileSync(join(dir, "event.json"), JSON.stringify(event));
    expect(JSON.parse(defaultDeps.readFile(join(dir, "event.json")))).toEqual(event);
    expect(defaultDeps.run(process.execPath, ["-e", "process.exit(3)"], {}).status).toBe(3);
    expect(typeof defaultDeps.revParse().status).toBe("number");
    expect(defaultDeps.io).toBe(console);
    expect(defaultDeps.env).toBe(process.env);
  });

  it("uses the defaults it is not given", () => {
    const run = vi.fn().mockReturnValue({ status: 0 });
    const dir = mkdtempSync(join(tmpdir(), "claims-pr-"));
    writeFileSync(join(dir, "event.json"), JSON.stringify(event));
    const revParse = vi.fn().mockReturnValue({ status: 0, stdout: "base\n" });
    expect(main({ env: { GITHUB_EVENT_PATH: join(dir, "event.json") }, run, revParse })).toBe(0);
    expect(run).toHaveBeenCalledTimes(STEPS.length);
  });
});

describe("the command line", () => {
  it("runs nothing when imported, and only as the entry script", () => {
    expect(runCliIfEntry()).toBe(false);
    expect(isCliEntry("file:///repo/scripts/claims-pr.mjs", "/repo/scripts/claims-pr.mjs")).toBe(true);
    expect(isCliEntry("file:///repo/scripts/claims-pr.mjs", undefined)).toBe(false);
  });

  it("sets the exit code from main when it is the entry script", () => {
    const exitCode = process.exitCode;
    const runMain = vi.fn().mockReturnValue(1);
    expect(runCliIfEntry({ moduleUrl: "file:///repo/scripts/claims-pr.mjs", argv1: "/repo/scripts/claims-pr.mjs", runMain })).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = exitCode;
  });

  it("runs main with the real dependencies by default", () => {
    const exitCode = process.exitCode;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_EVENT_PATH;
    expectConsoleError("claims-pr: GITHUB_EVENT_PATH is not set; run it in a pull_request workflow.");
    try {
      expect(runCliIfEntry({ moduleUrl: "file:///repo/scripts/claims-pr.mjs", argv1: "/repo/scripts/claims-pr.mjs" })).toBe(true);
      expect(process.exitCode).toBe(2);
    } finally {
      if (eventPath !== undefined) process.env.GITHUB_EVENT_PATH = eventPath;
      process.exitCode = exitCode;
    }
  });
});
