// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MCP_LEGACY_VERSION,
  MCP_MODERN_VERSION,
  classifyMcpTransportRequest,
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
          "https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http",
          "https://modelcontextprotocol.io/specification/draft/server/discover",
          "https://modelcontextprotocol.io/specification/draft/basic/versioning",
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

  it.each(["https://evil.example", "null", "://malformed"])(
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
    await expectJsonResponse(classify("POST", {
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": version,
    }), {
      status: 400,
      body: {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32022,
          message: "Unsupported protocol version",
          data: { supported: [MCP_MODERN_VERSION, MCP_LEGACY_VERSION], requested: version },
        },
      },
    });
  });
});
