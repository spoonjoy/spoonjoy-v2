import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import {
  SDK_CASES,
  parseBridgeReadyLine,
  parsePythonVersion,
  positiveMilliseconds,
  selectPythonBinary,
} from "../../scripts/mcp-python-sdk-conformance.mjs";
import {
  requestBody,
  requestHeaders,
  writeResponse,
} from "../../scripts/mcp-python-sdk-http-bridge";

const CONFORMANCE_TEMP_PREFIX = "spoonjoy-python-mcp-conformance-";

function conformanceTemporaryRoots() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(CONFORMANCE_TEMP_PREFIX)));
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 30_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function descendantPids(rootPid: number) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = new Set<number>();
  let parents = new Set([rootPid]);
  while (parents.size > 0) {
    const children = rows
      .filter(([, parent]) => parents.has(parent))
      .map(([pid]) => pid)
      .filter((pid) => !descendants.has(pid));
    if (children.length === 0) break;
    for (const pid of children) descendants.add(pid);
    parents = new Set(children);
  }
  return descendants;
}

async function expectProcessesStopped(pids: Iterable<number>) {
  const values = [...pids];
  const deadline = Date.now() + 5_000;
  while (values.some(processIsAlive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(values.filter(processIsAlive)).toEqual([]);
}

async function runHarness(environment: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stderr: string; descendants: Set<number> }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/mcp-python-sdk-conformance.mjs"], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const descendants = new Set<number>();
    const poll = setInterval(() => {
      for (const pid of descendantPids(child.pid!)) descendants.add(pid);
    }, 50);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearInterval(poll);
      reject(error);
    });
    child.once("exit", (code) => {
      clearInterval(poll);
      resolve({ code, stderr, descendants });
    });
  });
}

async function runInterruptedHarness(signal: "SIGINT" | "SIGTERM") {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "spoonjoy-python-harness-fixture-"));
  const python = join(fixtureRoot, "python-fixture");
  const pidFile = join(fixtureRoot, "python.pid");
  writeFileSync(python, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Python 3.13.14"
  exit 0
fi
echo $$ > "$SPOONJOY_FAKE_PYTHON_PID_FILE"
trap 'exit 143' TERM
while :; do sleep 1; done
`);
  chmodSync(python, 0o755);
  const before = conformanceTemporaryRoots();
  const child = spawn(process.execPath, ["scripts/mcp-python-sdk-conformance.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SPOONJOY_PYTHON_BIN: python,
      SPOONJOY_FAKE_PYTHON_PID_FILE: pidFile,
    },
    stdio: "ignore",
  });
  try {
    await waitForFile(pidFile);
    const workerPid = Number(readFileSync(pidFile, "utf8").trim());
    const descendants = descendantPids(child.pid!);
    child.kill(signal);
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      child.once("error", reject);
    });
    descendants.add(workerPid);
    await expectProcessesStopped(descendants);
    expect(conformanceTemporaryRoots()).toEqual(before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe("Python MCP SDK conformance harness", () => {
  it("pins the official legacy and modern SDK/protocol pairs", () => {
    expect(SDK_CASES).toEqual([
      { sdkVersion: "1.23.0", protocolVersion: "2025-06-18", mode: "legacy" },
      { sdkVersion: "2.1.1", protocolVersion: "2026-07-28", mode: "auto" },
    ]);
  });

  it.each([
    ["Python 3.13.14\n", { major: 3, minor: 13 }],
    ["Python 3.10.0", { major: 3, minor: 10 }],
    ["Python 3.9.6", null],
    ["not python", null],
  ])("parses supported Python versions from %j", (output, expected) => {
    expect(parsePythonVersion(output)).toEqual(expected);
  });

  it.each([
    ["1", 20_000, 1],
    ["250", 20_000, 250],
    [undefined, 20_000, 20_000],
    ["0", 20_000, 20_000],
    ["1.5", 20_000, 20_000],
    ["invalid", 20_000, 20_000],
  ])("accepts only positive whole-millisecond timeout overrides", (raw, fallback, expected) => {
    expect(positiveMilliseconds(raw, fallback)).toBe(expected);
  });

  it("selects the first available Python 3.10+ interpreter", () => {
    const probe = vi.fn((candidate: string) => {
      if (candidate === "python3.13") return { status: 0, stdout: "Python 3.13.14", stderr: "" };
      if (candidate === "python3") return { status: 0, stdout: "Python 3.9.6", stderr: "" };
      return { status: 127, stdout: "", stderr: "missing" };
    });

    expect(selectPythonBinary(["python3", "python3.13"], probe)).toBe("python3.13");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when no supported interpreter is available", () => {
    expect(() => selectPythonBinary(["python3"], () => ({
      status: 0,
      stdout: "Python 3.9.6",
      stderr: "",
    }))).toThrow(/Python 3\.10\+ is required/);
  });

  it("accepts only complete loopback bridge readiness messages", () => {
    expect(parseBridgeReadyLine(JSON.stringify({
      kind: "spoonjoy-mcp-python-bridge-ready",
      url: "http://127.0.0.1:41234/mcp",
      token: "secret",
    }))).toEqual({ url: "http://127.0.0.1:41234/mcp", token: "secret" });

    expect(() => parseBridgeReadyLine(JSON.stringify({
      kind: "spoonjoy-mcp-python-bridge-ready",
      url: "https://example.com/mcp",
      token: "secret",
    }))).toThrow(/loopback/);
    expect(() => parseBridgeReadyLine("not json")).toThrow(/readiness/);
    expect(() => parseBridgeReadyLine(JSON.stringify({
      kind: "spoonjoy-mcp-python-bridge-ready",
      url: "http://127.0.0.1:41234/mcp",
    }))).toThrow(/readiness/);
  });

  it("keeps credentials out of Python argv and constrains the bridge to loopback", () => {
    const orchestrator = readFileSync("scripts/mcp-python-sdk-conformance.mjs", "utf8");
    const client = readFileSync("scripts/mcp-python-sdk-client.py", "utf8");
    const bridge = readFileSync("scripts/mcp-python-sdk-http-bridge.ts", "utf8");

    expect(orchestrator).toContain("SPOONJOY_MCP_TOKEN");
    expect(orchestrator).toContain('await execCommand("sqlite3", [databasePath, "PRAGMA journal_mode=delete;"])');
    expect(orchestrator).toContain("activeProcesses.add(child)");
    expect(orchestrator).toContain("removeTemporaryRoot(workspace)");
    expect(orchestrator).toContain('"--no-cache-dir", "--only-binary=:all:"');
    expect(orchestrator).not.toMatch(/client\.py[^\n]*token/i);
    expect(client).toContain('os.environ["SPOONJOY_MCP_TOKEN"]');
    expect(client).toContain('getattr(result, "is_error", False)');
    expect(bridge).toContain('server.listen(0, "127.0.0.1"');
    expect(bridge).toContain("MAX_BODY_BYTES");
    expect(bridge).toContain("export function requestHeaders");
    expect(bridge).toContain("export async function requestBody");
    expect(bridge).toContain("export async function writeResponse");
  });

  it("adapts incoming bridge headers, bounded bodies, and route responses", async () => {
    const headers = requestHeaders({
      headers: {
        "x-many": ["one", "two"],
        "x-one": "value",
        "x-missing": undefined,
      },
    } as IncomingMessage);
    expect(headers.get("x-many")).toBe("one, two");
    expect(headers.get("x-one")).toBe("value");
    expect(headers.has("x-missing")).toBe(false);

    async function* bodyChunks() {
      yield Buffer.from("one");
      yield "two";
    }
    expect(await requestBody(bodyChunks() as IncomingMessage)).toEqual(Buffer.from("onetwo"));

    async function* oversizedBody() {
      yield Buffer.alloc(1024 * 1024 + 1);
    }
    expect(await requestBody(oversizedBody() as IncomingMessage)).toBeNull();

    const target = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    await writeResponse(target, new Response("bridge-body", {
      status: 202,
      headers: { "x-bridge": "yes" },
    }));
    expect(target.statusCode).toBe(202);
    expect(target.setHeader).toHaveBeenCalledWith("x-bridge", "yes");
    expect(target.end).toHaveBeenCalledWith(Buffer.from("bridge-body"));
  });

  it("installs each SDK from a fully hashed transitive lock", () => {
    const orchestrator = readFileSync("scripts/mcp-python-sdk-conformance.mjs", "utf8");
    for (const sdkVersion of ["1.23.0", "2.1.1"]) {
      const lockPath = `scripts/mcp-python-sdk-${sdkVersion}.requirements.txt`;
      const lock = readFileSync(lockPath, "utf8");
      const requirements = lock.split(/\r?\n(?=[a-zA-Z0-9])/).filter((block) => /^[a-zA-Z0-9]/.test(block));
      expect(requirements.length).toBeGreaterThan(1);
      expect(requirements.every((block) => block.split(/\r?\n/, 1)[0].includes("=="))).toBe(true);
      expect(requirements.every((block) => block.includes("--hash=sha256:"))).toBe(true);
      expect(lock).toContain(`mcp==${sdkVersion}`);
    }
    expect(orchestrator).toContain("mcp-python-sdk-${sdkCase.sdkVersion}.requirements.txt");
    expect(orchestrator).toContain('"--require-hashes"');
    expect(orchestrator).toContain('"--no-deps"');
  });

  it("surfaces successful child stdout and stderr to the outer warning gate", async () => {
    const orchestrator = await import("../../scripts/mcp-python-sdk-conformance.mjs") as Record<string, unknown>;
    const execCommand = orchestrator.execCommand as (
      command: string,
      args: string[],
    ) => Promise<{ stdout: string; stderr: string }>;
    expect(execCommand).toBeTypeOf("function");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await execCommand(process.execPath, ["-e", "process.stdout.write('child-out'); process.stderr.write('child-warning')"]);
      expect(stdout).toHaveBeenCalledWith("child-out");
      expect(stderr).toHaveBeenCalledWith("child-warning");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("removes its processes, database, token workspace, and venv after a bridge startup timeout", async () => {
    const before = conformanceTemporaryRoots();
    const result = await runHarness({
      ...process.env,
      SPOONJOY_MCP_CONFORMANCE_BRIDGE_START_TIMEOUT_MS: "1",
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("did not start within 1ms");
    await expectProcessesStopped(result.descendants);
    expect(conformanceTemporaryRoots()).toEqual(before);
  }, 60_000);

  it("removes its processes, database, token workspace, and failed venv after a child failure", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "spoonjoy-python-harness-failure-"));
    const python = join(fixtureRoot, "python-fixture");
    writeFileSync(python, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Python 3.13.14"
  exit 0
fi
echo "fixture failure" >&2
exit 42
`);
    chmodSync(python, 0o755);
    const before = conformanceTemporaryRoots();
    try {
      const result = await runHarness({ ...process.env, SPOONJOY_PYTHON_BIN: python });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("fixture failure");
      await expectProcessesStopped(result.descendants);
      expect(conformanceTemporaryRoots()).toEqual(before);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cleans all child state after %s",
    async (signal) => runInterruptedHarness(signal),
    60_000,
  );

  it("is an explicit clean CI gate", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(packageJson.scripts["test:mcp-sdk-python"])
      .toBe("node scripts/mcp-python-sdk-conformance.mjs");
    expect(packageJson.scripts["verify:clean:test:mcp-sdk-python"])
      .toBe("node scripts/run-with-warning-policy.mjs -- pnpm run test:mcp-sdk-python");
    expect(workflow).toContain("actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1");
    expect(workflow).toContain("python-version: '3.13'");
    expect(workflow).toContain("run: pnpm run verify:clean:test:mcp-sdk-python");
  });
});
