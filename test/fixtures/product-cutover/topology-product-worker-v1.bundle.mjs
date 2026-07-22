const INTERNAL_KEYS = [
  "phase",
  "operation",
  "recipeId",
  "mutationId",
  "requestHash",
  "expectedOwnerEpoch",
  "expectedAttemptId",
  "expectedRevision",
  "payload",
  "snapshot"
];
class CookSession {
  constructor(_state, _env) {
  }
  async fetch(request) {
    if (request.headers.get("X-Spoonjoy-Cook-Protocol") !== "1" || request.headers.get("X-Spoonjoy-Cook-Operation") !== "recipe") {
      return Response.json({ error: "unsupported_protocol" }, { status: 426 });
    }
    const body = await request.json();
    if (request.method !== "PATCH" || JSON.stringify(Object.keys(body)) !== JSON.stringify(INTERNAL_KEYS) || body.phase !== "apply" || body.operation !== "patch" || body.snapshot !== null) {
      return Response.json({ error: "invalid_internal_request" }, { status: 400 });
    }
    return Response.json({ ok: true, received: body });
  }
}
const COOK_SESSION_PATH = /^\/api\/cook-sessions\/([^/]+)$/;
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const _historicalRuntimeEntry = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = COOK_SESSION_PATH.exec(url.pathname);
    if (!match || request.method !== "PATCH") {
      return new Response(null, { status: 404 });
    }
    if (!env.COOK_SESSIONS) {
      return Response.json({ error: "cook_session_protocol_unavailable" }, { status: 503 });
    }
    if (!env.__fixturePrincipal) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const publicBody = await request.json();
    const payload = {
      activeStepIndex: publicBody.changes.activeStepIndex,
      scaleFactor: publicBody.changes.scaleFactor,
      checkedIngredientIds: publicBody.changes.checkedIngredientIds,
      checkedStepOutputIds: publicBody.changes.checkedStepOutputIds
    };
    const requestHash = await sha256Hex(JSON.stringify({
      operation: "patch",
      recipeId: match[1],
      expectedAttemptId: publicBody.attemptId,
      expectedRevision: publicBody.expectedRevision,
      payload
    }));
    const internalBody = {
      phase: "apply",
      operation: "patch",
      recipeId: match[1],
      mutationId: publicBody.mutationId,
      requestHash,
      expectedOwnerEpoch: null,
      expectedAttemptId: publicBody.attemptId,
      expectedRevision: publicBody.expectedRevision,
      payload,
      snapshot: null
    };
    const objectId = env.COOK_SESSIONS.idFromName(
      `owner:v1:${env.__fixturePrincipal.userId}`
    );
    const response = await env.COOK_SESSIONS.get(objectId).fetch(new Request(
      `https://cook-session.internal${url.pathname}`,
      {
        method: request.method,
        headers: {
          "X-Spoonjoy-Cook-Protocol": "1",
          "X-Spoonjoy-Cook-Operation": "recipe"
        },
        body: new TextEncoder().encode(JSON.stringify(internalBody))
      }
    ));
    const headers = new Headers(response.headers);
    headers.set("X-Spoonjoy-Worker-Runtime", "1");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
export {
  CookSession,
  _historicalRuntimeEntry as default
};
