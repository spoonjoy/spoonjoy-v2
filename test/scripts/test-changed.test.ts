import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInherited, testChanged } from "../../scripts/test-changed.mjs";

const BASE = "b".repeat(40);

function deps(listing: unknown, statuses: number[] = [0, 0]) {
  const run = vi.fn((_command: string, _args: readonly string[]) => statuses.shift() ?? 0);
  const log = vi.fn();
  return {
    env: { SPOONJOY_CHANGED_SINCE: BASE },
    run,
    log,
    readFile: vi.fn(() => (typeof listing === "string" ? listing : JSON.stringify(listing))),
    listFile: "/tmp/changed.json",
  };
}

describe("testChanged", () => {
  it("lists the affected tests, then runs them against the base commit", () => {
    const d = deps([{ file: "/repo/test/a.test.ts" }]);
    expect(testChanged(d)).toBe(0);
    expect(d.run.mock.calls).toEqual([
      ["pnpm", ["exec", "vitest", "list", "--changed", BASE, "--filesOnly", "--json=/tmp/changed.json"]],
      ["pnpm", ["exec", "vitest", "run", "--changed", BASE, "--fileParallelism=false"]],
    ]);
    expect(d.log).toHaveBeenCalledWith(`1 test file(s) are affected by the changes since ${BASE}.`);
  });

  it("passes without running Vitest when no test is affected", () => {
    const d = deps([]);
    expect(testChanged(d)).toBe(0);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.log).toHaveBeenCalledWith(`No unit tests are affected by the changes since ${BASE}.`);
  });

  it("fails with Vitest's status when listing or running fails", () => {
    expect(testChanged(deps([], [2]))).toBe(2);
    expect(testChanged(deps([{ file: "a" }], [0, 1]))).toBe(1);
  });

  it.each([
    ["missing", {}],
    ["a branch name", { SPOONJOY_CHANGED_SINCE: "main" }],
    ["shell syntax", { SPOONJOY_CHANGED_SINCE: `${BASE}; echo` }],
  ])("refuses a base commit that is %s", (_name, env) => {
    expect(() => testChanged({ ...deps([]), env })).toThrow("SPOONJOY_CHANGED_SINCE must be the base commit's 40-character SHA.");
  });

  it("rejects a listing that is not a file list", () => {
    expect(() => testChanged(deps({ files: [] }))).toThrow("vitest list did not return a file list.");
    expect(() => testChanged(deps("not json"))).toThrow();
  });

  it("reads the real listing file and logs to stdout by default", () => {
    const listFile = path.join(tmpdir(), `spoonjoy-test-changed-${process.pid}.json`);
    writeFileSync(listFile, "[]");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(testChanged({ env: { SPOONJOY_CHANGED_SINCE: BASE }, run: () => 0, listFile })).toBe(0);
      expect(write).toHaveBeenCalledWith(`No unit tests are affected by the changes since ${BASE}.\n`);
    } finally {
      write.mockRestore();
    }
    vi.stubEnv("SPOONJOY_CHANGED_SINCE", "");
    try {
      expect(() => testChanged()).toThrow("SPOONJOY_CHANGED_SINCE");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns a real child's exit status", () => {
    expect(runInherited(process.execPath, ["-e", "process.exit(3)"])).toBe(3);
    expect(runInherited(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"])).toBe(1);
  });
});
