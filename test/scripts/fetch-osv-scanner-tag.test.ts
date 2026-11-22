import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LOOKUP_TIMEOUT_MS,
  MAX_WAIT_MS,
  RETRY_STATUSES,
  describeAnswer,
  fetchOsvScannerTag,
  tagUrl,
  waitMs,
} from "../../scripts/fetch-osv-scanner-tag.mjs";

// Under the repository's ignored .cache/.
const SCRATCH = join(__dirname, "../../.cache/fetch-osv-scanner-tag-test");

function outputPath() {
  mkdirSync(SCRATCH, { recursive: true });
  return join(mkdtempSync(join(SCRATCH, "tag-")), "osv-scanner", "tag.json");
}

function answer(status: number, body = "", headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => body };
}

const TAG = '{"object":{"type":"commit","sha":"408fcd6f8707999a29e7ba45e15809764cf24f67"}}';

function run(fetchImpl: ReturnType<typeof vi.fn>, output = outputPath()) {
  const waits: number[] = [];
  const log = vi.fn();
  const result = fetchOsvScannerTag({
    version: "v2.3.8",
    token: "test-token",
    output,
    fetchImpl,
    sleep: async (ms: number) => { waits.push(ms); },
    log,
  });
  return { result, waits, log, output };
}

describe("fetch-osv-scanner-tag", () => {
  it("looks up the pinned tag with the job's token and writes GitHub's answer", async () => {
    const fetchImpl = vi.fn(async () => answer(200, TAG));
    const { result, output } = run(fetchImpl);
    await expect(result).resolves.toBe(output);
    expect(fetchImpl).toHaveBeenCalledWith(tagUrl("v2.3.8"), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer test-token",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: expect.any(AbortSignal),
    });
    expect(tagUrl("v2.3.8")).toBe("https://api.github.com/repos/google/osv-scanner/git/ref/tags/v2.3.8");
    expect(LOOKUP_TIMEOUT_MS).toBe(30_000);
    expect(readFileSync(output, "utf8")).toBe(TAG);
  });

  it("retries a rate-limit 403 and 429, and a 5xx, then succeeds", async () => {
    expect([...RETRY_STATUSES]).toEqual([403, 429, 500, 502, 503, 504]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer(403))
      .mockResolvedValueOnce(answer(429))
      .mockResolvedValueOnce(answer(503))
      .mockResolvedValueOnce(answer(200, TAG));
    const { result, waits, log } = run(fetchImpl);
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([2000, 4000, 8000]);
    expect(log).toHaveBeenCalledWith("OSV-Scanner tag lookup answered 403; trying again in 2 s");
    // A retry note must pass warning-gate, which fails a step on any line that says "warn".
    for (const [line] of log.mock.calls) expect(line).not.toMatch(/warn/i);
  });

  it("retries a network failure", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(answer(200, TAG));
    const { result, waits, log } = run(fetchImpl);
    await result;
    expect(waits).toEqual([2000]);
    expect(log).toHaveBeenCalledWith("OSV-Scanner tag lookup could not reach GitHub (fetch failed); trying again in 2 s");
  });

  it("fails after the last network failure", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const { result, waits } = run(fetchImpl);
    await expect(result).rejects.toThrow(`${tagUrl("v2.3.8")} could not be reached: fetch failed`);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([2000, 4000, 8000]);
  });

  it("prints the status and headers when the last try fails, and writes nothing", async () => {
    const headers = { "x-github-request-id": "ABCD:1234", "x-ratelimit-remaining": "12" };
    const fetchImpl = vi.fn(async () => answer(403, "", headers));
    const { result, output } = run(fetchImpl);
    const error = await result.then(() => undefined, (caught: Error) => caught);
    expect(error?.message).toBe(
      `${tagUrl("v2.3.8")} answered 403 on try 4 of 4\nstatus 403\nx-github-request-id: ABCD:1234\nx-ratelimit-remaining: 12`,
    );
    expect(error?.message).not.toContain("test-token");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(() => statSync(output)).toThrow();
  });

  it("fails at once on an answer a retry won't change", async () => {
    const fetchImpl = vi.fn(async () => answer(404));
    const { result } = run(fetchImpl);
    await expect(result).rejects.toThrow("answered 404 on try 1 of 4");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("needs a version, a token and an output path", async () => {
    const base = { version: "v2.3.8", token: "t", output: outputPath() };
    await expect(fetchOsvScannerTag({ ...base, version: "" })).rejects.toThrow("needs OSV_SCANNER_VERSION");
    await expect(fetchOsvScannerTag({ ...base, token: undefined })).rejects.toThrow("needs GITHUB_TOKEN");
    await expect(fetchOsvScannerTag({ ...base, output: undefined })).rejects.toThrow("needs an output path");
  });

  it("follows GitHub's retry-after or rate-limit reset, capped", () => {
    expect(waitMs(new Headers({ "retry-after": "5" }), 1)).toBe(5000);
    expect(waitMs(new Headers({ "retry-after": "600" }), 1)).toBe(MAX_WAIT_MS);
    const now = 1_000_000_000_000;
    const reset = (seconds: number) => new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + seconds) });
    expect(waitMs(reset(10), 1, now)).toBe(10_000);
    expect(waitMs(reset(3600), 1, now)).toBe(MAX_WAIT_MS);
    expect(waitMs(reset(-5), 1, now)).toBe(1000);
    // A reset is followed only when the limit is used up.
    expect(waitMs(new Headers({ "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1" }), 2)).toBe(4000);
    expect(waitMs(new Headers(), 3)).toBe(8000);
  });

  it("describes an answer by status and headers", () => {
    expect(describeAnswer(answer(429, "", { "retry-after": "7" }))).toBe("status 429\nretry-after: 7");
  });
});
