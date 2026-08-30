export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export type ParsedJsonRpcLine =
  | { ok: true; value: unknown }
  | { ok: false; error: JsonRpcFailure };

export interface JsonRpcToolRouter {
  listTools(): { tools: unknown[] };
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown[] }>;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
export const MCP_MODERN_PROTOCOL_VERSION = "2026-07-28";
export const MCP_LEGACY_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_INFO_META = {
  "io.modelcontextprotocol/serverInfo": { name: "spoonjoy", version: "1.0.0" },
};

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

function failure(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestId(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string" || value === null) return value;
  return null;
}

function parseCallParams(params: unknown): { name: string; args: Record<string, unknown> } {
  if (!isObject(params)) throw new Error("tools/call params must be an object");
  if (typeof params.name !== "string" || !params.name.trim()) {
    throw new Error("tools/call params.name is required");
  }
  const rawArgs = params.arguments;
  if (rawArgs === undefined) return { name: params.name, args: {} };
  if (!isObject(rawArgs)) throw new Error("tools/call params.arguments must be an object");
  return { name: params.name, args: rawArgs };
}

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

export interface HandleJsonRpcOptions {
  /** Protocol version to advertise when the client doesn't request one. */
  defaultProtocolVersion?: string;
  /** Exact version already selected by the HTTP transport. */
  protocolVersion?: string;
  /**
   * Called with the raw Error before it's collapsed into a JSON-RPC failure.
   * Lets the transport (e.g. /mcp) report unexpected exceptions to its
   * observability sink without losing the original stack to the wire format.
   */
  onError?: (error: unknown) => void;
  era?: "legacy" | "modern";
}

/**
 * Negotiate the MCP protocol version: echo the client's requested version
 * when it is a non-empty string, otherwise advertise our default. This lets
 * modern clients (which send a newer protocolVersion in `initialize`) agree
 * with the server instead of being pinned to a stale hardcoded value.
 */
function negotiateProtocolVersion(params: unknown, fallback: string): string {
  if (isObject(params) && typeof params.protocolVersion === "string" && params.protocolVersion.trim()) {
    return params.protocolVersion;
  }
  return fallback;
}

/**
 * Transport-agnostic JSON-RPC handler. Takes an already-parsed message
 * (object) and routes it. Shared by the stdio bridge (`handleJsonRpcLine`)
 * and the HTTP MCP endpoint.
 *
 * Returns `null` for notifications (messages with no `id`).
 */
export async function handleJsonRpcMessage(
  parsed: unknown,
  router: JsonRpcToolRouter,
  options: HandleJsonRpcOptions = {},
): Promise<JsonRpcResponse | null> {
  if (!isObject(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
    return failure(requestId(isObject(parsed) ? parsed.id : null), INVALID_REQUEST, "Invalid request");
  }

  const id = requestId(parsed.id);
  if (options.era === "modern") {
    if (parsed.method === "server/discover" && parsed.id !== undefined) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resultType: "complete",
          supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          _meta: {
            ...MCP_SERVER_INFO_META,
          },
          instructions: "Use Spoonjoy tools for authorized kitchen work.",
          ttlMs: 3_600_000,
          cacheScope: "public",
        },
      };
    }
    if (parsed.method !== "tools/list" && parsed.method !== "tools/call") {
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${parsed.method}`);
    }
  }
  if (parsed.id === undefined) return null;

  try {
    switch (parsed.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: negotiateProtocolVersion(
              options.protocolVersion === undefined ? parsed.params : undefined,
              options.protocolVersion ?? options.defaultProtocolVersion ?? DEFAULT_PROTOCOL_VERSION,
            ),
            serverInfo: { name: "spoonjoy", version: "1.0.0" },
            capabilities: { tools: {} },
          },
        };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: options.era === "modern"
            ? {
              resultType: "complete",
              ...router.listTools(),
              ttlMs: 300_000,
              cacheScope: "private",
              _meta: MCP_SERVER_INFO_META,
            }
            : router.listTools(),
        };
      case "tools/call": {
        const call = parseCallParams(parsed.params);
        const result = await router.callTool(call.name, call.args);
        return {
          jsonrpc: "2.0",
          id,
          result: options.era === "modern"
            ? { resultType: "complete", ...result, isError: false, _meta: MCP_SERVER_INFO_META }
            : result,
        };
      }
      default:
        return failure(id, METHOD_NOT_FOUND, `Method not found: ${parsed.method}`);
    }
  } catch (error) {
    if (error instanceof JsonRpcError) {
      return failure(id, error.code, error.message, error.data);
    }
    options.onError?.(error);
    const message = error instanceof Error ? error.message : String(error);
    const code = parsed.method === "tools/call" ? INVALID_PARAMS : INTERNAL_ERROR;
    return failure(id, code, message);
  }
}

export async function handleJsonRpcLine(
  line: string,
  router: JsonRpcToolRouter,
  options: HandleJsonRpcOptions = {},
): Promise<JsonRpcResponse | null> {
  const parsed = parseJsonRpcLine(line);
  if (!parsed.ok) return parsed.error;
  return handleJsonRpcMessage(parsed.value, router, options);
}

export function parseJsonRpcLine(line: string): ParsedJsonRpcLine {
  try {
    return { ok: true, value: JSON.parse(line) as unknown };
  } catch {
    return { ok: false, error: failure(null, PARSE_ERROR, "Parse error") };
  }
}
