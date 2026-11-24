import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLOUDFLARED_LINUX_AMD64_SHA256, CLOUDFLARED_URL, CLOUDFLARED_VERSION, installCloudflared } from "../../scripts/install-cloudflared.mjs";

// Under the repository's ignored .cache/.
const SCRATCH = join(__dirname, "../../.cache/install-cloudflared-test");

describe("install-cloudflared", () => {
  it("pins one release binary by version and SHA-256", () => {
    expect(CLOUDFLARED_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/);
    expect(CLOUDFLARED_URL).toBe(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`);
    expect(CLOUDFLARED_LINUX_AMD64_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("downloads the pinned binary and refuses it when its checksum differs", async () => {
    mkdirSync(SCRATCH, { recursive: true });
    const dir = mkdtempSync(join(SCRATCH, "run-"));
    const env = { RUNNER_TEMP: dir, GITHUB_PATH: join(dir, "github-path") };
    const bytes = Buffer.from("not cloudflared");
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }));
    await expect(installCloudflared({ env, fetchImpl })).rejects.toThrow(/^cloudflared's SHA-256 is [0-9a-f]{64}, expected /);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(CLOUDFLARED_URL, { signal: expect.any(AbortSignal) });
    expect(() => readFileSync(env.GITHUB_PATH)).toThrow();
  });
});
