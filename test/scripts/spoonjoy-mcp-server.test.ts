import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

async function listMcpToolsWithEnv(env: NodeJS.ProcessEnv): Promise<string[]> {
  const child = spawn("pnpm", ["exec", "tsx", "scripts/spoonjoy-mcp-server.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);

    const line = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`timed out waiting for tools/list response\nstderr:\n${stderr}`));
      }, 10_000);

      const interval = setInterval(() => {
        const candidate = stdout.split(/\r?\n/).find((entry) => entry.trim().startsWith("{"));
        if (!candidate) return;
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(candidate);
      }, 25);
    });

    const response = JSON.parse(line) as {
      result?: { tools?: Array<{ name: string }> };
      error?: { message?: string };
    };
    if (response.error) throw new Error(response.error.message ?? "MCP tools/list failed");
    return response.result?.tools?.map((tool) => tool.name) ?? [];
  } finally {
    child.kill("SIGTERM");
  }
}

describe("spoonjoy MCP stdio server", () => {
  it("lists tools in local mode when the cached token is stale", async () => {
    const home = await mkdtemp(join(tmpdir(), "spoonjoy-mcp-home-"));
    const tokenFile = join(home, ".config/spoonjoy/mcp-token");
    await mkdir(dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, "stale-token-from-another-environment\n");

    try {
      const tools = await listMcpToolsWithEnv({
        ...process.env,
        HOME: home,
        SPOONJOY_MCP_API_BASE_URL: "",
        SPOONJOY_MCP_API_TOKEN: "",
        SPOONJOY_MCP_USER_EMAIL: "demo@spoonjoy.com",
      });

      expect(tools).toContain("upload_recipe_image");
      expect(tools).toContain("list_recipe_covers");
      expect(tools).toContain("generate_recipe_cover_placeholder");
      expect(tools).toContain("regenerate_recipe_cover");
      expect(tools).toContain("set_active_recipe_cover");
      expect(tools).toContain("set_recipe_no_cover");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);
});
