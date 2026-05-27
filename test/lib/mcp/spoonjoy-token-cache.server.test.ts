import { afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readSpoonjoyMcpCachedToken,
  resolveSpoonjoyMcpTokenFile,
  writeSpoonjoyMcpCachedToken,
} from "../../../app/lib/mcp/spoonjoy-token-cache.server";

describe("spoonjoy MCP token cache", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function tempHome() {
    return mkdtemp(join(tmpdir(), "spoonjoy-token-cache-"));
  }

  it("prefers an explicit token file path", () => {
    expect(resolveSpoonjoyMcpTokenFile({
      HOME: "/home/agent",
      SPOONJOY_MCP_TOKEN_FILE: " /tmp/spoonjoy-token ",
    })).toBe("/tmp/spoonjoy-token");
  });

  it("uses the home config path when no explicit path is configured", () => {
    expect(resolveSpoonjoyMcpTokenFile({ HOME: " /home/agent " }, "/fallback")).toBe(
      "/home/agent/.config/spoonjoy/mcp-token",
    );
  });

  it("returns null when neither home nor fallback home is available", () => {
    expect(resolveSpoonjoyMcpTokenFile({ HOME: " " }, "")).toBeNull();
  });

  it("reads missing and blank token files as absent", async () => {
    const home = await tempHome();
    expect(await readSpoonjoyMcpCachedToken({ HOME: home }, "")).toBeNull();

    const blank = await writeSpoonjoyMcpCachedToken("   ", { HOME: home }, "");
    expect(blank.stored).toBe(true);
    expect(await readSpoonjoyMcpCachedToken({ HOME: home }, "")).toBeNull();
  });

  it("writes a newline-terminated token with owner-only file permissions", async () => {
    const home = await tempHome();
    const result = await writeSpoonjoyMcpCachedToken(" sj_live_cache ", { HOME: home }, "");

    expect(result).toEqual({
      stored: true,
      tokenFile: join(home, ".config/spoonjoy/mcp-token"),
    });
    expect(await readFile(result.tokenFile, "utf8")).toBe("sj_live_cache\n");
    expect(await readSpoonjoyMcpCachedToken({ HOME: home }, "")).toBe("sj_live_cache");

    const mode = (await stat(result.tokenFile)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("uses process env defaults when no explicit source is passed", async () => {
    const home = await tempHome();
    const tokenFile = join(home, "cached-token");
    vi.stubEnv("SPOONJOY_MCP_TOKEN_FILE", tokenFile);
    vi.stubEnv("HOME", "");

    expect(resolveSpoonjoyMcpTokenFile()).toBe(tokenFile);
    await expect(writeSpoonjoyMcpCachedToken("sj_default_source")).resolves.toEqual({
      stored: true,
      tokenFile,
    });
    await expect(readSpoonjoyMcpCachedToken()).resolves.toBe("sj_default_source");
  });

  it("does not write when no token path is available", async () => {
    await expect(writeSpoonjoyMcpCachedToken("sj_live", { HOME: "" }, ""))
      .resolves.toEqual({ stored: false, tokenFile: null });
  });

  it("does not read when no token path is available", async () => {
    await expect(readSpoonjoyMcpCachedToken({ HOME: "" }, "")).resolves.toBeNull();
  });

  it("surfaces unexpected read failures", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".config/spoonjoy/mcp-token"), { recursive: true });

    await expect(readSpoonjoyMcpCachedToken({ HOME: home }, "")).rejects.toThrow();
  });
});
