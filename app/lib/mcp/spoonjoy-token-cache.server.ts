import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_TOKEN_FILE = ".config/spoonjoy/mcp-token";

type EnvSource = {
  HOME?: string;
  SPOONJOY_MCP_TOKEN_FILE?: string;
};

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function resolveSpoonjoyMcpTokenFile(
  source: EnvSource = process.env as EnvSource,
  fallbackHome = homedir(),
): string | null {
  const explicitPath = source.SPOONJOY_MCP_TOKEN_FILE?.trim();
  if (explicitPath) return explicitPath;

  const home = source.HOME?.trim() || fallbackHome.trim();
  if (!home) return null;
  return join(home, DEFAULT_TOKEN_FILE);
}

export async function readSpoonjoyMcpCachedToken(
  source: EnvSource = process.env as EnvSource,
  fallbackHome = homedir(),
): Promise<string | null> {
  const tokenFile = resolveSpoonjoyMcpTokenFile(source, fallbackHome);
  if (!tokenFile) return null;

  try {
    const token = (await readFile(tokenFile, "utf8")).trim();
    return token || null;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function writeSpoonjoyMcpCachedToken(
  token: string,
  source: EnvSource = process.env as EnvSource,
  fallbackHome = homedir(),
): Promise<{ tokenFile: string; stored: true } | { tokenFile: null; stored: false }> {
  const tokenFile = resolveSpoonjoyMcpTokenFile(source, fallbackHome);
  if (!tokenFile) return { tokenFile: null, stored: false };

  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, `${token.trim()}\n`, { mode: 0o600 });
  return { tokenFile, stored: true };
}
