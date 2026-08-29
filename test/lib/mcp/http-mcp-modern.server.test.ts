import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { handleMcpHttpRequest } from "~/lib/mcp/http-mcp.server";
import { MCP_MODERN_VERSION } from "~/lib/mcp/http-mcp-protocol.server";
import { cleanupDatabase } from "../../helpers/cleanup";

const modernTransport = { era: "modern", protocolVersion: MCP_MODERN_VERSION } as const;

function modernMessage(
  id: number | string | null | undefined,
  method: string,
  params: Record<string, unknown> = {},
) {
  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_MODERN_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "fixture-client", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

function modernRequest(
  body: unknown,
  options: { method?: string; name?: string; token?: string; contentLength?: string } = {},
) {
  const method = options.method ?? (typeof body === "object" && body !== null && "method" in body
    ? String(body.method)
    : "server/discover");
  return new UndiciRequest("https://spoonjoy.app/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_MODERN_VERSION,
      "Mcp-Method": method,
      ...(options.name === undefined ? {} : { "Mcp-Name": options.name }),
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
      ...(options.contentLength === undefined ? {} : { "Content-Length": options.contentLength }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Request;
}

describe("modern MCP HTTP requests", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function token() {
    const user = await db.user.create({
      data: {
        email: `modern-mcp-${faker.string.alphanumeric(8).toLowerCase()}@example.com`,
        username: faker.internet.username(),
      },
    });
    return (await createApiCredential(db, user.id, "modern MCP test")).token;
  }

  it("preserves the canonical OAuth challenge for a valid discover request", async () => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(modernMessage("discover-1", "server/discover")),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://spoonjoy.app/.well-known/oauth-protected-resource/mcp"',
    );
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Authentication required.",
    });
  });

  it("rejects malformed modern metadata before authentication", async () => {
    const message = modernMessage(8, "server/discover");
    delete (message.params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientCapabilities"];

    const response = await handleMcpHttpRequest({
      request: modernRequest(message),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 8,
      error: { code: -32602 },
    });
  });

  it("returns deterministic authenticated server discovery", async () => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(modernMessage("discover-1", "server/discover"), { token: await token() }),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: "discover-1",
      result: {
        resultType: "complete",
        supportedVersions: [MCP_MODERN_VERSION, "2025-06-18"],
        capabilities: { tools: {} },
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "spoonjoy", version: "1.0.0" },
        },
        instructions: "Use Spoonjoy tools for authorized kitchen work.",
        ttlMs: 3_600_000,
        cacheScope: "public",
      },
    });
  });

  it("returns a deterministic privately cacheable modern tool list", async () => {
    const bearer = await token();
    const call = () => handleMcpHttpRequest({
      request: modernRequest(modernMessage("tools-list", "tools/list"), { token: bearer }),
      db,
      transport: modernTransport,
    });

    const first = await call();
    const second = await call();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as { result: { tools: Array<{ name: string }> } };
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
    expect(firstBody).toMatchObject({
      jsonrpc: "2.0",
      id: "tools-list",
      result: {
        resultType: "complete",
        ttlMs: 300_000,
        cacheScope: "private",
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "spoonjoy", version: "1.0.0" },
        },
      },
    });
    expect(firstBody.result.tools.map((tool) => tool.name)).toContain("get_shopping_list");
  });

  it("returns a complete modern tool-call result with the mirrored name", async () => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(
        modernMessage(22, "tools/call", { name: "get_shopping_list", arguments: {} }),
        { name: "get_shopping_list", token: await token() },
      ),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { result: { content: Array<{ text: string }> } };
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 22,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: expect.any(String) }],
        isError: false,
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "spoonjoy", version: "1.0.0" },
        },
      },
    });
    expect(JSON.parse(body.result.content[0].text)).toHaveProperty("shoppingList");
  });

  it.each([
    ["unknown method", modernMessage("unknown-id", "recipes/list"), "recipes/list"],
    ["removed initialize handshake", modernMessage(10, "initialize"), "initialize"],
    ["removed initialized notification", modernMessage(undefined, "notifications/initialized"), "notifications/initialized"],
  ])("returns HTTP 404 and -32601 for %s", async (_label, message, method) => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(message, { method, token: await token() }),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "id" in message ? message.id : null,
      error: { code: -32601 },
    });
  });

  it("returns a modern parse error with HTTP 400 before authentication", async () => {
    const response = await handleMcpHttpRequest({
      request: modernRequest("{ not json"),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it.each([
    ["batch", [{ jsonrpc: "2.0", id: 30, method: "server/discover" }], null],
    ["client response", { jsonrpc: "2.0", id: "response-id", result: {} }, "response-id"],
  ])("rejects a modern JSON-RPC %s with HTTP 400", async (_label, body, id) => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(body),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id,
      error: { code: -32600 },
    });
  });

  it("rejects a no-id modern tool call instead of falsely acknowledging execution", async () => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(
        modernMessage(undefined, "tools/call", { name: "get_shopping_list", arguments: {} }),
        { name: "get_shopping_list" },
      ),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600 },
    });
  });

  it("keeps the body limit ahead of modern parsing and dispatch", async () => {
    const response = await handleMcpHttpRequest({
      request: modernRequest(modernMessage(11, "server/discover"), {
        token: await token(),
        contentLength: String(8 * 1024 * 1024),
      }),
      db,
      transport: modernTransport,
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "request_too_large",
      message: "Request body is too large.",
    });
  });

  it("rejects malformed UTF-8 before authentication or dispatch", async () => {
    const request = new UndiciRequest("https://spoonjoy.app/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_MODERN_VERSION,
        "Mcp-Method": "server/discover",
      },
      body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    }) as unknown as Request;
    const response = await handleMcpHttpRequest({ request, db, transport: modernTransport });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });
});
