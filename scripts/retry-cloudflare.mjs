#!/usr/bin/env node
// Runs a command and runs it again when it failed only because Cloudflare's API failed on its own
// side, waiting 5, 15 and then 30 seconds:
//
//   node scripts/retry-cloudflare.mjs -- pnpm run qa:migrate
//
// During a Cloudflare incident on 2026-11-24, D1 answered "internal error; reference = …" for
// requests it served again moments later. Journeys run 45350929268 failed its QA setup on one
// (the kitchen seed's `wrangler d1 execute --file`) before any journey ran, and run 45348033648
// failed its QA cleanup on another, "[code: 7429]", after every journey had passed. Only those
// answers, and failed Cloudflare API requests with a 429 or 5xx code, are retried; an SQL error
// or any other failure fails at once. The command's stderr still reaches the job log as it runs.
// Only wrap commands that are safe to run again: wrangler rolls back a failed `d1 execute --file`,
// and `d1 migrations apply` skips the migrations it already applied.
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CLOUDFLARE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

function errorText(error) {
  return [
    typeof error === "string" ? error : "",
    error instanceof Error ? error.message : "",
    typeof error?.stdout === "string" ? error.stdout : "",
    typeof error?.stderr === "string" ? error.stderr : "",
  ].join("\n");
}

export function isTransientCloudflareApiError(error) {
  const text = errorText(error);
  return /internal error; reference = [\w-]+/.test(text)
    || /A request to the Cloudflare API \([^)]*\) failed\.[\s\S]*?\[code: (?:7429|10500|429|5\d\d)\]/.test(text);
}

// Runs the command once with its stdout passed straight through and its stderr both passed
// through and kept, so a failure can be classified.
export function runOnce(command, args, { spawnProcess = spawn, stderr = process.stderr } = {}) {
  return new Promise((resolve) => {
    const child = spawnProcess(command, args, { stdio: ["inherit", "inherit", "pipe"] });
    let text = "";
    child.stderr.on("data", (chunk) => {
      text += String(chunk);
      stderr.write(chunk);
    });
    child.on("error", (error) => resolve({ code: 1, stderr: `${text}${error.message}\n` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr: text }));
  });
}

export async function runWithCloudflareRetry(argv, {
  run = runOnce,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (line) => console.log(line),
} = {}) {
  const separator = argv.indexOf("--");
  const [command, ...args] = separator === -1 ? [] : argv.slice(separator + 1);
  if (!command) throw new Error("retry-cloudflare needs a command after --.");
  for (let attempt = 0; ; attempt += 1) {
    const result = await run(command, args);
    if (result.code === 0) return 0;
    if (attempt >= CLOUDFLARE_RETRY_DELAYS_MS.length || !isTransientCloudflareApiError(result.stderr)) return result.code;
    const delay = CLOUDFLARE_RETRY_DELAYS_MS[attempt];
    log(`Cloudflare's API answered an internal error; running ${[command, ...args].join(" ")} again in ${delay / 1000} s (retry ${attempt + 1} of ${CLOUDFLARE_RETRY_DELAYS_MS.length}).`);
    await sleep(delay);
  }
}

export function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = () => runWithCloudflareRetry(process.argv.slice(2)),
  setExitCode = (code) => { process.exitCode = code; },
  onError = (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
} = {}) {
  if (typeof argv1 !== "string" || moduleUrl !== pathToFileURL(argv1).href) return false;
  runMain().then(setExitCode, onError);
  return true;
}

runCliIfEntry();
