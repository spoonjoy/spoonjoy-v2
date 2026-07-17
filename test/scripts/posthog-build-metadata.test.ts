import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPostHogBuildMetadata,
  writePostHogBuildMetadata,
} from "../../scripts/posthog-build-metadata";

describe("PostHog client build metadata", () => {
  it.each([
    ["production", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
    ["qa", "https://eu.i.posthog.com", "https://eu-assets.i.posthog.com"],
    ["qa", "https://analytics.example.com", "https://analytics.example.com"],
  ])("records structured %s metadata for %s", (environment, host, assetsOrigin) => {
    expect(createPostHogBuildMetadata(environment, host)).toEqual({
      schemaVersion: 1,
      environment,
      publicEnv: { VITE_POSTHOG_HOST: host },
      runtimeCsp: { ingestOrigin: host, assetsOrigin },
    });
  });

  it("writes the structured manifest to the requested build path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-posthog-build-"));
    const target = path.join(root, "nested", "metadata.json");
    try {
      await writePostHogBuildMetadata(target, "qa", "https://eu.i.posthog.com");
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual(
        createPostHogBuildMetadata("qa", "https://eu.i.posthog.com"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    "http://us.i.posthog.com",
    "https://us.i.posthog.com/path",
    "not-a-url",
  ])("rejects a non-normalized build host: %s", (host) => {
    expect(() => createPostHogBuildMetadata("qa", host)).toThrow(
      /normalized HTTPS origin/,
    );
  });
});
