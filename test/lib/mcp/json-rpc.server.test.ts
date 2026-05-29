import { describe, expect, it, vi } from "vitest";
import {
  handleJsonRpcLine,
  handleJsonRpcMessage,
  type JsonRpcToolRouter,
} from "~/lib/mcp/json-rpc.server";

function router(overrides: Partial<JsonRpcToolRouter> = {}): JsonRpcToolRouter {
  return {
    listTools: vi.fn(() => ({ tools: [{ name: "health" }] })),
    callTool: vi.fn(async (_name, args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] })),
    ...overrides,
  };
}

describe("json-rpc MCP server", () => {
  it("returns parse and invalid request errors", async () => {
    await expect(handleJsonRpcLine("{", router())).resolves.toMatchObject({
      id: null,
      error: { code: -32700, message: "Parse error" },
    });

    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: { nope: true } }), router())).resolves.toMatchObject({
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });

    await expect(handleJsonRpcLine(JSON.stringify("not an object"), router())).resolves.toMatchObject({
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });

    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "1.0", id: 9, method: "tools/list" }), router())).resolves.toMatchObject({
      id: 9,
      error: { code: -32600, message: "Invalid request" },
    });

    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 10, method: 123 }), router())).resolves.toMatchObject({
      id: 10,
      error: { code: -32600, message: "Invalid request" },
    });
  });

  it("ignores notifications", async () => {
    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }), router())).resolves.toBeNull();
  });

  it("handles initialize", async () => {
    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }), router())).resolves.toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "spoonjoy" },
        capabilities: { tools: {} },
      },
    });
  });

  it("lists tools", async () => {
    const testRouter = router();
    const response = await handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" }), testRouter);

    expect(response).toEqual({ jsonrpc: "2.0", id: "tools", result: { tools: [{ name: "health" }] } });
    expect(testRouter.listTools).toHaveBeenCalledOnce();
  });

  it("calls tools with omitted arguments", async () => {
    const testRouter = router();
    const response = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "health" } }),
      testRouter
    );

    expect(response).toEqual({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "{}" }] } });
    expect(testRouter.callTool).toHaveBeenCalledWith("health", {});
  });

  it("calls tools with object arguments", async () => {
    const testRouter = router();
    await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "pie" } } }),
      testRouter
    );

    expect(testRouter.callTool).toHaveBeenCalledWith("search", { query: "pie" });
  });

  it("rejects invalid tool call params", async () => {
    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call" }), router())).resolves.toMatchObject({
      error: { code: -32602, message: "tools/call params must be an object" },
    });

    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "" } }), router())).resolves.toMatchObject({
      error: { code: -32602, message: "tools/call params.name is required" },
    });

    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "x", arguments: [] } }), router())).resolves.toMatchObject({
      error: { code: -32602, message: "tools/call params.arguments must be an object" },
    });
  });

  it("returns method not found and internal errors", async () => {
    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "missing" }), router())).resolves.toMatchObject({
      error: { code: -32601, message: "Method not found: missing" },
    });

    await expect(handleJsonRpcLine(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list" }), router({ listTools: () => { throw new Error("boom"); } }))).resolves.toMatchObject({
      error: { code: -32603, message: "boom" },
    });

    await expect(handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "explode" } }),
      router({ callTool: async () => { throw "string boom"; } })
    )).resolves.toMatchObject({
      error: { code: -32602, message: "string boom" },
    });
  });

  it("invokes onError with the raw exception before collapsing it to JSON-RPC", async () => {
    // The transport (e.g. /mcp) uses this to report unexpected exceptions to
    // its observability sink — the wire only carries the message+code, so the
    // raw Error has to escape the catch through this side channel.
    const onError = vi.fn();
    const boom = new Error("kaboom");
    const response = await handleJsonRpcLine(
      JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "explode" } }),
      router({ callTool: async () => { throw boom; } }),
      { onError },
    );
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    expect(response).toMatchObject({ error: { code: -32602, message: "kaboom" } });
  });
});

describe("handleJsonRpcMessage (transport-agnostic core)", () => {
  it("routes an already-parsed object without re-parsing JSON", async () => {
    const testRouter = router();
    const response = await handleJsonRpcMessage(
      { jsonrpc: "2.0", id: "p", method: "tools/list" },
      testRouter
    );
    expect(response).toEqual({ jsonrpc: "2.0", id: "p", result: { tools: [{ name: "health" }] } });
  });

  it("returns invalid request for a non-object message", async () => {
    await expect(handleJsonRpcMessage("nope", router())).resolves.toMatchObject({
      id: null,
      error: { code: -32600, message: "Invalid request" },
    });
  });

  it("returns null for notifications (no id)", async () => {
    await expect(
      handleJsonRpcMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, router())
    ).resolves.toBeNull();
  });

  describe("initialize protocol-version negotiation", () => {
    it("echoes the client's requested protocolVersion when it is a non-empty string", async () => {
      const response = await handleJsonRpcMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        router()
      );
      expect(response).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    });

    it("falls back to the default when protocolVersion is absent", async () => {
      const response = await handleJsonRpcMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        router()
      );
      expect(response).toMatchObject({ result: { protocolVersion: "2024-11-05" } });
    });

    it("falls back to the default when protocolVersion is blank or non-string", async () => {
      const blank = await handleJsonRpcMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "   " } },
        router()
      );
      expect(blank).toMatchObject({ result: { protocolVersion: "2024-11-05" } });

      const nonString = await handleJsonRpcMessage(
        { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: 5 } },
        router()
      );
      expect(nonString).toMatchObject({ result: { protocolVersion: "2024-11-05" } });
    });

    it("honors a caller-provided defaultProtocolVersion option", async () => {
      const response = await handleJsonRpcMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        router(),
        { defaultProtocolVersion: "2025-03-26" }
      );
      expect(response).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
    });

    it("ignores params when it is not an object", async () => {
      const response = await handleJsonRpcMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: "garbage" },
        router()
      );
      expect(response).toMatchObject({ result: { protocolVersion: "2024-11-05" } });
    });
  });
});
