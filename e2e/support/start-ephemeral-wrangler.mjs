#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runEphemeralE2eServer } from "../../scripts/e2e-run-cleanup.mjs";
import { runWithWarningPolicy } from "../../scripts/run-with-warning-policy.mjs";

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
      ], {
        env: environment,
        spawn(command, args, options) {
          commandChild = spawnChild(command, args, options);
          return commandChild;
        },
      });
      if (!interruptedSignal && status !== 0) {
        throw new Error(`Ephemeral Wrangler server exited with status ${status}.`);
      }
    } finally {
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
