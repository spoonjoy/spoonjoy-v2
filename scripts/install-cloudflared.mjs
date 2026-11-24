#!/usr/bin/env node
// Installs cloudflared for the Move in journeys, which open a Cloudflare quick tunnel to a stand-in of the other
// recipe app's server (e2e/journeys/support/recipe-server.ts). Like install-jq.mjs: the pinned release binary,
// checked against its published SHA-256, into $RUNNER_TEMP/cloudflared on the job's PATH.
// Usage: node scripts/install-cloudflared.mjs
import { pathToFileURL } from "node:url";
import { installPinnedBinary } from "./install-jq.mjs";

export const CLOUDFLARED_VERSION = "2026.10.7";
// The release's own digest for the cloudflared-linux-amd64 asset.
export const CLOUDFLARED_LINUX_AMD64_SHA256 = "1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872";
export const CLOUDFLARED_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`;

export function installCloudflared(options = {}) {
  return installPinnedBinary({ name: "cloudflared", url: CLOUDFLARED_URL, sha256: CLOUDFLARED_LINUX_AMD64_SHA256, ...options });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  installCloudflared().then(
    (path) => console.log(`Installed cloudflared ${CLOUDFLARED_VERSION} at ${path}`),
    (error) => {
      console.error(`::error title=cloudflared install failed::${error.message}`);
      process.exit(1);
    },
  );
}
