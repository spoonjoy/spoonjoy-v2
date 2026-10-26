import { describe, expect, it, vi } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCaptured, runInherited, testChanged, testsNamingPaths } from "../../scripts/test-changed.mjs";
import { findUnexpectedWarnings } from "../../scripts/warning-gate.ts";

const BASE = "b".repeat(40);
const LIST_FILE = "/tmp/changed.json";
const LIST_CHANGED = ["pnpm", ["exec", "vitest", "list", "--changed", BASE, "--filesOnly", `--json=${LIST_FILE}`]];
const LIST_ALL = ["pnpm", ["exec", "vitest", "list", "--filesOnly", `--json=${LIST_FILE}`]];
const RUN_CHANGED = ["pnpm", ["exec", "vitest", "run", "--changed", BASE]];

interface Setup {
  /** What `vitest list --changed` names. */
  imported?: unknown;
  /** What plain `vitest list` names. */
  all?: unknown;
  /** Each test file's source, by repository-relative path. */
  sources?: Record<string, string>;
  /** `git diff --name-only`'s output. */
  diff?: string;
  diffStatus?: number;
  statuses?: number[];
}

function deps({ imported = [], all = imported, sources = {}, diff = "", diffStatus = 0, statuses = [] }: Setup = {}) {
  let lastList: unknown;
  const run = vi.fn((_command: string, args: readonly string[]) => {
    if (args[2] === "list") lastList = args.includes("--changed") ? imported : all;
    return statuses.shift() ?? 0;
  });
  const capture = vi.fn((_command: string, _args: readonly string[]) => ({ status: diffStatus, stdout: diff }));
  const readFile = vi.fn((file: string) => {
    if (file === LIST_FILE) return typeof lastList === "string" ? lastList : JSON.stringify(lastList);
    return sources[file] ?? "";
  });
  return { env: { SPOONJOY_CHANGED_SINCE: BASE }, run, capture, log: vi.fn(), readFile, removeFile: vi.fn(), listFile: LIST_FILE, cwd: "/repo" };
}

describe("testChanged", () => {
  it("runs the tests the changes reach through imports against the base commit", () => {
    const d = deps({ imported: [{ file: "/repo/test/a.test.ts" }], all: [{ file: "/repo/test/a.test.ts" }, { file: "/repo/test/b.test.ts" }], diff: "app/a.ts\n" });
    expect(testChanged(d)).toBe(0);
    expect(d.capture).toHaveBeenCalledWith("git", ["diff", "--name-only", "--no-renames", BASE, "HEAD"]);
    expect(d.run.mock.calls).toEqual([LIST_CHANGED, LIST_ALL, RUN_CHANGED]);
    expect(d.log).toHaveBeenCalledWith(`1 test file(s) are affected by the changes since ${BASE} through imports.`);
  });

  it("also runs a test that reads a changed file by path, which --changed cannot see", () => {
    const d = deps({
      imported: [{ file: "/repo/test/a.test.ts" }],
      all: [{ file: "/repo/test/a.test.ts" }, { file: "test/config/worker-observability.test.ts" }, { file: "/repo/test/c.test.ts" }],
      sources: {
        "test/config/worker-observability.test.ts": 'JSON.parse(readFileSync("wrangler.json", "utf8"))',
        "test/c.test.ts": 'readFileSync("wrangler.seed.json")',
      },
      diff: "wrangler.json\napp/a.ts\n",
    });
    expect(testChanged(d)).toBe(0);
    expect(d.run.mock.calls).toEqual([LIST_CHANGED, LIST_ALL, ["pnpm", ["exec", "vitest", "run", "test/a.test.ts", "test/config/worker-observability.test.ts"]]]);
    expect(d.log).toHaveBeenCalledWith("1 more test file(s) name a changed file.");
  });

  it("logs nothing the warning gate rejects when a test with warning in its name names a changed file", () => {
    const d = deps({
      imported: [],
      all: [{ file: "/repo/test/config/warning-policy.test.ts" }],
      sources: { "test/config/warning-policy.test.ts": 'readFileSync("vitest.config.ts")' },
      diff: "vitest.config.ts\n",
    });
    expect(testChanged(d)).toBe(0);
    expect(d.run).toHaveBeenLastCalledWith("pnpm", ["exec", "vitest", "run", "test/config/warning-policy.test.ts"]);
    const logged = d.log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(findUnexpectedWarnings(logged)).toEqual([]);
  });

  it("runs a test that only names a changed file even when no import reaches a test", () => {
    const d = deps({ imported: [], all: [{ file: "/repo/test/workflows/ci.test.ts" }], sources: { "test/workflows/ci.test.ts": "read('.github/workflows/ci.yml')" }, diff: ".github/workflows/ci.yml" });
    expect(testChanged(d)).toBe(0);
    expect(d.run).toHaveBeenLastCalledWith("pnpm", ["exec", "vitest", "run", "test/workflows/ci.test.ts"]);
    expect(d.log).toHaveBeenCalledWith(`0 test file(s) are affected by the changes since ${BASE} through imports.`);
  });

  it("keeps --changed when every test naming a changed file is already selected", () => {
    const d = deps({ imported: [{ file: "/repo/test/a.test.ts" }], sources: { "test/a.test.ts": "`wrangler.json`" }, diff: "wrangler.json" });
    expect(testChanged(d)).toBe(0);
    expect(d.run).toHaveBeenLastCalledWith(...RUN_CHANGED);
  });

  it("deletes the listing even when it cannot be read", () => {
    const d = { ...deps(), readFile: vi.fn(() => { throw new Error("EACCES"); }) };
    expect(() => testChanged(d)).toThrow("EACCES");
    expect(d.removeFile).toHaveBeenCalledWith(LIST_FILE);
  });

  it("passes without running Vitest when no test is affected", () => {
    const d = deps({ all: [{ file: "/repo/test/a.test.ts" }], sources: { "test/a.test.ts": '"README.md"' }, diff: "docs/guide.md\n" });
    expect(testChanged(d)).toBe(0);
    expect(d.removeFile).toHaveBeenCalledTimes(2);
    expect(d.run.mock.calls).toEqual([LIST_CHANGED, LIST_ALL]);
    expect(d.log).toHaveBeenCalledWith(`No unit tests are affected by the changes since ${BASE}.`);
  });

  it("fails with the status of whichever step fails", () => {
    expect(testChanged(deps({ diffStatus: 128 }))).toBe(128);
    expect(testChanged(deps({ statuses: [2] }))).toBe(2);
    expect(testChanged(deps({ statuses: [0, 3] }))).toBe(3);
    expect(testChanged(deps({ imported: [{ file: "a" }], statuses: [0, 0, 1] }))).toBe(1);
  });

  it.each([
    ["missing", {}],
    ["a branch name", { SPOONJOY_CHANGED_SINCE: "main" }],
    ["shell syntax", { SPOONJOY_CHANGED_SINCE: `${BASE}; echo` }],
  ])("refuses a base commit that is %s", (_name, env) => {
    expect(() => testChanged({ ...deps(), env })).toThrow("SPOONJOY_CHANGED_SINCE must be the base commit's 40-character SHA.");
  });

  it("rejects a listing that is not a file list", () => {
    expect(() => testChanged(deps({ imported: { files: [] } }))).toThrow("vitest list did not return a file list.");
    expect(() => testChanged(deps({ imported: "not json" }))).toThrow();
  });

  it("reads the real listing file and logs to stdout by default", () => {
    const listFile = path.join(tmpdir(), `spoonjoy-test-changed-${process.pid}.json`);
    const run = () => {
      writeFileSync(listFile, "[]");
      return 0;
    };
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(testChanged({ env: { SPOONJOY_CHANGED_SINCE: BASE }, run, capture: () => ({ status: 0, stdout: "" }), listFile })).toBe(0);
      expect(write).toHaveBeenCalledWith(`No unit tests are affected by the changes since ${BASE}.\n`);
      expect(existsSync(listFile)).toBe(false);
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

  it("captures a real child's output and status", () => {
    expect(runCaptured(process.execPath, ["-e", "process.stdout.write('wrangler.json\\n')"])).toEqual({ status: 0, stdout: "wrangler.json\n" });
    expect(runCaptured(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"])).toEqual({ status: 1, stdout: "" });
    expect(runCaptured("spoonjoy-no-such-command", [])).toEqual({ status: 1, stdout: "" });
  });
});

describe("testsNamingPaths", () => {
  const sources: Record<string, string> = {
    "test/a.test.ts": 'readFileSync("wrangler.json")',
    "test/b.test.ts": "const file = 'migrations/0001_init.sql';",
    "test/c.test.ts": "readFileSync(`app/styles/tailwind.css`)",
    "test/d.test.ts": 'readFileSync("wrangler.json.bak")',
    "test/e.test.ts": "// wrangler.json is mentioned without quotes",
    "test/f.test.ts": 'readFileSync(path.join(__dirname, "../server.json"))',
    "test/g.test.ts": 'readFileSync("my-server.json")',
  };
  const files = Object.keys(sources);

  it("selects a test whose source names a changed path as a whole quoted string", () => {
    expect(testsNamingPaths(files, ["wrangler.json", "migrations/0001_init.sql", "app/styles/tailwind.css"], (file: string) => sources[file])).toEqual([
      "test/a.test.ts",
      "test/b.test.ts",
      "test/c.test.ts",
    ]);
  });

  it("selects a test that names the changed file after a directory, as a relative path does", () => {
    expect(testsNamingPaths(files, ["server.json"], (file: string) => sources[file])).toEqual(["test/f.test.ts"]);
  });

  it("reads nothing when nothing changed", () => {
    const readFile = vi.fn();
    expect(testsNamingPaths(files, [], readFile)).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("matches a path's dots and other pattern characters literally", () => {
    expect(testsNamingPaths(["t"], ["wrangler.json"], () => '"wranglerXjson"')).toEqual([]);
  });
});
