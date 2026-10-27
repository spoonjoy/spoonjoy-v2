import { readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  isCliEntry,
  main,
  QA_PHOTO_BUCKET,
  runCliIfEntry,
  SAMPLE_COVER_DIR,
  sampleCoverUploads,
  wranglerPutArgs,
} from "../../scripts/qa-sample-covers.mjs";

describe("scripts/qa-sample-covers", () => {
  it("ships a handful of sample covers it can upload", () => {
    const uploads = sampleCoverUploads(readdirSync(SAMPLE_COVER_DIR));
    expect(uploads.length).toBeGreaterThanOrEqual(4);
    expect(uploads.length).toBeLessThanOrEqual(8);
  });

  it("maps each image to its samples/covers/ key and content type, in name order, skipping dotfiles", () => {
    expect(sampleCoverUploads(["b.webp", ".DS_Store", "a.JPG", "c.png", "d.jpeg"])).toEqual([
      { path: `${SAMPLE_COVER_DIR}/a.JPG`, key: "samples/covers/a.JPG", contentType: "image/jpeg" },
      { path: `${SAMPLE_COVER_DIR}/b.webp`, key: "samples/covers/b.webp", contentType: "image/webp" },
      { path: `${SAMPLE_COVER_DIR}/c.png`, key: "samples/covers/c.png", contentType: "image/png" },
      { path: `${SAMPLE_COVER_DIR}/d.jpeg`, key: "samples/covers/d.jpeg", contentType: "image/jpeg" },
    ]);
  });

  it("refuses a file that is not an image, and an empty folder", () => {
    expect(() => sampleCoverUploads(["notes.txt"])).toThrow(`${SAMPLE_COVER_DIR}/notes.txt is not a JPEG, PNG or WebP image.`);
    expect(() => sampleCoverUploads([".keep"])).toThrow(`${SAMPLE_COVER_DIR} has no sample cover images.`);
  });

  it("puts each image only in QA's bucket, remotely", () => {
    expect(QA_PHOTO_BUCKET).toBe("spoonjoy-photos-qa");
    expect(wranglerPutArgs({ path: "assets/sample-covers/a.jpg", key: "samples/covers/a.jpg", contentType: "image/jpeg" })).toEqual([
      "exec", "wrangler", "r2", "object", "put", "spoonjoy-photos-qa/samples/covers/a.jpg",
      "--file", "assets/sample-covers/a.jpg",
      "--content-type", "image/jpeg",
      "--remote",
    ]);
  });

  it("uploads every sample and reports the count", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const log = vi.fn();
    await expect(main({ readdir: () => ["a.jpg", "b.webp"], exec, log })).resolves.toBe(2);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(1, "pnpm", expect.arrayContaining(["spoonjoy-photos-qa/samples/covers/a.jpg"]));
    expect(exec).toHaveBeenNthCalledWith(2, "pnpm", expect.arrayContaining(["spoonjoy-photos-qa/samples/covers/b.webp"]));
    expect(log).toHaveBeenCalledWith("Put 2 sample cover images in spoonjoy-photos-qa/samples/covers/.");
  });

  it("retries a put R2 refuses for a moment, and gives up on any other error or after the last retry", async () => {
    const transient = Object.assign(new Error("Command failed: pnpm exec wrangler r2 object put"), {
      stderr: "Failed to fetch /accounts/a/r2/buckets/spoonjoy-photos-qa/objects/samples/covers/a.jpg - 500: Internal Server Error;",
    });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    const flaky = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue({ stdout: "", stderr: "" });
    await expect(main({ readdir: () => ["a.jpg"], exec: flaky, log, sleep })).resolves.toBe(1);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000);

    const broken = vi.fn(async () => {
      throw new Error("no such file");
    });
    await expect(main({ readdir: () => ["a.jpg"], exec: broken, log, sleep })).rejects.toThrow("no such file");
    expect(broken).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => {
      throw transient;
    });
    await expect(main({ readdir: () => ["a.jpg"], exec: down, log, sleep })).rejects.toBe(transient);
    expect(down).toHaveBeenCalledTimes(4);
  });

  it("waits out a transient refusal on a real timer by default", async () => {
    vi.useFakeTimers();
    try {
      const transient = Object.assign(new Error("put failed"), { stderr: "Failed to fetch /r2/x - 429: Too Many Requests" });
      const exec = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue({ stdout: "", stderr: "" });
      const done = main({ readdir: () => ["a.jpg"], exec, log: vi.fn() });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(done).resolves.toBe(1);
      expect(exec).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs only as the entry script, and turns a failure into an error annotation and exit code", async () => {
    expect(isCliEntry("file:///a.mjs", "/a.mjs")).toBe(true);
    expect(isCliEntry("file:///a.mjs", undefined)).toBe(false);
    expect(await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/b.mjs" })).toBe(false);

    const runMain = vi.fn(async () => 1);
    expect(await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledTimes(1);

    const io = { error: vi.fn() };
    const previousExitCode = process.exitCode;
    try {
      await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain: async () => Promise.reject(new Error("boom")), io });
      expect(io.error).toHaveBeenCalledWith("::error::boom");
      expect(process.exitCode).toBe(1);
      await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain: async () => Promise.reject("plain"), io });
      expect(io.error).toHaveBeenCalledWith("::error::plain");
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
