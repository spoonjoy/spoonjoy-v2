import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildExactOauthClientCleanupSql,
  wranglerLocalD1Args,
} from "./cleanup-local-qa-data.mjs";

const execFileAsync = promisify(execFile);
const RUN_ID_PATTERN = /^e2e-run-[A-Za-z0-9-]{16,80}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_WRANGLER_BUFFER = 1024 * 1024 * 8;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("Invalid E2E run ID.");
  }
}

function assertClientId(clientId) {
  if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error("Invalid E2E OAuth client ID.");
  }
}

function parseWranglerRows(stdout) {
  const normalized = stdout.replace(ANSI_PATTERN, "");
  const rootLineStart = normalized.lastIndexOf("\n[");
  const start = normalized.startsWith("[") ? 0 : rootLineStart === -1 ? -1 : rootLineStart + 1;
  const end = normalized.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  const parsed = JSON.parse(normalized.slice(start, end + 1));
  return parsed.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []));
}

export function createE2eRunId() {
  return `e2e-run-${randomUUID()}`;
}

export function e2eRunPaths(projectRoot, runId) {
  assertRunId(runId);
  const runsPath = resolve(projectRoot, ".wrangler", "e2e-runs");
  const runPath = resolve(runsPath, runId);
  return {
    baselinePersistPath: resolve(projectRoot, ".wrangler", "state"),
    runPath,
    persistPath: join(runPath, "state"),
    manifestPath: join(runPath, "manifest"),
    markerPath: join(runPath, "run.json"),
    teardownPath: join(runPath, "teardown-requested.json"),
    resultPath: join(runsPath, `${runId}.result.json`),
  };
}

export function e2eOauthClientName(runId) {
  assertRunId(runId);
  return `E2E OAuth Client [${runId}]`;
}

export async function prepareE2eRun({ projectRoot, runId, serverProcessId = process.pid }) {
  const paths = e2eRunPaths(projectRoot, runId);
  if (!Number.isSafeInteger(serverProcessId) || serverProcessId <= 0) {
    throw new Error("Invalid E2E launcher process ID.");
  }
  const baseline = await stat(paths.baselinePersistPath).catch(() => null);
  if (!baseline?.isDirectory()) {
    throw new Error(`Playwright baseline Wrangler state is missing: ${paths.baselinePersistPath}`);
  }

  await rm(paths.runPath, { recursive: true, force: true });
  await rm(paths.resultPath, { force: true });
  await mkdir(paths.runPath, { recursive: true });
  await cp(paths.baselinePersistPath, paths.persistPath, { recursive: true });
  await writeFile(paths.markerPath, `${JSON.stringify({ runId, serverProcessId })}\n`, { flag: "wx" });
  return paths;
}

export async function recordE2eOauthClient({ projectRoot, runId, clientId }) {
  assertRunId(runId);
  assertClientId(clientId);
  const paths = e2eRunPaths(projectRoot, runId);
  const clientPath = join(paths.manifestPath, "oauth-clients");
  await mkdir(clientPath, { recursive: true });
  const filename = `${createHash("sha256").update(clientId).digest("hex")}.json`;
  const destination = join(clientPath, filename);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ runId, clientId })}\n`, { flag: "wx" });
  await rename(temporary, destination);
}

export async function readE2eOauthClientIds({ projectRoot, runId }) {
  assertRunId(runId);
  const { manifestPath } = e2eRunPaths(projectRoot, runId);
  const clientPath = join(manifestPath, "oauth-clients");
  const entries = await readdir(clientPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const clientIds = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = JSON.parse(await readFile(join(clientPath, entry.name), "utf8"));
    if (record?.runId !== runId) throw new Error("OAuth manifest run marker does not match this E2E run.");
    assertClientId(record?.clientId);
    clientIds.push(record.clientId);
  }
  return [...new Set(clientIds)].sort();
}

export async function removeE2eRunArtifacts({ projectRoot, runId }) {
  const { resultPath, runPath } = e2eRunPaths(projectRoot, runId);
  await rm(runPath, { recursive: true, force: true });
  await rm(resultPath, { force: true });
}

export async function waitForE2eRunRemoval(
  { statPath, delay: wait, maxAttempts },
  runPath,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await statPath(runPath);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await wait(100);
  }
  throw new Error(`Playwright launcher did not remove its E2E run: ${runPath}`);
}

const waitForRealE2eRunRemoval = waitForE2eRunRemoval.bind(null, {
  statPath: stat,
  delay,
  maxAttempts: 100,
});

export async function runE2eGlobalTeardown(
  { killProcess, waitForRemoval, resultRuntime = realE2eRunResultRuntime },
  { projectRoot, runId },
) {
  const paths = e2eRunPaths(projectRoot, runId);
  const marker = JSON.parse(await readFile(paths.markerPath, "utf8"));
  if (marker?.runId !== runId) throw new Error("E2E launcher run marker does not match teardown.");
  if (!Number.isSafeInteger(marker?.serverProcessId) || marker.serverProcessId <= 0) {
    throw new Error("Invalid E2E launcher process ID.");
  }
  await writeFile(
    paths.teardownPath,
    `${JSON.stringify({ runId, state: "requested" })}\n`,
    { flag: "w" },
  );
  try {
    try {
      killProcess(marker.serverProcessId, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    await waitForRemoval(paths.runPath);
  } catch (error) {
    try {
      await revokeE2eTeardown(resultRuntime, paths, runId);
    } catch (revocationError) {
      throw new AggregateError(
        [error, revocationError],
        "E2E teardown and ownership revocation both failed.",
      );
    }
    throw error;
  }
  try {
    const result = JSON.parse(await readFile(paths.resultPath, "utf8"));
    if (result?.runId !== runId) throw new Error("E2E cleanup result marker does not match teardown.");
    if (result.ok !== true) throw new Error(result?.error || "E2E cleanup did not report success.");
  } finally {
    await rm(paths.resultPath, { force: true });
  }
}

export const defaultRunE2eGlobalTeardown = runE2eGlobalTeardown.bind(null, {
  killProcess: process.kill,
  waitForRemoval: waitForRealE2eRunRemoval,
});

export async function cleanupE2eRunAfterServer({
  projectRoot,
  runId,
  dbName = "DB",
  runCommand = execFileAsync,
}) {
  const paths = e2eRunPaths(projectRoot, runId);
  try {
    const clientIds = await readE2eOauthClientIds({ projectRoot, runId });
    if (clientIds.length === 0) return;
    const sql = buildExactOauthClientCleanupSql(clientIds);
    const result = await runCommand("pnpm", wranglerLocalD1Args(dbName, sql, paths.persistPath), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    if ((result.stderr ?? "").trim() !== "") {
      throw new Error("Exact E2E OAuth cleanup emitted unexpected stderr output.");
    }
    const rows = parseWranglerRows(result.stdout ?? "");
    const remaining = rows.find((row) => Object.hasOwn(row, "remainingCount"));
    if (!remaining || Number(remaining.remainingCount) !== 0) {
      throw new Error("Exact E2E OAuth cleanup did not prove zero remaining rows.");
    }
    const foreignKeyRows = rows.filter((row) => row !== remaining);
    if (foreignKeyRows.length > 0) {
      throw new Error("Exact E2E OAuth cleanup failed foreign-key verification.");
    }
  } finally {
    await rm(paths.manifestPath, { recursive: true, force: true });
  }
}

async function isE2eTeardownRequested({ readPath }, paths, runId) {
  try {
    const request = JSON.parse(await readPath(paths.teardownPath, "utf8"));
    return request?.runId === runId && request.state === "requested";
  } catch {
    return false;
  }
}

export async function finalizeE2eRunResult(runtime, paths, runId, result) {
  if (!await isE2eTeardownRequested(runtime, paths, runId)) {
    await runtime.removePath(paths.resultPath, { force: true });
    return;
  }

  await runtime.writePath(
    paths.resultPath,
    `${JSON.stringify({ runId, ...result })}\n`,
    { flag: "w" },
  );
  if (!await isE2eTeardownRequested(runtime, paths, runId)) {
    await runtime.removePath(paths.resultPath, { force: true });
  }
}

export async function revokeE2eTeardown(runtime, paths, runId) {
  let revocationError;
  try {
    await runtime.writePath(
      paths.teardownPath,
      `${JSON.stringify({ runId, state: "revoked" })}\n`,
      { flag: "w" },
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      try {
        await runtime.removePath(paths.teardownPath, { force: true });
      } catch (removalError) {
        revocationError = new AggregateError(
          [error, removalError],
          "E2E teardown request could not be revoked or removed.",
        );
      }
    }
  }
  await runtime.removePath(paths.resultPath, { force: true });
  if (revocationError) throw revocationError;
}

const realE2eRunResultRuntime = {
  readPath: readFile,
  writePath: writeFile,
  removePath: rm,
};

export async function runEphemeralE2eServer({
  projectRoot,
  runId,
  launchServer,
  cleanupRun = cleanupE2eRunAfterServer,
}) {
  const paths = await prepareE2eRun({ projectRoot, runId });
  try {
    let result;
    let serverError;
    try {
      result = await launchServer(paths);
    } catch (error) {
      serverError = error;
    }

    try {
      await cleanupRun({ projectRoot, runId });
    } catch (cleanupError) {
      if (serverError) {
        throw new AggregateError([serverError, cleanupError], "E2E server and cleanup both failed.");
      }
      throw cleanupError;
    }
    if (serverError) throw serverError;
    await finalizeE2eRunResult(realE2eRunResultRuntime, paths, runId, { ok: true });
    return result;
  } catch (error) {
    await finalizeE2eRunResult(realE2eRunResultRuntime, paths, runId, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await rm(paths.runPath, { recursive: true, force: true });
  }
}
