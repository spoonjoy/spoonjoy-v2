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
export {
  CookSession
};
