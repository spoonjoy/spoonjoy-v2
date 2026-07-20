import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage = "usage: run-with-warning-policy -- <command> [args...]";
const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const diagnosticPattern = /^\s*(?:(?:\(node:\d+\)\s+)?(?:\[[^\]\r\n]+\]\s+)?(?:Warning:|[A-Za-z][A-Za-z0-9]*Warning\b:?)|(?:npm\s+)?WARN(?:ING)?\b|npm\s+warn(?:ing)?\b|⚠️?\s*Warnings?\b|▲\s+\[WARNING\]|\(!\)\s|warning(?:\s+TS\d+)?:)/m;

export function containsWarningDiagnostic(output) {
  return diagnosticPattern.test(output.replace(ansiPattern, ""));
}

export function runWithWarningPolicy(argv, runtime = {}) {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const spawnChild = runtime.spawn ?? spawn;
  const platform = runtime.platform ?? process.platform;
  const environment = runtime.env ?? process.env;
  const killProcess = runtime.killProcess ?? process.kill;

  if (argv[0] !== "--" || argv.length < 2) {
    stderr.write(`${usage}\n`);
    return Promise.resolve(2);
  }

  const child = spawnChild(argv[1], argv.slice(2), {
    detached: platform !== "win32",
    env: environment,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let output = "";
  let diagnosticDetected = false;

  const terminateChild = () => {
    if (typeof child.pid === "number" && platform !== "win32") {
      try {
        killProcess(-child.pid, "SIGTERM");
        return;
      } catch {
        // The process may have exited between output and termination.
      }
    }
    child.kill?.("SIGTERM");
  };
  const rejectCompletedDiagnostic = () => {
    if (diagnosticDetected) return;
    const completedOutputEnd = Math.max(output.lastIndexOf("\n"), output.lastIndexOf("\r"));
    if (completedOutputEnd === -1 || !containsWarningDiagnostic(output.slice(0, completedOutputEnd + 1))) {
      return;
    }
    diagnosticDetected = true;
    stderr.write("warning-policy: rejected diagnostic output\n");
    terminateChild();
  };

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    stdout.write(chunk);
    rejectCompletedDiagnostic();
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    stderr.write(chunk);
    rejectCompletedDiagnostic();
  });

  return new Promise((resolveStatus) => {
    let settled = false;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      resolveStatus(status);
    };

    child.on("error", (error) => {
      stderr.write(`${error.stack ?? error.message}\n`);
      settle(1);
    });
    child.on("close", (code) => {
      if (diagnosticDetected) {
        settle(1);
        return;
      }
      if (code !== 0) {
        settle(code ?? 1);
        return;
      }
      if (containsWarningDiagnostic(output)) {
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
