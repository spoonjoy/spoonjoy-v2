import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolvePostHogBuildHost } from "../app/lib/security-headers.server";
import { filterViteBuildErrorOutput } from "./build-output-hygiene";

const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as Record<string, unknown>;
const buildEnv = {
  ...process.env,
  VITE_POSTHOG_HOST: resolvePostHogBuildHost(wrangler, process.env.CLOUDFLARE_ENV),
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

child.on("close", (code, signal) => {
  if (signal) {
    process.stderr.write(`react-router build terminated by ${signal}\n`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
