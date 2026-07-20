import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createReactRouterBuildPlan,
  defaultReadWrangler,
  defaultSpawnBuild,
  pipeFilteredBuildOutput,
  runReactRouterBuild,
  runReactRouterBuildCli,
  type ReactRouterBuildChild,
} from "../../scripts/react-router-build-runner";

function wrangler(host: string): Record<string, unknown> {
  return {
    vars: { VITE_POSTHOG_HOST: host },
    env: { qa: { vars: { VITE_POSTHOG_HOST: host } } },
  };
}

function fakeChild(
  outcome: {
    code?: number | null;
    signal?: NodeJS.Signals | null;
    error?: Error;
    stdout?: string;
    stderr?: string;
  } = { code: 0 },
): ReactRouterBuildChild {
  const emitter = new EventEmitter() as ReactRouterBuildChild;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  queueMicrotask(() => {
    emitter.stdout.end(outcome.stdout ?? "client output\n");
    emitter.stderr.end(outcome.stderr ?? "server output\n");
    if (outcome.error) emitter.emit("error", outcome.error);
    emitter.emit("close", outcome.code ?? null, outcome.signal ?? null);
  });
  return emitter;
}

describe("React Router build runner", () => {
  it.each([
    [undefined, "https://us.i.posthog.com", "production"],
    ["qa", "https://eu.i.posthog.com", "qa"],
    ["qa", "https://analytics.example.com", "qa"],
  ])("creates one immutable %s build plan", (environment, host, expectedEnvironment) => {
    const plan = createReactRouterBuildPlan(wrangler(host), {
      CLOUDFLARE_ENV: environment,
      EXISTING: "kept",
    });

    expect(plan.command).toBe("pnpm");
    expect(plan.args).toEqual(["exec", "react-router", "build"]);
    expect(plan.env).toMatchObject({ EXISTING: "kept", VITE_POSTHOG_HOST: host });
    expect(plan.contract.environment).toBe(expectedEnvironment);
    expect(plan.contract.postHogHost).toBe(host);
    expect(plan.contract.metadata.publicEnv.VITE_POSTHOG_HOST).toBe(host);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.args)).toBe(true);
    expect(Object.isFrozen(plan.env)).toBe(true);
  });

  it("filters complete and pending output chunks", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString("utf8"); });
    pipeFilteredBuildOutput(input, output);
    input.write("kept\n\u001b[31m✘ [ERROR] The build was canceled\u001b[0m\npart");
    input.end("ial");
    await new Promise((resolve) => input.once("end", resolve));
    expect(rendered).toBe("kept\npartial");
  });

  it("passes one contract to the child environment and metadata writer", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const writeMetadata = vi.fn(async () => undefined);
    const spawnBuild = vi.fn(() => fakeChild());
    await runReactRouterBuild({
      env: { CLOUDFLARE_ENV: "qa" },
      readWrangler: () => wrangler("https://eu.i.posthog.com"),
      readBundleSources: async () => [
        'const env={VITE_POSTHOG_HOST:"https://eu.i.posthog.com"};',
      ],
      spawnBuild,
      writeMetadata,
      stdout,
      stderr,
    });

    expect(spawnBuild).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "react-router", "build"],
      expect.objectContaining({
        env: expect.objectContaining({ VITE_POSTHOG_HOST: "https://eu.i.posthog.com" }),
      }),
    );
    const contract = writeMetadata.mock.calls[0][1];
    expect(contract.postHogHost).toBe("https://eu.i.posthog.com");
    expect(contract.metadata.publicEnv.VITE_POSTHOG_HOST).toBe(contract.postHogHost);
  });

  it("covers the real Wrangler reader and unprivileged child spawn defaults", async () => {
    expect(defaultReadWrangler()).toMatchObject({ name: "spoonjoy-v2" });
    const child = defaultSpawnBuild(process.execPath, ["-e", "process.stdout.write('ok')"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });
    expect(output).toBe("ok");
  });

  it("uses default process boundaries and metadata writer without divergent host input", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-react-router-build-"));
    const previousCwd = process.cwd();
    const previousExitCode = process.exitCode;
    const previousPath = process.env.PATH;
    try {
      process.chdir(root);
      await writeFile("wrangler.json", JSON.stringify(wrangler("https://us.i.posthog.com")), "utf8");
      await writeFile("pnpm", "#!/bin/sh\nexit 0\n", "utf8");
      await chmod("pnpm", 0o755);
      await mkdir("build/client/assets", { recursive: true });
      await writeFile(
        "build/client/assets/app.js",
        'const env={VITE_POSTHOG_HOST:"https://us.i.posthog.com"};',
        "utf8",
      );
      process.env.PATH = `${root}:${previousPath ?? ""}`;
      await runReactRouterBuild();
      await runReactRouterBuildCli();
      expect(process.exitCode).toBe(0);
      const metadata = JSON.parse(await readFile(
        path.join(root, "build/client/.vite/spoonjoy-build-metadata.json"),
        "utf8",
      ));
      expect(metadata.publicEnv.VITE_POSTHOG_HOST).toBe("https://us.i.posthog.com");
    } finally {
      process.chdir(previousCwd);
      process.exitCode = previousExitCode;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for child errors, signals, exit codes, and metadata failures", async () => {
    const base = {
      env: {},
      readWrangler: () => wrangler("https://us.i.posthog.com"),
      readBundleSources: async () => [
        'const env={VITE_POSTHOG_HOST:"https://us.i.posthog.com"};',
      ],
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    };
    await expect(runReactRouterBuild({ ...base, spawnBuild: () => fakeChild({ code: 2 }) }))
      .rejects.toThrow(/code 2/);
    await expect(runReactRouterBuild({ ...base, spawnBuild: () => fakeChild({ code: null }) }))
      .rejects.toThrow(/code unknown/);
    await expect(runReactRouterBuild({ ...base, spawnBuild: () => fakeChild({ signal: "SIGTERM" }) }))
      .rejects.toThrow(/SIGTERM/);
    await expect(runReactRouterBuild({ ...base, spawnBuild: () => fakeChild({ error: new Error("spawn failed") }) }))
      .rejects.toThrow(/spawn failed/);
    await expect(runReactRouterBuild({
      ...base,
      spawnBuild: () => fakeChild(),
      writeMetadata: async () => { throw new Error("metadata failed"); },
    })).rejects.toThrow(/metadata failed/);
    await expect(runReactRouterBuild({
      ...base,
      spawnBuild: () => fakeChild(),
      readBundleSources: async () => [
        'const env={VITE_POSTHOG_HOST:"https://evil.example"};',
      ],
    })).rejects.toThrow(/bundle.*PostHog host/i);
    await expect(runReactRouterBuild({
      ...base,
      spawnBuild: () => fakeChild(),
      readBundleSources: async () => { throw new Error("bundle read failed"); },
    })).rejects.toThrow(/bundle read failed/);
  });

  it("reports CLI failures and success through injected process boundaries", async () => {
    const stderr = { write: vi.fn(() => true) };
    const setExitCode = vi.fn();
    await runReactRouterBuildCli({
      runBuild: async () => undefined,
      stderr,
      setExitCode,
    });
    expect(setExitCode).toHaveBeenCalledWith(0);

    await runReactRouterBuildCli({
      runBuild: async () => { throw new Error("build failed"); },
      stderr,
      setExitCode,
    });
    await runReactRouterBuildCli({
      runBuild: async () => { throw "string failure"; },
      stderr,
      setExitCode,
    });
    expect(stderr.write).toHaveBeenCalledWith("React Router build failed: build failed\n");
    expect(stderr.write).toHaveBeenCalledWith("React Router build failed: string failure\n");
    expect(setExitCode).toHaveBeenLastCalledWith(1);

    const processStderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    try {
      await runReactRouterBuildCli({ runBuild: async () => { throw new Error("default failure"); } });
      expect(processStderr).toHaveBeenCalledWith("React Router build failed: default failure\n");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      processStderr.mockRestore();
    }
  });
});
