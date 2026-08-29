// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MCP_LEGACY_VERSION,
  MCP_MODERN_VERSION,
  classifyMcpTransportRequest,
  validateModernMcpRequest,
  type McpTransportDecision,
} from "~/lib/mcp/http-mcp-protocol.server";
import {
  MCP_PROTOCOL_FIXTURE_METADATA,
  MCP_REJECTED_POST_ACCEPT_CASES,
  MCP_SUPPORTED_POST_ACCEPT_CASES,
  MCP_UNSUPPORTED_VERSION_CASES,
} from "../../fixtures/mcp/protocol-matrix";

const canonicalOrigin = "https://spoonjoy.app";

function request(method: string, headers: Record<string, string> = {}) {
  return new Request(`${canonicalOrigin}/mcp`, { method, headers });
}

function classify(method: string, headers: Record<string, string> = {}) {
  return classifyMcpTransportRequest(request(method, headers), { canonicalOrigin });
}

function expectProtocol(decision: McpTransportDecision) {
  expect(decision.kind).toBe("protocol");
  if (decision.kind !== "protocol") throw new Error("Expected protocol decision.");
  return decision;
}

function modernMessage(
  id: number | string | null = "discover-1",
  method = "server/discover",
  params: Record<string, unknown> = {},
) {
  return {
    jsonrpc: "2.0" as const,
    id,
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

function modernHeaders(method = "server/discover", name?: string) {
  return new Headers({
    "MCP-Protocol-Version": MCP_MODERN_VERSION,
    "Mcp-Method": method,
    ...(name === undefined ? {} : { "Mcp-Name": name }),
  });
}

function expectModernError(
  result: ReturnType<typeof validateModernMcpRequest>,
  code: number,
  id: number | string | null,
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected modern validation error.");
  expect(result.status).toBe(400);
  expect(result.error).toMatchObject({ jsonrpc: "2.0", id, error: { code } });
}

async function expectJsonResponse(
  decision: McpTransportDecision,
  expected: { status: number; body?: unknown; allow?: string },
) {
  expect(decision.kind).toBe("response");
  if (decision.kind !== "response") throw new Error("Expected response decision.");
  expect(decision.response.status).toBe(expected.status);
  expect(decision.response.headers.get("Content-Type")).toBe(
    expected.status === 204 ? null : "application/json",
  );
  expect(decision.response.headers.get("Allow")).toBe(expected.allow ?? null);
  const body = await decision.response.text();
  if (expected.status === 204) expect(body).toBe("");
  else expect(JSON.parse(body)).toEqual(expected.body);
  return body;
}

describe("MCP HTTP protocol boundary fixtures", () => {
  it("pins the dated source metadata used by this matrix", () => {
    expect(MCP_PROTOCOL_FIXTURE_METADATA).toEqual([
      {
        version: "2025-06-18",
        sources: ["https://modelcontextprotocol.io/specification/2025-06-18/basic/transports"],
      },
      {
        version: "2026-07-28",
        sources: [
          "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http",
          "https://modelcontextprotocol.io/specification/2026-07-28/server/discover",
          "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning",
          "https://modelcontextprotocol.io/specification/2026-07-28/schema",
        ],
      },
    ]);
    expect(Object.isFrozen(MCP_PROTOCOL_FIXTURE_METADATA)).toBe(true);
    expect(MCP_PROTOCOL_FIXTURE_METADATA.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    [undefined, "missing Accept"],
    ["text/html", "HTML"],
    ["application/xhtml+xml, text/html;q=0.7", "positive HTML range"],
  ])("classifies a human GET with %s as landing data (%s)", (accept) => {
    const headers = accept ? { Accept: accept } : {};
    expect(classify("GET", headers)).toEqual({ kind: "landing" });
  });

  it.each(["text/event-stream", "application/json", "text/html;q=0"])(
    "rejects protocol GET Accept %s without returning landing HTML",
    async (accept) => {
      const decision = classify("GET", { Accept: accept });
      const body = await expectJsonResponse(decision, {
        status: 405,
        allow: "GET, POST, OPTIONS",
        body: { error: "method_not_allowed", message: "The MCP endpoint accepts POST." },
      });
      expect(body.toLowerCase()).not.toContain("<html");
      expect(body.toLowerCase()).not.toContain("<!doctype");
      expect(body).not.toContain("Spoonjoy MCP gives");
    },
  );

  it.each(["DELETE", "PUT", "PATCH"])("rejects unsupported %s transport", async (method) => {
    await expectJsonResponse(classify(method), {
      status: 405,
      allow: "GET, POST, OPTIONS",
      body: { error: "method_not_allowed", message: "The MCP endpoint accepts POST." },
    });
  });

  it.each([undefined, canonicalOrigin])("answers OPTIONS for allowed Origin %s", async (origin) => {
    await expectJsonResponse(classify("OPTIONS", origin ? { Origin: origin } : {}), {
      status: 204,
      allow: "GET, POST, OPTIONS",
    });
  });

  it.each([
    "https://evil.example",
    "null",
    "://malformed",
    "https://SPOONJOY.APP",
    "https://spoonjoy.app:443",
    "https://spoonjoy.app.",
    "https://spoonjoy.app/path",
    "https://user@spoonjoy.app",
    "https://spoonjoy.app, https://evil.example",
  ])(
    "rejects present invalid Origin %s before other classification",
    async (origin) => {
      await expectJsonResponse(classify("DELETE", { Origin: origin }), {
        status: 403,
        body: { error: "invalid_origin", message: "Origin is not allowed." },
      });
    },
  );

  it.each(MCP_SUPPORTED_POST_ACCEPT_CASES)("accepts POST media ranges %s", (accept) => {
    expect(expectProtocol(classify("POST", { Accept: accept }))).toEqual({
      kind: "protocol",
      era: "legacy",
      protocolVersion: null,
    });
  });

  it.each(MCP_REJECTED_POST_ACCEPT_CASES)("rejects POST media ranges %s", async (accept) => {
    const headers = accept ? { Accept: accept } : {};
    await expectJsonResponse(classify("POST", headers), {
      status: 406,
      body: {
        error: "not_acceptable",
        message: "MCP POST requests must accept application/json and text/event-stream.",
      },
    });
  });

  it("classifies explicit legacy and modern protocol versions", () => {
    const headers = { Accept: "application/json, text/event-stream" };
    expect(expectProtocol(classify("POST", { ...headers, "MCP-Protocol-Version": MCP_LEGACY_VERSION })))
      .toEqual({ kind: "protocol", era: "legacy", protocolVersion: MCP_LEGACY_VERSION });
    expect(expectProtocol(classify("POST", { ...headers, "MCP-Protocol-Version": MCP_MODERN_VERSION })))
      .toEqual({ kind: "protocol", era: "modern", protocolVersion: MCP_MODERN_VERSION });
  });

  it.each(MCP_UNSUPPORTED_VERSION_CASES)("rejects unsupported protocol version %s", async (version) => {
    expect(classify("POST", {
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": version,
    })).toEqual({ kind: "unsupported", requested: version });
  });
});

describe("modern MCP request metadata validation", () => {
  it("accepts exact metadata and case-insensitive header names", () => {
    const parsed = modernMessage();
    const result = validateModernMcpRequest({ headers: new Headers({
      "mcp-protocol-version": MCP_MODERN_VERSION,
      "mcp-method": "server/discover",
    }) }, parsed);

    expect(result).toEqual({ ok: true, message: parsed });
  });

  it.each([
    ["missing method", modernHeaders(), modernMessage(1), "Mcp-Method"],
    ["method mismatch", modernHeaders("Tools/List"), modernMessage("method-id"), "Mcp-Method"],
    ["missing protocol metadata", modernHeaders(), modernMessage(3), "MCP-Protocol-Version"],
    ["protocol mismatch", modernHeaders(), modernMessage(4), "MCP-Protocol-Version"],
    ["missing protocol header", new Headers({ "Mcp-Method": "server/discover" }), modernMessage(41), "MCP-Protocol-Version"],
    ["protocol header mismatch", new Headers({ "MCP-Protocol-Version": MCP_LEGACY_VERSION, "Mcp-Method": "server/discover" }), modernMessage(42), "MCP-Protocol-Version"],
    ["missing tool name", modernHeaders("tools/call"), modernMessage(5, "tools/call", { name: "search_spoonjoy" }), "Mcp-Name"],
    ["tool name mismatch", modernHeaders("tools/call", "get_shopping_list"), modernMessage(6, "tools/call", { name: "search_spoonjoy" }), "Mcp-Name"],
    ["non-string tool name", modernHeaders("tools/call", "get_shopping_list"), modernMessage(61, "tools/call", { name: 123 }), "Mcp-Name"],
    ["non-string resource URI", modernHeaders("resources/read", "file:///recipe"), modernMessage(62, "resources/read", { uri: false }), "Mcp-Name"],
  ])("rejects %s with HeaderMismatch while preserving the request ID", (_label, headers, message, expectedHeader) => {
    if (_label === "missing method") headers.delete("Mcp-Method");
    if (_label === "missing protocol metadata") {
      delete ((message.params as Record<string, unknown>)._meta as Record<string, unknown>)[
        "io.modelcontextprotocol/protocolVersion"
      ];
    }
    if (_label === "protocol mismatch") {
      ((message.params as Record<string, unknown>)._meta as Record<string, unknown>)[
        "io.modelcontextprotocol/protocolVersion"
      ] = MCP_LEGACY_VERSION;
    }

    const result = validateModernMcpRequest({ headers }, message);

    expectModernError(result, -32020, message.id);
    if (!result.ok) expect(result.error.error.message).toContain(expectedHeader);
  });

  it.each([
    ["missing params", (message: ReturnType<typeof modernMessage>) => {
      delete (message as { params?: unknown }).params;
    }],
    ["missing metadata", (message: ReturnType<typeof modernMessage>) => {
      delete (message.params as { _meta?: unknown })._meta;
    }],
    ["missing capabilities", (message: ReturnType<typeof modernMessage>) => {
      delete ((message.params as Record<string, unknown>)._meta as Record<string, unknown>)[
        "io.modelcontextprotocol/clientCapabilities"
      ];
    }],
    ["malformed client info", (message: ReturnType<typeof modernMessage>) => {
      ((message.params as Record<string, unknown>)._meta as Record<string, unknown>)[
        "io.modelcontextprotocol/clientInfo"
      ] = { name: "fixture-client" };
    }],
  ])("rejects %s as invalid params while preserving a string ID", (_label, mutate) => {
    const message = modernMessage("metadata-id");
    mutate(message);

    expectModernError(validateModernMcpRequest({ headers: modernHeaders() }, message), -32602, "metadata-id");
  });

  it("accepts omitted optional clientInfo but still requires client capabilities", () => {
    const message = modernMessage("anonymous-client-info");
    delete (message.params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientInfo"];

    expect(validateModernMcpRequest({ headers: modernHeaders() }, message)).toEqual({
      ok: true,
      message,
    });
  });

  it("rejects a client-sent response as an invalid request with its ID", () => {
    expectModernError(validateModernMcpRequest(
      { headers: modernHeaders("server/discover") },
      { jsonrpc: "2.0", id: "response-id", result: {} },
    ), -32600, "response-id");
  });

  it("rejects a no-id call to a supported modern request method", () => {
    const message = modernMessage(12, "tools/call", { name: "get_shopping_list" });
    delete (message as { id?: number | string | null }).id;

    expectModernError(validateModernMcpRequest({
      headers: modernHeaders("tools/call", "get_shopping_list"),
    }, message), -32600, null);
  });

  it.each([null, true, { nested: "id" }, ["id"]])(
    "rejects invalid modern request id %j before dispatch",
    (id) => {
      expectModernError(validateModernMcpRequest(
        { headers: modernHeaders() },
        modernMessage(id as never),
      ), -32600, null);
    },
  );

  it("decodes a Base64-sentinel Mcp-Name before comparing a resource URI", () => {
    const message = modernMessage("resource-id", "resources/read", { uri: "file:///café.txt" });
    const result = validateModernMcpRequest({
      headers: modernHeaders("resources/read", "=?base64?ZmlsZTovLy9jYWbDqS50eHQ=?="),
    }, message);

    expect(result).toEqual({ ok: true, message });
  });

  it.each([
    "=?base64?not_base64!?=",
    "=?base64?/w==?=",
  ])("rejects malformed or invalid UTF-8 Mcp-Name sentinel %s", (name) => {
    const message = modernMessage(90, "prompts/get", { name: "weekly-menu" });
    expectModernError(validateModernMcpRequest({
      headers: modernHeaders("prompts/get", name),
    }, message), -32020, 90);
  });

  it("rejects a matching raw non-ASCII Mcp-Name that should use Base64", () => {
    const message = modernMessage(91, "resources/read", { uri: "file:///café.txt" });
    expectModernError(validateModernMcpRequest({
      headers: modernHeaders("resources/read", "file:///café.txt"),
    }, message), -32020, 91);
  });

  it.each([
    ["discover extras", modernMessage(92, "server/discover", { unexpected: true })],
    ["string cursor", modernMessage(93, "tools/list", { cursor: "next-page" })],
    ["non-string cursor", modernMessage(94, "tools/list", { cursor: 2 })],
  ])("rejects unsupported modern params for %s", (_label, message) => {
    expectModernError(validateModernMcpRequest({
      headers: modernHeaders(message.method),
    }, message), -32602, message.id);
  });
});
