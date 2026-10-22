import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JQ_LINUX_AMD64_SHA256, JQ_URL, JQ_VERSION, installJq } from "../../scripts/install-jq.mjs";

// Under the repository's ignored .cache/.
const SCRATCH = join(__dirname, "../../.cache/install-jq-test");

function jobEnv() {
  mkdirSync(SCRATCH, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH, "install-jq-"));
  return { RUNNER_TEMP: dir, GITHUB_PATH: join(dir, "github-path") };
}

function answer(bytes: Buffer, status = 200) {
  return { ok: status === 200, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
}

describe("install-jq", () => {
  it("pins one release binary by version and SHA-256", () => {
    expect(JQ_VERSION).toMatch(/^jq-\d+\.\d+\.\d+$/);
    expect(JQ_URL).toBe(`https://github.com/jqlang/jq/releases/download/${JQ_VERSION}/jq-linux-amd64`);
    expect(JQ_LINUX_AMD64_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("installs the binary, executable, and puts its directory on the job's PATH", async () => {
    const env = jobEnv();
    const bytes = Buffer.from("jq binary");
    const fetchImpl = vi.fn(async () => answer(bytes));
    const path = await installJq({ env, fetchImpl, expectedSha256: createHash("sha256").update(bytes).digest("hex") });
    expect(fetchImpl).toHaveBeenCalledWith(JQ_URL);
    expect(path).toBe(join(env.RUNNER_TEMP, "jq", "jq"));
    expect(readFileSync(path, "utf8")).toBe("jq binary");
    expect(statSync(path).mode & 0o111).toBe(0o111);
    expect(readFileSync(env.GITHUB_PATH, "utf8")).toBe(`${join(env.RUNNER_TEMP, "jq")}\n`);
  });

  it("refuses a binary whose checksum differs, at once and without trying again", async () => {
    const env = jobEnv();
    const fetchImpl = vi.fn(async () => answer(Buffer.from("not jq")));
    await expect(installJq({ env, fetchImpl })).rejects.toThrow(`expected ${JQ_LINUX_AMD64_SHA256}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(() => statSync(join(env.RUNNER_TEMP, "jq", "jq"))).toThrow();
  });

  it("tries a failed download up to three times, then fails with the last error", async () => {
    const env = jobEnv();
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(answer(Buffer.from(""), 503))
      .mockRejectedValueOnce(new TypeError("fetch failed again"));
    await expect(installJq({ env, fetchImpl, attempts: 3 })).rejects.toThrow("fetch failed again");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refuses to run outside a GitHub Actions job", async () => {
    await expect(installJq({ env: {}, fetchImpl: vi.fn() })).rejects.toThrow("RUNNER_TEMP and GITHUB_PATH");
  });
});
