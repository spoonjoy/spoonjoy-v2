#!/usr/bin/env node
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMP_PREFIX = "spoonjoy-python-mcp-conformance-";
const BRIDGE_READY_KIND = "spoonjoy-mcp-python-bridge-ready";
const BRIDGE_START_TIMEOUT_MS = positiveMilliseconds(
  process.env.SPOONJOY_MCP_CONFORMANCE_BRIDGE_START_TIMEOUT_MS,
  20_000,
);
const PROCESS_TIMEOUT_MS = 180_000;
const activeProcesses = new Set();

export const SDK_CASES = Object.freeze([
  Object.freeze({ sdkVersion: "1.23.0", protocolVersion: "2025-06-18", mode: "legacy" }),
  Object.freeze({ sdkVersion: "2.1.1", protocolVersion: "2026-07-28", mode: "auto" }),
]);

export function parsePythonVersion(output) {
  const match = /^Python (\d+)\.(\d+)(?:\.\d+)?\s*$/.exec(output);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 3 || (major === 3 && minor < 10)) return null;
  return { major, minor };
}

export function positiveMilliseconds(raw, fallback) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function selectPythonBinary(
  candidates = [process.env.SPOONJOY_PYTHON_BIN, "python3.13", "python3.12", "python3.11", "python3.10", "python3"].filter(Boolean),
  probe = (candidate) => spawnSync(candidate, ["--version"], { encoding: "utf8" }),
) {
  for (const candidate of candidates) {
    const result = probe(candidate);
    const versionOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status === 0 && parsePythonVersion(versionOutput)) return candidate;
  }
  throw new Error("Python 3.10+ is required for the pinned official MCP Python SDKs.");
}

export function parseBridgeReadyLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("The local MCP bridge emitted malformed readiness data.");
  }
  if (
    value?.kind !== BRIDGE_READY_KIND
    || typeof value.url !== "string"
    || typeof value.token !== "string"
    || value.token.length === 0
  ) {
    throw new Error("The local MCP bridge emitted incomplete readiness data.");
  }
  const url = new URL(value.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/mcp") {
    throw new Error("The local MCP bridge readiness URL must be an HTTP loopback /mcp URL.");
  }
  return { url: url.toString(), token: value.token };
}

function assertOwnedTemporaryRoot(path) {
  if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith(TEMP_PREFIX)) {
    throw new Error(`Refusing to clean an unowned path: ${path}`);
  }
}

function removeTemporaryRoot(path) {
  assertOwnedTemporaryRoot(path);
  rmSync(path, { recursive: true, force: true });
}

async function stopBridge(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      signalProcess(child, "SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    signalProcess(child, "SIGTERM");
  });
}

function signalProcess(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // The child may exit between the state check and group signal.
    }
  }
  return child.kill(signal);
}

async function startBridge(environment) {
  const child = spawn("pnpm", ["exec", "tsx", "scripts/mcp-python-sdk-http-bridge.ts"], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeProcesses.add(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
    process.stderr.write(chunk);
  });

  const ready = await new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    const finish = (callback, value) => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners("data");
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      activeProcesses.delete(child);
      callback(value);
    };
    const timeout = setTimeout(() => {
      finish(rejectReady, new Error(`The local MCP bridge did not start within ${BRIDGE_START_TIMEOUT_MS}ms.`));
    }, BRIDGE_START_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          finish(resolveReady, parseBridgeReadyLine(line));
          return;
        } catch (error) {
          finish(rejectReady, error);
          return;
        }
      }
    });
    child.once("exit", (code, signal) => {
      finish(rejectReady, new Error(
        `The local MCP bridge exited before readiness (code ${code}, signal ${signal}).${stderr ? `\n${stderr}` : ""}`,
      ));
    });
    child.once("error", (error) => {
      finish(rejectReady, new Error(`The local MCP bridge could not start: ${error.message}`, { cause: error }));
    });
  }).catch(async (error) => {
    await stopBridge(child);
    throw error;
  });

  return { child, ready };
}

export async function execCommand(command, args, options = {}) {
  return new Promise((resolveExec, rejectExec) => {
    const child = execFile(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: PROCESS_TIMEOUT_MS,
      detached: process.platform !== "win32",
      ...options,
    }, (error, stdout, stderr) => {
      activeProcesses.delete(child);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (!error) {
        resolveExec({ stdout, stderr });
        return;
      }
      const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
      rejectExec(new Error(`${command} ${args.join(" ")} failed.${detail ? `\n${detail}` : ""}`, { cause: error }));
    });
    activeProcesses.add(child);
  });
}

async function runSdkCase({ python, workspace, ready, sdkCase }) {
  const venv = join(workspace, `venv-mcp-${sdkCase.sdkVersion}`);
  await execCommand(python, ["-m", "venv", venv]);
  const venvPython = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const requirements = join(
    dirname(fileURLToPath(import.meta.url)),
    `mcp-python-sdk-${sdkCase.sdkVersion}.requirements.txt`,
  );
  await execCommand(venvPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
    "--quiet", "--no-cache-dir", "--only-binary=:all:", "--require-hashes", "--no-deps", "-r", requirements,
  ]);
  const { stdout } = await execCommand(venvPython, ["scripts/mcp-python-sdk-client.py"], {
    env: {
      ...process.env,
      SPOONJOY_MCP_URL: ready.url,
      SPOONJOY_MCP_TOKEN: ready.token,
      SPOONJOY_MCP_SDK_VERSION: sdkCase.sdkVersion,
      SPOONJOY_MCP_PROTOCOL_VERSION: sdkCase.protocolVersion,
      SPOONJOY_MCP_MODE: sdkCase.mode,
    },
  });
  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Python MCP SDK ${sdkCase.sdkVersion} emitted malformed proof output.`);
  }
  if (
    result.sdkVersion !== sdkCase.sdkVersion
    || result.protocolVersion !== sdkCase.protocolVersion
    || result.tool !== "get_shopping_list"
    || result.shoppingList !== true
  ) {
    throw new Error(`Python MCP SDK ${sdkCase.sdkVersion} returned incomplete conformance proof.`);
  }
  return result;
}

export async function runPythonSdkConformance() {
  const python = selectPythonBinary();
  const workspace = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  const databasePath = join(workspace, "conformance.db");
  const environment = {
    ...process.env,
    DATABASE_URL: `file:${databasePath}`,
    SPOONJOY_FORCE_SQLITE_LOCAL_DB: "1",
    SPOONJOY_NATIVE_DOGFOOD_API: "1",
  };
  let bridge;
  const interrupt = () => {
    if (bridge) signalProcess(bridge.child, "SIGTERM");
    for (const child of activeProcesses) signalProcess(child, "SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await execCommand("sqlite3", [databasePath, "PRAGMA journal_mode=delete;"]);
    await execCommand("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], { env: environment });
    bridge = await startBridge(environment);
    const results = [];
    for (const sdkCase of SDK_CASES) {
      results.push(await runSdkCase({ python, workspace, ready: bridge.ready, sdkCase }));
    }
    return results;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (bridge) await stopBridge(bridge.child);
    removeTemporaryRoot(workspace);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const results = await runPythonSdkConformance();
  for (const result of results) {
    console.log(
      `PASS official Python MCP SDK ${result.sdkVersion}: ${result.protocolVersion}, ${result.tool}, ${result.toolCount} tools`,
    );
  }
}
