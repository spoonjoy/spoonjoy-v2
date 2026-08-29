export const MCP_LEGACY_VERSION = "2025-06-18";
export const MCP_MODERN_VERSION = "2026-07-28";

const MCP_ALLOW_METHODS = "GET, POST, OPTIONS";
const MCP_SUPPORTED_VERSIONS = [MCP_MODERN_VERSION, MCP_LEGACY_VERSION] as const;

export type McpTransportDecision =
  | { kind: "landing" }
  | {
    kind: "protocol";
    era: "legacy" | "modern";
    protocolVersion: typeof MCP_LEGACY_VERSION | typeof MCP_MODERN_VERSION | null;
  }
  | { kind: "response"; response: Response; errorCode?: string };

type McpTransportRequest = Pick<Request, "method" | "headers">;

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

function unsupportedVersionResponse(requested: string): McpTransportDecision {
  return responseDecision(
    jsonResponse({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: MCP_SUPPORTED_VERSIONS, requested },
      },
    }, 400),
    "unsupported_protocol_version",
  );
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
  return unsupportedVersionResponse(protocolVersion);
}
