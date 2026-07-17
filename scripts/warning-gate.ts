import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

export const EXPECTED_PRISMA_D1_TRANSACTION_WARNING =
  "Cloudflare D1 does not support transactions yet. When using Prisma's D1 adapter, implicit & explicit transactions will be ignored and run as individual queries, which breaks the guarantees of the ACID properties of transactions. For more details see https://pris.ly/d/d1-transactions";

const BRACKETED_WARNING_PATTERN = /(?:^|[\s([<{])\[\s*warn(?:ing)?(?:\s*:\s*[^\]\r\n]+)?\s*\](?::|\s|$)/i;
const WARNING_WORD_PATTERN = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]+warning|warning|warn)(?=[:!\s([<{=]|$|-(?!gate\.ts\b))/i;
const PRISMA_WARNING_PATTERN = /(?:^|[\s([<{])prisma:warn(?::|\s|$)/i;
const WARNING_SYMBOL_PATTERN = /⚠/;
const TEST_RESULT_LINE_PATTERN = /^[✓↓×]\s/;
const OSC_SEQUENCE_PATTERN = /(?:\u001B\]|\u009D)[\s\S]*?(?:\u0007|\u001B\\|\u009C)/g;

function stripTerminalControlSequences(value: string): string {
  return stripVTControlCharacters(value.replace(OSC_SEQUENCE_PATTERN, ""));
}

export interface WarningGateCommandResult {
  exitCode: number;
  output: string;
  warningOutput?: string;
}

export interface WarningGateResult {
  exitCode: number;
  unexpectedWarnings: string[];
}

export type WarningGateCommandRunner = (
  command: readonly string[],
) => Promise<WarningGateCommandResult>;

function isWarningLine(line: string): boolean {
  if (TEST_RESULT_LINE_PATTERN.test(line)) {
    return (
      BRACKETED_WARNING_PATTERN.test(line) ||
      PRISMA_WARNING_PATTERN.test(line) ||
      WARNING_SYMBOL_PATTERN.test(line) ||
      /(?:^|[^A-Za-z0-9])(?:warning|warn)(?=[:!([<{=]|$)/i.test(line)
    );
  }
  return (
    BRACKETED_WARNING_PATTERN.test(line) ||
    WARNING_WORD_PATTERN.test(line) ||
    PRISMA_WARNING_PATTERN.test(line) ||
    WARNING_SYMBOL_PATTERN.test(line)
  );
}

export function findUnexpectedWarnings(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => stripTerminalControlSequences(line).trim())
    .filter((line) => line !== "")
    .filter((line) => isWarningLine(line));
}

export function parseWarningGateCommands(argv: readonly string[]): string[][] {
  const separatorIndex = argv.indexOf("--");
  if (separatorIndex === -1) {
    throw new Error("warning-gate requires a -- separator before the command.");
  }
  const tokens = argv.slice(separatorIndex + 1);
  if (tokens.length === 0) {
    throw new Error("warning-gate requires at least one command.");
  }

  const commands: string[][] = [[]];
  for (const token of tokens) {
    if (token === "--then") {
      if (commands.at(-1)!.length === 0) {
        throw new Error("warning-gate received an empty command segment.");
      }
      commands.push([]);
      continue;
    }
    commands.at(-1)!.push(token);
  }
  if (commands.at(-1)!.length === 0) {
    throw new Error("warning-gate received an empty command segment.");
  }
  return commands;
}

export function resolveSpawnedCommandClose(
  code: number | null,
  signal: NodeJS.Signals | null,
  output: string,
): WarningGateCommandResult {
  if (signal) {
    return {
      exitCode: 1,
      output: `${output}warning-gate child terminated by ${signal}\n`,
    };
  }
  return { exitCode: code ?? 1, output };
}

export function runSpawnedCommand(command: readonly string[]): Promise<WarningGateCommandResult> {
  const [file, ...args] = command;
  if (!file) throw new Error("warning-gate received an empty command.");

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let warningOutput = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      warningOutput += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        ...resolveSpawnedCommandClose(code, signal, output),
        ...(warningOutput ? { warningOutput } : {}),
      });
    });
  });
}

export async function runWarningGate(
  argv: readonly string[],
  deps: { runCommand?: WarningGateCommandRunner },
): Promise<WarningGateResult> {
  const commands = parseWarningGateCommands(argv);
  const runCommand = deps.runCommand ?? runSpawnedCommand;
  let exitCode = 0;
  let output = "";
  let warningOutput = "";

  for (const command of commands) {
    const result = await runCommand(command);
    output += result.output;
    warningOutput += result.warningOutput ?? "";
    if (result.exitCode !== 0 && exitCode === 0) {
      exitCode = result.exitCode;
    }
  }

  const warningChannelLines = warningOutput
    .split(/\r?\n/)
    .map((line) => stripTerminalControlSequences(line).trim())
    .filter(Boolean);
  const unexpectedWarnings = Array.from(new Set([
    ...findUnexpectedWarnings(output),
    ...warningChannelLines,
  ]));
  return {
    exitCode: unexpectedWarnings.length > 0 ? 1 : exitCode,
    unexpectedWarnings,
  };
}

export interface WarningGateMainDeps {
  runCommand?: WarningGateCommandRunner;
  writeStderr?: (message: string) => void;
  setExitCode?: (exitCode: number) => void;
}

export async function main(
  argv: readonly string[],
  deps: WarningGateMainDeps,
): Promise<WarningGateResult> {
  const result = await runWarningGate(argv, { runCommand: deps.runCommand });
  if (result.unexpectedWarnings.length > 0) {
    (deps.writeStderr ?? ((message) => process.stderr.write(message)))(
      [
        "warning-gate failed: unexpected warning output detected.",
        ...result.unexpectedWarnings.map((line) => `- ${line}`),
        "",
      ].join("\n"),
    );
  }
  (deps.setExitCode ?? ((exitCode) => {
    process.exitCode = exitCode;
  }))(result.exitCode);
  return result;
}

/* istanbul ignore if -- @preserve CLI boundary delegates to tested functions above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2), {}).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
