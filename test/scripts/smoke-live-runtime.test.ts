import { describe, expect, it, vi } from "vitest";

import { createSmokeLiveRuntime } from "../../scripts/smoke-live-runtime.mjs";

const hostileEnv = {
  PATH: "/test/bin",
  SAFE_VALUE: "safe",
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  CLOUDFLARE_API_TOKEN: "workers-token",
  CLOUDFLARE_D1_API_TOKEN: "d1-token",
  CLOUDFLARE_WORKERS_API_TOKEN: "deploy-token",
  CF_API_KEY: "api-key",
};

describe("live smoke runtime authority", () => {
  it("isolates Chromium and both D1 subprocesses from unrelated Cloudflare authority", async () => {
    const browser = { close: vi.fn() };
    const chromium = { launch: vi.fn(async () => browser) };
    const execFile = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const runtime = createSmokeLiveRuntime({ chromium, execFile, env: hostileEnv });

    await expect(runtime.launchBrowser({ headless: true })).resolves.toBe(browser);
    await runtime.executeD1(["cleanup"]);
    await runtime.executeD1(["verify"]);

    expect(chromium.launch).toHaveBeenCalledWith({
      headless: true,
      env: { PATH: "/test/bin", SAFE_VALUE: "safe" },
    });
    for (const args of execFile.mock.calls) {
      expect(args).toEqual([
        "pnpm",
        expect.any(Array),
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024 * 4,
          env: {
            PATH: "/test/bin",
            SAFE_VALUE: "safe",
            CLOUDFLARE_ACCOUNT_ID: "account-id",
            CLOUDFLARE_API_TOKEN: "d1-token",
          },
        },
      ]);
    }
    expect(JSON.stringify(chromium.mock.calls)).not.toContain("d1-token");
    expect(JSON.stringify(execFile.mock.calls)).not.toContain("workers-token");
    expect(JSON.stringify(execFile.mock.calls)).not.toContain("deploy-token");
  });

  it.each(["launch", "cleanup", "verification"])("propagates %s rejection", async (phase) => {
    const failure = new Error(`${phase} failed`);
    const chromium = {
      launch: vi.fn(async () => {
        if (phase === "launch") throw failure;
        return {};
      }),
    };
    let call = 0;
    const execFile = vi.fn(async () => {
      call += 1;
      if ((phase === "cleanup" && call === 1) || (phase === "verification" && call === 2)) {
        throw failure;
      }
      return { stdout: "ok", stderr: "" };
    });
    const runtime = createSmokeLiveRuntime({ chromium, execFile, env: hostileEnv });

    if (phase === "launch") {
      await expect(runtime.launchBrowser({ headless: true })).rejects.toBe(failure);
      return;
    }
    await runtime.launchBrowser({ headless: true });
    if (phase === "cleanup") {
      await expect(runtime.executeD1(["cleanup"])).rejects.toBe(failure);
      return;
    }
    await runtime.executeD1(["cleanup"]);
    await expect(runtime.executeD1(["verify"])).rejects.toBe(failure);
  });
});
