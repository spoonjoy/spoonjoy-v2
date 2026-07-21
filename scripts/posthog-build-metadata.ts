import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolvePostHogBuildHost,
  resolvePostHogCspOrigins,
} from "../app/lib/security-headers.server";

export const POSTHOG_CLIENT_BUILD_METADATA_PATH =
  "build/client/.vite/spoonjoy-build-metadata.json";

export interface PostHogBuildMetadata {
  readonly schemaVersion: 1;
  readonly environment: string;
  readonly publicEnv: Readonly<{
    VITE_POSTHOG_HOST: string;
  }>;
  readonly runtimeCsp: Readonly<{
    ingestOrigin: string;
    assetsOrigin: string;
  }>;
}

export interface PostHogBuildContract {
  readonly environment: string;
  readonly postHogHost: string;
  readonly metadata: PostHogBuildMetadata;
}

export function createPostHogBuildContract(
  wrangler: Record<string, unknown>,
  environment?: string,
): PostHogBuildContract {
  const normalizedEnvironment = environment ?? "production";
  const postHogHost = resolvePostHogBuildHost(wrangler, environment);
  const runtimeCsp = Object.freeze(resolvePostHogCspOrigins({
    VITE_POSTHOG_HOST: postHogHost,
  }));
  const publicEnv = Object.freeze({ VITE_POSTHOG_HOST: postHogHost });
  const metadata = Object.freeze({
    schemaVersion: 1 as const,
    environment: normalizedEnvironment,
    publicEnv,
    runtimeCsp,
  });
  return Object.freeze({
    environment: normalizedEnvironment,
    postHogHost,
    metadata,
  });
}

export function createPostHogBuildMetadata(
  contract: PostHogBuildContract,
): PostHogBuildMetadata {
  return contract.metadata;
}

export async function writePostHogBuildMetadata(
  filePath: string,
  contract: PostHogBuildContract,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(createPostHogBuildMetadata(contract), null, 2)}\n`,
    "utf8",
  );
}

const BUNDLED_POSTHOG_HOST_PATTERN =
  /(?:^|[,{])\s*(?:"VITE_POSTHOG_HOST"|VITE_POSTHOG_HOST)\s*:\s*("(?:\\.|[^"\\])*")/g;

export function extractBundledPostHogHosts(sources: readonly string[]): readonly string[] {
  const hosts: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(BUNDLED_POSTHOG_HOST_PATTERN)) {
      hosts.push(JSON.parse(match[1]) as string);
    }
  }
  return hosts;
}

export function bundledPostHogHostMatches(
  sources: readonly string[],
  expectedHost: string,
): boolean {
  const hosts = extractBundledPostHogHosts(sources);
  return hosts.length === 1 && hosts[0] === expectedHost;
}

export async function readPostHogClientBundleSources(
  rootDir = process.cwd(),
): Promise<readonly string[]> {
  const clientOutputDir = path.join(rootDir, "build/client");
  const files = await collectJavaScriptFiles(clientOutputDir);
  files.sort((a, b) =>
    path.relative(clientOutputDir, a).localeCompare(path.relative(clientOutputDir, b)),
  );
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

async function collectJavaScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptFiles(entryPath);
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      return [entryPath];
    }
    return [];
  }));
  return files.flat();
}
