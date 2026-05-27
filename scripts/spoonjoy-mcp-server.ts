import { createInterface } from "node:readline";
import { authenticateApiToken, principalFromUserEmail, type ApiPrincipal } from "../app/lib/api-auth.server";
import { getLocalDb } from "../app/lib/db.server";
import { createJsonRpcLineSession } from "../app/lib/mcp/json-rpc-stdio.server";
import type { JsonRpcToolRouter } from "../app/lib/mcp/json-rpc.server";
import { spoonjoyRemoteAuthorizationHeader } from "../app/lib/mcp/spoonjoy-remote-auth.server";
import { getSpoonjoyMcpEnv } from "../app/lib/mcp/spoonjoy-mcp-env.server";
import { callSpoonjoyMcpTool, listSpoonjoyMcpTools } from "../app/lib/mcp/spoonjoy-tools.server";

type RemoteOperation = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

async function getProtocolSafeDb() {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await getLocalDb();
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write;
  }
}

function remoteBaseUrl(): string | null {
  const raw = process.env.SPOONJOY_MCP_API_BASE_URL?.trim();
  if (!raw) return null;
  return new URL(raw).origin;
}

function remoteUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

async function remoteJson(baseUrl: string, path: string, init?: RequestInit & { operation?: string }): Promise<unknown> {
  const headers = new Headers(init?.headers);
  const authorization = spoonjoyRemoteAuthorizationHeader(init?.operation, process.env.SPOONJOY_MCP_API_TOKEN);
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  const response = await fetch(remoteUrl(baseUrl, path), { ...init, headers });
  const payload = await response.json() as {
    ok?: boolean;
    data?: unknown;
    error?: { message?: string };
  };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `Spoonjoy API request failed: ${response.status}`);
  }
  return payload.data;
}

async function remoteTools(baseUrl: string): Promise<RemoteOperation[]> {
  const data = await remoteJson(baseUrl, "/api/tools") as { operations?: RemoteOperation[] };
  return data.operations ?? [];
}

const baseUrl = remoteBaseUrl();
let db: Awaited<ReturnType<typeof getProtocolSafeDb>> | null = null;
let defaultOwnerEmail: string | undefined;
const env = getSpoonjoyMcpEnv(process.env);
let principal: ApiPrincipal | null = null;
const remoteToolList = baseUrl ? await remoteTools(baseUrl) : null;

if (!baseUrl) {
  db = await getProtocolSafeDb();
  defaultOwnerEmail = process.env.SPOONJOY_MCP_API_TOKEN ? undefined : process.env.SPOONJOY_MCP_USER_EMAIL;

  if (process.env.SPOONJOY_MCP_API_TOKEN) {
    principal = await authenticateApiToken(db, process.env.SPOONJOY_MCP_API_TOKEN);
  } else if (defaultOwnerEmail) {
    principal = await principalFromUserEmail(db, defaultOwnerEmail, "environment");
  }
}

const router: JsonRpcToolRouter = {
  listTools() {
    return { tools: remoteToolList ?? listSpoonjoyMcpTools() };
  },
  async callTool(name, args) {
    if (baseUrl) {
      const data = await remoteJson(baseUrl, `/api/tools/${encodeURIComponent(name)}`, {
        method: "POST",
        operation: name,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (name === "poll_agent_connection" && data && typeof data === "object" && "token" in data) {
        process.env.SPOONJOY_MCP_API_TOKEN = String((data as { token: unknown }).token);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    if (!db) throw new Error("Spoonjoy database is unavailable");
    const text = await callSpoonjoyMcpTool(name, args, { db, principal, defaultOwnerEmail, env });
    if (name === "poll_agent_connection") {
      const parsed = JSON.parse(text) as { token?: string };
      if (parsed.token) {
        principal = await authenticateApiToken(db, parsed.token);
      }
    }
    return { content: [{ type: "text", text }] };
  },
};

const reader = createInterface({ input: process.stdin });

const session = createJsonRpcLineSession(router, {
  write(line) {
    process.stdout.write(line);
  },
  async disconnect() {
    await db?.$disconnect();
  },
});

reader.on("line", session.onLine);

reader.on("close", () => {
  session.close()
    .catch(() => undefined)
    .finally(() => process.exit(0));
});
