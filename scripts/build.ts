import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { shouldLogViteBuildErrorMessage } from "./build-output-hygiene";

type Writable = NodeJS.WritableStream;

export interface Command {
  command: string;
  args: string[];
}

interface SpawnedProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

type SpawnImpl = (command: string, args: readonly string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["inherit", "pipe", "pipe"];
}) => SpawnedProcess;

export const DEFAULT_BUILD_COMMANDS: Command[] = [
  { command: "pnpm", args: ["run", "api:playground:generate"] },
  { command: "pnpm", args: ["exec", "react-router", "build"] },
];

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnImpl;
  stdout?: Writable;
  stderr?: Writable;
}

export interface RunBuildOptions extends RunCommandOptions {
  commands?: Command[];
  runCommandImpl?: (command: Command) => Promise<number>;
}

export interface MaybeRunMainOptions {
  metaUrl?: string;
  argvPath?: string;
  mainImpl?: (options: RunBuildOptions) => Promise<void>;
  mainOptions?: RunBuildOptions;
}

export function writeFilteredLine(stream: Writable, line: string) {
  if (!shouldLogViteBuildErrorMessage(line)) return;
  stream.write(`${line}\n`);
}

export async function runCommand({ command, args }: Command, options: RunCommandOptions) {
  const child = (options.spawnImpl ?? spawn)(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const flushers = [
    filterStream(child.stdout, options.stdout ?? process.stdout),
    filterStream(child.stderr, options.stderr ?? process.stderr),
  ];

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });

  await Promise.all(flushers);
  return exitCode;
}

export async function filterStream(input: NodeJS.ReadableStream | null, output: Writable) {
  if (!input) return;

  let buffer = "";
  for await (const chunk of input) {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop()!;
    for (const line of lines) {
      writeFilteredLine(output, line);
    }
  }

  if (buffer) {
    writeFilteredLine(output, buffer);
  }
}

export async function runBuild(options: RunBuildOptions) {
  for (const command of options.commands ?? DEFAULT_BUILD_COMMANDS) {
    const exitCode = await (options.runCommandImpl ?? ((item) => runCommand(item, options)))(command);
    if (exitCode !== 0) return exitCode;
  }

  return 0;
}

export async function main(options: RunBuildOptions) {
  const exitCode = await runBuild(options);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

export function isDirectInvocation(metaUrl = import.meta.url, argvPath = process.argv[1]) {
  return Boolean(argvPath) && resolve(argvPath) === fileURLToPath(metaUrl);
}

export async function maybeRunMain({
  metaUrl = import.meta.url,
  argvPath = process.argv[1],
  mainImpl = main,
  mainOptions = {},
}: MaybeRunMainOptions = {}) {
  if (isDirectInvocation(metaUrl, argvPath)) {
    await mainImpl(mainOptions);
  }
}

await maybeRunMain();
