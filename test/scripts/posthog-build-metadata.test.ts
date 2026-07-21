import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledPostHogHostMatches,
  createPostHogBuildContract,
  createPostHogBuildMetadata,
  extractBundledPostHogHosts,
  readPostHogClientBundleSources,
  writePostHogBuildMetadata,
} from "../../scripts/posthog-build-metadata";

function wrangler(host: string): Record<string, unknown> {
  return {
    vars: { VITE_POSTHOG_HOST: host },
    env: { qa: { vars: { VITE_POSTHOG_HOST: host } } },
  };
}

describe("PostHog client build contract", () => {
  it.each([
    [undefined, "production", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
    ["qa", "qa", "https://eu.i.posthog.com", "https://eu-assets.i.posthog.com"],
    ["qa", "qa", "https://analytics.example.com", "https://analytics.example.com"],
  ])("records immutable %s metadata for %s", (environment, expectedEnvironment, host, assetsOrigin) => {
    const contract = createPostHogBuildContract(wrangler(host), environment);

    expect(contract).toEqual({
      environment: expectedEnvironment,
      postHogHost: host,
      metadata: {
        schemaVersion: 1,
        environment: expectedEnvironment,
        publicEnv: { VITE_POSTHOG_HOST: host },
        runtimeCsp: { ingestOrigin: host, assetsOrigin },
      },
    });
    expect(createPostHogBuildMetadata(contract)).toBe(contract.metadata);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.metadata)).toBe(true);
    expect(Object.isFrozen(contract.metadata.publicEnv)).toBe(true);
    expect(Object.isFrozen(contract.metadata.runtimeCsp)).toBe(true);
  });

  it("writes metadata from the same contract object", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-posthog-build-"));
    const target = path.join(root, "nested", "metadata.json");
    const contract = createPostHogBuildContract(wrangler("https://eu.i.posthog.com"), "qa");
    try {
      await writePostHogBuildMetadata(target, contract);
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual(contract.metadata);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    "http://us.i.posthog.com",
    "https://us.i.posthog.com/path",
    " https://us.i.posthog.com ",
    "not-a-url",
  ])("rejects a non-normalized build host: %s", (host) => {
    expect(() => createPostHogBuildContract(wrangler(host), "qa")).toThrow(
      /origin-only HTTPS origin|origin-only HTTPS VITE_POSTHOG_HOST/,
    );
  });

  it("extracts every structured host literal occurrence from actual client code", () => {
    expect(extractBundledPostHogHosts([
      'const a={VITE_POSTHOG_HOST:"https://us.i.posthog.com"};',
      'const b={"VITE_POSTHOG_HOST":"https://eu.i.posthog.com"};',
      'const duplicate={VITE_POSTHOG_HOST:"https://us.i.posthog.com"};',
      'const dead="VITE_POSTHOG_HOST=https://evil.example";',
    ])).toEqual([
      "https://us.i.posthog.com",
      "https://eu.i.posthog.com",
      "https://us.i.posthog.com",
    ]);
    expect(extractBundledPostHogHosts([])).toEqual([]);
  });

  it("requires exactly one total bundled host occurrence matching the immutable build contract", () => {
    const expected = "https://us.i.posthog.com";
    expect(bundledPostHogHostMatches([
      `const env={VITE_POSTHOG_HOST:"${expected}"};`,
    ], expected)).toBe(true);
    expect(bundledPostHogHostMatches([
      `const a={VITE_POSTHOG_HOST:"${expected}"};`,
      `const b={VITE_POSTHOG_HOST:"${expected}"};`,
    ], expected)).toBe(false);
    expect(bundledPostHogHostMatches([], expected)).toBe(false);
    expect(bundledPostHogHostMatches([
      `const a={VITE_POSTHOG_HOST:"${expected}"};`,
      'const b={VITE_POSTHOG_HOST:"https://evil.example"};',
    ], expected)).toBe(false);
  });

  it("recursively reads sorted JavaScript client output and ignores other generated files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-posthog-bundle-"));
    try {
      const client = path.join(root, "build/client");
      const assets = path.join(root, "build/client/assets");
      await Promise.all([
        mkdir(assets, { recursive: true }),
        mkdir(path.join(assets, "nested"), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(assets, "b.js"), "second", "utf8"),
        writeFile(path.join(assets, "a.js"), "first", "utf8"),
        writeFile(path.join(assets, "nested", "c.js"), "third", "utf8"),
        writeFile(path.join(client, "entry.js"), "entry", "utf8"),
        writeFile(path.join(assets, "style.css"), "ignored", "utf8"),
      ]);

      await expect(readPostHogClientBundleSources(root)).resolves.toEqual([
        "first",
        "second",
        "third",
        "entry",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes top-level decoy and nested actual hosts as duplicate bundle occurrences", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-posthog-bundle-"));
    const expected = "https://us.i.posthog.com";
    try {
      const client = path.join(root, "build/client");
      const nested = path.join(client, "assets/chunks");
      await mkdir(nested, { recursive: true });
      await Promise.all([
        writeFile(path.join(client, "decoy.js"), `const a={VITE_POSTHOG_HOST:"${expected}"};`, "utf8"),
        writeFile(path.join(nested, "actual.js"), `const b={VITE_POSTHOG_HOST:"${expected}"};`, "utf8"),
      ]);

      const sources = await readPostHogClientBundleSources(root);
      expect(extractBundledPostHogHosts(sources)).toEqual([expected, expected]);
      expect(bundledPostHogHostMatches(sources, expected)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults client bundle reads to the current working directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spoonjoy-posthog-bundle-"));
    const previousCwd = process.cwd();
    try {
      const assets = path.join(root, "build/client/assets");
      await mkdir(assets, { recursive: true });
      await writeFile(path.join(assets, "app.js"), "default-root", "utf8");

      process.chdir(root);
      await expect(readPostHogClientBundleSources()).resolves.toEqual(["default-root"]);
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
