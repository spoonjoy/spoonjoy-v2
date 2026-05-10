import { createInterface } from "node:readline";
import { getLocalDb } from "../app/lib/db.server";
import { handleJsonRpcLine, type JsonRpcToolRouter } from "../app/lib/mcp/json-rpc.server";
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

const router: JsonRpcToolRouter = {
  listTools() {
    return { tools: listSpoonjoyMcpTools() };
  },
  async callTool(name, args) {
    const text = await callSpoonjoyMcpTool(name, args, { db, defaultOwnerEmail });
    return { content: [{ type: "text", text }] };
  },
};

const reader = createInterface({ input: process.stdin });

reader.on("line", (line) => {
  handleJsonRpcLine(line, router)
    .then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message } })}\n`);
    });
});

reader.on("close", () => {
  db.$disconnect()
    .catch(() => undefined)
    .finally(() => process.exit(0));
});
