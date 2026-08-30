export const MCP_PROTOCOL_FIXTURE_METADATA = Object.freeze([
  Object.freeze({
    version: "2025-06-18",
    sources: Object.freeze([
      "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports",
    ]),
  }),
  Object.freeze({
    version: "2026-07-28",
    sources: Object.freeze([
      "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http",
      "https://modelcontextprotocol.io/specification/2026-07-28/server/discover",
      "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning",
      "https://modelcontextprotocol.io/specification/2026-07-28/schema",
    ]),
  }),
]);

export const MCP_SUPPORTED_POST_ACCEPT_CASES = Object.freeze([
  "application/json, text/event-stream",
  "text/event-stream, application/json",
  "Application/Json; q=0.8, Text/Event-Stream;Q=1",
  "application/json; charset=utf-8; q=1, text/event-stream; transport=streamable",
]);

export const MCP_REJECTED_POST_ACCEPT_CASES = Object.freeze([
  undefined,
  "application/json",
  "text/event-stream",
  "text/html",
  "*/*",
  "application/json;q=0, text/event-stream",
  "application/json, text/event-stream;q=0",
  "application/json;q=garbage, text/event-stream",
  "application/json;q=1;q=0, text/event-stream",
]);

export const MCP_UNSUPPORTED_VERSION_CASES = Object.freeze([
  "2024-11-05",
  "2025-11-25",
  "2099-01-01",
  "2025-06-18, 2026-07-28",
]);
