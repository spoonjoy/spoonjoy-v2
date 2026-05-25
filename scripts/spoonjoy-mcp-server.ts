import { createInterface } from "node:readline";
import { authenticateApiToken, principalFromUserEmail, type ApiPrincipal } from "../app/lib/api-auth.server";
import { getLocalDb } from "../app/lib/db.server";
import { createJsonRpcLineSession } from "../app/lib/mcp/json-rpc-stdio.server";
import type { JsonRpcToolRouter } from "../app/lib/mcp/json-rpc.server";
import { getSpoonjoyMcpEnv } from "../app/lib/mcp/spoonjoy-mcp-env.server";
import { callSpoonjoyMcpTool, listSpoonjoyMcpTools } from "../app/lib/mcp/spoonjoy-tools.server";

async function getProtocolSafeDb() {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await getLocalDb();
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write;
  }
}

const db = await getProtocolSafeDb();
const defaultOwnerEmail = process.env.SPOONJOY_MCP_USER_EMAIL;
const env = getSpoonjoyMcpEnv(process.env);
let principal: ApiPrincipal | null = null;

if (process.env.SPOONJOY_MCP_API_TOKEN) {
  principal = await authenticateApiToken(db, process.env.SPOONJOY_MCP_API_TOKEN);
} else if (defaultOwnerEmail) {
  principal = await principalFromUserEmail(db, defaultOwnerEmail, "environment");
}

const router: JsonRpcToolRouter = {
  listTools() {
    return { tools: listSpoonjoyMcpTools() };
  },
  async callTool(name, args) {
    const text = await callSpoonjoyMcpTool(name, args, { db, principal, defaultOwnerEmail, env });
    return { content: [{ type: "text", text }] };
  },
};

const reader = createInterface({ input: process.stdin });

const session = createJsonRpcLineSession(router, {
  write(line) {
    process.stdout.write(line);
  },
  async disconnect() {
    await db.$disconnect();
  },
});

reader.on("line", session.onLine);

reader.on("close", () => {
  session.close()
    .catch(() => undefined)
    .finally(() => process.exit(0));
});
