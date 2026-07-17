import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolvePostHogBuildHost } from "../app/lib/security-headers.server";
import { filterViteBuildErrorOutput } from "./build-output-hygiene";
import {
  POSTHOG_CLIENT_BUILD_METADATA_PATH,
  writePostHogBuildMetadata,
} from "./posthog-build-metadata";

const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as Record<string, unknown>;
const buildEnvironment = process.env.CLOUDFLARE_ENV ?? "production";
const postHogBuildHost = resolvePostHogBuildHost(wrangler, process.env.CLOUDFLARE_ENV);
const buildEnv = {
  ...process.env,
  VITE_POSTHOG_HOST: postHogBuildHost,
};
const child = spawn("pnpm", ["exec", "react-router", "build"], {
  env: buildEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

function pipeFiltered(stream: NodeJS.ReadableStream, target: NodeJS.WritableStream) {
  let pending = "";

  stream.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/(?<=\r?\n)/);
    pending = lines.pop() ?? "";
    target.write(filterViteBuildErrorOutput(lines.join("")));
  });

  stream.on("end", () => {
    if (pending) {
      target.write(filterViteBuildErrorOutput(pending));
      pending = "";
    }
  });
}

pipeFiltered(child.stdout, process.stdout);
pipeFiltered(child.stderr, process.stderr);

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

child.on("close", async (code, signal) => {
  if (signal) {
    process.stderr.write(`react-router build terminated by ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  try {
    await writePostHogBuildMetadata(
      POSTHOG_CLIENT_BUILD_METADATA_PATH,
      buildEnvironment,
      postHogBuildHost,
    );
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`Could not write PostHog build metadata: ${String(error)}\n`);
    process.exitCode = 1;
  }
});
