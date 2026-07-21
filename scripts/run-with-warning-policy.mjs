import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findUnexpectedDiagnosticOutput } from "./warning-gate.ts";

const usage = "usage: run-with-warning-policy -- <command> [args...]";

export function containsWarningDiagnostic(output) {
  return findUnexpectedDiagnosticOutput(output, "").length > 0;
}

export function runWithWarningPolicy(argv, runtime = {}) {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const spawnChild = runtime.spawn ?? spawn;
  const platform = runtime.platform ?? process.platform;
  const environment = runtime.env ?? process.env;
  const killProcess = runtime.killProcess ?? process.kill;
  const signalSource = runtime.signalSource ?? process;

  if (argv[0] !== "--" || argv.length < 2) {
    stderr.write(`${usage}\n`);
    return Promise.resolve(2);
  }

  const child = spawnChild(argv[1], argv.slice(2), {
    detached: platform !== "win32",
    env: environment,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let stdoutOutput = "";
  let stderrOutput = "";
  let diagnosticDetected = false;
  let forwardedSignal;

  const terminateChild = (signal = "SIGTERM") => {
    if (typeof child.pid === "number" && platform !== "win32") {
      try {
        killProcess(-child.pid, signal);
        return;
      } catch {
        // The process may have exited between output and termination.
      }
    }
    child.kill?.(signal);
  };
  const completedLines = (output) => {
    const completedOutputEnd = Math.max(output.lastIndexOf("\n"), output.lastIndexOf("\r"));
    return completedOutputEnd === -1 ? "" : output.slice(0, completedOutputEnd + 1);
  };
  const rejectCompletedDiagnostic = () => {
    if (diagnosticDetected) return;
    if (findUnexpectedDiagnosticOutput(
      completedLines(stdoutOutput),
      completedLines(stderrOutput),
    ).length === 0) {
      return;
    }
    diagnosticDetected = true;
    stderr.write("warning-policy: rejected diagnostic output\n");
    terminateChild();
  };

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    stdoutOutput += text;
    stdout.write(chunk);
    rejectCompletedDiagnostic();
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderrOutput += text;
    stderr.write(chunk);
    rejectCompletedDiagnostic();
  });

  return new Promise((resolveStatus) => {
    let settled = false;
    const signalExitCode = { SIGINT: 130, SIGTERM: 143 };
    const signalHandlers = Object.fromEntries(
      Object.keys(signalExitCode).map((signal) => [signal, () => {
        if (forwardedSignal) return;
        forwardedSignal = signal;
        terminateChild(signal);
      }]),
    );
    for (const [signal, handler] of Object.entries(signalHandlers)) {
      signalSource.on(signal, handler);
    }
    const settle = (status) => {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of Object.entries(signalHandlers)) {
        signalSource.off(signal, handler);
      }
      resolveStatus(status);
    };

    child.on("error", (error) => {
      stderr.write(`${error.stack ?? error.message}\n`);
      settle(1);
    });
    child.on("close", (code) => {
      if (forwardedSignal) {
        settle(signalExitCode[forwardedSignal]);
        return;
      }
      if (diagnosticDetected) {
        settle(1);
        return;
      }
      if (code !== 0) {
        settle(code ?? 1);
        return;
      }
      if (findUnexpectedDiagnosticOutput(stdoutOutput, stderrOutput).length > 0) {
        stderr.write("warning-policy: rejected diagnostic output\n");
        settle(1);
        return;
      }
      settle(0);
    });
  });
}

export async function runCliIfInvoked(moduleUrl, argv, runtime = {}) {
  const invokedUrl = argv[1]
    ? pathToFileURL(resolve(argv[1])).href
    : undefined;
  if (moduleUrl !== invokedUrl) return false;

  const status = await runWithWarningPolicy(argv.slice(2), runtime);
  const setExitCode = runtime.setExitCode ?? ((value) => {
    process.exitCode = value;
  });
  setExitCode(status);
  return true;
}

await runCliIfInvoked(import.meta.url, process.argv);
