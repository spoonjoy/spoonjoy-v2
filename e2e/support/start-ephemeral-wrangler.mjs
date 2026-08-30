#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { runEphemeralE2eServer } from "../../scripts/e2e-run-cleanup.mjs";
import { runWithWarningPolicy } from "../../scripts/run-with-warning-policy.mjs";

const WORKERD_WRITE_CLOSE_LINES = new Set([
  "✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: "
  + "::write(fd, buffer.begin(), buffer.size()): Connection reset by peer",
  "✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: "
  + "::write(fd, buffer.begin(), buffer.size()): Broken pipe",
]);
const WORKERD_STACK_TOKEN =
  String.raw`\/\S*\/node_modules\/@cloudflare\/workerd-[A-Za-z0-9_-]+\/bin\/workerd@[0-9a-f]+`;
const WORKERD_STACK_LINE = new RegExp(`^stack: ${WORKERD_STACK_TOKEN}(?: ${WORKERD_STACK_TOKEN})*$`);

function outputLines(value) {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function normalizedLine(value) {
  return stripVTControlCharacters(value).trim();
}

function isWorkerdPeerResetLine(value) {
  return WORKERD_WRITE_CLOSE_LINES.has(normalizedLine(value));
}

function isWorkerdStackLine(value) {
  return WORKERD_STACK_LINE.test(normalizedLine(value));
}

export function filterExpectedWranglerPeerResetDiagnostic({ stdout, stderr, final }) {
  const lines = outputLines(stderr);
  const normalized = lines.map(normalizedLine);
  const omitted = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!isWorkerdPeerResetLine(lines[index])) continue;
    let stackIndex = index + 1;
    while (stackIndex < lines.length && normalized[stackIndex] === "") stackIndex += 1;
    if (stackIndex < lines.length && isWorkerdStackLine(lines[stackIndex])) {
      for (let omittedIndex = index; omittedIndex <= stackIndex; omittedIndex += 1) {
        omitted.add(omittedIndex);
      }
      while (stackIndex + 1 < lines.length && normalized[stackIndex + 1] === "") {
        stackIndex += 1;
        omitted.add(stackIndex);
      }
      index = stackIndex;
      continue;
    }
    if (!final && normalized.slice(index + 1).every((line) => line === "")) {
      for (let omittedIndex = index; omittedIndex < lines.length; omittedIndex += 1) {
        omitted.add(omittedIndex);
      }
    }
  }

  return {
    stdout,
    stderr: lines.filter((_, index) => !omitted.has(index)).join(""),
  };
}

export function createWranglerDiagnosticFilterStream(destination) {
  const decoder = new StringDecoder("utf8");
  let stderr = "";

  return {
    write(chunk) {
      stderr += typeof chunk === "string" ? chunk : decoder.write(chunk);
      return true;
    },
    flush() {
      stderr += decoder.end();
      const filtered = filterExpectedWranglerPeerResetDiagnostic({
        stdout: "",
        stderr,
        final: true,
      });
      if (filtered.stderr !== "") destination.write(filtered.stderr);
      stderr = "";
    },
  };
}

export function requiredArg(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}.`);
  return value;
}

export function createWranglerLauncher({
  processLike,
  spawnChild,
  runPolicy,
}) {
  return async function launchWrangler(paths) {
    let commandChild;
    let interruptedSignal;
    const environment = { ...processLike.env };
    const diagnosticStderr = createWranglerDiagnosticFilterStream(processLike.stderr);
    delete environment.NO_COLOR;

    const stop = (signal) => {
      interruptedSignal = signal;
      try {
        if (processLike.platform !== "win32" && commandChild?.pid) {
          processLike.kill(-commandChild.pid, signal);
        } else {
          commandChild?.kill(signal);
        }
      } catch {
        // The command may have exited while Playwright was stopping the server.
      }
    };
    const onSigInt = () => stop("SIGINT");
    const onSigTerm = () => stop("SIGTERM");
    processLike.once("SIGINT", onSigInt);
    processLike.once("SIGTERM", onSigTerm);

    try {
      const status = await runPolicy([
        "--",
        "pnpm",
        "exec",
        "wrangler",
        "dev",
        "--config",
        "build/server/wrangler.json",
        "--port",
        "5197",
        "--log-level",
        "error",
        "--persist-to",
        paths.persistPath,
        "--var",
        "SESSION_SECRET:spoonjoy-playwright-local-session-secret",
        "--var",
        "SPOONJOY_BASE_URL:http://localhost:5197",
        "--var",
        "GOOGLE_CLIENT_ID:spoonjoy-playwright-google-client",
        "--var",
        "GOOGLE_CLIENT_SECRET:spoonjoy-playwright-google-secret",
      ], {
        diagnosticFilter: filterExpectedWranglerPeerResetDiagnostic,
        env: environment,
        stderr: diagnosticStderr,
        spawn(command, args, options) {
          commandChild = spawnChild(command, args, options);
          return commandChild;
        },
      });
      if (!interruptedSignal && status !== 0) {
        throw new Error(`Ephemeral Wrangler server exited with status ${status}.`);
      }
    } finally {
      diagnosticStderr.flush();
      processLike.off("SIGINT", onSigInt);
      processLike.off("SIGTERM", onSigTerm);
    }
  };
}

export async function runServerCli({
  argv,
  projectRoot,
  runServer,
  launchServer,
}) {
  const runId = requiredArg(argv, "--run-id");
  await runServer({ projectRoot, runId, launchServer });
}

export async function runCliIfInvoked(moduleUrl, argv, runtime) {
  if (!argv[1] || moduleUrl !== pathToFileURL(resolve(argv[1])).href) return false;
  await runServerCli({
    argv: argv.slice(2),
    projectRoot: runtime.projectRoot,
    runServer: runtime.runServer,
    launchServer: runtime.launchServer,
  });
  return true;
}

await runCliIfInvoked(import.meta.url, process.argv, {
  projectRoot: process.cwd(),
  runServer: runEphemeralE2eServer,
  launchServer: createWranglerLauncher({
    processLike: process,
    spawnChild: spawn,
    runPolicy: runWithWarningPolicy,
  }),
});
