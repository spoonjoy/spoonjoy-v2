import {
  COOK_INTERNAL_ORIGIN,
  COOK_PROTOCOL_HEADER,
  cookErrorResponse,
  cookJsonResponse,
  cookProtocolUnavailableResponse,
  parseCookPatchBody,
} from "./cook-session-protocol";
import {
  expireIdleCookSession,
  readCookSession,
  startCookSession,
  writeCookProgress,
  type CookSessionSqlStorage,
} from "./cook-session-store";

const PROBE_HEADER = "X-Spoonjoy-Internal-Probe";
const PROBE_PATH = "/__bootstrap/probe";
const PROBE_BODY = '{"version":1}';

type CookSessionSqlValue = string | number | ArrayBuffer | null;

interface CookSessionSqlCursor<T extends Record<string, CookSessionSqlValue>> extends Iterable<T> {
  one(): T;
  toArray(): T[];
}

interface CookSessionStorage extends CookSessionSqlStorage {
  sql: {
    exec<T extends Record<string, CookSessionSqlValue> = Record<string, CookSessionSqlValue>>(
      query: string,
      ...bindings: CookSessionSqlValue[]
    ): CookSessionSqlCursor<T>;
  };
}

interface CookSessionState {
  storage: CookSessionStorage;
}

// Protocol-v1 operations this slice implements. Every other recognized internal route (purge,
// complete, abandon, restart, socket) still answers the retryable protocol-unavailable response.
type InternalCookOperation = "detail" | "start" | "patch" | "unavailable";

interface InternalCookRoute {
  operation: InternalCookOperation;
  recipeId: string;
}

function internalCookRoute(request: Request, url: URL): InternalCookRoute | null {
  if (url.origin !== COOK_INTERNAL_ORIGIN || url.search || request.headers.get(COOK_PROTOCOL_HEADER) !== "1") {
    return null;
  }

  const match = /^\/api\/cook-sessions\/([^/]+)(?:\/([a-z]+))?$/.exec(url.pathname);
  if (!match) return null;
  const [, recipeId, action] = match;
  const route = (operation: InternalCookOperation) => ({ operation, recipeId });

  if (request.method === "GET" && action === undefined) return route("detail");
  if (request.method === "GET" && action === "socket") return route("unavailable");
  if (request.method === "PATCH" && action === undefined) return route("patch");
  if (request.method === "DELETE" && action === undefined) return route("unavailable");
  if (request.method === "POST" && action === "start") return route("start");
  if (request.method === "POST" && ["complete", "abandon", "restart"].includes(action ?? "")) {
    return route("unavailable");
  }
  return null;
}

async function clearBootstrapProbeStorage(storage: CookSessionStorage) {
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

export class CookSession {
  constructor(
    private readonly state: CookSessionState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cookRoute = internalCookRoute(request, url);
    if (cookRoute) {
      return this.handleCookRoute(cookRoute, request);
    }

    if (
      url.origin !== COOK_INTERNAL_ORIGIN ||
      url.pathname !== PROBE_PATH ||
      url.search ||
      request.method !== "POST" ||
      request.headers.get(PROBE_HEADER) !== "1" ||
      await request.text() !== PROBE_BODY
    ) {
      return new Response(null, { status: 404 });
    }

    const { storage } = this.state;
    await clearBootstrapProbeStorage(storage);
    let storageKind: string;
    try {
      storage.sql.exec(
        "CREATE TABLE __bootstrap_probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
      );
      storage.sql.exec("INSERT INTO __bootstrap_probe (id, value) VALUES (1, 'sqlite')");
      ({ value: storageKind } = storage.sql.exec<{ value: string }>(
        "SELECT value FROM __bootstrap_probe WHERE id = 1",
      ).one());
    } finally {
      await clearBootstrapProbeStorage(storage);
    }
    const residue = Array.from(storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', '_cf_METADATA') ORDER BY name",
    )).length;

    return Response.json({ ok: true, storage: storageKind, residue });
  }

  async alarm(): Promise<void> {
    await expireIdleCookSession(this.state.storage, Date.now());
  }

  private async handleCookRoute({ operation, recipeId }: InternalCookRoute, request: Request): Promise<Response> {
    const { storage } = this.state;
    if (operation === "detail") {
      // No session yet is an ordinary answer (`state: null`), not an error: every signed-in
      // recipe visit asks, and most recipes have never been cooked by this user.
      return cookJsonResponse({ state: readCookSession(storage) });
    }
    if (operation === "start") {
      const { created, state } = await startCookSession(storage, recipeId, crypto.randomUUID(), Date.now());
      return cookJsonResponse({ state }, created ? 201 : 200);
    }
    if (operation === "patch") {
      return this.patchProgress(storage, await request.text());
    }
    return cookProtocolUnavailableResponse();
  }

  private async patchProgress(storage: CookSessionStorage, text: string): Promise<Response> {
    const body = parseCookPatchBody(text);
    if (!body) {
      return cookErrorResponse(400, "invalid_request", "Cook session request is invalid.");
    }
    const current = readCookSession(storage);
    if (!current) {
      return cookErrorResponse(404, "not_found", "Cook session not found.");
    }
    if (current.attemptId !== body.attemptId) {
      return cookErrorResponse(409, "stale_attempt", "Cook session attempt has changed.", { state: current });
    }
    if (current.revision !== body.expectedRevision) {
      return cookErrorResponse(409, "stale_revision", "Cook session has newer progress.", { state: current });
    }
    const state = await writeCookProgress(storage, current, body.changes, Date.now());
    return cookJsonResponse({ state });
  }
}
