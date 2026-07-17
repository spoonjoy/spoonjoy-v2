import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePostHogCspOrigins } from "../app/lib/security-headers.server";

export const POSTHOG_CLIENT_BUILD_METADATA_PATH =
  "build/client/.vite/spoonjoy-build-metadata.json";

export interface PostHogBuildMetadata {
  schemaVersion: 1;
  environment: string;
  publicEnv: {
    VITE_POSTHOG_HOST: string;
  };
  runtimeCsp: {
    ingestOrigin: string;
    assetsOrigin: string;
  };
}

export function createPostHogBuildMetadata(
  environment: string,
  postHogHost: string,
): PostHogBuildMetadata {
  const runtimeCsp = resolvePostHogCspOrigins({ VITE_POSTHOG_HOST: postHogHost });
  if (runtimeCsp.ingestOrigin !== postHogHost) {
    throw new Error("PostHog build metadata requires a normalized HTTPS origin.");
  }
  return {
    schemaVersion: 1,
    environment,
    publicEnv: { VITE_POSTHOG_HOST: postHogHost },
    runtimeCsp,
  };
}

export async function writePostHogBuildMetadata(
  filePath: string,
  environment: string,
  postHogHost: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(createPostHogBuildMetadata(environment, postHogHost), null, 2)}\n`,
    "utf8",
  );
}
