function createRequestHandler() {
  return async function fixtureReactRouterHandler() {
    return new Response(null, { status: 418 });
  };
}
function canonicalizeRequestUrlForHost() {
  return null;
}
class ApiAuthError extends Error {
  constructor(status = 401) {
    super("fixture auth error");
    this.status = status;
  }
}
async function authenticateApiRequest(_db, _request, env) {
  return env.__fixturePrincipal ?? null;
}
async function getDb({ DB }) {
  return DB;
}
async function handleMcpPostRouteRequest() {
  return new Response(null, { status: 404 });
}
function generateNonce() {
  return "fixture-nonce";
}
function withSecurityHeaders(response) {
  return response;
}
const INTERNAL_ORIGIN = "https://cook-session.internal";
const PROTOCOL_HEADER = "X-Spoonjoy-Cook-Protocol";
const PROBE_HEADER = "X-Spoonjoy-Internal-Probe";
const PROBE_PATH = "/__bootstrap/probe";
const PROBE_BODY = '{"version":1}';
const protocolUnavailableBody = {
  error: {
    code: "cook_session_protocol_unavailable",
    message: "Cook session protocol is temporarily unavailable.",
    retryable: true
  }
};
function protocolUnavailableResponse() {
  return Response.json(protocolUnavailableBody, {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store",
      "Retry-After": "1"
    }
  });
}
function isRecognizedInternalCookRoute(request, url) {
  if (url.origin !== INTERNAL_ORIGIN || url.search || request.headers.get(PROTOCOL_HEADER) !== "1") {
    return false;
  }
  const recipePath = "/api/cook-sessions/[^/]+";
  if (request.method === "GET") {
    return new RegExp(`^${recipePath}(?:/socket)?$`).test(url.pathname);
  }
  if (request.method === "PATCH" || request.method === "DELETE") {
    return new RegExp(`^${recipePath}$`).test(url.pathname);
  }
  if (request.method === "POST") {
    return new RegExp(`^${recipePath}/(?:start|complete|abandon|restart)$`).test(url.pathname);
  }
  return false;
}
async function clearBootstrapProbeStorage(storage) {
  try {
    storage.sql.exec("DROP TABLE IF EXISTS __bootstrap_probe");
  } finally {
    try {
      await storage.deleteAll();
    } finally {
      await storage.deleteAlarm();
    }
  }
}
class CookSession {
  constructor(state, _env) {
    this.state = state;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (isRecognizedInternalCookRoute(request, url)) {
      return protocolUnavailableResponse();
    }
    if (url.origin !== INTERNAL_ORIGIN || url.pathname !== PROBE_PATH || url.search || request.method !== "POST" || request.headers.get(PROBE_HEADER) !== "1" || await request.text() !== PROBE_BODY) {
      return new Response(null, { status: 404 });
    }
    const { storage } = this.state;
    await clearBootstrapProbeStorage(storage);
    let storageKind;
    try {
      storage.sql.exec(
        "CREATE TABLE __bootstrap_probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)"
      );
      storage.sql.exec("INSERT INTO __bootstrap_probe (id, value) VALUES (1, 'sqlite')");
      ({ value: storageKind } = storage.sql.exec(
        "SELECT value FROM __bootstrap_probe WHERE id = 1"
      ).one());
    } finally {
      await clearBootstrapProbeStorage(storage);
    }
    const residue = Array.from(storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', '_cf_METADATA') ORDER BY name"
    )).length;
    return Response.json({ ok: true, storage: storageKind, residue });
  }
}
const requestHandler = createRequestHandler();
const COOK_SESSION_PREFIX = "/api/cook-sessions";
const COOK_SESSION_BOOTSTRAP_PATH = "/.well-known/spoonjoy-cook-session-bootstrap";
function cookErrorResponse(status, code, message, retryable = false) {
  return Response.json({ error: { code, message, retryable } }, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}
function cookProtocolUnavailableResponse() {
  const response = cookErrorResponse(
    503,
    "cook_session_protocol_unavailable",
    "Cook session protocol is temporarily unavailable.",
    true
  );
  response.headers.set("Retry-After", "1");
  return response;
}
function configuredCookSessionOrigin(env) {
  if (!env.SPOONJOY_BASE_URL) return null;
  try {
    const url = new URL(env.SPOONJOY_BASE_URL);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
function classifyCookRoute(request, url) {
  if (url.search) return null;
  if (request.method === "GET" && url.pathname === COOK_SESSION_PREFIX) {
    return { scope: "kitchen:read", originRequired: false };
  }
  const recipePath = `${COOK_SESSION_PREFIX}/[^/]+`;
  if (request.method === "GET" && new RegExp(`^${recipePath}$`).test(url.pathname)) {
    return { scope: "kitchen:read", originRequired: false };
  }
  if (request.method === "GET" && new RegExp(`^${recipePath}/socket$`).test(url.pathname)) {
    return { scope: "kitchen:read", originRequired: true };
  }
  if ((request.method === "PATCH" || request.method === "DELETE") && new RegExp(`^${recipePath}$`).test(url.pathname)) {
    return { scope: "kitchen:write", originRequired: true };
  }
  if (request.method === "POST" && new RegExp(`^${recipePath}/(?:start|complete|abandon|restart)$`).test(url.pathname)) {
    return { scope: "kitchen:write", originRequired: true };
  }
  return null;
}
async function handleCookSessionRequest(request, env) {
  const url = new URL(request.url);
  const requirement = classifyCookRoute(request, url);
  if (!requirement) return new Response(null, { status: 404 });
  try {
    const principal = await authenticateApiRequest(
      await getDb({ DB: env.DB }),
      request,
      env
    );
    if (!principal) {
      return cookErrorResponse(401, "authentication_required", "Authentication required.");
    }
    if (principal.source === "bearer" && !principal.scopes.includes(requirement.scope)) {
      return cookErrorResponse(
        403,
        "insufficient_scope",
        "This credential does not include the required cook-session scope."
      );
    }
    if (requirement.originRequired && request.headers.get("Origin") !== configuredCookSessionOrigin(env)) {
      return cookErrorResponse(403, "origin_forbidden", "Request origin is not allowed.");
    }
    return cookProtocolUnavailableResponse();
  } catch (error) {
    if (!(error instanceof ApiAuthError)) throw error;
    if (error.status === 400) {
      return cookErrorResponse(400, "invalid_request", "Authentication request is invalid.");
    }
    return cookErrorResponse(401, "authentication_required", "Authentication required.");
  }
}
async function handleCookSessionBootstrapRequest(request, env) {
  const url = new URL(request.url);
  const workerVersionId = env.CF_VERSION_METADATA?.id;
  const connectingIp = request.headers.get("CF-Connecting-IP");
  const contentLength = request.headers.get("Content-Length");
  if (url.pathname !== COOK_SESSION_BOOTSTRAP_PATH || url.search || request.method !== "POST" || env.COOK_SESSION_BOOTSTRAP_MODE !== "1" || !workerVersionId || !env.COOK_SESSIONS || request.body !== null && contentLength !== "0" || request.headers.has("Content-Type") || request.headers.has("Transfer-Encoding") || ![null, "0"].includes(contentLength) || !connectingIp || !env.AUTH_IP_RATE_LIMITER) {
    return new Response(null, { status: 404 });
  }
  const rateLimit = await env.AUTH_IP_RATE_LIMITER.limit({
    key: `cook-session-bootstrap:${connectingIp}`
  });
  if (!rateLimit.success) return new Response(null, { status: 404 });
  const objectId = env.COOK_SESSIONS.idFromName(`bootstrap:${workerVersionId}`);
  const response = await env.COOK_SESSIONS.get(objectId).fetch(new Request(
    "https://cook-session.internal/__bootstrap/probe",
    {
      method: "POST",
      headers: { "X-Spoonjoy-Internal-Probe": "1" },
      body: new TextEncoder().encode('{"version":1}')
    }
  ));
  const payload = await response.json();
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return Response.json({ ...payload, workerVersionId }, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
function finalizeResponse(response, env, nonce) {
  const finalized = withSecurityHeaders(response);
  const workerVersionId = env.CF_VERSION_METADATA?.id;
  if (workerVersionId) {
    finalized.headers.set("X-Spoonjoy-Worker-Version", workerVersionId);
  }
  return finalized;
}
const _historicalRuntimeEntry = {
  async fetch(request, env, ctx) {
    canonicalizeRequestUrlForHost(request.url, request.headers.get("X-Forwarded-Host")) ?? canonicalizeRequestUrlForHost(request.url, request.headers.get("Host"));
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith(COOK_SESSION_BOOTSTRAP_PATH)) {
        return finalizeResponse(await handleCookSessionBootstrapRequest(request, env), env);
      }
      if (url.pathname.startsWith(COOK_SESSION_PREFIX)) {
        return finalizeResponse(await handleCookSessionRequest(request, env), env);
      }
      if (request.method === "POST" && new URL(request.url).pathname === "/mcp") {
        const response2 = await handleMcpPostRouteRequest(request, {
          cloudflare: { env, ctx }
        });
        return finalizeResponse(response2, env);
      }
      const nonce = generateNonce();
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
        nonce
      });
      return finalizeResponse(response, env, nonce);
    } catch (error) {
      throw error;
    }
  }
};
export {
  CookSession,
  _historicalRuntimeEntry as default
};
