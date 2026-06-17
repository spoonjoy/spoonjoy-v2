import { spawn } from "node:child_process";
import { shouldLogViteBuildErrorMessage } from "./build-output-hygiene";

type Writable = typeof process.stdout;

interface Command {
  command: string;
  args: string[];
}

function writeFilteredLine(stream: Writable, line: string) {
  if (!shouldLogViteBuildErrorMessage(line)) return;
  stream.write(`${line}\n`);
}

async function runCommand({ command, args }: Command) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const flushers = [
    filterStream(child.stdout, process.stdout),
    filterStream(child.stderr, process.stderr),
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

async function filterStream(input: NodeJS.ReadableStream | null, output: Writable) {
  if (!input) return;

  let buffer = "";
  for await (const chunk of input) {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      writeFilteredLine(output, line);
    }
  }

  if (buffer) {
    writeFilteredLine(output, buffer);
  }
}

for (const command of [
  { command: "pnpm", args: ["run", "api:playground:generate"] },
  { command: "pnpm", args: ["exec", "react-router", "build"] },
]) {
  const exitCode = await runCommand(command);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}
