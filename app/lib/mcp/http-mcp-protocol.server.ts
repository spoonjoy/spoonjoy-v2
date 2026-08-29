import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
  parseJsonRpcLine,
  type JsonRpcFailure,
  type JsonRpcRequest,
} from "~/lib/mcp/json-rpc.server";
import {
  RequestBodyTooLargeError,
  readLimitedTextBody,
} from "~/lib/request-body-limit.server";

export const MCP_LEGACY_VERSION = MCP_LEGACY_PROTOCOL_VERSION;
export const MCP_MODERN_VERSION = MCP_MODERN_PROTOCOL_VERSION;

const MCP_ALLOW_METHODS = "GET, POST, OPTIONS";
const MCP_SUPPORTED_VERSIONS = [MCP_MODERN_VERSION, MCP_LEGACY_VERSION] as const;

export type McpProtocolContext =
  | { era: "legacy"; protocolVersion: typeof MCP_LEGACY_VERSION | null }
  | { era: "modern"; protocolVersion: typeof MCP_MODERN_VERSION };

export type McpTransportDecision =
  | { kind: "landing" }
  | ({ kind: "protocol" } & McpProtocolContext)
  | { kind: "unsupported"; requested: string }
  | { kind: "response"; response: Response; errorCode?: string };

type McpTransportRequest = Pick<Request, "method" | "headers">;

export type ModernMcpRequestValidation =
  | { ok: true; message: JsonRpcRequest }
  | { ok: false; status: 400; error: JsonRpcFailure };

const HEADER_MISMATCH = -32020;
const INVALID_REQUEST = -32600;
const INVALID_PARAMS = -32602;
const SUPPORTED_MODERN_REQUEST_METHODS = new Set(["server/discover", "tools/list", "tools/call"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestId(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" || value === null
    ? value
    : null;
}

function validationError(
  parsed: unknown,
  code: number,
  message: string,
): ModernMcpRequestValidation {
  return {
    ok: false,
    status: 400,
    error: {
      jsonrpc: "2.0",
      id: requestId(isRecord(parsed) ? parsed.id : null),
      error: { code, message },
    },
  };
}

function decodedHeaderValue(value: string): string | null {
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) {
    return value === value.trim() && /^[\x20-\x7e\t]*$/.test(value) ? value : null;
  }
  const encoded = value.slice(9, -2);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return null;
  }
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function expectedMcpName(method: string, params: Record<string, unknown>): string | null {
  const name = method === "resources/read" ? params.uri : params.name;
  return typeof name === "string" ? name : null;
}

function requiresMcpName(method: string): boolean {
  return method === "tools/call" || method === "resources/read" || method === "prompts/get";
}

export function validateModernMcpRequest(
  request: Pick<Request, "headers">,
  parsed: unknown,
): ModernMcpRequestValidation {
  if (
    !isRecord(parsed) ||
    parsed.jsonrpc !== "2.0" ||
    typeof parsed.method !== "string" ||
    "result" in parsed ||
    "error" in parsed
  ) {
    return validationError(parsed, INVALID_REQUEST, "Invalid request");
  }

  const message = parsed as unknown as JsonRpcRequest;
  if (
    message.id !== undefined &&
    ((typeof message.id !== "string" && typeof message.id !== "number") ||
      (typeof message.id === "number" && !Number.isFinite(message.id)))
  ) {
    return validationError(parsed, INVALID_REQUEST, "Invalid request: modern request id must be a string or number.");
  }
  if (message.id === undefined && SUPPORTED_MODERN_REQUEST_METHODS.has(message.method)) {
    return validationError(parsed, INVALID_REQUEST, "Invalid request: modern request methods require an id.");
  }
  const methodHeader = request.headers.get("Mcp-Method");
  if (methodHeader !== message.method) {
    return validationError(parsed, HEADER_MISMATCH, "Header mismatch: Mcp-Method does not match the request body.");
  }

  if (!isRecord(message.params) || !isRecord(message.params._meta)) {
    return validationError(parsed, INVALID_PARAMS, "Invalid params: modern request metadata is required.");
  }
  const metadata = message.params._meta;
  const protocolHeader = request.headers.get("MCP-Protocol-Version");
  if (
    protocolHeader !== MCP_MODERN_VERSION ||
    metadata["io.modelcontextprotocol/protocolVersion"] !== protocolHeader
  ) {
    return validationError(parsed, HEADER_MISMATCH, "Header mismatch: MCP-Protocol-Version does not match request metadata.");
  }

  const clientInfo = metadata["io.modelcontextprotocol/clientInfo"];
  if (
    clientInfo !== undefined && (
      !isRecord(clientInfo) ||
      typeof clientInfo.name !== "string" ||
      !clientInfo.name ||
      typeof clientInfo.version !== "string" ||
      !clientInfo.version
    )
  ) {
    return validationError(parsed, INVALID_PARAMS, "Invalid params: modern clientInfo is malformed.");
  }
  if (!isRecord(metadata["io.modelcontextprotocol/clientCapabilities"])) {
    return validationError(parsed, INVALID_PARAMS, "Invalid params: modern clientCapabilities are required.");
  }

  if (requiresMcpName(message.method)) {
    const expectedName = expectedMcpName(message.method, message.params);
    const headerName = request.headers.get("Mcp-Name");
    if (expectedName === null || headerName === null || decodedHeaderValue(headerName) !== expectedName) {
      return validationError(parsed, HEADER_MISMATCH, "Header mismatch: Mcp-Name does not match the request body.");
    }
  }

  if (message.method === "server/discover" && Object.keys(message.params).some((key) => key !== "_meta")) {
    return validationError(parsed, INVALID_PARAMS, "Invalid params: server/discover accepts only request metadata.");
  }
  if (message.method === "tools/list" && "cursor" in message.params) {
    return validationError(parsed, INVALID_PARAMS, "Invalid params: tools/list cursor is not valid.");
  }

  return { ok: true, message };
}

function jsonResponse(payload: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function responseDecision(
  response: Response,
  errorCode?: string,
): McpTransportDecision {
  return { kind: "response", response, errorCode };
}

function qualityValue(parameter: string): number | null {
  const separator = parameter.indexOf("=");
  if (separator === -1 || parameter.slice(0, separator).trim().toLowerCase() !== "q") return null;
  const raw = parameter.slice(separator + 1).trim();
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw)) return 0;
  return Number(raw);
}

function acceptsMediaType(header: string | null, requiredType: string): boolean {
  if (!header) return false;
  return header.split(",").some((range) => {
    const [mediaType, ...parameters] = range.split(";");
    if (mediaType.trim().toLowerCase() !== requiredType) return false;
    const qualities = parameters
      .map(qualityValue)
      .filter((value): value is number => value !== null);
    if (qualities.length > 1) return false;
    const quality = qualities[0] ?? 1;
    return quality > 0;
  });
}

function invalidOriginResponse(): McpTransportDecision {
  return responseDecision(
    jsonResponse({ error: "invalid_origin", message: "Origin is not allowed." }, 403),
    "invalid_origin",
  );
}

function methodNotAllowedResponse(): McpTransportDecision {
  return responseDecision(
    jsonResponse(
      { error: "method_not_allowed", message: "The MCP endpoint accepts POST." },
      405,
      { Allow: MCP_ALLOW_METHODS },
    ),
    "method_not_allowed",
  );
}

function notAcceptableResponse(): McpTransportDecision {
  return responseDecision(
    jsonResponse({
      error: "not_acceptable",
      message: "MCP POST requests must accept application/json and text/event-stream.",
    }, 406),
    "not_acceptable",
  );
}

function unsupportedVersionResponse(
  requested: string,
  id: number | string | null,
): Response {
  return jsonResponse({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: MCP_SUPPORTED_VERSIONS, requested },
      },
    }, 400);
}

export async function resolveUnsupportedMcpVersionRequest(
  request: Request,
  requested: string,
): Promise<Response> {
  let id: number | string | null = null;
  try {
    const body = await readLimitedTextBody(request, undefined, { fatalUtf8: true });
    const parsed = parseJsonRpcLine(body);
    if (parsed.ok && isRecord(parsed.value)) {
      const candidate = parsed.value.id;
      if (
        typeof candidate === "string" ||
        (typeof candidate === "number" && Number.isFinite(candidate))
      ) {
        id = candidate;
      }
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse({ error: "request_too_large", message: error.message }, error.status);
    }
  }
  return unsupportedVersionResponse(requested, id);
}

export function classifyMcpTransportRequest(
  request: McpTransportRequest,
  options: { canonicalOrigin: string },
): McpTransportDecision {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== options.canonicalOrigin) return invalidOriginResponse();

  if (request.method === "OPTIONS") {
    return responseDecision(new Response(null, {
      status: 204,
      headers: { Allow: MCP_ALLOW_METHODS },
    }));
  }

  const accept = request.headers.get("Accept");
  if (request.method === "GET") {
    if (accept === null || acceptsMediaType(accept, "text/html")) return { kind: "landing" };
    return methodNotAllowedResponse();
  }
  if (request.method !== "POST") return methodNotAllowedResponse();

  if (
    !acceptsMediaType(accept, "application/json") ||
    !acceptsMediaType(accept, "text/event-stream")
  ) {
    return notAcceptableResponse();
  }

  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  if (protocolVersion === null) {
    return { kind: "protocol", era: "legacy", protocolVersion: null };
  }
  if (protocolVersion === MCP_LEGACY_VERSION) {
    return { kind: "protocol", era: "legacy", protocolVersion };
  }
  if (protocolVersion === MCP_MODERN_VERSION) {
    return { kind: "protocol", era: "modern", protocolVersion };
  }
  return { kind: "unsupported", requested: protocolVersion };
}
