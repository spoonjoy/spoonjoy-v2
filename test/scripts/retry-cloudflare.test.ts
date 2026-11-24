import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import * as retry from "../../scripts/retry-cloudflare.mjs";
import { expectConsoleError } from "../warning-policy";

// The kitchen seed's failure in Journeys run 45350929268's QA setup.
const SEED_FAILURE = [
  "✘ [ERROR] internal error; reference = e_fPYqxG_6426c8fd1ef74c4ead37ff6d25179260",
  "Command failed: pnpm exec wrangler d1 execute DB --remote --env qa --file /tmp/spoonjoy-qa-kitchen-oB8uSA/kitchen-reset.sql",
].join("\n");

function results(...list: Array<{ code: number; stderr: string }>) {
  return vi.fn(async () => list.shift() ?? { code: 0, stderr: "" });
}

describe("retry-cloudflare", () => {
  it("runs the command again with backoff while Cloudflare answers an internal error", async () => {
    const run = results({ code: 1, stderr: SEED_FAILURE }, { code: 1, stderr: SEED_FAILURE }, { code: 0, stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    await expect(retry.runWithCloudflareRetry(["--", "pnpm", "run", "qa:migrate"], { run, sleep, log })).resolves.toBe(0);

    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledWith("pnpm", ["run", "qa:migrate"]);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([5_000, 15_000]);
    expect(log).toHaveBeenCalledWith("Cloudflare's API answered an internal error; running pnpm run qa:migrate again in 5 s (retry 1 of 3).");
  });

  it("returns the command's exit code after three retries", async () => {
    const run = vi.fn(async () => ({ code: 7, stderr: SEED_FAILURE }));
    const sleep = vi.fn(async () => {});

    await expect(retry.runWithCloudflareRetry(["--", "pnpm", "run", "seed:qa:kitchen"], { run, sleep, log: vi.fn() })).resolves.toBe(7);
    expect(run).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([5_000, 15_000, 30_000]);
  });

  it("never runs a command again for a failure that is not Cloudflare's", async () => {
    const run = results({ code: 1, stderr: "no such table: User: SQLITE_ERROR [code: 7500]" });
    const sleep = vi.fn(async () => {});

    await expect(retry.runWithCloudflareRetry(["--", "pnpm", "run", "qa:migrate"], { run, sleep, log: vi.fn() })).resolves.toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("needs a command after --", async () => {
    await expect(retry.runWithCloudflareRetry(["pnpm"], {})).rejects.toThrow("retry-cloudflare needs a command after --.");
    await expect(retry.runWithCloudflareRetry(["--"], {})).rejects.toThrow("retry-cloudflare needs a command after --.");
  });

  it("waits with a real timer by default", async () => {
    vi.useFakeTimers();
    try {
      const run = results({ code: 1, stderr: SEED_FAILURE });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const done = retry.runWithCloudflareRetry(["--", "pnpm", "run", "qa:migrate"], { run });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(done).resolves.toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
      log.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["the setup seed's answer", SEED_FAILURE, true],
    ["the cleanup's 7429", { stderr: "A request to the Cloudflare API (/accounts/x/d1/database/d/query) failed.\n  internal error [code: 7429]" }, true],
    ["a 503 on stdout", { stdout: "A request to the Cloudflare API (/accounts/x/d1/database/d/query) failed.\n  Service Unavailable [code: 503]" }, true],
    ["an Error", new Error("internal error; reference = abc"), true],
    ["R2's passing 10042", "A request to the Cloudflare API (/accounts/x/r2/buckets/b/lifecycle) failed.\n  Please enable R2 through the Cloudflare Dashboard. [code: 10042]", true],
    ["a 502 page", "Received a malformed response from the API\n<html>…</html>\nGET /accounts/x/r2/buckets/b/lifecycle -> 502 Bad Gateway", true],
    ["a malformed answer that is no 5xx", "Received a malformed response from the API\nGET /accounts/x/r2/buckets/b/lifecycle -> 403 Forbidden", false],
    ["a token without R2 rights", "A request to the Cloudflare API (/accounts/x/r2/buckets/b/lifecycle) failed.\n  Authentication error [code: 10000]", false],
    ["an SQL error", "A request to the Cloudflare API (/accounts/x/d1/database/d/query) failed.\n  no such table [code: 7500]", false],
    ["nothing", undefined, false],
  ])("classifies %s", (_label, error, transient) => {
    expect(retry.isTransientCloudflareApiError(error)).toBe(transient);
  });

  describe("runOnce", () => {
    function fakeChild() {
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      return child;
    }

    it("passes stderr through, keeps it, and resolves with the exit code", async () => {
      const child = fakeChild();
      const spawnProcess = vi.fn(() => child);
      const written: string[] = [];
      const done = retry.runOnce("pnpm", ["run", "x"], { spawnProcess, stderr: { write: (chunk: unknown) => written.push(String(chunk)) } });
      child.stderr.emit("data", Buffer.from("internal error; "));
      child.stderr.emit("data", Buffer.from("reference = abc\n"));
      child.emit("close", 1);

      await expect(done).resolves.toEqual({ code: 1, stderr: "internal error; reference = abc\n" });
      expect(written.join("")).toBe("internal error; reference = abc\n");
      expect(spawnProcess).toHaveBeenCalledWith("pnpm", ["run", "x"], { stdio: ["inherit", "inherit", "pipe"] });
    });

    it("treats a signal as a failure and a spawn error as exit 1", async () => {
      const killed = fakeChild();
      const done = retry.runOnce("pnpm", [], { spawnProcess: () => killed, stderr: { write: () => true } });
      killed.emit("close", null);
      await expect(done).resolves.toEqual({ code: 1, stderr: "" });

      const missing = fakeChild();
      const failed = retry.runOnce("nope", [], { spawnProcess: () => missing, stderr: { write: () => true } });
      missing.emit("error", new Error("spawn nope ENOENT"));
      await expect(failed).resolves.toEqual({ code: 1, stderr: "spawn nope ENOENT\n" });
    });

    it("runs a real command by default", async () => {
      const written: string[] = [];
      await expect(retry.runOnce(process.execPath, ["-e", "process.stderr.write('x'); process.exit(3)"], { stderr: { write: (chunk: unknown) => written.push(String(chunk)) } }))
        .resolves.toEqual({ code: 3, stderr: "x" });
      expect(written).toEqual(["x"]);
    });
  });

  describe("runCliIfEntry", () => {
    it("runs only as the entry script and sets the exit code from the command", async () => {
      const setExitCode = vi.fn();
      expect(retry.runCliIfEntry({ moduleUrl: "file:///tmp/retry-cloudflare.mjs", argv1: "/tmp/other.mjs", runMain: async () => 0, setExitCode })).toBe(false);
      expect(retry.runCliIfEntry({ moduleUrl: "file:///tmp/retry-cloudflare.mjs", argv1: undefined, runMain: async () => 0, setExitCode })).toBe(false);
      expect(retry.runCliIfEntry({ moduleUrl: "file:///tmp/retry-cloudflare.mjs", argv1: "/tmp/retry-cloudflare.mjs", runMain: async () => 4, setExitCode })).toBe(true);
      await vi.waitFor(() => expect(setExitCode).toHaveBeenCalledWith(4));
    });

    it("prints a usage error and exits 1 by default", async () => {
      const originalArgv = process.argv;
      const originalExitCode = process.exitCode;
      process.argv = [process.execPath, "/tmp/retry-cloudflare.mjs"];
      try {
        expectConsoleError("retry-cloudflare needs a command after --.");
        expect(retry.runCliIfEntry({ moduleUrl: "file:///tmp/retry-cloudflare.mjs", argv1: "/tmp/retry-cloudflare.mjs" })).toBe(true);
        await vi.waitFor(() => expect(process.exitCode).toBe(1));

        process.exitCode = undefined;
        expectConsoleError("plain");
        retry.runCliIfEntry({ moduleUrl: "file:///tmp/retry-cloudflare.mjs", argv1: "/tmp/retry-cloudflare.mjs", runMain: async () => { throw "plain"; } });
        await vi.waitFor(() => expect(process.exitCode).toBe(1));

        process.argv = [process.execPath, "/tmp/retry-cloudflare.mjs", "--", process.execPath, "-e", "process.exit(0)"];
        process.exitCode = undefined;
        retry.runCliIfEntry({ moduleUrl: "file:///tmp/retry-cloudflare.mjs", argv1: "/tmp/retry-cloudflare.mjs" });
        await vi.waitFor(() => expect(process.exitCode).toBe(0));
      } finally {
        process.argv = originalArgv;
        process.exitCode = originalExitCode;
      }
    });
  });
});
