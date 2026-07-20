import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { filterViteBuildErrorOutput } from "./build-output-hygiene";
import {
  POSTHOG_CLIENT_BUILD_METADATA_PATH,
  bundledPostHogHostMatches,
  createPostHogBuildContract,
  readPostHogClientBundleSources,
  writePostHogBuildMetadata,
  type PostHogBuildContract,
} from "./posthog-build-metadata";

export interface ReactRouterBuildChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
}

export interface ReactRouterBuildPlan {
  readonly command: "pnpm";
  readonly args: readonly ["exec", "react-router", "build"];
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly contract: PostHogBuildContract;
}

export function createReactRouterBuildPlan(
  wrangler: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): ReactRouterBuildPlan {
  const contract = createPostHogBuildContract(wrangler, env.CLOUDFLARE_ENV);
  return Object.freeze({
    command: "pnpm" as const,
    args: Object.freeze(["exec", "react-router", "build"] as const),
    env: Object.freeze({ ...env, VITE_POSTHOG_HOST: contract.postHogHost }),
    contract,
  });
}

export function pipeFilteredBuildOutput(stream: Readable, target: Writable): void {
  let pending = "";
  stream.on("data", (chunk: Buffer | string) => {
    pending += chunk.toString();
    const lines = pending.split(/(?<=\r?\n)/);
    pending = lines.pop() as string;
    target.write(filterViteBuildErrorOutput(lines.join("")));
  });
  stream.on("end", () => {
    if (pending) {
      target.write(filterViteBuildErrorOutput(pending));
      pending = "";
    }
  });
}

interface SpawnBuildOptions {
  env: NodeJS.ProcessEnv;
  stdio: ["ignore", "pipe", "pipe"];
}

export interface ReactRouterBuildDeps {
  env?: NodeJS.ProcessEnv;
  readWrangler?: () => Record<string, unknown>;
  spawnBuild?: (
    command: string,
    args: readonly string[],
    options: SpawnBuildOptions,
  ) => ReactRouterBuildChild;
  writeMetadata?: typeof writePostHogBuildMetadata;
  readBundleSources?: () => Promise<readonly string[]>;
  stdout?: Writable;
  stderr?: Writable;
}

export function defaultReadWrangler(): Record<string, unknown> {
  return JSON.parse(readFileSync("wrangler.json", "utf8")) as Record<string, unknown>;
}

export function defaultSpawnBuild(
  command: string,
  args: readonly string[],
  options: SpawnBuildOptions,
): ReactRouterBuildChild {
  return spawn(command, [...args], options) as ReactRouterBuildChild;
}

export async function runReactRouterBuild(deps: ReactRouterBuildDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const plan = createReactRouterBuildPlan(
    (deps.readWrangler ?? defaultReadWrangler)(),
    env,
  );
  const child = (deps.spawnBuild ?? defaultSpawnBuild)(plan.command, plan.args, {
    env: plan.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeFilteredBuildOutput(child.stdout, deps.stdout ?? process.stdout);
  pipeFilteredBuildOutput(child.stderr, deps.stderr ?? process.stderr);

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        reject(new Error(`react-router build terminated by ${signal}.`));
      } else if (code !== 0) {
        reject(new Error(`react-router build exited with code ${code ?? "unknown"}.`));
      } else {
        resolve();
      }
    });
  });
  const bundleSources = await (deps.readBundleSources ?? readPostHogClientBundleSources)();
  if (!bundledPostHogHostMatches(bundleSources, plan.contract.postHogHost)) {
    throw new Error(
      `Client bundle PostHog host does not exactly match ${plan.contract.postHogHost}.`,
    );
  }
  await (deps.writeMetadata ?? writePostHogBuildMetadata)(
    POSTHOG_CLIENT_BUILD_METADATA_PATH,
    plan.contract,
  );
}

interface CliOutput {
  write(chunk: string): unknown;
}

export interface ReactRouterBuildCliDeps extends ReactRouterBuildDeps {
  runBuild?: () => Promise<void>;
  stderr?: Writable & CliOutput;
  setExitCode?: (code: number) => void;
}

export async function runReactRouterBuildCli(
  deps: ReactRouterBuildCliDeps = {},
): Promise<void> {
  const setExitCode = deps.setExitCode ?? ((code: number) => { process.exitCode = code; });
  try {
    await (deps.runBuild ?? (() => runReactRouterBuild(deps)))();
    setExitCode(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (deps.stderr ?? process.stderr).write(`React Router build failed: ${message}\n`);
    setExitCode(1);
  }
}
