import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupE2eRunAfterServer,
  createE2eRunId,
  e2eOauthClientName,
  e2eRunPaths,
  finalizeE2eRunResult,
  prepareE2eRun,
  readE2eOauthClientIds,
  recordE2eOauthClient,
  removeE2eRunArtifacts,
  revokeE2eTeardown,
  runE2eGlobalTeardown,
  runEphemeralE2eServer,
  waitForE2eRunRemoval,
} from "../../scripts/e2e-run-cleanup.mjs";

const projectRoot = resolve(import.meta.dirname, "../..");

describe("ephemeral Playwright run ownership", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function createProject() {
    root = await mkdtemp(join(tmpdir(), "spoonjoy-e2e-run-"));
    const baseline = join(root, ".wrangler", "state", "v3", "d1");
    mkdirSync(baseline, { recursive: true });
    writeFileSync(join(baseline, "baseline.sqlite"), "seed-state");
    return root;
  }

  it("copies baseline state, records exact client IDs, and removes the manifest after teardown", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-11111111-1111-4111-8111-111111111111";
    const paths = e2eRunPaths(tempProject, runId);

    await prepareE2eRun({ projectRoot: tempProject, runId });
    await recordE2eOauthClient({ projectRoot: tempProject, runId, clientId: "client-b" });
    await recordE2eOauthClient({ projectRoot: tempProject, runId, clientId: "client-a" });

    expect(readFileSync(join(paths.persistPath, "v3", "d1", "baseline.sqlite"), "utf8")).toBe("seed-state");
    await expect(readE2eOauthClientIds({ projectRoot: tempProject, runId })).resolves.toEqual([
      "client-a",
      "client-b",
    ]);
    expect(e2eOauthClientName(runId)).toBe(`E2E OAuth Client [${runId}]`);

    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify([{ results: [{ remainingCount: 0 }] }, { results: [] }]),
      stderr: "",
    }));
    await cleanupE2eRunAfterServer({ projectRoot: tempProject, runId, runCommand });

    expect(runCommand).toHaveBeenCalledOnce();
    const [, args] = runCommand.mock.calls[0] as [string, string[]];
    expect(args).toEqual(expect.arrayContaining([
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      paths.persistPath,
      "--command",
    ]));
    const sql = args.at(-1)!;
    expect(sql).toContain("'client-a', 'client-b'");
    expect(sql).not.toContain("clientName");
    expect(sql).not.toContain("redirectUris");
    expect(existsSync(paths.manifestPath)).toBe(false);
    expect(existsSync(paths.persistPath)).toBe(true);

    await removeE2eRunArtifacts({ projectRoot: tempProject, runId });
    expect(existsSync(paths.runPath)).toBe(false);
  });

  it("signals the recorded launcher and waits for complete run removal", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-12121212-1212-4212-8212-121212121212";
    const paths = await prepareE2eRun({
      projectRoot: tempProject,
      runId,
      serverProcessId: 4321,
    });
    const killProcess = vi.fn();
    const waitForRemoval = vi.fn(async (runPath: string) => {
      expect(runPath).toBe(paths.runPath);
      await rm(paths.runPath, { recursive: true, force: true });
    });
    writeFileSync(paths.resultPath, JSON.stringify({ runId, ok: true }));

    await runE2eGlobalTeardown(
      { killProcess, waitForRemoval },
      { projectRoot: tempProject, runId },
    );

    expect(killProcess).toHaveBeenCalledWith(4321, "SIGTERM");
    expect(waitForRemoval).toHaveBeenCalledOnce();
    expect(existsSync(paths.runPath)).toBe(false);
    expect(existsSync(paths.resultPath)).toBe(false);
  });

  it("propagates cleanup failure through a registered global teardown handshake", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-14141414-1414-4414-8414-141414141414";
    let releaseServer!: () => void;
    let reportLaunch!: () => void;
    const serverReleased = new Promise<void>((resolveReleased) => {
      releaseServer = resolveReleased;
    });
    const serverLaunched = new Promise<void>((resolveLaunched) => {
      reportLaunch = resolveLaunched;
    });

    const launcher = runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async () => {
        reportLaunch();
        await serverReleased;
      },
      cleanupRun: async () => {
        throw new Error("registered cleanup failed");
      },
    });
    await serverLaunched;

    const teardown = runE2eGlobalTeardown(
      {
        killProcess: vi.fn(() => releaseServer()),
        waitForRemoval: vi.fn(async (runPath: string) => {
          while (existsSync(runPath)) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 0));
          }
        }),
      },
      { projectRoot: tempProject, runId },
    );

    await expect(launcher).rejects.toThrow("registered cleanup failed");
    await expect(teardown).rejects.toThrow("registered cleanup failed");
    await expect(readdir(join(tempProject, ".wrangler", "e2e-runs"))).resolves.toEqual([]);
  });

  it("revokes the teardown request when signaling fails before later launcher cleanup", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-15151515-1515-4515-8515-151515151515";
    let releaseServer!: () => void;
    let reportLaunch!: () => void;
    const serverReleased = new Promise<void>((resolveReleased) => {
      releaseServer = resolveReleased;
    });
    const serverLaunched = new Promise<void>((resolveLaunched) => {
      reportLaunch = resolveLaunched;
    });
    const launcher = runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async () => {
        reportLaunch();
        await serverReleased;
      },
      cleanupRun: async () => undefined,
    });
    await serverLaunched;

    await expect(runE2eGlobalTeardown(
      {
        killProcess: vi.fn(() => {
          throw new Error("signal failed before launcher stopped");
        }),
        waitForRemoval: vi.fn(),
      },
      { projectRoot: tempProject, runId },
    )).rejects.toThrow("signal failed before launcher stopped");

    releaseServer();
    await expect(launcher).resolves.toBeUndefined();
    await expect(readdir(join(tempProject, ".wrangler", "e2e-runs"))).resolves.toEqual([]);
  });

  it("revokes the teardown request when removal times out before launcher cleanup finishes", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-16161616-1616-4616-8616-161616161616";
    let stopServer!: () => void;
    let finishCleanup!: () => void;
    let reportLaunch!: () => void;
    let reportCleanup!: () => void;
    const serverStopped = new Promise<void>((resolveStopped) => {
      stopServer = resolveStopped;
    });
    const cleanupFinished = new Promise<void>((resolveCleanup) => {
      finishCleanup = resolveCleanup;
    });
    const serverLaunched = new Promise<void>((resolveLaunched) => {
      reportLaunch = resolveLaunched;
    });
    const cleanupStarted = new Promise<void>((resolveCleanupStarted) => {
      reportCleanup = resolveCleanupStarted;
    });
    const launcher = runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async () => {
        reportLaunch();
        await serverStopped;
      },
      cleanupRun: async () => {
        reportCleanup();
        await cleanupFinished;
      },
    });
    await serverLaunched;

    await expect(runE2eGlobalTeardown(
      {
        killProcess: vi.fn(() => stopServer()),
        waitForRemoval: vi.fn(async () => {
          await cleanupStarted;
          throw new Error("launcher removal timed out");
        }),
      },
      { projectRoot: tempProject, runId },
    )).rejects.toThrow("launcher removal timed out");

    finishCleanup();
    await expect(launcher).resolves.toBeUndefined();
    await expect(readdir(join(tempProject, ".wrangler", "e2e-runs"))).resolves.toEqual([]);
  });

  it("removes a launcher result when teardown is revoked between bounded checks", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-17171717-1717-4717-8717-171717171717";
    const paths = e2eRunPaths(tempProject, runId);
    const readPath = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ runId, state: "requested" }))
      .mockResolvedValueOnce(JSON.stringify({ runId, state: "revoked" }));
    const writePath = vi.fn(async () => undefined);
    const removePath = vi.fn(async () => undefined);

    await finalizeE2eRunResult(
      { readPath, writePath, removePath },
      paths,
      runId,
      { ok: true },
    );

    expect(writePath).toHaveBeenCalledWith(
      paths.resultPath,
      `${JSON.stringify({ runId, ok: true })}\n`,
      { flag: "w" },
    );
    expect(removePath).toHaveBeenCalledWith(paths.resultPath, { force: true });
  });

  it("removes aborted results when revocation sees a vanished run or write failure", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-18181818-1818-4818-8818-181818181818";
    const paths = e2eRunPaths(tempProject, runId);
    const vanished = Object.assign(new Error("run vanished"), { code: "ENOENT" });
    const removePath = vi.fn(async () => undefined);

    await expect(revokeE2eTeardown(
      {
        writePath: vi.fn(async () => { throw vanished; }),
        removePath,
      },
      paths,
      runId,
    )).resolves.toBeUndefined();
    expect(removePath).toHaveBeenCalledWith(paths.resultPath, { force: true });

    const requestWriteError = new Error("revocation write failed");
    await expect(revokeE2eTeardown(
      {
        writePath: vi.fn(async () => { throw requestWriteError; }),
        removePath,
      },
      paths,
      runId,
    )).resolves.toBeUndefined();
    expect(removePath).toHaveBeenNthCalledWith(2, paths.teardownPath, { force: true });
    expect(removePath).toHaveBeenNthCalledWith(3, paths.resultPath, { force: true });
  });

  it("removes a late launcher result after fallback request deletion", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-19191919-1919-4919-8919-191919191919";
    const paths = e2eRunPaths(tempProject, runId);
    let requestState: "requested" | undefined = "requested";
    let resultPresent = false;
    let releaseLauncherWrite!: () => void;
    let reportLauncherWrite!: () => void;
    const launcherWriteReleased = new Promise<void>((resolveWrite) => {
      releaseLauncherWrite = resolveWrite;
    });
    const launcherWriteStarted = new Promise<void>((resolveWrite) => {
      reportLauncherWrite = resolveWrite;
    });
    const missingRequest = Object.assign(new Error("request removed"), { code: "ENOENT" });

    const launcher = finalizeE2eRunResult(
      {
        readPath: vi.fn(async () => {
          if (!requestState) throw missingRequest;
          return JSON.stringify({ runId, state: requestState });
        }),
        writePath: vi.fn(async () => {
          reportLauncherWrite();
          await launcherWriteReleased;
          resultPresent = true;
        }),
        removePath: vi.fn(async () => {
          resultPresent = false;
        }),
      },
      paths,
      runId,
      { ok: true },
    );
    await launcherWriteStarted;

    await expect(revokeE2eTeardown(
      {
        writePath: vi.fn(async () => { throw new Error("revocation overwrite failed"); }),
        removePath: vi.fn(async (path: string) => {
          if (path === paths.teardownPath) requestState = undefined;
          if (path === paths.resultPath) resultPresent = false;
        }),
      },
      paths,
      runId,
    )).resolves.toBeUndefined();

    releaseLauncherWrite();
    await launcher;
    expect(requestState).toBeUndefined();
    expect(resultPresent).toBe(false);
  });

  it("preserves teardown and fallback-revocation failures", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-20202020-2020-4020-8020-202020202020";
    const paths = await prepareE2eRun({
      projectRoot: tempProject,
      runId,
      serverProcessId: 2020,
    });
    const teardownError = new Error("signal failed");
    const requestWriteError = new Error("revocation overwrite failed");
    const requestRemoveError = new Error("revocation deletion failed");
    const removePath = vi.fn(async (path: string) => {
      if (path === paths.teardownPath) throw requestRemoveError;
    });

    let failure: unknown;
    try {
      await runE2eGlobalTeardown(
        {
          killProcess: vi.fn(() => { throw teardownError; }),
          waitForRemoval: vi.fn(),
          resultRuntime: {
            readPath: vi.fn(),
            writePath: vi.fn(async () => { throw requestWriteError; }),
            removePath,
          },
        },
        { projectRoot: tempProject, runId },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toBe(teardownError);
    const revocationFailure = (failure as AggregateError).errors[1];
    expect(revocationFailure).toBeInstanceOf(AggregateError);
    expect((revocationFailure as AggregateError).errors).toEqual([
      requestWriteError,
      requestRemoveError,
    ]);
    expect(removePath).toHaveBeenCalledWith(paths.resultPath, { force: true });
  });

  it("polls run removal and distinguishes timeout from filesystem failure", async () => {
    const removed = Object.assign(new Error("gone"), { code: "ENOENT" });
    const statPath = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(removed);
    const delay = vi.fn(async () => undefined);

    await expect(waitForE2eRunRemoval(
      { statPath, delay, maxAttempts: 2 },
      "/tmp/e2e-run",
    )).resolves.toBeUndefined();
    expect(delay).toHaveBeenCalledOnce();

    await expect(waitForE2eRunRemoval(
      {
        statPath: vi.fn(async () => ({})),
        delay,
        maxAttempts: 1,
      },
      "/tmp/e2e-stuck",
    )).rejects.toThrow(/did not remove/);

    await expect(waitForE2eRunRemoval(
      {
        statPath: vi.fn(async () => {
          throw new Error("filesystem failed");
        }),
        delay,
        maxAttempts: 1,
      },
      "/tmp/e2e-error",
    )).rejects.toThrow("filesystem failed");
  });

  it("rejects mismatched launcher ownership and only tolerates an exited launcher", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-13131313-1313-4313-8313-131313131313";
    const paths = await prepareE2eRun({
      projectRoot: tempProject,
      runId,
      serverProcessId: 7654,
    });
    writeFileSync(paths.markerPath, JSON.stringify({ runId: "e2e-run-wrong-marker", serverProcessId: 7654 }));
    await expect(runE2eGlobalTeardown(
      { killProcess: vi.fn(), waitForRemoval: vi.fn() },
      { projectRoot: tempProject, runId },
    )).rejects.toThrow(/run marker/);

    writeFileSync(paths.markerPath, JSON.stringify({ runId, serverProcessId: 0 }));
    await expect(runE2eGlobalTeardown(
      { killProcess: vi.fn(), waitForRemoval: vi.fn() },
      { projectRoot: tempProject, runId },
    )).rejects.toThrow(/launcher process ID/);

    writeFileSync(paths.markerPath, JSON.stringify({ runId, serverProcessId: 7654 }));
    writeFileSync(paths.resultPath, JSON.stringify({ runId, ok: true }));
    const exited = Object.assign(new Error("gone"), { code: "ESRCH" });
    const waitForRemoval = vi.fn(async () => undefined);
    await expect(runE2eGlobalTeardown(
      {
        killProcess: vi.fn(() => {
          throw exited;
        }),
        waitForRemoval,
      },
      { projectRoot: tempProject, runId },
    )).resolves.toBeUndefined();
    expect(waitForRemoval).toHaveBeenCalledOnce();

    await expect(runE2eGlobalTeardown(
      {
        killProcess: vi.fn(() => {
          throw new Error("signal failed");
        }),
        waitForRemoval,
      },
      { projectRoot: tempProject, runId },
    )).rejects.toThrow("signal failed");

    writeFileSync(paths.resultPath, JSON.stringify({ runId, ok: false, error: "cleanup proof failed" }));
    await expect(runE2eGlobalTeardown(
      {
        killProcess: vi.fn(),
        waitForRemoval: vi.fn(async () => rm(paths.runPath, { recursive: true, force: true })),
      },
      { projectRoot: tempProject, runId },
    )).rejects.toThrow("cleanup proof failed");
    expect(existsSync(paths.resultPath)).toBe(false);

    const assertRejectedResult = async (
      result: Record<string, unknown>,
      expected: RegExp,
    ) => {
      const freshPaths = await prepareE2eRun({
        projectRoot: tempProject,
        runId,
        serverProcessId: 7654,
      });
      writeFileSync(freshPaths.resultPath, JSON.stringify(result));
      await expect(runE2eGlobalTeardown(
        {
          killProcess: vi.fn(() => {
            throw exited;
          }),
          waitForRemoval: vi.fn(async () => rm(freshPaths.runPath, { recursive: true, force: true })),
        },
        { projectRoot: tempProject, runId },
      )).rejects.toThrow(expected);
      expect(existsSync(freshPaths.resultPath)).toBe(false);
    };

    await assertRejectedResult(
      { runId: "e2e-run-result-mismatch", ok: true },
      /result marker/,
    );
    await assertRejectedResult({ runId, ok: false }, /did not report success/);
  });

  it("creates valid run IDs and rejects missing or non-directory baseline state", async () => {
    expect(createE2eRunId()).toMatch(/^e2e-run-[0-9a-f-]{36}$/);
    expect(() => e2eRunPaths(projectRoot, null as unknown as string)).toThrow(/run ID/);

    root = await mkdtemp(join(tmpdir(), "spoonjoy-e2e-run-"));
    const runId = "e2e-run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await expect(prepareE2eRun({ projectRoot: root, runId })).rejects.toThrow(
      /baseline Wrangler state is missing/,
    );
    await expect(prepareE2eRun({ projectRoot: root, runId, serverProcessId: 0 }))
      .rejects.toThrow(/launcher process ID/);

    mkdirSync(join(root, ".wrangler"), { recursive: true });
    writeFileSync(join(root, ".wrangler", "state"), "not-a-directory");
    await expect(prepareE2eRun({ projectRoot: root, runId })).rejects.toThrow(
      /baseline Wrangler state is missing/,
    );
  });

  it("removes manifest and ephemeral state after exact cleanup or server failure", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-22222222-2222-4222-8222-222222222222";
    const paths = e2eRunPaths(tempProject, runId);
    await prepareE2eRun({ projectRoot: tempProject, runId });
    await recordE2eOauthClient({ projectRoot: tempProject, runId, clientId: "client-failure" });

    await expect(cleanupE2eRunAfterServer({
      projectRoot: tempProject,
      runId,
      runCommand: vi.fn(async () => {
        throw new Error("exact cleanup failed");
      }),
    })).rejects.toThrow("exact cleanup failed");
    expect(existsSync(paths.manifestPath)).toBe(false);

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async () => {
        throw new Error("Playwright server failed");
      },
    })).rejects.toThrow("Playwright server failed");
    expect(existsSync(paths.runPath)).toBe(false);
  });

  it("leaves no E2E run artifacts when startup fails before global teardown", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-23232323-2323-4232-8232-232323232323";

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async () => {
        throw new Error("Playwright startup failed");
      },
      cleanupRun: async () => undefined,
    })).rejects.toThrow("Playwright startup failed");

    await expect(readdir(join(tempProject, ".wrangler", "e2e-runs"))).resolves.toEqual([]);
  });

  it("rejects traversal IDs and manifest records from another run", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-33333333-3333-4333-8333-333333333333";

    expect(() => e2eRunPaths(tempProject, "../shared-state")).toThrow(/run ID/);
    await expect(recordE2eOauthClient({
      projectRoot: tempProject,
      runId,
      clientId: "../client",
    })).rejects.toThrow(/client ID/);

    await prepareE2eRun({ projectRoot: tempProject, runId });
    const { manifestPath } = e2eRunPaths(tempProject, runId);
    mkdirSync(join(manifestPath, "oauth-clients"), { recursive: true });
    writeFileSync(
      join(manifestPath, "oauth-clients", "foreign.json"),
      JSON.stringify({ runId: "e2e-run-foreign", clientId: "client-foreign" }),
    );

    await expect(readE2eOauthClientIds({ projectRoot: tempProject, runId })).rejects.toThrow(/run marker/);
  });

  it("ignores non-record entries and rejects malformed client records", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await prepareE2eRun({ projectRoot: tempProject, runId });
    const { manifestPath } = e2eRunPaths(tempProject, runId);
    const clientPath = join(manifestPath, "oauth-clients");
    mkdirSync(join(clientPath, "nested"), { recursive: true });
    writeFileSync(join(clientPath, "notes.txt"), "ignore me");
    await expect(readE2eOauthClientIds({ projectRoot: tempProject, runId })).resolves.toEqual([]);

    writeFileSync(
      join(clientPath, "invalid.json"),
      JSON.stringify({ runId, clientId: "../invalid" }),
    );
    await expect(readE2eOauthClientIds({ projectRoot: tempProject, runId })).rejects.toThrow(
      /client ID/,
    );

    await rm(clientPath, { recursive: true, force: true });
    writeFileSync(join(manifestPath, "oauth-clients"), "not-a-directory");
    await expect(readE2eOauthClientIds({ projectRoot: tempProject, runId })).rejects.toThrow();
  });

  it("proves exact cleanup output and rejects missing, remaining, or foreign-key rows", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const prepareClient = async (clientId: string) => {
      await prepareE2eRun({ projectRoot: tempProject, runId });
      await recordE2eOauthClient({ projectRoot: tempProject, runId, clientId });
    };
    const runWithStdout = async (stdout: string | undefined) => {
      await cleanupE2eRunAfterServer({
        projectRoot: tempProject,
        runId,
        runCommand: vi.fn(async () => ({ stdout, stderr: "" })),
      });
    };

    await prepareE2eRun({ projectRoot: tempProject, runId });
    await expect(cleanupE2eRunAfterServer({ projectRoot: tempProject, runId })).resolves.toBeUndefined();

    await prepareClient("client-missing-proof");
    await expect(runWithStdout(undefined)).rejects.toThrow(/did not prove zero/);

    await prepareClient("client-remaining");
    await expect(runWithStdout(JSON.stringify([{ results: [{ remainingCount: 2 }] }])))
      .rejects.toThrow(/did not prove zero/);

    await prepareClient("client-foreign-key");
    await expect(runWithStdout(JSON.stringify([
      { ignored: true },
      { results: [{ remainingCount: 0 }] },
      { results: [{ table: "ApiCredential", rowid: 1 }] },
    ]))).rejects.toThrow(/foreign-key verification/);

    await prepareClient("client-ansi-output");
    await expect(runWithStdout(
      `\u001b[32m4.112.0\u001b[0m)\n${JSON.stringify([{ results: [{ remainingCount: 0 }] }, { results: [] }])}\n`,
    )).resolves.toBeUndefined();
  });

  it("preserves server and cleanup failures independently and together", async () => {
    const tempProject = await createProject();
    const runId = "e2e-run-dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const writeTeardownRequest = (teardownPath: string, requestedRunId = runId) => {
      writeFileSync(teardownPath, JSON.stringify({ runId: requestedRunId, state: "requested" }));
    };

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async (paths) => {
        writeTeardownRequest(paths.teardownPath);
        return "ok";
      },
      cleanupRun: async () => undefined,
    })).resolves.toBe("ok");
    const successPaths = e2eRunPaths(tempProject, runId);
    expect(JSON.parse(readFileSync(successPaths.resultPath, "utf8"))).toEqual({ runId, ok: true });
    await removeE2eRunArtifacts({ projectRoot: tempProject, runId });

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async (paths) => {
        writeTeardownRequest(paths.teardownPath);
        return "unused";
      },
      cleanupRun: async () => {
        throw new Error("cleanup only");
      },
    })).rejects.toThrow("cleanup only");
    const failedPaths = e2eRunPaths(tempProject, runId);
    expect(JSON.parse(readFileSync(failedPaths.resultPath, "utf8"))).toEqual({
      runId,
      ok: false,
      error: "cleanup only",
    });
    await removeE2eRunArtifacts({ projectRoot: tempProject, runId });

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async (paths) => {
        writeTeardownRequest(paths.teardownPath, "e2e-run-mismatched-teardown");
        throw new Error("server failed");
      },
      cleanupRun: async () => {
        throw new Error("cleanup failed");
      },
    })).rejects.toMatchObject({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "server failed" }), expect.objectContaining({ message: "cleanup failed" })],
    });
    await expect(readdir(join(tempProject, ".wrangler", "e2e-runs"))).resolves.toEqual([]);

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async (paths) => {
        writeTeardownRequest(paths.teardownPath);
        throw new Error("server only");
      },
      cleanupRun: async () => undefined,
    })).rejects.toThrow("server only");
    const serverFailurePaths = e2eRunPaths(tempProject, runId);
    expect(JSON.parse(readFileSync(serverFailurePaths.resultPath, "utf8"))).toEqual({
      runId,
      ok: false,
      error: "server only",
    });
    await removeE2eRunArtifacts({ projectRoot: tempProject, runId });

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async (paths) => {
        writeFileSync(paths.teardownPath, "not-json");
        return "ok without teardown";
      },
      cleanupRun: async () => undefined,
    })).resolves.toBe("ok without teardown");
    await expect(readdir(join(tempProject, ".wrangler", "e2e-runs"))).resolves.toEqual([]);

    await expect(runEphemeralE2eServer({
      projectRoot: tempProject,
      runId,
      launchServer: async (paths) => {
        writeTeardownRequest(paths.teardownPath);
        return "unused";
      },
      cleanupRun: async () => {
        throw "string cleanup";
      },
    })).rejects.toBe("string cleanup");
    const stringFailurePaths = e2eRunPaths(tempProject, runId);
    expect(JSON.parse(readFileSync(stringFailurePaths.resultPath, "utf8"))).toEqual({
      runId,
      ok: false,
      error: "string cleanup",
    });
    await removeE2eRunArtifacts({ projectRoot: tempProject, runId });
  });

  it("exports testable global teardown and ephemeral server CLI boundaries", async () => {
    const teardown = await import("../../e2e/support/global-teardown");
    const starter = await import("../../e2e/support/start-ephemeral-wrangler.mjs");

    expect(typeof teardown.runGlobalTeardown).toBe("function");
    await expect(teardown.runGlobalTeardown({ env: {}, projectRoot, runTeardown: vi.fn() }))
      .rejects.toThrow(/SPOONJOY_E2E_RUN_ID/);
    const runTeardown = vi.fn(async () => undefined);
    await teardown.runGlobalTeardown({
      env: { SPOONJOY_E2E_RUN_ID: "e2e-run-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      projectRoot,
      runTeardown,
    });
    expect(runTeardown).toHaveBeenCalledOnce();

    expect(typeof starter.requiredArg).toBe("function");
    expect(() => starter.requiredArg([], "--run-id")).toThrow(/Missing --run-id/);
    expect(() => starter.requiredArg(["--run-id", "--bad"], "--run-id"))
      .toThrow(/Missing --run-id/);
    expect(starter.requiredArg(["--run-id", "run-value"], "--run-id")).toBe("run-value");

    class FakeProcess extends EventEmitter {
      env: Record<string, string> = { NO_COLOR: "1", KEEP: "yes" };
      platform = "darwin";
      killed: Array<[number, string]> = [];
      kill(pid: number, signal: string) {
        this.killed.push([pid, signal]);
      }
    }
    const processLike = new FakeProcess();
    const child = Object.assign(new EventEmitter(), { pid: 321, kill: vi.fn() });
    const spawnChild = vi.fn(() => child);
    const runPolicy = vi.fn(async (_argv: string[], runtime: { spawn: Function; env: Record<string, string> }) => {
      runtime.spawn("pnpm", [], {});
      expect(runtime.env.NO_COLOR).toBeUndefined();
      expect(runtime.env.KEEP).toBe("yes");
      return 0;
    });
    const launch = starter.createWranglerLauncher({ processLike, spawnChild, runPolicy });
    await expect(launch({ persistPath: "/tmp/e2e-state" })).resolves.toBeUndefined();
    expect(spawnChild).toHaveBeenCalledOnce();

    const interruptedProcess = new FakeProcess();
    const interruptedChild = Object.assign(new EventEmitter(), { pid: 654, kill: vi.fn() });
    const interruptedLaunch = starter.createWranglerLauncher({
      processLike: interruptedProcess,
      spawnChild: () => interruptedChild,
      runPolicy: async (_argv: string[], runtime: { spawn: Function }) => {
        runtime.spawn("pnpm", [], {});
        interruptedProcess.emit("SIGTERM");
        return 1;
      },
    });
    await expect(interruptedLaunch({ persistPath: "/tmp/e2e-state" })).resolves.toBeUndefined();
    expect(interruptedProcess.killed).toEqual([[-654, "SIGTERM"]]);

    const failedLaunch = starter.createWranglerLauncher({
      processLike: new FakeProcess(),
      spawnChild,
      runPolicy: async () => 7,
    });
    await expect(failedLaunch({ persistPath: "/tmp/e2e-state" })).rejects.toThrow(
      /status 7/,
    );

    const windowsProcess = new FakeProcess();
    windowsProcess.platform = "win32";
    const windowsChild = Object.assign(new EventEmitter(), { pid: 777, kill: vi.fn() });
    const windowsLaunch = starter.createWranglerLauncher({
      processLike: windowsProcess,
      spawnChild: () => windowsChild,
      runPolicy: async (_argv: string[], runtime: { spawn: Function }) => {
        runtime.spawn("pnpm", [], {});
        windowsProcess.emit("SIGINT");
        return 1;
      },
    });
    await expect(windowsLaunch({ persistPath: "/tmp/e2e-state" })).resolves.toBeUndefined();
    expect(windowsChild.kill).toHaveBeenCalledWith("SIGINT");

    const raceProcess = new FakeProcess();
    raceProcess.kill = () => {
      throw new Error("already exited");
    };
    const raceLaunch = starter.createWranglerLauncher({
      processLike: raceProcess,
      spawnChild: () => interruptedChild,
      runPolicy: async (_argv: string[], runtime: { spawn: Function }) => {
        runtime.spawn("pnpm", [], {});
        raceProcess.emit("SIGTERM");
        return 1;
      },
    });
    await expect(raceLaunch({ persistPath: "/tmp/e2e-state" })).resolves.toBeUndefined();

    const runServer = vi.fn(async () => undefined);
    await starter.runServerCli({
      argv: ["--run-id", "e2e-run-ffffffff-ffff-4fff-8fff-ffffffffffff"],
      projectRoot,
      runServer,
      launchServer: vi.fn(),
    });
    expect(runServer).toHaveBeenCalledOnce();

    const virtualPath = resolve("e2e/support/virtual-start.mjs");
    const moduleUrl = pathToFileURL(virtualPath).href;
    const runtime = {
      projectRoot,
      runServer: vi.fn(async () => undefined),
      launchServer: vi.fn(),
    };
    await expect(starter.runCliIfInvoked(moduleUrl, ["node"], runtime)).resolves.toBe(false);
    await expect(starter.runCliIfInvoked(
      moduleUrl,
      ["node", resolve("e2e/support/not-start.mjs")],
      runtime,
    )).resolves.toBe(false);
    await expect(starter.runCliIfInvoked(
      moduleUrl,
      ["node", virtualPath, "--run-id", "e2e-run-99999999-9999-4999-8999-999999999999"],
      runtime,
    )).resolves.toBe(true);
    expect(runtime.runServer).toHaveBeenCalledOnce();
  });
});

describe("Playwright data-ownership wiring", () => {
  it("does not persist the mobile seed-recipe visual edit", () => {
    const source = readFileSync(join(projectRoot, "e2e/flows/mobile-recipebuilder-spoondock.spec.ts"), "utf8");

    expect(source).not.toContain("await saveAction.click()");
    expect(source).toContain("await page.reload()");
  });

  it("wires unique OAuth markers, exact ID recording, global teardown, and ephemeral Wrangler state", () => {
    const oauth = readFileSync(join(projectRoot, "e2e/flows/oauth-authorize.spec.ts"), "utf8");
    const config = readFileSync(join(projectRoot, "playwright.config.ts"), "utf8");

    expect(oauth).toContain("e2eOauthClientName");
    expect(oauth).toContain("recordE2eOauthClient");
    expect(oauth).toContain("REDIRECT_URI = 'http://localhost:5197/privacy'");
    expect(config).toContain("SPOONJOY_E2E_RUN_ID");
    expect(config).toContain("globalTeardown");
    expect(config).toContain("start-ephemeral-wrangler");
    expect(config).not.toContain(".dev.vars");
  });
});
