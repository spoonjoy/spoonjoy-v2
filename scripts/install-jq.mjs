#!/usr/bin/env node
// Installs jq for a job that runs in Playwright's image, which has none, without apt: the pinned
// static release binary from jq's GitHub release, checked against its published SHA-256, into
// $RUNNER_TEMP/jq, which is added to the job's PATH. Usage: node scripts/install-jq.mjs
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const JQ_VERSION = "jq-1.8.1";
// From the release's sha256sum.txt, line "jq-linux-amd64".
export const JQ_LINUX_AMD64_SHA256 = "020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d";
export const JQ_URL = `https://github.com/jqlang/jq/releases/download/${JQ_VERSION}/jq-linux-amd64`;

// Each download may take a minute; a failed one waits 1 s, then 2 s, before the next try.
export const JQ_DOWNLOAD_TIMEOUT_MS = 60_000;
const backoffMs = (attempt) => 1000 * 2 ** (attempt - 1);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function installJq({
  env = process.env,
  fetchImpl = fetch,
  attempts = 3,
  expectedSha256 = JQ_LINUX_AMD64_SHA256,
  sleep = defaultSleep,
} = {}) {
  const runnerTemp = env.RUNNER_TEMP;
  const githubPath = env.GITHUB_PATH;
  if (!runnerTemp || !githubPath) throw new Error("install-jq needs RUNNER_TEMP and GITHUB_PATH (run it in a GitHub Actions job)");

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(JQ_URL, { signal: AbortSignal.timeout(JQ_DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`${JQ_URL} answered ${response.status}`);
      const binary = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(binary).digest("hex");
      // A wrong checksum is not a transient failure: stop at once.
      if (sha256 !== expectedSha256) {
        throw Object.assign(new Error(`jq's SHA-256 is ${sha256}, expected ${expectedSha256}`), { fatal: true });
      }
      const dir = join(runnerTemp, "jq");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "jq"), binary);
      chmodSync(join(dir, "jq"), 0o755);
      appendFileSync(githubPath, `${dir}\n`);
      return join(dir, "jq");
    } catch (error) {
      if (error?.fatal) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  installJq().then(
    (path) => console.log(`Installed ${JQ_VERSION} at ${path}`),
    (error) => {
      console.error(`::error title=jq install failed::${error.message}`);
      process.exit(1);
    },
  );
}
